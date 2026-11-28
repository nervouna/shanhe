/**
 * Diplomacy between nations: wars and how allies and vassals are drawn into
 * them, the five agreements, vassalage, resource deals, pending offers to
 * the player, and how favour moves.
 */

import { AGREEMENT_KINDS, AI, BALANCE, DEAL, DIPLOMACY, FAVOUR, SPECIALTY, UNITS, WAR } from './data.ts';
import type { AgreementKind } from './data.ts';
import { forgetInfluence, updateSuzerain } from './cityStates.ts';
import { militaryStrength } from './combat.ts';
import {
  BORDER_OPENING,
  at,
  dropKey,
  atWar,
  enforceBorders,
  polityOf,
  relationKey,
  relationOf,
  setOpenFlag,
  setWarFlag,
} from './context.ts';
import type { Ctx } from './context.ts';
import { personalityOf } from './kits.ts';
import { balanceOfPower, commonThreats, fearedOf, standsAgainst } from './power.ts';
import type { Balance } from './power.ts';
import { modsOf, nationOf, percentOf } from './modifiers.ts';
import {
  addFavour,
  alliesOf,
  enemiesOf,
  favourOf,
  findAgreement,
  hasAgreement,
  isCityState,
  isNation,
  vassalsFull,
  vassalsOf,
} from './relations.ts';
import { hasResource, isStrategic, knows, ownsResource, specialtiesOf } from './tech.ts';
import { endRoute } from './trade.ts';
import { NO_POLITY } from './types.ts';
import type { Agreement, Deal, EndReason, Offer, RejectReason } from './types.ts';

// ------------------------------------------------------------- agreements

function refreshOpenFlag(ctx: Ctx, a: number, b: number): void {
  const open = ctx.state.agreements.some(
    (agreement) =>
      BORDER_OPENING.includes(agreement.kind) &&
      ((agreement.a === a && agreement.b === b) || (agreement.a === b && agreement.b === a)),
  );
  setOpenFlag(ctx, a, b, open);
}

/** Puts an agreement in force. A vassalage goes through {@link makeVassal}, a truce through {@link endWar}. */
function addAgreement(ctx: Ctx, kind: AgreementKind, a: number, b: number, until: number): void {
  ctx.state.agreements.push({ kind, a, b, since: ctx.state.turn, until });
  refreshOpenFlag(ctx, a, b);
  // A truce comes with the peace that `peaceMade` reports, and goes without notice.
  if (kind !== 'truce') ctx.events.push({ type: 'agreementSigned', agreement: kind, a, b });
}

/** Signs a trade pact, open borders or an alliance between two nations. */
export function signAgreement(ctx: Ctx, kind: AgreementKind, x: number, y: number): void {
  const a = Math.min(x, y);
  const b = Math.max(x, y);
  const until = kind === 'alliance' ? 0 : ctx.state.turn + DIPLOMACY.termTurns - 1;
  addAgreement(ctx, kind, a, b, until);
  if (kind === 'alliance') ctx.state.stats.alliancesFormed++;
}

/**
 * Takes an agreement out of force. Units that stood on the other's land by
 * it are moved out. Favour moves for an agreement that was kept to its term
 * or cancelled; a war or an annexation has its own consequences.
 */
export function endAgreement(ctx: Ctx, agreement: Agreement, reason: EndReason): void {
  const index = ctx.state.agreements.indexOf(agreement);
  if (index < 0) return;
  ctx.state.agreements.splice(index, 1);
  const { kind, a, b } = agreement;
  if (kind === 'vassalage') polityOf(ctx, b).overlord = NO_POLITY;
  refreshOpenFlag(ctx, a, b);
  if (kind !== 'truce') ctx.events.push({ type: 'agreementEnded', agreement: kind, a, b, reason });
  if (kind === 'vassalage') ctx.events.push({ type: 'vassalReleased', vassal: b, overlord: a, reason });
  if (kind !== 'truce' && kind !== 'vassalage') {
    if (reason === 'expired') addFavour(ctx, a, b, FAVOUR.dealKept);
    else if (reason === 'cancelled') addFavour(ctx, a, b, FAVOUR.dealBroken);
  }
  if (BORDER_OPENING.includes(kind)) enforceBorders(ctx);
}

