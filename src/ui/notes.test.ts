import { afterEach, describe, expect, it } from 'vitest';
import { createGame } from '../core/game.ts';
import type { GameEvent, GameState } from '../core/game.ts';
import { edit, put, withCity } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { setLanguage } from '../shared/i18n.ts';
import { canPoint, noteDrafts } from './notes.ts';
import { sightOf } from './sight.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const BING = 2;
const site = (zone: number): number => map.zones[zone]!.siteHex;
const yiSeat = map.polities[YI]!.capitalZone;
const bingSeat = map.polities[BING]!.capitalZone;
const played = createGame(map, { seed: 1, player: 'jia' });
const watched = createGame(map, { seed: 1 });

const texts = (state: GameState, events: readonly GameEvent[]): string[] =>
  noteDrafts(state, events, sightOf(state)).map((draft) => draft.text());

afterEach(() => {
  setLanguage('zh');
});

describe('noteDrafts', () => {
  const fall: GameEvent = { type: 'cityCaptured', city: yiSeat, from: YI, to: BING };

  it('does not tell a player of a city that falls out of their sight between others', () => {
    expect(sightOf(played)!.visible[site(yiSeat)]).toBe(0);
    expect(noteDrafts(played, [fall], sightOf(played))).toEqual([]);
    // the observer is told
    expect(texts(watched, [fall])).toHaveLength(1);
  });

  it('tells a player of a city that falls where they can see it', () => {
    const scouting = edit(played, (draft) => {
      put(draft, 'warrior', JIA, topo.neighbors[site(yiSeat) * 6] as number);
    });
    expect(sightOf(scouting)!.visible[site(yiSeat)]).toBe(1);
    const drafts = noteDrafts(scouting, [fall], sightOf(scouting));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.hex).toBe(site(yiSeat));
    expect(drafts[0]!.text()).toContain(map.polities[BING]!.nameZh);
  });

  it('tells a player of what they are a party to, in sight or not', () => {
    const lost: GameEvent = { type: 'cityCaptured', city: map.polities[JIA]!.capitalZone, from: JIA, to: YI };
    const taken: GameEvent = { type: 'cityCaptured', city: yiSeat, from: YI, to: JIA };
    const war: GameEvent = { type: 'warDeclared', by: YI, on: JIA };
    expect(texts(played, [lost, taken, war])).toHaveLength(3);
  });

  it('keeps the wars, annexations and vassals of others from a player, and shows them to the observer', () => {
    const events: GameEvent[] = [
      { type: 'warDeclared', by: YI, on: BING },
      { type: 'peaceMade', a: YI, b: BING },
      { type: 'polityAnnexed', polity: BING, by: YI },
      { type: 'vassalized', vassal: BING, overlord: YI, forced: true } as GameEvent,
      { type: 'unitKilled', unit: 99, owner: YI, hex: site(yiSeat), unitType: 'warrior' },
    ];
    expect(noteDrafts(played, events, sightOf(played))).toEqual([]);
    expect(texts(watched, events)).toHaveLength(4);
  });

  it('drops the earlier peace offers of whoever a new event settles with', () => {
    const offered = noteDrafts(played, [{ type: 'peaceOffered', from: YI, to: JIA }], sightOf(played));
    expect(offered).toHaveLength(1);
    expect(offered[0]!.offer).toEqual({ kind: 'peace', from: YI });
    expect(offered[0]!.settles).toEqual([YI]);
    const made = noteDrafts(played, [{ type: 'peaceMade', a: JIA, b: YI }], sightOf(played));
    expect(made[0]!.settles).toEqual([JIA, YI]);
  });

  it('names a peace offer for what accepting it does', () => {
    const war = edit(played, (draft) => {
      draft.turn = 20;
      draft.relations[`${JIA}:${YI}`] = { a: JIA, b: YI, atWar: true, since: 5, offerA: 0, offerB: 19 };
      const free = topo.zoneHexes[map.polities[JIA]!.capitalZone]!.filter(
        (hex) => topo.enterable[hex] === 1 && topo.water[hex] === 0 && !draft.units.some((unit) => unit.hex === hex),
      );
      for (const hex of free.slice(0, 5)) put(draft, 'warrior', JIA, hex);
    });
    const submits = edit(war, (draft) => {
      draft.polities[YI]!.cityLostOn = 12;
    });
    const offer: GameEvent = { type: 'peaceOffered', from: YI, to: JIA };
    expect(texts(war, [offer])).toEqual(['乙国求和']);
    expect(texts(submits, [offer])).toEqual(['乙国求和，愿为藩属']);
    setLanguage('en');
    expect(texts(submits, [offer])[0]).toContain('vassal');
    expect(texts(war, [offer])[0]).not.toContain('vassal');
    // the text follows the game: once the offer no longer makes a vassal, it no longer says so
    let now = submits;
    const draft = noteDrafts(submits, [offer], sightOf(submits), () => now)[0]!;
    expect(draft.text()).toContain('vassal');
    now = war;
    expect(draft.text()).not.toContain('vassal');
  });
});

describe('canPoint', () => {
  it('points a player only at what they have seen and at the starting capitals', () => {
    const sight = sightOf(played);
    const second = map.zones.findIndex((zone, index) => zone.polity === YI && index !== yiSeat);
    const state = withCity(played, second, YI);
    expect(sightOf(state)!.visible[site(second)]).toBe(0);
    expect(canPoint(state, sightOf(state), site(second))).toBe(false);
    expect(canPoint(played, sight, site(map.polities[JIA]!.capitalZone))).toBe(true);
    // a starting capital is common knowledge
    expect(canPoint(played, sight, site(bingSeat))).toBe(true);
    expect(canPoint(played, sight, -1)).toBe(false);
    // the observer may be pointed anywhere
    expect(canPoint(state, null, site(second))).toBe(true);
  });

  it('gives a notification about a place the player has not seen no hex to fly to', () => {
    const second = map.zones.findIndex((zone, index) => zone.polity === YI && index !== yiSeat);
    const state = withCity(played, second, YI);
    // the player's own unit falls there: they are told, but the map is not opened for them
    const fallen: GameEvent = { type: 'cityCaptured', city: second, from: YI, to: JIA };
    const drafts = noteDrafts(state, [fallen], sightOf(state));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.hex).toBe(-1);
  });
});
