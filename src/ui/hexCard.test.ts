import { afterEach, describe, expect, it } from 'vitest';
import { encodeHexSet } from '../core/fog.ts';
import { createGame, hexOwner, rememberedBy, visibleTo } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { edit, put } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { setLanguage } from '../shared/i18n.ts';
import { Feature, Terrain } from '../shared/mapData.ts';
import { remember } from './board.ts';
import type { BoardView } from './board.ts';
import { cardLines, hexCard } from './hexCard.ts';
import { sightOf } from './sight.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const BING = 2;
const site = (zone: number): number => map.zones[zone]!.siteHex;
const jiaSeat = map.polities[JIA]!.capitalZone;
const yiSeat = map.polities[YI]!.capitalZone;
const start = createGame(map, { seed: 1, player: 'jia' });

const viewOf = (state: GameState, memory = remember(null, state, sightOf(state)!)): BoardView => ({ sight: sightOf(state)!, memory });
const land = (state: GameState, hex: number): boolean =>
  topo.enterable[hex] === 1 && topo.water[hex] === 0 && !state.units.some((unit) => unit.hex === hex) && !map.zones.some((zone) => zone.siteHex === hex);
/** A free land hex in the player's sight. */
const seenHex = (state: GameState): number => {
  const visible = visibleTo(state, JIA);
  const hex = visible.findIndex((flag, index) => flag === 1 && land(state, index));
  expect(hex).toBeGreaterThanOrEqual(0);
  return hex;
};
/** A free land hex outside the player's sight and land. */
const farHex = (state: GameState, avoid: readonly number[] = []): number => {
  const visible = visibleTo(state, JIA);
  const hex = visible.findIndex((flag, index) => flag === 0 && land(state, index) && hexOwner(state, index) !== JIA && !avoid.includes(index));
  expect(hex).toBeGreaterThanOrEqual(0);
  return hex;
};
/** `state` with `hex` seen before by the player, though not in sight now. */
const explored = (state: GameState, hex: number): GameState =>
  edit(state, (draft) => {
    const seen = rememberedBy(state, JIA);
    seen[hex] = 1;
    draft.explored[JIA] = encodeHexSet(seen);
  });
const text = (state: GameState, hex: number, view: BoardView | null): string =>
  cardLines(hexCard(state, hex, view), map).map((line) => line.parts.join(' · ')).join('\n');

afterEach(() => {
  setLanguage('zh');
});

describe('hexCard for a unit', () => {
  it('names a unit in sight with its owner, hit points, strength, level and status', () => {
    const hex = seenHex(start);
    let id = 0;
    const state = edit(start, (draft) => {
      id = put(draft, 'archer', YI, hex, { hp: 64, level: 2, status: 'fortified' }).id;
    });
    const card = hexCard(state, hex, viewOf(state));
    expect(card.knowledge).toBe('visible');
    expect(card.units).toEqual([{ id, type: 'archer', owner: YI, hp: 64, strength: 14, ranged: 18, level: 2, status: 'fortified' }]);

    setLanguage('en');
    const english = text(state, hex, viewOf(state));
    expect(english).toContain('Archer · Yi');
    expect(english).toContain('HP 64 · Strength 14 · Ranged 18 · Level 2 · Fortified');
    setLanguage('zh');
    const chinese = text(state, hex, viewOf(state));
    expect(chinese).toContain('弓手 · 乙国');
    expect(chinese).toContain('生命 64');
  });

  it('shows the player their own unit wherever it stands, with the order it is travelling under', () => {
    const own = start.units.find((unit) => unit.owner === JIA)!;
    const card = hexCard(start, own.hex, viewOf(start));
    expect(card.units.map((unit) => unit.id)).toEqual([own.id]);
    setLanguage('en');
    const lines = cardLines(card, map, { has: (unit) => unit === own.id });
    expect(lines.find((line) => line.kind === 'unitFacts')?.parts).toContain('Travelling');
  });

  it('leaves out a foreign unit on a hex that is remembered or was never seen', () => {
    const remembered = farHex(start);
    const unseen = farHex(start, [remembered]);
    const state = explored(
      edit(start, (draft) => {
        put(draft, 'warrior', YI, remembered);
        put(draft, 'warrior', BING, unseen);
      }),
      remembered,
    );
    const view = viewOf(state);
    expect(hexCard(state, remembered, view)).toMatchObject({ knowledge: 'remembered', units: [] });
    expect(hexCard(state, unseen, view)).toMatchObject({ knowledge: 'unseen', units: [] });
    // the observer sees both
    expect(hexCard(state, remembered, null).units).toHaveLength(1);
    expect(hexCard(state, unseen, null)).toMatchObject({ knowledge: 'visible', units: [{ owner: BING }] });
  });

  it('lists every unit the player knows of on the hex', () => {
    const hex = seenHex(start);
    const state = edit(start, (draft) => {
      put(draft, 'warrior', YI, hex);
      put(draft, 'settler', YI, hex);
    });
    expect(hexCard(state, hex, viewOf(state)).units.map((unit) => unit.type)).toEqual(['warrior', 'settler']);
  });
});