/** Why `polity` cannot have the agreement with `target`, or null. Whether the target agrees is not checked. */
export function checkAgreement(ctx: Ctx, polity: number, target: number, kind: AgreementKind): RejectReason | null {
  if (!isNation(ctx, polity) || !isNation(ctx, target) || polity === target) return 'badTarget';
  if (atWar(ctx, polity, target)) return 'atWar';
  if (hasAgreement(ctx, kind, polity, target)) return 'alreadyAgreed';
  const self = polityOf(ctx, polity);
  const other = polityOf(ctx, target);
  if (kind === 'alliance') {
    if (self.overlord !== NO_POLITY || other.overlord !== NO_POLITY) return 'vassal';
    if (alliesOf(ctx, polity).length >= DIPLOMACY.maxAlliances) return 'tooManyAlliances';
    if (alliesOf(ctx, target).length >= DIPLOMACY.maxAlliances) return 'tooManyAlliances';
  }
  if (kind === 'vassalage' && (self.overlord !== NO_POLITY || other.overlord !== NO_POLITY)) return 'vassal';
  if (kind === 'vassalage' && modsOf(ctx, target, 'noVassal').length > 0) return 'refused';
  if (kind === 'vassalage' && vassalsFull(ctx, polity)) return 'refused';
  return null;
}

/**
 * What the modifiers of the two add to the favour an AI needs before it
 * accepts the agreement between them (negative: it agrees sooner).
 */
export function favourShift(ctx: Ctx, a: number, b: number, kind: AgreementKind): number {
  let shift = 0;
  for (const [self, other] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const modifier of modsOf(ctx, self, 'favourNeeded')) {
      if (!modifier.agreements.includes(kind)) continue;
      if (modifier.vsStronger === true && militaryStrength(ctx, other) <= militaryStrength(ctx, self)) continue;
      shift += modifier.favour;
    }
  }
  return shift;
}

/** True if the AI-run `target` agrees to the agreement `proposer` asks for. */
export function acceptsAgreement(ctx: Ctx, target: number, proposer: number, kind: AgreementKind): boolean {
  const major = ctx.state.majors.includes(target);
  // What the two nations' modifiers and the decider's style add to the favour it needs comes off the favour it has.
  const favour =
    favourOf(ctx, target, proposer) - favourShift(ctx, target, proposer, kind) - personalityOf(nationOf(ctx, target)).favour;
  switch (kind) {
    case 'tradePact':
      // A nation on the simplified AI trades with anybody it does not thoroughly dislike.
      return favour >= (major ? AI.tradePactFavour : BALANCE.simpleTradePactFavour);
    case 'openBorders':
      return favour >= AI.openBordersFavour;
    case 'alliance': {
      // Nobody allies with a friend of its enemies, or with an enemy of its friends.
      for (const enemy of enemiesOf(ctx, target)) {
        if (hasAgreement(ctx, 'alliance', proposer, enemy)) return false;
      }
      for (const ally of alliesOf(ctx, target)) if (atWar(ctx, ally, proposer)) return false;
      return favour >= (major ? AI.allianceFavour : AI.simpleAllianceFavour);
    }
    case 'vassalage':
      if (major) return false;
      return (
        favour >= AI.vassalFavour &&
        militaryStrength(ctx, target) * AI.vassalStrengthRatio <= militaryStrength(ctx, proposer)
      );
    case 'truce':
      return false;
  }
}

// -------------------------------------------------------------------- wars

/** Ends the deals between the two. */
function endDealsBetween(ctx: Ctx, a: number, b: number, reason: EndReason): void {
  for (const deal of [...ctx.state.deals]) {
    if ((deal.seller === a && deal.buyer === b) || (deal.seller === b && deal.buyer === a)) endDeal(ctx, deal, reason);
  }
}

/** Ends the trade routes one of the two runs to a city of the other. */
function endRoutesBetween(ctx: Ctx, a: number, b: number): void {
  for (const route of [...ctx.state.routes]) {
    if (route.toCity < 0 || (route.owner !== a && route.owner !== b)) continue;
    const owner = ctx.state.cities[route.toCity]?.owner;
    if (owner === (route.owner === a ? b : a)) endRoute(ctx, route, 'war');
  }
}

