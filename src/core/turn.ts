/** What happens when a turn ends: income, cities, healing, victory, the next turn. */

import {
  BUILDINGS,
  COMBAT,
  FREE_UNITS_PER_CITY,
  UNIT_UPKEEP,
  WAR,
  conquestTarget,
  eraOfTurn,
  noYields,
  unitDef,
} from './data.ts';
import type { Yields } from './data.ts';
import { YIELD_KEYS, processCity } from './cities.ts';
import { at, ownerOf, polityOf, removeUnit, warCount } from './context.ts';
import type { Ctx } from './context.ts';
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

/** Number of major nations' original capitals `polity` holds. */
export function capitalsHeld(ctx: Ctx, polity: number): number {
  let held = 0;
  for (const major of ctx.state.majors) {
    const city = ctx.state.cities[at(ctx.map.polities, major).capitalZone];
    if (city !== undefined && city !== null && city.owner === polity) held++;
  }
  return held;
}

function findResult(ctx: Ctx): GameResult | null {
  const { state } = ctx;
  const candidates = contenders(ctx);
  const needed = conquestTarget(state.majors.length);
  for (const polity of candidates) {
    if (capitalsHeld(ctx, polity) >= needed) return { kind: 'conquest', winner: polity, turn: state.turn };
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

  // Treasuries.
  const unitUpkeep: number[] = state.polities.map(() => 0);
  for (const unit of state.units) {
    if (unit.owner !== NO_POLITY) unitUpkeep[unit.owner] = at(unitUpkeep, unit.owner) + unitDef(unit.type).upkeep;
  }
  state.polities.forEach((polity, index) => {
    if (!polity.alive) return;
    const total = at(totals, index);
    const free = FREE_UNITS_PER_CITY * at(cityCount, index) * UNIT_UPKEEP;
    polity.yields = total;
    polity.upkeep = at(upkeep, index) + Math.max(0, at(unitUpkeep, index) - free);
    polity.grossIncome += total.gold;
    polity.gold += total.gold - polity.upkeep;
    polity.science += total.science;
    polity.culture += total.culture;
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
  const era = eraOfTurn(state.turn);
  if (era !== ctx.era) {
    ctx.era = era;
    ctx.events.push({ type: 'eraStarted', era });
  }
  ctx.events.push({ type: 'turnStarted', turn: state.turn });
}
