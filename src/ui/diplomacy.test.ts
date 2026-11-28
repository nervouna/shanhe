import { afterEach, describe, expect, it } from 'vitest';
import { DIPLOMACY } from '../core/data.ts';
import { applyAction, createGame } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { edit, learn } from '../core/testUtil.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { setLanguage } from '../shared/i18n.ts';
import {
  agreementsBetween,
  controlReasonText,
  dealsBetween,
  diplomaticControls,
  offersFrom,
  standingWith,
} from './diplomacy.ts';
import type { DiplomaticControl } from './diplomacy.ts';

const map = createFixtureMap();
const JIA = 0;
const nation = (id: string): number => map.polities.findIndex((polity) => polity.id === id);
const YI = nation('yi');
const DING = nation('ding');
const cityState = map.polities.findIndex((polity) => polity.kind === 'cityState');
const wasteland = map.polities.findIndex((polity) => polity.kind === 'wastelandRegion');

const base = createGame(map, { seed: 3, player: 'jia' });

function ids(state: GameState, other: number): string[] {
  return diplomaticControls(state, JIA, other).map((control) => control.id);
}

function control(state: GameState, other: number, id: string): DiplomaticControl {
  const found = diplomaticControls(state, JIA, other).find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no control ${id}`);
  return found;
}

function withFavour(state: GameState, other: number, favour: number): GameState {
  return edit(state, (draft) => {
    draft.favour[`${Math.min(JIA, other)}:${Math.max(JIA, other)}`] = favour;
  });
}

afterEach(() => {
  setLanguage('zh');
});

describe('diplomaticControls', () => {
  it('offers a nation at peace war, every agreement and the gifts', () => {
    expect(ids(base, YI)).toEqual([
      'declareWar',
      'propose:tradePact',
      'propose:openBorders',
      'propose:alliance',
      'propose:vassalage',
      'gift:20',
      'gift:100',
    ]);
  });

  it('gives each control the action the rules accept or the reason they refuse it', () => {
    const friendly = withFavour(edit(base, (draft) => {
      draft.polities[JIA]!.gold = 500;
    }), YI, 80);
    for (const entry of diplomaticControls(friendly, JIA, YI)) {
      const result = applyAction(friendly, entry.action);
      expect(result.ok ? null : result.reason, entry.id).toBe(entry.reason);
    }
    expect(control(friendly, YI, 'propose:alliance').reason).toBeNull();
    expect(control(friendly, YI, 'gift:100').reason).toBeNull();
    // without favour the other side would say no, and without gold there is nothing to give
    expect(control(base, YI, 'propose:alliance').reason).toBe('refused');
    expect(control(base, YI, 'gift:100').reason).toBe('notEnoughGold');
  });

  it('offers only peace at war', () => {
    const war = applyAction(base, { type: 'declareWar', polity: JIA, target: YI }).state;
    expect(ids(war, YI)).toEqual(['makePeace']);
    expect(control(war, YI, 'makePeace').reason).toBe('warTooYoung');
  });

  it('swaps a proposal for a cancellation once the agreement is in force', () => {
    const signed = edit(base, (draft) => {
      draft.agreements.push({ kind: 'tradePact', a: JIA, b: YI, since: 1, until: 30 });
    });
    expect(ids(signed, YI)).toContain('cancel:tradePact');
    expect(ids(signed, YI)).not.toContain('propose:tradePact');
    expect(control(signed, YI, 'cancel:tradePact').reason).toBe('agreementTooYoung');
    const later = edit(signed, (draft) => {
      draft.turn = 1 + DIPLOMACY.minTurns;
    });
    expect(control(later, YI, 'cancel:tradePact').reason).toBeNull();
  });

  it('lets an overlord release its vassal, and gives a vassal no control over its vassalage', () => {
    const overlord = edit(base, (draft) => {
      draft.agreements.push({ kind: 'vassalage', a: JIA, b: YI, since: 1, until: 0 });
      draft.polities[YI]!.overlord = JIA;
    });
    expect(control(overlord, YI, 'cancel:vassalage').reason).toBeNull();
    const vassal = edit(base, (draft) => {
      draft.agreements.push({ kind: 'vassalage', a: YI, b: JIA, since: 1, until: 0 });
      draft.polities[JIA]!.overlord = YI;
    });
    expect(ids(vassal, YI).filter((id) => id.endsWith('vassalage'))).toEqual([]);
    expect(control(vassal, YI, 'declareWar').reason).toBe('vassal');
  });

  it('lists the resource deals both ways and the cancellation of one in force', () => {
    // Jia has horses and Ding has none
    const horsed = learn(base, 'all', ['husbandry']);
    expect(ids(horsed, DING)).toContain('deal:sell:horses');
    const sell = control(horsed, DING, 'deal:sell:horses');
    expect(sell).toMatchObject({ kind: 'deal', buying: false, resource: 'horses' });
    expect(sell.action).toMatchObject({ type: 'proposeDeal', seller: JIA, target: DING });
    const dealt = edit(horsed, (draft) => {
      draft.deals.push({ id: 5, seller: JIA, buyer: DING, resource: 'horses', goldPerTurn: 4, since: 1, until: 20 });
    });
    expect(ids(dealt, DING)).toContain('cancelDeal:5');
    expect(ids(dealt, DING)).not.toContain('deal:sell:horses');
    expect(control(dealt, DING, 'cancelDeal:5').reason).toBeNull();
    expect(dealsBetween(dealt, DING, JIA)).toHaveLength(1);
    expect(dealsBetween(dealt, YI, JIA)).toEqual([]);
  });

  it('offers a city-state war and gifts, and nothing to wasteland, to oneself or in observer mode', () => {
    expect(ids(base, cityState)).toEqual(['declareWar', 'gift:20', 'gift:100']);
    expect(ids(base, wasteland)).toEqual([]);
    expect(ids(base, JIA)).toEqual([]);
    expect(diplomaticControls(createGame(map), -1, YI)).toEqual([]);
  });
});

describe('controlReasonText', () => {
  it('is null for a control the rules accept', () => {
    expect(controlReasonText(control(base, YI, 'declareWar'))).toBeNull();
  });

  it('says that the other side would decline a proposal, in both languages', () => {
    const alliance = control(base, YI, 'propose:alliance');
    expect(controlReasonText(alliance)).toBe('对方不会答应');
    setLanguage('en');
    expect(controlReasonText(alliance)).toBe('They would decline');
  });

  it('uses the rules\' own sentence for every other reason', () => {
    expect(controlReasonText(control(base, YI, 'gift:100'))).toBe('金钱不足');
    const war = applyAction(base, { type: 'declareWar', polity: JIA, target: YI }).state;
    setLanguage('en');
    expect(controlReasonText(control(war, YI, 'makePeace'))).toBe('The war is too young for peace');
    const old = edit(war, (draft) => {
      draft.turn = 30;
      draft.polities[YI]!.warWeariness = 0;
    });
    const peace = control(old, YI, 'makePeace');
    if (peace.reason === 'refused') expect(controlReasonText(peace)).toBe('They refuse peace');
  });
});

describe('standingWith and the lists between two polities', () => {
  it('names the strongest tie', () => {
    expect(standingWith(base, JIA, JIA)).toBe('self');
    expect(standingWith(base, JIA, YI)).toBe('peace');
    const pact = edit(base, (draft) => {
      draft.agreements.push({ kind: 'tradePact', a: JIA, b: YI, since: 1, until: 30 });
    });
    expect(standingWith(pact, JIA, YI)).toBe('friendly');
    expect(agreementsBetween(pact, YI, JIA)).toHaveLength(1);
    const allied = edit(pact, (draft) => {
      draft.agreements.push({ kind: 'alliance', a: JIA, b: YI, since: 1, until: 0 });
    });
    expect(standingWith(allied, JIA, YI)).toBe('alliance');
    const vassal = edit(base, (draft) => {
      draft.agreements.push({ kind: 'vassalage', a: JIA, b: YI, since: 1, until: 0 });
      draft.polities[YI]!.overlord = JIA;
    });
    expect(standingWith(vassal, JIA, YI)).toBe('vassal');
    expect(standingWith(vassal, YI, JIA)).toBe('overlord');
    const war = applyAction(base, { type: 'declareWar', polity: JIA, target: YI }).state;
    expect(standingWith(war, JIA, YI)).toBe('war');
    const truce = edit(base, (draft) => {
      draft.agreements.push({ kind: 'truce', a: JIA, b: YI, since: 1, until: 10 });
    });
    expect(standingWith(truce, JIA, YI)).toBe('truce');
  });

  it('finds the offers of one polity to the player', () => {
    const offered = edit(base, (draft) => {
      draft.offers.push({ id: 3, type: 'agreement', from: YI, to: JIA, turn: 1, agreement: 'openBorders' });
      draft.offers.push({ id: 4, type: 'agreement', from: DING, to: JIA, turn: 1, agreement: 'tradePact' });
    });
    expect(offersFrom(offered, YI).map((offer) => offer.id)).toEqual([3]);
    expect(offersFrom(base, YI)).toEqual([]);
  });
});