function dropOffersBetween(ctx: Ctx, a: number, b: number): void {
  for (const offer of [...ctx.state.offers]) {
    if ((offer.from === a && offer.to === b) || (offer.from === b && offer.to === a)) dropOffer(ctx, offer);
  }
}

/** Puts one pair at war and ends what peace held between them. False if they already were. */
function openWar(ctx: Ctx, x: number, y: number): boolean {
  if (x === y || atWar(ctx, x, y)) return false;
  const { state } = ctx;
  const a = Math.min(x, y);
  const b = Math.max(x, y);
  state.relations[relationKey(a, b)] = { a, b, atWar: true, since: state.turn, offerA: 0, offerB: 0 };
  setWarFlag(ctx, a, b, true);
  for (const agreement of [...state.agreements]) {
    if ((agreement.a === a && agreement.b === b) || (agreement.a === b && agreement.b === a)) {
      endAgreement(ctx, agreement, 'war');
    }
  }
  endDealsBetween(ctx, a, b, 'war');
  endRoutesBetween(ctx, a, b);
  dropOffersBetween(ctx, a, b);
  if (isCityState(ctx, a)) forgetInfluence(ctx, b, a);
  if (isCityState(ctx, b)) forgetInfluence(ctx, a, b);
  return true;
}

/**
 * `by` declares war on `on`. The vassals of both go to war with the other
 * side, and so do the allies of the attacked polity and their vassals,
 * except an ally that is also allied with the attacker.
 */
export function beginWar(ctx: Ctx, by: number, on: number): void {
  const { state } = ctx;
  const attackers = [by, ...vassalsOf(ctx, by)];
  const defenders = [on, ...vassalsOf(ctx, on)];
  const allies = alliesOf(ctx, on).filter(
    (ally) => !attackers.includes(ally) && !hasAgreement(ctx, 'alliance', ally, by) && polityOf(ctx, ally).alive,
  );

  // An attack on a partner breaks the agreements it had with it.
  const broken = state.agreements.some(
    (agreement) =>
      agreement.kind !== 'truce' &&
      ((agreement.a === by && agreement.b === on) || (agreement.a === on && agreement.b === by)),
  );
  addFavour(ctx, by, on, FAVOUR.warDeclared + (broken ? FAVOUR.dealBroken : 0));
  for (const ally of allies) addFavour(ctx, by, ally, FAVOUR.allyAttacked);

  openWar(ctx, by, on);
  state.stats.warsDeclared++;
  ctx.events.push({ type: 'warDeclared', by, on });
  for (const attacker of attackers) {
    for (const defender of defenders) {
      if (!openWar(ctx, attacker, defender)) continue;
      if (attacker !== by) ctx.events.push({ type: 'warJoined', polity: attacker, against: defender, with: by });
      else ctx.events.push({ type: 'warJoined', polity: defender, against: attacker, with: on });
    }
  }
  for (const ally of allies) {
    for (const joiner of [ally, ...vassalsOf(ctx, ally)]) {
      for (const attacker of attackers) {
        if (openWar(ctx, joiner, attacker)) {
          ctx.events.push({ type: 'warJoined', polity: joiner, against: attacker, with: on });
        }
      }
    }
  }
}

/** Ends the war of one pair and starts their truce. False if they were not at war. */
function closeWar(ctx: Ctx, x: number, y: number): boolean {
  const relation = relationOf(ctx, x, y);
  if (relation === undefined || !relation.atWar) return false;
  const { state } = ctx;
  relation.atWar = false;
  relation.since = state.turn;
  relation.offerA = 0;
  relation.offerB = 0;
  setWarFlag(ctx, relation.a, relation.b, false);
  polityOf(ctx, relation.a).aiTarget = -1;
  polityOf(ctx, relation.b).aiTarget = -1;
  ctx.events.push({ type: 'peaceMade', a: relation.a, b: relation.b });
  // Between two nations the truce is also listed as an agreement. For a pair with a
  // city-state the date of the peace in the relation holds it: city-states make no agreements.
  const nations = isNation(ctx, relation.a) && isNation(ctx, relation.b);
  if (nations && polityOf(ctx, relation.a).alive && polityOf(ctx, relation.b).alive) {
    const truce = findAgreement(ctx, 'truce', relation.a, relation.b);
    if (truce !== undefined) state.agreements.splice(state.agreements.indexOf(truce), 1);
    addAgreement(ctx, 'truce', relation.a, relation.b, state.turn + WAR.truceTurns - 1);
  }
  return true;
}

