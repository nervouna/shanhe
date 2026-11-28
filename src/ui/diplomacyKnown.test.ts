import { afterEach, describe, expect, it } from 'vitest';
import { DIPLOMACY } from '../core/data.ts';
import { NO_POLITY, createGame } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { labMap } from '../core/kitLab.ts';
import { AMBITIONS, ambitionOf } from '../core/kits.ts';
import { edit, put, withAgreement } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { dictionaries, setLanguage } from '../shared/i18n.ts';
import { knownAmbition, peaceText, vassalRoomText } from './diplomacy.ts';

const fixture = createFixtureMap();
const JIA = 0;
const YI = 1;
const BING = 2;

afterEach(() => {
  setLanguage('zh');
});

describe('knownAmbition', () => {
  // polity 0 is 秦 with its leader; the player is the nation next to it
  const map = labMap('qin');
  const QIN = 0;
  const ME = 1;
  const game = (seed: number): GameState => createGame(map, { seed, player: map.polities[ME]!.id });

  it('is hidden from a player who is neither the nation’s ally nor its overlord', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const state = game(seed);
      expect(knownAmbition(state, ME, QIN), `seed ${seed}`).toBeNull();
      // a trade pact and open borders tell nothing, nor does being its vassal
      expect(knownAmbition(withAgreement(state, 'tradePact', ME, QIN), ME, QIN)).toBeNull();
      expect(knownAmbition(withAgreement(state, 'openBorders', ME, QIN), ME, QIN)).toBeNull();
      expect(knownAmbition(withAgreement(state, 'vassalage', QIN, ME), ME, QIN)).toBeNull();
    }
  });

  it('is known to an ally, to an overlord and to the observer: the one the AI plays by', () => {
    const drawn = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const state = game(seed);
      const real = ambitionOf(seed, QIN, 'qin');
      drawn.add(real);
      expect(knownAmbition(withAgreement(state, 'alliance', ME, QIN), ME, QIN)).toBe(real);
      expect(knownAmbition(withAgreement(state, 'vassalage', ME, QIN), ME, QIN)).toBe(real);
      expect(knownAmbition(state, NO_POLITY, QIN)).toBe(real);
    }
    // the draw differs from game to game, so the checks above are not all about one value
    expect(drawn.size).toBeGreaterThan(1);
  });

  it('is nobody’s to know for a nation that follows none, and for the player’s own', () => {
    const state = edit(game(3), (draft) => {
      draft.majors = draft.majors.filter((polity) => polity !== QIN);
    });
    expect(knownAmbition(withAgreement(state, 'alliance', ME, QIN), ME, QIN)).toBeNull();
    expect(knownAmbition(state, NO_POLITY, QIN)).toBeNull();
    expect(knownAmbition(game(3), ME, ME)).toBeNull();
    expect(knownAmbition(game(3), ME, 99)).toBeNull();
  });

  it('has a name in both languages for every ambition', () => {
    for (const ambition of AMBITIONS) {
      const zh = dictionaries.zh[`ambition.${ambition}`];
      const en = dictionaries.en[`ambition.${ambition}`];
      expect(zh, ambition).toBeTruthy();
      expect(en, ambition).toBeTruthy();
      expect(zh).not.toBe(en);
    }
  });
});

describe('vassalRoomText', () => {
  const start = createGame(fixture, { seed: 5, player: 'jia' });

  it('shows the vassals in use against what the era allows, in both languages', () => {
    expect(vassalRoomText(start, JIA)).toBe(`藩属 0/${DIPLOMACY.vassalsByEra[0]}`);
    const held = withAgreement(start, 'vassalage', JIA, BING);
    expect(vassalRoomText(held, JIA)).toBe(`藩属 1/${DIPLOMACY.vassalsByEra[0]}`);
    setLanguage('en');
    expect(vassalRoomText(held, JIA)).toBe(`Vassals 1/${DIPLOMACY.vassalsByEra[0]}`);
  });

  it('follows the era through the whole table', () => {
    DIPLOMACY.vassalsByEra.forEach((cap, era) => {
      const state = edit(start, (draft) => {
        draft.polities[JIA]!.era = era;
      });
      expect(vassalRoomText(state, JIA), `era ${era}`).toBe(`藩属 0/${cap}`);
    });
  });
});

describe('peaceText', () => {
  const topo = topologyOf(fixture);
  const war = (lostCity: boolean): GameState =>
    edit(createGame(fixture, { seed: 5, player: 'jia' }), (draft) => {
      draft.turn = 20;
      draft.relations[`${JIA}:${YI}`] = { a: JIA, b: YI, atWar: true, since: 5, offerA: 0, offerB: 19 };
      if (lostCity) draft.polities[YI]!.cityLostOn = 12;
      const free = topo.zoneHexes[fixture.polities[JIA]!.capitalZone]!.filter(
        (hex) => topo.enterable[hex] === 1 && topo.water[hex] === 0 && !draft.units.some((unit) => unit.hex === hex),
      );
      for (const hex of free.slice(0, 5)) put(draft, 'warrior', JIA, hex);
    });

  it('says before it is accepted that a peace makes the other a vassal', () => {
    expect(peaceText(war(false), JIA, YI)).toBe('议和');
    expect(peaceText(war(true), JIA, YI)).toBe('求和，愿为藩属');
    setLanguage('en');
    expect(peaceText(war(false), JIA, YI)).toBe('Make peace');
    expect(peaceText(war(true), JIA, YI)).toBe('Peace, as your vassal');
  });
});
