import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { DEAL, DIPLOMACY, FAVOUR, WAR } from './data.ts';
import {
  NO_POLITY,
  agreementsOf,
  applyAction,
  createGame,
  endTurn,
  favourBetween,
  getLegalActions,
  hexOwner,
  loadGame,
  polityHasResource,
  saveGame,
} from './game.ts';
import type { Action, GameEvent, GameState } from './game.ts';
import {
  apply,
  applyWithEvents,
  around,
  edit,
  isPlainGround,
  learn,
  put,
  withAgreement,
  withCity,
  withResource,
  yieldsOf,
} from './testUtil.ts';
import { topologyOf } from './topology.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const BING = 2;
const DING = 3;
const WUCHENG = 4;
const JIADU = 0;
const JIABEI = 1;
const YIDU = 3;
const YIDONG = 4;
const site = (zone: number): number => map.zones[zone]!.siteHex;

/** Jia is the human player. Nobody is a major: every other nation runs the simplified AI and starts no war. */
const base = createGame(map, { seed: 3, player: 'jia', majors: [] });
/** Nobody plays; Yi is a major nation, Bing and Ding are not. */
const observed = createGame(map, { seed: 3, majors: ['yi'] });
const reason = (state: GameState, action: Action): string => {
  const result = applyAction(state, action);
  return result.ok ? 'ok' : result.reason;
};
const turns = (state: GameState, count: number): { state: GameState; events: GameEvent[] } => {
  let current = state;
  const events: GameEvent[] = [];
  for (let i = 0; i < count; i++) {
    const step = endTurn(current);
    current = step.state;
    events.push(...step.events);
  }
  return { state: current, events };
};
const favoured = (state: GameState, a: number, b: number, value: number): GameState =>
  edit(state, (draft) => {
    draft.favour[`${Math.min(a, b)}:${Math.max(a, b)}`] = value;
  });
const atWar = (state: GameState, a: number, b: number): boolean =>
  state.relations[`${Math.min(a, b)}:${Math.max(a, b)}`]?.atWar === true;
const war = (state: GameState, by: number, on: number): GameState => apply(state, { type: 'declareWar', polity: by, target: on });
const propose = (polity: number, target: number, agreement: 'tradePact' | 'openBorders' | 'alliance' | 'vassalage' | 'truce'): Action => ({
  type: 'propose', polity, target, agreement,
});
/** Land of `polity` next to the site of `zone`. */
const beside = (state: GameState, zone: number, polity: number): number =>
  around(map, site(zone)).find((hex) => isPlainGround(map, hex) && hexOwner(state, hex) === polity)!;
/** The favour a shared border alone gives the two: they touch or they do not. */
const border = (a: number, b: number): number =>
  map.zones.some((zone, z) => zone.polity === a && topo.zoneNeighbors[z]!.some((other) => map.zones[other]!.polity === b))
    ? FAVOUR.border
    : 0;
const rich = (state: GameState, polity: number, gold = 500): GameState =>
  edit(state, (draft) => {
    draft.polities[polity]!.gold = gold;
  });