/** Peace between `a` and `b`, and between each of them and the other's vassals. */
export function endWar(ctx: Ctx, a: number, b: number): void {
  const sideA = [a, ...vassalsOf(ctx, a)];
  const sideB = [b, ...vassalsOf(ctx, b)];
  let ended = false;
  for (const x of sideA) for (const y of sideB) ended = closeWar(ctx, x, y) || ended;
  if (!ended) return;
  addFavour(ctx, a, b, FAVOUR.peaceMade);
  enforceBorders(ctx);
}

// --------------------------------------------------------------- vassalage

/**
 * True if the AI-run nation `weak` pays for peace with `strong` by becoming
 * its vassal: it has lost a city since their war began, the other is
 * `AI.submitRatio` times as strong, and nothing stands in the way of the
 * vassalage. The player never submits this way: a human decides for
 * themselves.
 */
export function submits(ctx: Ctx, weak: number, strong: number): boolean {
  const { state } = ctx;
  if (weak === state.player || !isNation(ctx, weak) || !isNation(ctx, strong)) return false;
  const relation = relationOf(ctx, weak, strong);
  if (relation === undefined || !relation.atWar) return false;
  const loser = polityOf(ctx, weak);
  if (loser.overlord !== NO_POLITY || polityOf(ctx, strong).overlord !== NO_POLITY) return false;
  if (modsOf(ctx, weak, 'noVassal').length > 0 || vassalsFull(ctx, strong)) return false;
  if (loser.cityLostOn < relation.since) return false;
  return militaryStrength(ctx, strong) >= militaryStrength(ctx, weak) * AI.submitRatio;
}

/**
 * `vassal` becomes the vassal of `overlord`. It lets its own vassals and
 * allies go, its wars end except those its overlord is also in, and it joins
 * the rest of its overlord's wars.
 */
export function makeVassal(ctx: Ctx, vassal: number, overlord: number, forced: boolean): void {
  const { state } = ctx;
  for (const agreement of [...state.agreements]) {
    if (agreement.kind === 'vassalage' && agreement.a === vassal) endAgreement(ctx, agreement, 'replaced');
    else if (agreement.kind === 'alliance' && (agreement.a === vassal || agreement.b === vassal)) {
      endAgreement(ctx, agreement, 'replaced');
    }
  }
  for (const offer of [...state.offers]) if (offer.from === vassal || offer.to === vassal) dropOffer(ctx, offer);
  for (const enemy of enemiesOf(ctx, vassal)) {
    if (enemy === overlord || !atWar(ctx, overlord, enemy)) closeWar(ctx, vassal, enemy);
  }
  polityOf(ctx, vassal).overlord = overlord;
  // A nation brought to heel by war lifts the victor's mood, at the gates of its capital or in a peace.
  if (forced) {
    const victor = polityOf(ctx, overlord);
    victor.warWeariness = Math.max(0, victor.warWeariness - WAR.wearinessPerVassalMade);
  }
  addAgreement(ctx, 'vassalage', overlord, vassal, 0);
  state.stats.vassalsMade++;
  ctx.events.push({ type: 'vassalized', vassal, overlord, forced });
  for (const enemy of enemiesOf(ctx, overlord)) {
    if (openWar(ctx, vassal, enemy)) ctx.events.push({ type: 'warJoined', polity: vassal, against: enemy, with: overlord });
  }
  enforceBorders(ctx);
}

/** Frees every vassal of `overlord`: it lost its capital, or it is gone. */
export function releaseVassals(ctx: Ctx, overlord: number, reason: EndReason): void {
  for (const agreement of [...ctx.state.agreements]) {
    if (agreement.kind === 'vassalage' && agreement.a === overlord) endAgreement(ctx, agreement, reason);
  }
}

// ------------------------------------------------------------------- deals

