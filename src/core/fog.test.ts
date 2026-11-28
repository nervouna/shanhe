import { describe, expect, it } from 'vitest';
import { hexDistance, indexToOffset } from '../shared/hex.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { AIR_STRIKE } from './data.ts';
import { cloneState, createCtx } from './context.ts';
import { decodeHexSet, encodeHexSet, knowsCity } from './fog.ts';
import {
  NO_POLITY,
  applyAction,
  createGame,
  endTurn,
  hashState,
  loadGame,
  rememberedBy,
  saveGame,
  visibleHexes,
  visibleTo,
} from './game.ts';
import type { Action, GameEvent, GameState } from './game.ts';
import { KIT } from './kits.ts';
import { around, edit, isPlainGround, put, withAgreement, withCity } from './testUtil.ts';
import { topologyOf } from './topology.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const BING = 2;
const DING = 3;
const count = map.width * map.height;
const site = (zone: number): number => map.zones[zone]!.siteHex;
const apart = (a: number, b: number): number => hexDistance(indexToOffset(a, map.width), indexToOffset(b, map.width));
const hexesOf = (flags: Uint8Array): number[] => [...flags].flatMap((flag, hex) => (flag === 1 ? [hex] : []));
const war = (state: GameState, a: number, b: number): GameState =>
  edit(state, (draft) => {
    draft.relations[`${Math.min(a, b)}:${Math.max(a, b)}`] = {
      a: Math.min(a, b), b: Math.max(a, b), atWar: true, since: draft.turn, offerA: 0, offerB: 0,
    };
  });

/** Jia is the player and Yi the only major: those two remember, Bing and Ding do not. */
const base = createGame(map, { seed: 4, player: 'jia', majors: ['yi'] });
const jiaSeat = site(map.polities[JIA]!.capitalZone);
const yiSeat = site(map.polities[YI]!.capitalZone);
const bingSeat = site(map.polities[BING]!.capitalZone);

describe('encodeHexSet and decodeHexSet', () => {
  it('round-trip a set and write the empty set as nothing', () => {
    const flags = new Uint8Array(count);
    expect(encodeHexSet(flags)).toBe('');
    for (const hex of [0, 5, 6, 77, count - 1]) flags[hex] = 1;
    const text = encodeHexSet(flags);
    expect(text).toHaveLength(Math.ceil(count / 6));
    expect(decodeHexSet(text, count)).toEqual(flags);
    flags[count - 1] = 0;
    expect(encodeHexSet(flags)).toHaveLength(Math.floor(77 / 6) + 1);
    expect(decodeHexSet(encodeHexSet(flags), count)).toEqual(flags);
  });

  it('refuse text that was not written for the map', () => {
    expect(decodeHexSet('?', count)).toBeNull();
    expect(decodeHexSet('BA', count)).toBeNull(); // an empty tail is never written
    expect(decodeHexSet('B'.repeat(Math.ceil(count / 6) + 1), count)).toBeNull();
    expect(decodeHexSet('g', 5)).toBeNull(); // bit 5 lies outside a map of five hexes
    expect(decodeHexSet('', count)).toEqual(new Uint8Array(count));
  });
});

describe('what a polity sees', () => {
  it('is what lies within the vision of its units and its cities', () => {
    const seen = visibleTo(base, JIA);
    for (let hex = 0; hex < count; hex++) {
      // At the start a nation has its capital with a garrison standing in it.
      expect(seen[hex], `hex ${hex}`).toBe(apart(hex, jiaSeat) <= KIT.cityVision ? 1 : 0);
    }
    let scout = 0;
    const far = topo.zoneHexes[map.polities[JIA]!.capitalZone]!.find(
      (hex) => isPlainGround(map, hex) && apart(hex, jiaSeat) === KIT.cityVision + KIT.unitVision,
    )!;
    const scouting = edit(base, (draft) => {
      scout = put(draft, 'warrior', JIA, far).id;
    });
    expect(scout).toBeGreaterThan(0);
    const wider = visibleTo(scouting, JIA);
    for (let hex = 0; hex < count; hex++) {
      const inSight = apart(hex, jiaSeat) <= KIT.cityVision || apart(hex, far) <= KIT.unitVision;
      expect(wider[hex], `hex ${hex}`).toBe(inSight ? 1 : 0);
    }
  });

  it('includes what its allies and its vassals see, and nobody else', () => {
    expect(visibleTo(base, JIA)[yiSeat]).toBe(0);
    const allied = withAgreement(base, 'alliance', JIA, YI);
    expect(visibleTo(allied, JIA)[yiSeat]).toBe(1);
    expect(visibleTo(allied, YI)[jiaSeat]).toBe(1);
    // An overlord sees what its vassal sees; the vassal does not see for its overlord.
    const overlord = withAgreement(base, 'vassalage', JIA, BING);
    expect(visibleTo(overlord, JIA)[bingSeat]).toBe(1);
    expect(visibleTo(overlord, BING)[jiaSeat]).toBe(0);
    // Open borders and a trade pact share nothing.
    const open = withAgreement(withAgreement(base, 'openBorders', JIA, YI), 'tradePact', JIA, YI);
    expect(visibleTo(open, JIA)[yiSeat]).toBe(0);
    // Its own sight alone is still there to ask for.
    expect(visibleHexes(allied, JIA)[yiSeat]).toBe(0);
    expect(visibleHexes(allied, JIA)).toEqual(visibleTo(base, JIA));
  });

  it('is everything for the observer', () => {
    expect(visibleTo(base, NO_POLITY).every((flag) => flag === 1)).toBe(true);
    expect(rememberedBy(base, NO_POLITY).every((flag) => flag === 1)).toBe(true);
  });
});