describe('hexCard for a city', () => {
  it('shows a city in sight with its owner, population and defence', () => {
    const card = hexCard(start, site(jiaSeat), viewOf(start));
    const city = start.cities[jiaSeat]!;
    expect(card.city).toMatchObject({ zone: jiaSeat, owner: JIA, population: city.pop, hp: Math.round(city.hp), remembered: false });
    expect(card.city!.maxHp).toBeGreaterThanOrEqual(card.city!.hp!);
    expect(card.city!.strength).toBeGreaterThan(0);
    setLanguage('en');
    const lines = cardLines(card, map);
    expect(lines.find((line) => line.kind === 'city')?.parts).toEqual([map.zones[jiaSeat]!.cityNameEn, 'Jia']);
    const facts = lines.find((line) => line.kind === 'cityFacts')!.parts;
    expect(facts[0]).toBe(`Population ${city.pop}`);
    expect(facts[1]).toBe(`Defence ${card.city!.hp}/${card.city!.maxHp}`);
    expect(facts[2]).toBe(`Strength ${card.city!.strength}`);
  });

  it('shows a city out of sight as the player remembers it: owner and size, no defence', () => {
    expect(visibleTo(start, JIA)[site(yiSeat)]).toBe(0);
    const memory = remember(null, start, sightOf(start)!);
    const changed = edit(start, (draft) => {
      const city = draft.cities[yiSeat]!;
      city.pop = 9;
      city.owner = BING;
    });
    const card = hexCard(changed, site(yiSeat), viewOf(changed, memory));
    expect(card.knowledge).toBe('unseen');
    expect(card.city).toEqual({ zone: yiSeat, owner: YI, population: 1, hp: null, maxHp: null, strength: null, remembered: true });
    setLanguage('en');
    const lines = cardLines(card, map);
    expect(lines.find((line) => line.kind === 'cityFacts')?.parts).toEqual(['Population 1', 'As last seen']);
    // the observer is shown the city as it is
    expect(hexCard(changed, site(yiSeat), null).city).toMatchObject({ owner: BING, population: 9, remembered: false });
  });

  it('shows no city on a site the player has never seen, and none where they last saw an empty site', () => {
    const empty = map.zones.findIndex((zone, index) => start.cities[index] === null && visibleTo(start, JIA)[zone.siteHex] === 0);
    expect(empty).toBeGreaterThanOrEqual(0);
    const founded = edit(start, (draft) => {
      draft.cities[empty] = { ...draft.cities[yiSeat]!, zone: empty, owner: YI, worked: [], queue: [], buildings: [] };
    });
    const memory = remember(null, start, sightOf(start)!);
    expect(hexCard(founded, site(empty), viewOf(founded, memory)).city).toBeNull();
    expect(hexCard(founded, site(empty), null).city).toMatchObject({ owner: YI });
  });
});

