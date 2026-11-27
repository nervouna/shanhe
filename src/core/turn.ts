/** What happens when a turn ends: income, cities, healing, victory, the next turn. */

import {
  BUILDINGS,
  CITY_STATE,
  COMBAT,
  DIPLOMACY,
  FREE_UNITS_PER_CITY,
  PROJECT,
  UNIT_UPKEEP,
  WAR,
  conquestTarget,
  noYields,
  unitDef,
} from './data.ts';
import type { Yields } from './data.ts';
import { YIELD_KEYS, processCity } from './cities.ts';
import { at, dropKey, ownerOf, polityOf, removeUnit, warCount } from './context.ts';
import type { Ctx } from './context.ts';
import { processInfluence } from './cityStates.ts';
import { endDeal, processDiplomacy } from './diplomacy.ts';
import { policySum } from './policies.ts';
import { followWorld, processResearch, worldEra } from './tech.ts';
import { processRoads, processRoutes } from './trade.ts';
import { NO_POLITY } from './types.ts';
import type { GameResult } from './types.ts';

/**
 * The polities that can win: the major nations and the player, if still
 * alive. Should none of them be left, every living polity is ranked instead,
 * so that the game still ends with a result.
 */
export function contenders(ctx: Ctx): number[] {
  const { state } = ctx;
  const list = [...state.majors];
  if (state.player !== NO_POLITY && !list.includes(state.player)) list.push(state.player);
  const alive = list.filter((polity) => polityOf(ctx, polity).alive).sort((a, b) => a - b);
  if (alive.length > 0) return alive;
  return state.polities.flatMap((polity, index) => (polity.alive ? [index] : []));
}

/** Number of major nations' original capitals `polity` holds, itself or through a vassal. */
export function capitalsHeld(ctx: Ctx, polity: number): number {
  let held = 0;
  for (const major of ctx.state.majors) {
    const city = ctx.state.cities[at(ctx.map.polities, major).capitalZone];
    if (city === undefined || city === null) continue;
    if (city.owner === polity || polityOf(ctx, city.owner).overlord === polity) held++;
  }
  return held;
}

/** Percentage of its income the payer hands the receiver, with the receiver's Tribute card. */
function tributePercent(ctx: Ctx, receiver: number, base: number): number {
  return (base * (100 + policySum(ctx, receiver, 'tributePercent'))) / 100;
}

function findResult(ctx: Ctx): GameResult | null {
  const { state } = ctx;
  const candidates = contenders(ctx);
  const needed = conquestTarget(state.majors.length);
  for (const polity of candidates) {
    if (capitalsHeld(ctx, polity) >= needed) return { kind: 'conquest', winner: polity, turn: state.turn };
  }
  for (const polity of candidates) {
    if (polityOf(ctx, polity).projectStage >= PROJECT.stages.length) {
      return { kind: 'science', winner: polity, turn: state.turn };
    }
  }
  if (state.turn < state.lastTurn) return null;
  let winner = -1;
  for (const polity of candidates) {
    if (winner < 0 || polityOf(ctx, polity).grossIncome > polityOf(ctx, winner).grossIncome) winner = polity;
  }
  return winner < 0 ? null : { kind: 'economic', winner, turn: state.turn };
}