describe('what a polity remembers', () => {
  // A scout of Jia walks away from the capital, one hex at a time.
  const start = around(map, jiaSeat).find((hex) => isPlainGround(map, hex))!;
  let scout = 0;
  let walked = edit(base, (draft) => {
    scout = put(draft, 'chariot', JIA, start, { moves: 40 }).id;
  });
  const path: number[] = [start];
  for (let step = 0; step < 6; step++) {
    const here = path[path.length - 1]!;
    const next = around(map, here)
      .filter((hex) => isPlainGround(map, hex) && !path.includes(hex))
      .sort((a, b) => apart(b, jiaSeat) - apart(a, jiaSeat) || a - b)[0];
    if (next === undefined) break;
    const result = applyAction(walked, { type: 'move', polity: JIA, unit: scout, to: next });
    if (!result.ok) break;
    walked = result.state;
    path.push(next);
  }
  const end = path[path.length - 1]!;

  it('starts with what it sees on the first turn', () => {
    expect(hexesOf(decodeHexSet(base.explored[JIA]!, count)!)).toEqual(hexesOf(visibleTo(base, JIA)));
    expect(rememberedBy(base, JIA)).toEqual(visibleTo(base, JIA));
  });

  it('keeps every hex a unit has passed, in the state', () => {
    expect(path.length).toBeGreaterThan(3);
    const remembered = rememberedBy(walked, JIA);
    const stored = decodeHexSet(walked.explored[JIA]!, count)!;
    for (const passed of path) {
      for (let hex = 0; hex < count; hex++) {
        if (apart(hex, passed) > KIT.unitVision) continue;
        expect(remembered[hex], `hex ${hex}`).toBe(1);
        expect(stored[hex], `hex ${hex}`).toBe(1);
      }
    }
    // Something it passed is out of sight now, and still remembered.
    const visible = visibleTo(walked, JIA);
    const left = hexesOf(remembered).filter((hex) => visible[hex] === 0);
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((hex) => apart(hex, end) > KIT.unitVision && apart(hex, jiaSeat) > KIT.cityVision)).toBe(true);
    // What it never came near stays unknown.
    expect(remembered[yiSeat]).toBe(0);
  });

  it('grows at the end of a turn with what its allies show it', () => {
    const allied = endTurn(withAgreement(base, 'alliance', JIA, YI)).state;
    expect(visibleTo(allied, JIA)[yiSeat]).toBe(1);
    const alone = edit(allied, (draft) => {
      draft.agreements = [];
    });
    expect(visibleTo(alone, JIA)[yiSeat]).toBe(0);
    expect(rememberedBy(alone, JIA)[yiSeat]).toBe(1);
  });

  it('is kept by the major nations and the player only', () => {
    const later = endTurn(endTurn(walked).state).state;
    expect(later.explored[JIA]).not.toBe('');
    expect(later.explored[YI]).not.toBe('');
    expect(later.explored[BING]).toBe('');
    expect(later.explored[DING]).toBe('');
    // Without a memory, what a polity remembers is what it sees.
    expect(rememberedBy(later, BING)).toEqual(visibleTo(later, BING));
    expect(later.explored).toHaveLength(map.polities.length);
  });

  it('survives a save, and the game goes on from it as before', () => {
    let state = walked;
    for (let i = 0; i < 12; i++) state = endTurn(state).state;
    const loaded = loadGame(saveGame(state), map);
    expect(loaded.explored).toEqual(state.explored);
    expect(rememberedBy(loaded, JIA)).toEqual(rememberedBy(state, JIA));
    expect(hashState(endTurn(loaded).state)).toBe(hashState(endTurn(state).state));
  });

  it('is the same in two games with the same seed', () => {
    const run = (): GameState => {
      let state = createGame(map, { seed: 9 });
      for (let i = 0; i < 40; i++) state = endTurn(state).state;
      return state;
    };
    const first = run();
    expect(first.explored.some((entry) => entry !== '')).toBe(true);
    expect(run().explored).toEqual(first.explored);
    expect(hashState(run())).toBe(hashState(first));
  });
});