describe('favour', () => {
  it('starts at zero and is worn down by a shared border', () => {
    expect(favourBetween(base, JIA, YI)).toBe(0);
    expect(topo.zoneNeighbors[JIABEI]).toContain(YIDU);
    const later = turns(base, 8).state;
    expect(favourBetween(later, JIA, YI)).toBe(FAVOUR.border);
    // It goes no further than that, and nations that do not touch stay at zero.
    expect(favourBetween(turns(later, 8).state, JIA, YI)).toBe(FAVOUR.border);
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) expect(favourBetween(later, a, b)).toBe(border(a, b));
    }
    // City-states have influence, not favour.
    expect(Object.keys(later.favour).some((key) => key.split(':').includes(String(WUCHENG)))).toBe(false);
  });

  it('falls at once with a declaration of war, sinks during the war and recovers after the peace', () => {
    const fighting = war(base, JIA, YI);
    expect(favourBetween(fighting, JIA, YI)).toBe(FAVOUR.warDeclared);
    const long = turns(fighting, WAR.minTurns).state;
    expect(favourBetween(long, JIA, YI)).toBe(FAVOUR.warDeclared - WAR.minTurns);
    const peace = apply(long, { type: 'makePeace', polity: JIA, target: YI });
    expect(favourBetween(peace, JIA, YI)).toBe(FAVOUR.warDeclared - WAR.minTurns + FAVOUR.peaceMade);
    expect(favourBetween(turns(peace, 5).state, JIA, YI)).toBe(favourBetween(peace, JIA, YI) + 5);
  });

  it('rises with agreements, shared enemies and gifts', () => {
    const pact = withAgreement(base, 'tradePact', JIA, DING);
    expect(favourBetween(turns(pact, 20).state, JIA, DING)).toBe(FAVOUR.tradePact + border(JIA, DING));
    // Jia and Ding are both at war with Bing.
    const allies = war(war(base, JIA, BING), DING, BING);
    expect(favourBetween(turns(allies, 5).state, JIA, DING)).toBe(FAVOUR.sharedEnemy + border(JIA, DING));
    const { state, events } = applyWithEvents(rich(base, JIA), { type: 'gift', polity: JIA, target: DING, amount: 100 });
    expect(events).toEqual([{ type: 'goldGifted', from: JIA, to: DING, amount: 100 }]);
    expect(favourBetween(state, JIA, DING)).toBe(100 / FAVOUR.goldPerPoint);
    expect(state.polities[JIA]!.gold).toBe(400);
    expect(state.polities[DING]!.gold).toBe(base.polities[DING]!.gold + 100);
    expect(reason(base, { type: 'gift', polity: JIA, target: DING, amount: 5 })).toBe('notEnoughGold');
    expect(reason(rich(base, JIA), { type: 'gift', polity: JIA, target: DING, amount: 0 })).toBe('badAmount');
  });

  it('rewards an agreement kept to its term and punishes one that is broken', () => {
    const pact = apply(base, propose(JIA, DING, 'tradePact'));
    const young = turns(pact, 3).state;
    expect(reason(young, { type: 'cancelAgreement', polity: JIA, target: DING, agreement: 'tradePact' })).toBe('agreementTooYoung');
    const old = turns(pact, DIPLOMACY.minTurns).state;
    const before = favourBetween(old, JIA, DING);
    const cancelled = apply(old, { type: 'cancelAgreement', polity: JIA, target: DING, agreement: 'tradePact' });
    expect(favourBetween(cancelled, JIA, DING)).toBe(before + FAVOUR.dealBroken);
    // Attacking a partner costs more than attacking a stranger.
    expect(favourBetween(war(old, JIA, DING), JIA, DING)).toBe(before + FAVOUR.warDeclared + FAVOUR.dealBroken);
    // Kept to the end: the favour the pact built up, and a little more.
    const kept = turns(pact, DIPLOMACY.termTurns);
    expect(kept.events).toContainEqual({ type: 'agreementEnded', agreement: 'tradePact', a: JIA, b: DING, reason: 'expired' });
    expect(agreementsOf(kept.state, JIA)).toHaveLength(0);
    // The reward comes on the last turn of the pact; from then on favour drifts back.
    expect(favourBetween(kept.state, JIA, DING)).toBe(FAVOUR.tradePact + border(JIA, DING) + FAVOUR.dealKept - FAVOUR.drift);
  });
});

