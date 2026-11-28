import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { DIPLOMACY } from './data.ts';
import { applyAction, createGame, hashState } from './game.ts';
import type { Action, GameState } from './game.ts';
import { peaceMakesVassal, vassalRoom } from './query.ts';
import { edit, put, withAgreement } from './testUtil.ts';
import { topologyOf } from './topology.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const BING = 2;
const peace: Action = { type: 'makePeace', polity: JIA, target: YI };

/**
 * Jia, played by a human, at war with Yi since turn 1, with an army several
 * times Yi's.
 *
 * @param offered Yi has asked for peace.
 * @param lostCity Yi has lost a city in this war.
 */
function war(offered: boolean, lostCity: boolean): GameState {
  const base = createGame(map, { seed: 5, player: 'jia' });
  const free = topo.zoneHexes[map.polities[JIA]!.capitalZone]!.filter(
    (hex) => topo.enterable[hex] === 1 && topo.water[hex] === 0 && !base.units.some((unit) => unit.hex === hex),
  );
  return edit(base, (draft) => {
    draft.turn = 20;
    draft.relations[`${JIA}:${YI}`] = { a: JIA, b: YI, atWar: true, since: 5, offerA: 0, offerB: offered ? 19 : 0 };
    if (lostCity) draft.polities[YI]!.cityLostOn = 12;
    for (const hex of free.slice(0, 5)) put(draft, 'warrior', JIA, hex);
  });
}

const vassalized = (state: GameState): boolean => {
  const result = applyAction(state, peace);
  if (!result.ok) throw new Error(`peace rejected: ${result.reason}`);
  return result.events.some((event) => event.type === 'vassalized' && event.vassal === YI && event.overlord === JIA);
};

describe('peaceMakesVassal', () => {
  it('says what accepting a peace offer does, as the rules then do it', () => {
    const submission = war(true, true);
    const before = hashState(submission);
    expect(peaceMakesVassal(submission, JIA, YI)).toBe(true);
    expect(hashState(submission)).toBe(before);
    expect(vassalized(submission)).toBe(true);

    // an offer from a nation that has lost no city is a plain peace
    const plain = war(true, false);
    expect(peaceMakesVassal(plain, JIA, YI)).toBe(false);
    expect(vassalized(plain)).toBe(false);
  });

  it('is false while the other side has not asked, and for the side that asked', () => {
    const unasked = war(false, true);
    expect(peaceMakesVassal(unasked, JIA, YI)).toBe(false);
    const result = applyAction(unasked, peace);
    expect(result.ok && result.events.some((event) => event.type === 'vassalized')).toBe(false);
    // the one who asked does not gain a vassal by it
    expect(peaceMakesVassal(war(true, true), YI, JIA)).toBe(false);
  });

  it('is false once the vassals of the era are all taken', () => {
    const full = withAgreement(war(true, true), 'vassalage', JIA, BING);
    expect(vassalRoom(full, JIA)).toEqual({ used: 1, cap: 1 });
    expect(peaceMakesVassal(full, JIA, YI)).toBe(false);
    expect(vassalized(full)).toBe(false);
  });
});

describe('vassalRoom', () => {
  it('counts the living vassals against what the era allows', () => {
    const state = createGame(map, { seed: 5, player: 'jia' });
    expect(vassalRoom(state, JIA)).toEqual({ used: 0, cap: DIPLOMACY.vassalsByEra[0] });
    const later = edit(withAgreement(state, 'vassalage', JIA, BING), (draft) => {
      draft.polities[JIA]!.era = 3;
    });
    expect(vassalRoom(later, JIA)).toEqual({ used: 1, cap: DIPLOMACY.vassalsByEra[3] });
    expect(vassalRoom(later, BING)).toEqual({ used: 0, cap: DIPLOMACY.vassalsByEra[0] });
    const dead = edit(later, (draft) => {
      draft.polities[BING]!.alive = false;
    });
    expect(vassalRoom(dead, JIA).used).toBe(0);
    expect(vassalRoom(state, 99)).toEqual({ used: 0, cap: 0 });
  });
});