/** Ends the current turn for everybody and, unless the game is over, starts the next one. */
export function endRound(ctx: Ctx): void {
  const { state } = ctx;
  const eraBefore = worldEra(state);

  // War weariness first, so that this turn's morale reflects it.
  state.polities.forEach((polity, index) => {
    if (!polity.alive) return;
    const wars = warCount(ctx, index);
    polity.warWeariness =
      wars > 0
        ? Math.min(WAR.wearinessMax, polity.warWeariness + wars * WAR.wearinessPerWarTurn)
        : Math.max(0, polity.warWeariness - WAR.wearinessDecay);
  });

  // Cities.
  const totals: Yields[] = state.polities.map(() => noYields());
  const upkeep: number[] = state.polities.map(() => 0);
  const cityCount: number[] = state.polities.map(() => 0);
  for (let zone = 0; zone < state.cities.length; zone++) {
    const city = state.cities[zone];
    if (city === undefined || city === null) continue;
    processCity(ctx, city);
    const total = at(totals, city.owner);
    for (const key of YIELD_KEYS) total[key] += city.yields[key];
    for (const id of city.buildings) upkeep[city.owner] = at(upkeep, city.owner) + BUILDINGS[id].upkeep;
    cityCount[city.owner] = at(cityCount, city.owner) + 1;
  }

  // Trade routes, then the tribute of vassals to their overlord and of city-states to their suzerain.
  const routeIncome = processRoutes(ctx);
  const received: number[] = state.polities.map(() => 0);
  const paid: number[] = state.polities.map(() => 0);
  state.polities.forEach((polity, index) => {
    if (!polity.alive) return;
    const income = at(totals, index).gold + at(routeIncome, index);
    let receiver = NO_POLITY;
    let percent = 0;
    if (polity.overlord !== NO_POLITY) {
      receiver = polity.overlord;
      percent = tributePercent(ctx, receiver, DIPLOMACY.vassalTributePercent);
    } else if (polity.suzerain !== NO_POLITY) {
      receiver = polity.suzerain;
      percent = tributePercent(ctx, receiver, CITY_STATE.tributePercent);
    }
    if (receiver === NO_POLITY || !polityOf(ctx, receiver).alive) return;
    const tribute = Math.floor((income * percent) / 100);
    paid[index] = tribute;
    received[receiver] = at(received, receiver) + tribute;
  });

  // Treasuries.
  const unitUpkeep: number[] = state.polities.map(() => 0);
  for (const unit of state.units) {
    if (unit.owner !== NO_POLITY) unitUpkeep[unit.owner] = at(unitUpkeep, unit.owner) + unitDef(unit.type).upkeep;
  }
  state.polities.forEach((polity, index) => {
    if (!polity.alive) return;
    const total = at(totals, index);
    const free = FREE_UNITS_PER_CITY * at(cityCount, index) * UNIT_UPKEEP;
    const units = Math.max(0, at(unitUpkeep, index) - free);
    polity.yields = total;
    polity.upkeep =
      at(upkeep, index) + Math.floor((units * (100 + policySum(ctx, index, 'unitUpkeepPercent'))) / 100);
    polity.routeIncome = at(routeIncome, index);
    polity.tributeReceived = at(received, index);
    polity.tributePaid = at(paid, index);
    polity.dealIncome = 0;
    const income = total.gold + polity.routeIncome + polity.tributeReceived;
    polity.grossIncome += income;
    polity.gold += income - polity.tributePaid - polity.upkeep;
    polity.science += total.science;
    polity.culture += total.culture;
    if (at(ctx.map.polities, index).kind === 'nation') polity.cultureProgress += total.culture;
    if (polity.gold < 0) {
      // Out of gold: the newest unit goes home.
      polity.gold = 0;
      for (let i = state.units.length - 1; i >= 0; i--) {
        const unit = at(state.units, i);
        if (unit.owner !== index) continue;
        removeUnit(ctx, unit);
        ctx.events.push({ type: 'unitDisbanded', unit: unit.id, owner: index, hex: unit.hex });
        break;
      }
    }
  });

  // Resource deals: the buyer pays out of what it now has; a deal it cannot pay ends.
  for (const deal of [...state.deals]) {
    const buyer = polityOf(ctx, deal.buyer);
    const seller = polityOf(ctx, deal.seller);
    if (buyer.gold < deal.goldPerTurn) {
      endDeal(ctx, deal, 'unpaid');
      continue;
    }
    buyer.gold -= deal.goldPerTurn;
    buyer.dealIncome -= deal.goldPerTurn;
    seller.gold += deal.goldPerTurn;
    seller.grossIncome += deal.goldPerTurn;
    seller.dealIncome += deal.goldPerTurn;
  }

  // Research, then the polities that follow it.
  processResearch(ctx);
  followWorld(ctx);

  // Diplomacy, city-states, roads, and improvements that have been repaired.
  processDiplomacy(ctx);
  processInfluence(ctx);
  processRoads(ctx);
  for (const key of Object.keys(state.pillaged)) {
    if ((state.pillaged[key] ?? 0) <= state.turn) dropKey(state.pillaged, key);
  }

  // Units: rest heals, and everybody gets their movement back.
  for (const unit of state.units) {
    if (!unit.acted && unit.hp < COMBAT.maxHp) {
      const heal = ownerOf(ctx, unit.hex) === unit.owner ? COMBAT.healOwnTerritory : COMBAT.healNeutral;
      unit.hp = Math.min(COMBAT.maxHp, unit.hp + heal);
    }
    unit.acted = false;
    unit.moves = unitDef(unit.type).moves;
  }

  const result = findResult(ctx);
  if (result !== null) {
    state.result = result;
    ctx.events.push({ type: 'gameEnded', result });
    return;
  }
  state.turn++;
  const era = worldEra(state);
  if (era > eraBefore) ctx.events.push({ type: 'eraStarted', era });
  ctx.events.push({ type: 'turnStarted', turn: state.turn });
}