describe('agreements', () => {
  it('are proposed with an action and signed at once when an AI accepts', () => {
    const { state, events } = applyWithEvents(base, propose(JIA, DING, 'tradePact'));
    expect(events).toEqual([{ type: 'agreementSigned', agreement: 'tradePact', a: JIA, b: DING }]);
    expect(state.agreements).toEqual([
      { kind: 'tradePact', a: JIA, b: DING, since: 1, until: DIPLOMACY.termTurns },
    ]);
    expect(reason(state, propose(JIA, DING, 'tradePact'))).toBe('alreadyAgreed');
    expect(reason(base, propose(JIA, JIA, 'tradePact'))).toBe('badTarget');
    expect(reason(base, propose(JIA, WUCHENG, 'tradePact'))).toBe('badTarget');
    expect(reason(war(base, JIA, DING), propose(JIA, DING, 'tradePact'))).toBe('atWar');
  });

  it('are accepted or refused by the AI from favour and relative strength', () => {
    // A major weighs favour for every agreement; a nation on the simplified AI takes trade and alliances readily.
    expect(reason(observed, propose(BING, YI, 'tradePact'))).toBe('ok');
    expect(reason(favoured(observed, BING, YI, -30), propose(BING, YI, 'tradePact'))).toBe('refused');
    expect(reason(favoured(observed, BING, DING, -30), propose(BING, DING, 'tradePact'))).toBe('ok');
    expect(reason(observed, propose(BING, YI, 'openBorders'))).toBe('refused');
    expect(reason(favoured(observed, BING, YI, 5), propose(BING, YI, 'openBorders'))).toBe('ok');
    expect(reason(observed, propose(BING, YI, 'alliance'))).toBe('refused');
    expect(reason(favoured(observed, BING, YI, 20), propose(BING, YI, 'alliance'))).toBe('ok');
    expect(reason(observed, propose(BING, DING, 'alliance'))).toBe('ok');
    expect(reason(favoured(observed, BING, DING, -1), propose(BING, DING, 'alliance'))).toBe('refused');
    // Nobody allies with the ally of its enemy.
    const hostile = withAgreement(war(observed, DING, JIA), 'alliance', JIA, BING);
    expect(reason(hostile, propose(BING, DING, 'alliance'))).toBe('refused');
    // Vassalage without a fight: only a far weaker nation on the simplified AI, and only on good terms.
    const strong = edit(favoured(observed, BING, DING, 30), (draft) => {
      const free = topo.zoneHexes[5]!.filter((hex) => isPlainGround(map, hex) && !draft.units.some((unit) => unit.hex === hex));
      for (let i = 0; i < 4; i++) put(draft, 'warrior', BING, free[i]!);
    });
    expect(reason(strong, propose(BING, DING, 'vassalage'))).toBe('ok');
    expect(reason(favoured(strong, BING, DING, 0), propose(BING, DING, 'vassalage'))).toBe('refused');
    expect(reason(favoured(observed, BING, DING, 30), propose(BING, DING, 'vassalage'))).toBe('refused');
    expect(reason(favoured(strong, BING, YI, 90), propose(BING, YI, 'vassalage'))).toBe('refused');
  });

  it('reach the human player as pending offers, like peace offers', () => {
    const { state, events } = applyWithEvents(base, propose(YI, JIA, 'tradePact'));
    expect(state.agreements).toHaveLength(0);
    expect(state.offers).toEqual([{ id: 1, type: 'agreement', from: YI, to: JIA, turn: 1, agreement: 'tradePact' }]);
    expect(events).toEqual([{ type: 'offerMade', offer: state.offers[0] }]);
    expect(reason(state, propose(YI, JIA, 'tradePact'))).toBe('alreadyOffered');
    expect(reason(state, { type: 'respond', polity: JIA, offer: 7, accept: true })).toBe('noSuchOffer');
    expect(reason(state, { type: 'respond', polity: YI, offer: 1, accept: true })).toBe('noSuchOffer');
    expect(getLegalActions(state, JIA).filter((action) => action.type === 'respond')).toHaveLength(2);

    const accepted = applyWithEvents(state, { type: 'respond', polity: JIA, offer: 1, accept: true });
    expect(accepted.state.offers).toHaveLength(0);
    expect(accepted.state.agreements.map((agreement) => agreement.kind)).toEqual(['tradePact']);
    expect(accepted.events).toContainEqual({ type: 'offerAnswered', offer: 1, from: YI, to: JIA, accepted: true });

    const declined = applyWithEvents(state, { type: 'respond', polity: JIA, offer: 1, accept: false });
    expect(declined.state.offers).toHaveLength(0);
    expect(declined.state.agreements).toHaveLength(0);
    expect(declined.events).toEqual([{ type: 'offerAnswered', offer: 1, from: YI, to: JIA, accepted: false }]);

    // An offer that is no longer possible does nothing when accepted, and an unanswered one lapses.
    const stale = applyWithEvents(withAgreement(state, 'tradePact', JIA, YI), { type: 'respond', polity: JIA, offer: 1, accept: true });
    expect(stale.state.agreements.filter((agreement) => agreement.kind === 'tradePact')).toHaveLength(1);
    expect(stale.events).toEqual([{ type: 'offerAnswered', offer: 1, from: YI, to: JIA, accepted: false }]);
    // A war between the two withdraws it.
    expect(war(state, YI, JIA).offers).toHaveLength(0);
    const lapsed = turns(state, DIPLOMACY.offerTurns);
    expect(lapsed.state.offers).toHaveLength(0);
    expect(lapsed.events).toContainEqual({ type: 'offerAnswered', offer: 1, from: YI, to: JIA, accepted: false });
  });

  it('trade pact: lasts its term and ends with a war', () => {
    const pact = apply(base, propose(JIA, DING, 'tradePact'));
    const fighting = applyWithEvents(pact, { type: 'declareWar', polity: JIA, target: DING });
    expect(fighting.state.agreements).toHaveLength(0);
    expect(fighting.events).toContainEqual({ type: 'agreementEnded', agreement: 'tradePact', a: JIA, b: DING, reason: 'war' });
    expect(turns(pact, DIPLOMACY.termTurns - 1).state.agreements).toHaveLength(1);
    expect(turns(pact, DIPLOMACY.termTurns).state.agreements).toHaveLength(0);
  });

  it('open borders: units may enter and pass, and go home when it ends', () => {
    const [inside] = [beside(base, YIDU, YI)];
    const edge = around(map, inside!).find((hex) => isPlainGround(map, hex) && hexOwner(base, hex) === YI && hex !== site(YIDU))!;
    let scout = 0;
    const placed = edit(favoured(base, JIA, YI, 10), (draft) => {
      scout = put(draft, 'warrior', JIA, edge).id;
    });
    // The unit was put there by hand; a step deeper into Yi's land is refused without an agreement.
    expect(reason(placed, { type: 'move', polity: JIA, unit: scout, to: inside! })).toBe('closedBorders');
    const open = apply(placed, propose(JIA, YI, 'openBorders'));
    expect(reason(open, { type: 'move', polity: JIA, unit: scout, to: inside! })).toBe('ok');
    // A foreign city stays closed.
    const next = apply(open, { type: 'move', polity: JIA, unit: scout, to: inside! });
    expect(reason(edit(next, (draft) => {
      draft.units.find((unit) => unit.id === scout)!.moves = 2;
    }), { type: 'move', polity: JIA, unit: scout, to: site(YIDU) })).toBe('hexOccupied');
    const ended = turns(next, DIPLOMACY.termTurns);
    expect(ended.events.some((event) => event.type === 'unitExpelled' && event.unit === scout)).toBe(true);
    expect(hexOwner(ended.state, ended.state.units.find((unit) => unit.id === scout)!.hex)).not.toBe(YI);
  });

  it('alliance: joins the ally\'s defensive wars, and only those', () => {
    const allied = apply(favoured(base, JIA, YI, 30), propose(JIA, YI, 'alliance'));
    expect(allied.stats.alliancesFormed).toBe(1);
    expect(allied.agreements).toEqual([{ kind: 'alliance', a: JIA, b: YI, since: 1, until: 0 }]);
    expect(reason(allied, { type: 'declareWar', polity: JIA, target: YI })).toBe('allied');
    // Bing attacks Yi: Jia is at war with Bing too.
    const attacked = applyWithEvents(allied, { type: 'declareWar', polity: BING, target: YI });
    expect(attacked.events.filter((event) => event.type === 'warDeclared')).toEqual([{ type: 'warDeclared', by: BING, on: YI }]);
    expect(attacked.events).toContainEqual({ type: 'warJoined', polity: JIA, against: BING, with: YI });
    expect(atWar(attacked.state, JIA, BING)).toBe(true);
    expect(attacked.state.stats.warsDeclared).toBe(1);
    expect(favourBetween(attacked.state, JIA, BING)).toBe(FAVOUR.allyAttacked);
    // Yi attacks Ding: that is Yi's own war.
    const aggressor = war(allied, YI, DING);
    expect(atWar(aggressor, YI, DING)).toBe(true);
    expect(atWar(aggressor, JIA, DING)).toBe(false);
    // An alliance opens the borders between the two.
    let scout = 0;
    const placed = edit(allied, (draft) => {
      scout = put(draft, 'warrior', JIA, beside(base, YIDU, YI)).id;
    });
    const deeper = around(map, beside(base, YIDU, YI)).find((hex) => isPlainGround(map, hex) && hexOwner(base, hex) === YI)!;
    expect(reason(placed, { type: 'move', polity: JIA, unit: scout, to: deeper })).toBe('ok');
  });

  it('alliance: is limited in number and ends when cancelled', () => {
    expect(DIPLOMACY.maxAlliances).toBe(2);
    let state = favoured(favoured(favoured(base, JIA, YI, 30), JIA, BING, 30), JIA, DING, 30);
    state = apply(state, propose(JIA, YI, 'alliance'));
    state = apply(state, propose(JIA, BING, 'alliance'));
    expect(reason(state, propose(JIA, DING, 'alliance'))).toBe('tooManyAlliances');
    expect(reason(state, { type: 'cancelAgreement', polity: JIA, target: YI, agreement: 'alliance' })).toBe('agreementTooYoung');
    const old = turns(state, DIPLOMACY.minTurns).state;
    const { state: ended, events } = applyWithEvents(old, { type: 'cancelAgreement', polity: JIA, target: YI, agreement: 'alliance' });
    expect(events).toContainEqual({ type: 'agreementEnded', agreement: 'alliance', a: JIA, b: YI, reason: 'cancelled' });
    expect(agreementsOf(ended, YI)).toHaveLength(0);
    expect(reason(ended, { type: 'cancelAgreement', polity: JIA, target: YI, agreement: 'alliance' })).toBe('noSuchAgreement');
    // After that Bing's attack on Yi is no longer Jia's business.
    expect(atWar(war(ended, DING, YI), JIA, DING)).toBe(false);
  });

  it('truce: follows every peace and forbids a new war until it runs out', () => {
    const fighting = turns(war(base, JIA, YI), WAR.minTurns).state;
    const peace = applyWithEvents(fighting, propose(JIA, YI, 'truce'));
    expect(peace.events.map((event) => event.type)).toContain('peaceMade');
    expect(peace.state.agreements).toEqual([
      { kind: 'truce', a: JIA, b: YI, since: peace.state.turn, until: peace.state.turn + WAR.truceTurns - 1 },
    ]);
    expect(reason(peace.state, { type: 'declareWar', polity: JIA, target: YI })).toBe('truce');
    expect(reason(peace.state, propose(JIA, YI, 'truce'))).toBe('notAtWar');
    const over = turns(peace.state, WAR.truceTurns).state;
    expect(over.agreements).toHaveLength(0);
    expect(reason(over, { type: 'declareWar', polity: JIA, target: YI })).toBe('ok');
  });
});