/** Why the deal cannot be made, or null. Whether the other side agrees is not checked. */
export function checkDeal(
  ctx: Ctx,
  polity: number,
  target: number,
  seller: unknown,
  resource: unknown,
  goldPerTurn: unknown,
): RejectReason | null {
  if (!isNation(ctx, polity) || !isNation(ctx, target) || polity === target) return 'badTarget';
  if (seller !== polity && seller !== target) return 'badTarget';
  if (typeof resource !== 'string' || !ctx.map.resources.some((entry) => entry.id === resource)) return 'badItem';
  if (
    typeof goldPerTurn !== 'number' ||
    !Number.isInteger(goldPerTurn) ||
    goldPerTurn < 1 ||
    goldPerTurn > DEAL.maxGoldPerTurn
  ) {
    return 'badAmount';
  }
  if (atWar(ctx, polity, target)) return 'atWar';
  const buyer = seller === polity ? target : polity;
  if (!ownsResource(ctx, seller, resource)) return 'needsResource';
  if (hasResource(ctx, buyer, resource)) return 'alreadyHasResource';
  return polityOf(ctx, buyer).gold >= goldPerTurn ? null : 'notEnoughGold';
}

/** The price per turn the AI asks and pays for a resource, before what the seller's modifiers add. */
export function dealPrice(resource: string): number {
  return isStrategic(resource) ? DEAL.strategicPrice : DEAL.specialtyPrice;
}

/** The price per turn the AI asks and pays for a resource that `seller` sells. */
export function dealPriceFrom(ctx: Ctx, seller: number, resource: string): number {
  const price = dealPrice(resource);
  if (isStrategic(resource)) return price;
  return Math.min(DEAL.maxGoldPerTurn, Math.floor((price * (100 + percentOf(ctx, seller, 'specialtySale'))) / 100));
}

/** True if the resource is worth buying to `polity`: a strategic one for a unit it knows, or a specialty it has room for. */
export function wantsResource(ctx: Ctx, polity: number, resource: string): boolean {
  if (hasResource(ctx, polity, resource)) return false;
  if (isStrategic(resource)) {
    return Object.values(UNITS).some((def) => def.resource === resource && knows(ctx, polity, def.tech));
  }
  return specialtiesOf(ctx, polity).length < SPECIALTY.max;
}

/** True if the AI-run `decider` agrees to the deal `other` proposes. */
export function acceptsDeal(
  ctx: Ctx,
  decider: number,
  other: number,
  seller: number,
  resource: string,
  goldPerTurn: number,
): boolean {
  const price = dealPriceFrom(ctx, seller, resource);
  if (decider === seller) return goldPerTurn >= price && favourOf(ctx, decider, other) >= DEAL.minFavour;
  const self = polityOf(ctx, decider);
  const spare = self.yields.gold + self.routeIncome - self.upkeep;
  return goldPerTurn <= price && spare > goldPerTurn && wantsResource(ctx, decider, resource);
}

export function signDeal(ctx: Ctx, seller: number, buyer: number, resource: string, goldPerTurn: number): void {
  const { state } = ctx;
  const deal: Deal = {
    id: state.nextId++,
    seller,
    buyer,
    resource,
    goldPerTurn,
    since: state.turn,
    until: state.turn + DEAL.turns - 1,
  };
  state.deals.push(deal);
  ctx.events.push({ type: 'dealSigned', deal: { ...deal } });
}

export function endDeal(ctx: Ctx, deal: Deal, reason: EndReason): void {
  const index = ctx.state.deals.indexOf(deal);
  if (index < 0) return;
  ctx.state.deals.splice(index, 1);
  ctx.events.push({
    type: 'dealEnded', deal: deal.id, seller: deal.seller, buyer: deal.buyer, resource: deal.resource, reason,
  });
  if (reason === 'expired') addFavour(ctx, deal.seller, deal.buyer, FAVOUR.dealKept);
  else if (reason === 'cancelled' || reason === 'unpaid') addFavour(ctx, deal.seller, deal.buyer, FAVOUR.dealBroken);
}

// ------------------------------------------------------------------ offers

/** Leaves a proposal for the human player to answer. */
export function makeOffer(ctx: Ctx, offer: Offer): void {
  ctx.state.offers.push(offer);
  ctx.events.push({ type: 'offerMade', offer: { ...offer } });
}