describe('hexCard for the ground', () => {
  it('names terrain, feature, improvement, resource, owner, road and trade route of a hex in sight', () => {
    const hex = seenHex(start);
    const state = edit(start, (draft) => {
      draft.improvements[hex] = 'farm';
      draft.roads[hex] = 1;
      draft.routes.push({ id: 7, owner: YI, from: yiSeat, toCity: jiaSeat, toPort: -1, sea: false, path: [hex], income: 3, pillagedUntil: 0 });
    });
    const card = hexCard(state, hex, viewOf(state));
    expect(card).toMatchObject({
      knowledge: 'visible',
      units: [],
      city: null,
      terrain: map.terrain[hex],
      hills: map.hills[hex] === 1,
      feature: map.feature[hex],
      improvement: 'farm',
      pillaged: false,
      owner: hexOwner(state, hex),
      road: 1,
      routes: [YI],
    });
    setLanguage('en');
    const lines = cardLines(card, map);
    expect(lines.find((line) => line.kind === 'works')?.parts).toEqual(['Farm', 'Road', 'Trade route: Yi']);
    expect(lines.some((line) => line.kind === 'unit' || line.kind === 'city')).toBe(false);
    setLanguage('zh');
    expect(cardLines(card, map).find((line) => line.kind === 'works')?.parts).toEqual(['农田', '道路', '商路：乙国']);
  });

  it('names every terrain and feature in both languages', () => {
    const card = hexCard(start, seenHex(start), viewOf(start));
    for (const language of ['zh', 'en'] as const) {
      setLanguage(language);
      const names = new Set<string>();
      for (const terrain of Object.values(Terrain)) {
        for (const feature of Object.values(Feature)) {
          const ground = cardLines({ ...card, terrain, feature, hills: true }, map).find((line) => line.kind === 'ground')!;
          expect(ground.parts.length).toBe(feature === Feature.None ? 2 : 3);
          for (const part of ground.parts) {
            expect(part).not.toBe('');
            names.add(part);
          }
        }
      }
      // nine terrains, the hills and five features
      expect(names.size).toBe(15);
    }
  });

  it('keeps what the player last saw on a remembered hex, and says so', () => {
    const hex = farHex(start);
    const seen = edit(start, (draft) => {
      draft.improvements[hex] = 'mine';
      put(draft, 'warrior', JIA, topo.neighbors[hex * 6] as number);
    });
    expect(sightOf(seen)!.visible[hex]).toBe(1);
    const memory = remember(null, seen, sightOf(seen)!);
    // the unit leaves; the mine is replaced and a road is laid out of sight
    const later = explored(
      edit(start, (draft) => {
        draft.improvements[hex] = 'farm';
        draft.roads[hex] = 2;
      }),
      hex,
    );
    const card = hexCard(later, hex, viewOf(later, memory));
    expect(card).toMatchObject({ knowledge: 'remembered', improvement: 'mine', road: 0 });
    setLanguage('en');
    const lines = cardLines(card, map);
    expect(lines.find((line) => line.kind === 'works')?.parts).toEqual(['Mine']);
    expect(lines.at(-1)).toEqual({ kind: 'fog', parts: ['As last seen'] });
  });

  it('gives the ground and the owner of a hex never seen, and nothing that stands on it', () => {
    const hex = farHex(start);
    const state = edit(start, (draft) => {
      draft.improvements[hex] = 'farm';
      draft.roads[hex] = 1;
      draft.routes.push({ id: 7, owner: YI, from: yiSeat, toCity: jiaSeat, toPort: -1, sea: false, path: [hex], income: 3, pillagedUntil: 0 });
      put(draft, 'warrior', YI, hex);
    });
    const card = hexCard(state, hex, viewOf(state));
    expect(card).toMatchObject({
      knowledge: 'unseen',
      units: [],
      city: null,
      terrain: map.terrain[hex],
      improvement: null,
      road: 0,
      routes: [],
      owner: hexOwner(state, hex),
    });
    setLanguage('en');
    const lines = cardLines(card, map);
    expect(lines.map((line) => line.kind).filter((kind) => kind !== 'resource')).toEqual(hexOwner(state, hex) < 0 ? ['ground', 'fog'] : ['ground', 'owner', 'fog']);
    expect(lines.at(-1)?.parts).toEqual(['Not seen yet']);
  });

  it('shows the player their own land as it is, in sight or not', () => {
    const own = topo.zoneHexes[jiaSeat]!.find((hex) => hex !== site(jiaSeat))!;
    const state = edit(start, (draft) => {
      draft.improvements[own] = 'pasture';
      draft.pillaged[own] = draft.turn + 2;
    });
    const sight = sightOf(state)!;
    const blind: BoardView = { sight: { ...sight, visible: new Uint8Array(sight.visible.length) }, memory: remember(null, state, sight) };
    const card = hexCard(state, own, blind);
    expect(card).toMatchObject({ improvement: 'pasture', pillaged: true, owner: JIA });
    setLanguage('en');
    expect(cardLines(card, map).find((line) => line.kind === 'works')?.parts).toEqual(['Pasture (pillaged)']);
  });
});