describe('vassalage', () => {
  /** Jia at war with Yi, a Jia swordsman at the gates of Yi's capital, which has fallen to 0 HP. */
  const siege = (state: GameState): { state: GameState; unit: number } => {
    let unit = 0;
    const ready = edit(war(state, JIA, YI), (draft) => {
      unit = put(draft, 'swordsman', JIA, beside(state, YIDU, YI)).id;
      draft.cities[YIDU]!.hp = 0;
    });
    return { state: ready, unit };
  };
  const demand = (unit: number, zone = YIDU): Action => ({ type: 'demandVassalage', polity: JIA, unit, target: site(zone) });

  it('can be demanded at a fallen capital instead of taking the city', () => {
    const { state, unit } = siege(base);
    const result = applyWithEvents(state, demand(unit));
    const yi = result.state.polities[YI]!;
    expect(yi.overlord).toBe(JIA);
    expect(result.state.cities[YIDU]!.owner).toBe(YI);
    expect(result.state.cities[YIDU]!.hp).toBeGreaterThan(0);
    expect(atWar(result.state, JIA, YI)).toBe(false);
    expect(result.state.stats.vassalsMade).toBe(1);
    expect(result.state.stats.citiesCaptured).toBe(0);
    expect(result.events).toContainEqual({ type: 'vassalized', vassal: YI, overlord: JIA, forced: true });
    expect(result.events).toContainEqual({ type: 'peaceMade', a: JIA, b: YI });
    expect(agreementsOf(result.state, YI).map((agreement) => agreement.kind)).toContain('vassalage');
    // The same unit could have taken the city instead.
    expect(apply(state, { type: 'attack', polity: JIA, unit, target: site(YIDU) }).cities[YIDU]!.owner).toBe(JIA);
  });

  it('cannot be demanded of a standing city, a city that is no capital, a city-state or a vassal', () => {
    const { state, unit } = siege(base);
    const standing = edit(state, (draft) => {
      draft.cities[YIDU]!.hp = 50;
    });
    expect(reason(standing, demand(unit))).toBe('cityNotFallen');
    expect(reason(base, demand(1))).toBe('atPeace');
    const second = edit(withCity(war(base, JIA, YI), YIDONG, YI), (draft) => {
      draft.cities[YIDONG]!.hp = 0;
      put(draft, 'swordsman', JIA, beside(base, YIDONG, YI), { id: 900 });
    });
    expect(reason(second, { type: 'demandVassalage', polity: JIA, unit: 900, target: site(YIDONG) })).toBe('notACapital');
    const cityState = edit(war(base, JIA, WUCHENG), (draft) => {
      draft.cities[8]!.hp = 0;
      put(draft, 'swordsman', JIA, beside(base, 8, WUCHENG), { id: 901 });
    });
    expect(reason(cityState, { type: 'demandVassalage', polity: JIA, unit: 901, target: site(8) })).toBe('badTarget');
    const taken = apply(state, demand(unit));
    expect(reason(taken, demand(unit))).not.toBe('ok');
  });

  it('makes the vassal pay 20% of its income', () => {
    expect(DIPLOMACY.vassalTributePercent).toBe(20);
    const vassal = edit(withAgreement(base, 'vassalage', JIA, YI), (draft) => {
      draft.cities[YIDU]!.pop = 18;
      draft.cities[YIDU]!.focus = 'gold';
    });
    const free = edit(base, (draft) => {
      draft.cities[YIDU]!.pop = 18;
      draft.cities[YIDU]!.focus = 'gold';
    });
    const after = endTurn(vassal).state;
    const without = endTurn(free).state;
    const income = after.polities[YI]!.yields.gold;
    const tribute = Math.floor(income * 0.2);
    expect(tribute).toBeGreaterThan(0);
    expect(after.polities[YI]!.tributePaid).toBe(tribute);
    expect(after.polities[JIA]!.tributeReceived).toBe(tribute);
    expect(after.polities[JIA]!.gold).toBe(without.polities[JIA]!.gold + tribute);
    expect(after.polities[YI]!.gold).toBe(without.polities[YI]!.gold - tribute);
    // Tribute is income for the overlord, and the vassal's gross income is not reduced.
    expect(after.polities[JIA]!.grossIncome).toBe(without.polities[JIA]!.grossIncome + tribute);
    expect(after.polities[YI]!.grossIncome).toBe(without.polities[YI]!.grossIncome);
  });

  it('draws the vassal into its overlord\'s wars and out of them again', () => {
    const vassal = apply(siege(base).state, demand(siege(base).unit));
    // The overlord attacks.
    const attack = applyWithEvents(vassal, { type: 'declareWar', polity: JIA, target: BING });
    expect(atWar(attack.state, YI, BING)).toBe(true);
    expect(attack.events).toContainEqual({ type: 'warJoined', polity: YI, against: BING, with: JIA });
    // The overlord is attacked.
    const defence = war(vassal, DING, JIA);
    expect(atWar(defence, YI, DING)).toBe(true);
    // Peace with the overlord is peace with the vassal.
    const peace = apply(turns(attack.state, WAR.minTurns).state, { type: 'makePeace', polity: JIA, target: BING });
    expect(atWar(peace, JIA, BING)).toBe(false);
    expect(atWar(peace, YI, BING)).toBe(false);
    // A vassal has no wars of its own, and war on it is declared on its overlord.
    expect(reason(vassal, { type: 'declareWar', polity: YI, target: BING })).toBe('vassal');
    expect(reason(vassal, { type: 'declareWar', polity: BING, target: YI })).toBe('vassal');
    expect(reason(vassal, { type: 'declareWar', polity: JIA, target: YI })).toBe('vassal');
    expect(reason(turns(attack.state, WAR.minTurns).state, { type: 'makePeace', polity: YI, target: BING })).toBe('vassal');
    expect(reason(vassal, propose(YI, BING, 'alliance'))).toBe('vassal');
  });

  it('ends the wars the new vassal had that its overlord is not in, and joins those it is in', () => {
    // Yi is at war with Ding (its own war) and Jia with Bing.
    const { state, unit } = siege(war(war(base, YI, DING), JIA, BING));
    const after = apply(state, demand(unit));
    expect(atWar(after, YI, DING)).toBe(false);
    expect(atWar(after, YI, BING)).toBe(true);
    expect(atWar(after, YI, JIA)).toBe(false);
  });

  it('frees the vassal when its overlord loses its own capital, lets it go, or is annexed', () => {
    const vassal = withAgreement(withCity(base, JIABEI, JIA), 'vassalage', JIA, YI);
    let taker = 0;
    const falling = edit(war(vassal, BING, JIA), (draft) => {
      draft.cities[JIADU]!.hp = 0;
      for (const unit of draft.units.filter((entry) => entry.hex === site(JIADU))) draft.units.splice(draft.units.indexOf(unit), 1);
      taker = put(draft, 'swordsman', BING, beside(base, JIADU, JIA)).id;
    });
    const fallen = applyWithEvents(falling, { type: 'attack', polity: BING, unit: taker, target: site(JIADU) });
    expect(fallen.state.cities[JIADU]!.owner).toBe(BING);
    expect(fallen.state.polities[JIA]!.alive).toBe(true);
    expect(fallen.state.polities[YI]!.overlord).toBe(NO_POLITY);
    expect(fallen.events).toContainEqual({ type: 'vassalReleased', vassal: YI, overlord: JIA, reason: 'capitalLost' });
    expect(agreementsOf(fallen.state, YI).filter((agreement) => agreement.kind === 'vassalage')).toHaveLength(0);

    // Losing another city changes nothing.
    const other = edit(war(vassal, BING, JIA), (draft) => {
      draft.cities[JIABEI]!.hp = 0;
      for (const unit of draft.units.filter((entry) => entry.hex === site(JIABEI))) draft.units.splice(draft.units.indexOf(unit), 1);
      put(draft, 'swordsman', BING, beside(vassal, JIABEI, JIA), { id: 950 });
    });
    expect(apply(other, { type: 'attack', polity: BING, unit: 950, target: site(JIABEI) }).polities[YI]!.overlord).toBe(JIA);

    // The overlord lets it go; the vassal cannot leave by itself.
    const plain = withAgreement(base, 'vassalage', JIA, YI);
    expect(reason(plain, { type: 'cancelAgreement', polity: YI, target: JIA, agreement: 'vassalage' })).toBe('vassal');
    const released = applyWithEvents(plain, { type: 'cancelAgreement', polity: JIA, target: YI, agreement: 'vassalage' });
    expect(released.state.polities[YI]!.overlord).toBe(NO_POLITY);
    expect(released.events).toContainEqual({ type: 'vassalReleased', vassal: YI, overlord: JIA, reason: 'cancelled' });

    // An overlord with one city is annexed with its capital.
    const last = edit(war(plain, BING, JIA), (draft) => {
      draft.cities[JIADU]!.hp = 0;
      for (const unit of draft.units.filter((entry) => entry.hex === site(JIADU))) draft.units.splice(draft.units.indexOf(unit), 1);
      put(draft, 'swordsman', BING, beside(base, JIADU, JIA), { id: 951 });
    });
    const annexed = apply(last, { type: 'attack', polity: BING, unit: 951, target: site(JIADU) });
    expect(annexed.polities[JIA]!.alive).toBe(false);
    expect(annexed.polities[YI]!.overlord).toBe(NO_POLITY);
    expect(annexed.agreements.filter((agreement) => agreement.kind === 'vassalage')).toHaveLength(0);
  });

  it('counts a vassal\'s capital as held for the Conquest victory', () => {
    // With two majors, both capitals are needed.
    const two = createGame(map, { seed: 3, player: 'jia', majors: ['jia', 'bing'] });
    const quiet = edit(two, (draft) => {
      // Keep Bing's AI from doing anything of note: it has no army to speak of at turn 1 anyway.
      draft.polities[BING]!.gold = 0;
    });
    expect(endTurn(quiet).state.result).toBeNull();
    const vassal = withAgreement(quiet, 'vassalage', JIA, BING);
    expect(endTurn(vassal).state.result).toEqual({ kind: 'conquest', winner: JIA, turn: 1 });
    // The vassal itself does not win by its overlord's capitals.
    const reversed = withAgreement(quiet, 'vassalage', BING, JIA);
    expect(endTurn(reversed).state.result).toEqual({ kind: 'conquest', winner: BING, turn: 1 });
  });
});