function dropOffer(ctx: Ctx, offer: Offer, accepted = false): void {
  const index = ctx.state.offers.indexOf(offer);
  if (index < 0) return;
  ctx.state.offers.splice(index, 1);
  ctx.events.push({ type: 'offerAnswered', offer: offer.id, from: offer.from, to: offer.to, accepted });
}

/** True if the same proposal already waits for the player. */
export function offerPending(ctx: Ctx, from: number, to: number, what: AgreementKind | string): boolean {
  return ctx.state.offers.some(
    (offer) =>
      offer.from === from &&
      offer.to === to &&
      (offer.type === 'agreement' ? offer.agreement === what : offer.resource === what),
  );
}

/**
 * The player's answer to an offer. An accepted offer takes effect if it is
 * still possible: the state has moved on since it was made. A deal whose
 * buyer cannot pay the price is refused instead: nothing is signed, the
 * offer goes on waiting (it can be accepted once the gold is there, declined,
 * or left to run out) and an `offerRefused` event carries the reason. An
 * offer anything else stands in the way of is dropped.
 */
export function answerOffer(ctx: Ctx, offer: Offer, accept: boolean): void {
  let done = false;
  if (accept && polityOf(ctx, offer.from).alive) {
    if (offer.type === 'agreement') {
      if (checkAgreement(ctx, offer.from, offer.to, offer.agreement) === null) {
        if (offer.agreement === 'vassalage') makeVassal(ctx, offer.to, offer.from, false);
        else signAgreement(ctx, offer.agreement, offer.from, offer.to);
        done = true;
      }
    } else {
      const reason = checkDeal(ctx, offer.from, offer.to, offer.seller, offer.resource, offer.goldPerTurn);
      if (reason === 'notEnoughGold') {
        ctx.events.push({ type: 'offerRefused', offer: offer.id, from: offer.from, to: offer.to, reason });
        return;
      }
      if (reason === null) {
        signDeal(ctx, offer.seller, offer.seller === offer.from ? offer.to : offer.from, offer.resource, offer.goldPerTurn);
        done = true;
      }
    }
  }
  dropOffer(ctx, offer, done);
}

// ------------------------------------------------------- a polity is gone

/** Clears what an annexed polity leaves behind: its agreements, deals, offers, routes, favour and influence. */
export function polityGone(ctx: Ctx, polity: number): void {
  const { state } = ctx;
  for (const agreement of [...state.agreements]) {
    if (agreement.a === polity || agreement.b === polity) endAgreement(ctx, agreement, 'annexed');
  }
  for (const deal of [...state.deals]) if (deal.seller === polity || deal.buyer === polity) endDeal(ctx, deal, 'annexed');
  for (const offer of [...state.offers]) if (offer.from === polity || offer.to === polity) dropOffer(ctx, offer);
  for (const route of [...state.routes]) if (route.owner === polity) endRoute(ctx, route, 'annexed');
  for (const key of Object.keys(state.favour)) {
    const [a, b] = key.split(':').map(Number);
    if (a === polity || b === polity) dropKey(state.favour, key);
  }
  const self = polityOf(ctx, polity);
  self.overlord = NO_POLITY;
  forgetInfluence(ctx, polity);
  if (self.cityStateType !== null) {
    self.influence = {};
    updateSuzerain(ctx, polity);
  }
}

// --------------------------------------------------------- turn processing

/** What can stand between two nations and move their favour. The last two come from the balance of power. */
export type StandingCause =
  | 'border'
  | 'war'
  | 'sharedEnemy'
  | 'deal'
  | 'route'
  | Exclude<AgreementKind, 'truce'>
  | 'leader'
  | 'commonThreat';

export interface StandingTerm {
  readonly cause: StandingCause;
  /** What it adds to the level favour moves towards. */
  readonly value: number;
  /** How many times it counts: deals, routes and shared enemies. 1 for the others. */
  readonly count: number;
  /** For `leader`: the one of the two that is feared. For `commonThreat`: the leader both stand against. */
  readonly polity?: number;
}

/** What stands between two living nations, and the level their favour moves towards. */
export interface PairStanding {
  readonly a: number;
  readonly b: number;
  readonly terms: StandingTerm[];
  /** The sum of the terms, within the limits of favour. */
  target: number;
}

/**
 * What stands between every pair of living nations that has anything
 * between them, by relation key: the shared border, war, the agreements in
 * force, deals, routes, shared enemies and the balance of power. Both the
 * turn processing and the query the interface reads favour through use it.
 */