describe('fog of war and targets', () => {
  // Jia has an airfield in its capital and is at war with Yi; a unit of Yi stands in range but out of sight.
  const hidden = Array.from({ length: count }, (_, hex) => hex).find(
    (hex) =>
      isPlainGround(map, hex) &&
      apart(hex, jiaSeat) > KIT.cityVision + 1 &&
      apart(hex, jiaSeat) <= AIR_STRIKE.range &&
      around(map, hex).some((next) => isPlainGround(map, next) && apart(next, jiaSeat) > KIT.cityVision),
  )!;
  const spotterHex = around(map, hidden).find((hex) => isPlainGround(map, hex) && apart(hex, jiaSeat) > KIT.cityVision)!;
  const setUp = (player: string | null, spotter: boolean): GameState =>
    edit(war(createGame(map, { seed: 4, player, majors: ['jia'] }), JIA, YI), (draft) => {
      draft.cities[map.polities[JIA]!.capitalZone]!.buildings.push('airfield');
      put(draft, 'warrior', YI, hidden, { status: 'fortified' });
      if (spotter) put(draft, 'warrior', JIA, spotterHex, { moves: 0 });
    });
  const strike: Action = { type: 'airStrike', polity: JIA, city: map.polities[JIA]!.capitalZone, target: hidden };
  const strikes = (events: GameEvent[]): GameEvent[] => events.filter((event) => event.type === 'airStrike');

  it('an air strike needs a unit its owner can see', () => {
    const blind = setUp('jia', false);
    expect(visibleTo(blind, JIA)[hidden]).toBe(0);
    expect(applyAction(blind, strike)).toMatchObject({ ok: false, reason: 'noTarget' });
    const sighted = setUp('jia', true);
    expect(visibleTo(sighted, JIA)[hidden]).toBe(1);
    expect(applyAction(sighted, strike).ok).toBe(true);
    // An ally's eyes will do.
    const lent = edit(withAgreement(blind, 'alliance', JIA, BING), (draft) => {
      put(draft, 'warrior', BING, spotterHex);
    });
    expect(applyAction(lent, strike).ok).toBe(true);
  });

  it('a city is known of without being seen if it is a seat, and otherwise once its site was seen', () => {
    // Yi founds its second city; Jia has never been near it.
    const second = map.zones.findIndex((zone, index) => zone.polity === YI && index !== map.polities[YI]!.capitalZone);
    expect(second).toBeGreaterThanOrEqual(0);
    const state = withCity(base, second, YI);
    const known = (from: GameState, zone: number): boolean => knowsCity(createCtx(cloneState(from)), JIA, from.cities[zone]!);
    expect(visibleTo(state, JIA)[yiSeat]).toBe(0);
    expect(known(state, map.polities[YI]!.capitalZone)).toBe(true);
    expect(visibleTo(state, JIA)[site(second)]).toBe(0);
    expect(known(state, second)).toBe(false);
    // A scout sees the site, then leaves: the city stays known.
    const beside = around(map, site(second)).find((hex) => isPlainGround(map, hex))!;
    let scout = 0;
    const seen = endTurn(
      edit(withAgreement(state, 'openBorders', JIA, YI), (draft) => {
        scout = put(draft, 'warrior', JIA, beside, { status: 'asleep' }).id;
      }),
    ).state;
    const gone = edit(seen, (draft) => {
      draft.units = draft.units.filter((unit) => unit.id !== scout);
    });
    expect(visibleTo(gone, JIA)[site(second)]).toBe(0);
    expect(known(gone, second)).toBe(true);
  });

  it('the AI strikes from the air only at what it sees', () => {
    const blind = endTurn(setUp(null, false));
    expect(strikes(blind.events)).toHaveLength(0);
    const sighted = endTurn(setUp(null, true));
    expect(strikes(sighted.events)).toContainEqual(expect.objectContaining({ owner: JIA, target: hidden }));
  });
});