describe('resource deals', () => {
  // Jia, Yi and Bing have horses; Ding has none.
  const horsed = learn(base, 'all', ['husbandry']);
  const sale = (goldPerTurn: number = DEAL.strategicPrice): Action => ({
    type: 'proposeDeal', polity: JIA, target: DING, seller: JIA, resource: 'horses', goldPerTurn,
  });
  /** Ding can afford the horses. */
  const solvent = edit(horsed, (draft) => {
    draft.polities[DING]!.gold = 200;
    draft.polities[DING]!.yields.gold = 20;
  });

  it('let a polity sell a strategic resource for gold per turn, and the buyer build with it', () => {
    expect(polityHasResource(horsed, JIA, 'horses')).toBe(true);
    expect(polityHasResource(horsed, DING, 'horses')).toBe(false);
    const chariot: Action = { type: 'queueBuild', polity: DING, city: 7, item: { kind: 'unit', unit: 'chariot' } };
    expect(reason(solvent, chariot)).toBe('needsResource');

    const { state, events } = applyWithEvents(solvent, sale());
    expect(state.deals).toEqual([
      { id: 1, seller: JIA, buyer: DING, resource: 'horses', goldPerTurn: 4, since: 1, until: DEAL.turns },
    ]);
    expect(events).toEqual([{ type: 'dealSigned', deal: state.deals[0] }]);
    expect(polityHasResource(state, DING, 'horses')).toBe(true);
    expect(reason(state, chariot)).toBe('ok');
    // The seller keeps its own use of it: quantity is not counted.
    expect(polityHasResource(state, JIA, 'horses')).toBe(true);
    expect(reason(state, sale())).toBe('alreadyHasResource');

    const next = endTurn(state).state;
    const plain = endTurn(solvent).state;
    expect(next.polities[JIA]!.dealIncome).toBe(4);
    expect(next.polities[DING]!.dealIncome).toBe(-4);
    expect(next.polities[JIA]!.gold).toBe(plain.polities[JIA]!.gold + 4);
    expect(next.polities[DING]!.gold).toBe(plain.polities[DING]!.gold - 4);
    expect(next.polities[JIA]!.grossIncome).toBe(plain.polities[JIA]!.grossIncome + 4);
  });

  it('run for a fixed term', () => {
    const state = apply(solvent, sale());
    expect(turns(state, DEAL.turns - 1).state.deals).toHaveLength(1);
    const ended = turns(state, DEAL.turns);
    expect(ended.state.deals).toHaveLength(0);
    expect(ended.events).toContainEqual({ type: 'dealEnded', deal: 1, seller: JIA, buyer: DING, resource: 'horses', reason: 'expired' });
    expect(polityHasResource(ended.state, DING, 'horses')).toBe(false);
    expect(ended.state.polities[JIA]!.grossIncome).toBe(turns(solvent, DEAL.turns).state.polities[JIA]!.grossIncome + 4 * DEAL.turns);
  });

  it('end early when cancelled, unpaid, or at war', () => {
    const state = apply(solvent, sale());
    const cancelled = applyWithEvents(state, { type: 'cancelDeal', polity: DING, deal: 1 });
    expect(cancelled.state.deals).toHaveLength(0);
    expect(cancelled.events).toEqual([{ type: 'dealEnded', deal: 1, seller: JIA, buyer: DING, resource: 'horses', reason: 'cancelled' }]);
    expect(favourBetween(cancelled.state, JIA, DING)).toBe(FAVOUR.dealBroken);
    expect(reason(state, { type: 'cancelDeal', polity: YI, deal: 1 })).toBe('noSuchDeal');
    expect(war(state, DING, JIA).deals).toHaveLength(0);
    const broke = edit(state, (draft) => {
      draft.polities[DING]!.gold = 0;
      for (const city of draft.cities) if (city?.owner === DING) city.unrest = 5;
      draft.polities[DING]!.warWeariness = 60;
    });
    const unpaid = endTurn(edit(broke, (draft) => {
      // Enough units to eat Ding's whole income.
      const free = topo.zoneHexes[7]!.filter((hex) => isPlainGround(map, hex) && !draft.units.some((unit) => unit.hex === hex));
      for (let i = 0; i < 12; i++) put(draft, 'warrior', DING, free[i]!);
    }));
    expect(unpaid.state.deals).toHaveLength(0);
    expect(unpaid.events).toContainEqual({ type: 'dealEnded', deal: 1, seller: JIA, buyer: DING, resource: 'horses', reason: 'unpaid' });
  });

  it('are refused by an AI that has no use for the resource, cannot pay, or is offered too little', () => {
    expect(reason(solvent, sale(DEAL.strategicPrice + 1))).toBe('refused');
    expect(reason(edit(solvent, (draft) => {
      draft.polities[DING]!.yields.gold = 2;
    }), sale())).toBe('refused');
    // Without Husbandry Ding knows no unit that needs horses, and Jia cannot see its own.
    expect(reason(edit(base, (draft) => {
      draft.polities[DING]!.gold = 200;
    }), sale())).toBe('needsResource');
    const buying: Action = { type: 'proposeDeal', polity: DING, target: JIA, seller: YI, resource: 'horses', goldPerTurn: 4 };
    expect(reason(solvent, buying)).toBe('badTarget');
    // An AI seller wants its price.
    const ask = (gold: number, resource = 'horses'): Action => ({ type: 'proposeDeal', polity: DING, target: YI, seller: YI, resource, goldPerTurn: gold });
    expect(reason(solvent, ask(DEAL.strategicPrice - 1))).toBe('refused');
    expect(reason(solvent, ask(DEAL.strategicPrice))).toBe('ok');
    expect(reason(favoured(solvent, DING, YI, -50), ask(DEAL.strategicPrice))).toBe('refused');
    expect(reason(solvent, ask(0))).toBe('badAmount');
    expect(reason(solvent, ask(4, 'unobtainium'))).toBe('badItem');
  });

  it('reach the human player as pending offers', () => {
    const offered = apply(solvent, { type: 'proposeDeal', polity: DING, target: JIA, seller: JIA, resource: 'horses', goldPerTurn: 6 });
    expect(offered.deals).toHaveLength(0);
    expect(offered.offers).toEqual([
      { id: 1, type: 'deal', from: DING, to: JIA, turn: 1, seller: JIA, resource: 'horses', goldPerTurn: 6 },
    ]);
    const accepted = apply(offered, { type: 'respond', polity: JIA, offer: 1, accept: true });
    expect(accepted.deals).toMatchObject([{ seller: JIA, buyer: DING, resource: 'horses', goldPerTurn: 6 }]);
    expect(accepted.offers).toHaveLength(0);
  });

  it('sell a specialty too: each different one gives gold in every city of the buyer', () => {
    const silkHex = topo.zoneHexes[YIDU]!.find((hex) => isPlainGround(map, hex) && map.resource[hex] === -1)!;
    const silkMap = withResource(map, 'silk', [silkHex]);
    const start = edit(createGame(silkMap, { seed: 3, player: 'jia', majors: [] }), (draft) => {
      draft.polities[JIA]!.gold = 100;
    });
    const before = yieldsOf(start, JIADU).gold;
    const deal: Action = { type: 'proposeDeal', polity: JIA, target: YI, seller: YI, resource: 'silk', goldPerTurn: DEAL.specialtyPrice };
    const bought = apply(start, deal);
    expect(yieldsOf(bought, JIADU).gold).toBe(before + 1);
    // A second deal for the same specialty is pointless.
    expect(reason(bought, deal)).toBe('alreadyHasResource');
  });
});

describe('diplomacy in a saved game', () => {
  it('survives a round trip', () => {
    let state = apply(favoured(base, JIA, YI, 30), propose(JIA, YI, 'alliance'));
    state = apply(state, propose(DING, JIA, 'tradePact'));
    state = turns(state, 3).state;
    const loaded = loadGame(saveGame(state), map);
    expect(loaded).toEqual(state);
    expect(endTurn(loaded).state).toEqual(endTurn(state).state);
  });
});