export function favourStandings(ctx: Ctx, balance: Balance = balanceOfPower(ctx)): Map<string, PairStanding> {
  const { state, topo } = ctx;
  const standings = new Map<string, PairStanding>();
  const standing = (x: number, y: number): PairStanding | null => {
    if (x === y || !isNation(ctx, x) || !isNation(ctx, y)) return null;
    if (!polityOf(ctx, x).alive || !polityOf(ctx, y).alive) return null;
    const key = relationKey(x, y);
    let entry = standings.get(key);
    if (entry === undefined) {
      entry = { a: Math.min(x, y), b: Math.max(x, y), terms: [], target: 0 };
      standings.set(key, entry);
    }
    return entry;
  };
  const add = (x: number, y: number, cause: StandingCause, each: number, count = 1, polity?: number): void => {
    const entry = count > 0 ? standing(x, y) : null;
    if (entry === null) return;
    entry.terms.push(polity === undefined ? { cause, value: each * count, count } : { cause, value: each * count, count, polity });
  };
  /** Deals and routes per pair, each counted up to the limit. */
  const counted = new Map<string, { x: number; y: number; cause: 'deal' | 'route'; count: number }>();
  const countUp = (x: number, y: number, cause: 'deal' | 'route'): void => {
    const key = `${cause}:${relationKey(x, y)}`;
    const entry = counted.get(key);
    if (entry === undefined) counted.set(key, { x, y, cause, count: 1 });
    else entry.count = Math.min(FAVOUR.maxCounted, entry.count + 1);
  };

  // Shared borders.
  const bordering = new Set<string>();
  topo.zoneNeighbors.forEach((list, zone) => {
    const owner = at(state.zoneOwner, zone);
    for (const other of list) {
      const neighbour = at(state.zoneOwner, other);
      if (other <= zone || owner === neighbour || owner === NO_POLITY || neighbour === NO_POLITY) continue;
      const key = relationKey(owner, neighbour);
      if (bordering.has(key)) continue;
      bordering.add(key);
      add(owner, neighbour, 'border', FAVOUR.border);
    }
  });
  for (const key of Object.keys(state.relations)) {
    const relation = state.relations[key];
    if (relation !== undefined && relation.atWar) add(relation.a, relation.b, 'war', FAVOUR.war);
  }
  for (const agreement of state.agreements) {
    if (agreement.kind !== 'truce') add(agreement.a, agreement.b, agreement.kind, FAVOUR[agreement.kind]);
  }
  for (const deal of state.deals) countUp(deal.seller, deal.buyer, 'deal');
  for (const route of state.routes) {
    const owner = route.toCity < 0 ? undefined : state.cities[route.toCity]?.owner;
    if (owner !== undefined) countUp(route.owner, owner, 'route');
  }
  for (const entry of counted.values()) add(entry.x, entry.y, entry.cause, FAVOUR[entry.cause], entry.count);

  // The balance of power: a leader is feared by everybody below it, and those who stand against it draw together.
  const nations: number[] = [];
  for (let polity = 0; polity < ctx.n; polity++) {
    if (isNation(ctx, polity) && polityOf(ctx, polity).alive) nations.push(polity);
  }
  const borders = (x: number, y: number): boolean => bordering.has(relationKey(x, y));
  for (const leader of nations) {
    if (at(balance.fear, leader) <= 0) continue;
    for (const other of nations) {
      const feared = other === leader ? null : fearedOf(balance, leader, other);
      if (feared !== null && feared.leader === leader) add(leader, other, 'leader', -feared.fear, 1, leader);
    }
  }
  const threats = commonThreats(ctx, balance);
  const joined = new Set<string>();
  for (const leader of threats) {
    const group = nations.filter((polity) => standsAgainst(ctx, balance, polity, leader, borders));
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const key = relationKey(at(group, i), at(group, j));
        // Once per pair, for the leader they fear most.
        if (joined.has(key)) continue;
        joined.add(key);
        add(at(group, i), at(group, j), 'commonThreat', BALANCE.commonThreat, 1, leader);
      }
    }
  }

  // Shared enemies, for every pair that has anything between it or any favour left.
  for (const key of Object.keys(state.favour)) {
    const [a, b] = key.split(':').map(Number);
    standing(a ?? -1, b ?? -1);
  }
  for (const entry of standings.values()) {
    let shared = 0;
    for (let other = 0; other < ctx.n && shared < FAVOUR.maxCounted; other++) {
      if (ctx.war[entry.a * ctx.n + other] === 1 && ctx.war[entry.b * ctx.n + other] === 1) shared++;
    }
    if (shared > 0) entry.terms.push({ cause: 'sharedEnemy', value: FAVOUR.sharedEnemy * shared, count: shared });
    const sum = entry.terms.reduce((total, term) => total + term.value, 0);
    entry.target = Math.max(-FAVOUR.max, Math.min(FAVOUR.max, sum));
  }
  return standings;
}

/**
 * One turn of diplomacy: agreements and deals that have run their term end,
 * a deal whose seller lost the resource ends, offers nobody answered lapse,
 * favour moves one step towards what the pair's standing gives, and a vassal
 * that has come to dislike an overlord too weak to hold it goes its own way.
 */
export function processDiplomacy(ctx: Ctx): void {
  const { state } = ctx;
  for (const agreement of [...state.agreements]) {
    if (agreement.until !== 0 && agreement.until <= state.turn) endAgreement(ctx, agreement, 'expired');
  }
  for (const deal of [...state.deals]) {
    if (!ownsResource(ctx, deal.seller, deal.resource)) endDeal(ctx, deal, 'lost');
    else if (deal.until <= state.turn) endDeal(ctx, deal, 'expired');
  }
  for (const offer of [...state.offers]) {
    if (state.turn - offer.turn >= DIPLOMACY.offerTurns - 1) dropOffer(ctx, offer);
  }
  // A peace offer lapses like any other. The turn it lapsed is kept, negated, so that it is not made again at once.
  for (const key of Object.keys(state.relations)) {
    const relation = state.relations[key];
    if (relation === undefined || !relation.atWar) continue;
    if (relation.offerA > 0 && state.turn - relation.offerA >= DIPLOMACY.offerTurns - 1) relation.offerA = -state.turn;
    if (relation.offerB > 0 && state.turn - relation.offerB >= DIPLOMACY.offerTurns - 1) relation.offerB = -state.turn;
  }

  for (const key of Object.keys(state.favour)) {
    const [a, b] = key.split(':').map(Number);
    const gone =
      a === undefined || b === undefined || !isNation(ctx, a) || !isNation(ctx, b) ||
      !polityOf(ctx, a).alive || !polityOf(ctx, b).alive;
    if (gone) dropKey(state.favour, key);
  }
  for (const entry of favourStandings(ctx).values()) {
    const key = relationKey(entry.a, entry.b);
    const current = state.favour[key] ?? 0;
    const next =
      current < entry.target ? Math.min(entry.target, current + FAVOUR.drift) : Math.max(entry.target, current - FAVOUR.drift);
    if (next === 0) dropKey(state.favour, key);
    else state.favour[key] = next;
  }

  // Vassals drift away from an overlord they dislike, unless its army overawes them.
  for (const agreement of [...state.agreements]) {
    if (agreement.kind !== 'vassalage' || state.turn - agreement.since < DIPLOMACY.minTurns) continue;
    if (!vassalLeaves(ctx, agreement.b, agreement.a)) continue;
    endAgreement(ctx, agreement, 'cancelled');
    enforceBorders(ctx);
  }
}

/**
 * True if `vassal` would leave `overlord` now: favour between them is down
 * to `BALANCE.vassalLeavesFavour` and the overlord's army is less than
 * `BALANCE.vassalAweRatio` times its own. How long the vassalage has lasted
 * is not looked at here.
 */
export function vassalLeaves(ctx: Ctx, vassal: number, overlord: number): boolean {
  if (favourOf(ctx, vassal, overlord) > BALANCE.vassalLeavesFavour) return false;
  return militaryStrength(ctx, overlord) < militaryStrength(ctx, vassal) * BALANCE.vassalAweRatio;
}

/** True for a kind of agreement an action may name. */
export function isAgreementKind(value: unknown): value is AgreementKind {
  return (AGREEMENT_KINDS as readonly unknown[]).includes(value);
}
