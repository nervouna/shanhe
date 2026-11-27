/** Combat arithmetic, attacks, city capture and annexation. */

import { hexDistance, indexToOffset } from '../shared/hex.ts';
import { BUILDINGS, CITY, COMBAT, ERA_STRENGTH, WAR, unitDef } from './data.ts';
import { assignCitizens, hasBuilding, maxCityHp } from './cities.ts';
import {
  at,
  bordersOpen,
  cityAtHex,
  enforceBorders,
  isEmbarked,
  placeUnit,
  polityOf,
  random,
  relationOf,
  removeUnit,
  setWarFlag,
  terrainAllows,
} from './context.ts';
import type { Ctx } from './context.ts';
import type { City, Unit } from './types.ts';

// -------------------------------------------------------------- arithmetic

/**
 * Damage dealt by `attack` strength to `defence` strength:
 * `baseDamage * exp(exponent * (attack - defence)) * roll`, rounded and kept
 * within 1–100.
 *
 * @param roll the random factor, in `1 ± COMBAT.randomSpread`.
 */
export function combatDamage(attack: number, defence: number, roll: number): number {
  const raw = COMBAT.baseDamage * Math.exp(COMBAT.exponent * (attack - defence)) * roll;
  return Math.max(1, Math.min(COMBAT.maxHp, Math.round(raw)));
}

/** A random factor in `1 ± COMBAT.randomSpread`. */
function rollFactor(ctx: Ctx): number {
  return 1 - COMBAT.randomSpread + 2 * COMBAT.randomSpread * random(ctx);
}

/** Multiplier from experience level and wounds. */
function conditionFactor(unit: Unit): number {
  const level = 1 + (COMBAT.levelPercent * unit.level) / 100;
  const health = COMBAT.woundedFloor + ((1 - COMBAT.woundedFloor) * unit.hp) / COMBAT.maxHp;
  return level * health;
}

/**
 * Strength a unit attacks with.
 *
 * @param ranged use the ranged strength.
 * @param againstCity apply the unit type's bonus or penalty against cities.
 * @param acrossRiver a melee attack over a river edge.
 */
export function attackStrength(unit: Unit, ranged: boolean, againstCity: boolean, acrossRiver: boolean): number {
  const def = unitDef(unit.type);
  let strength = (ranged ? def.rangedStrength : def.strength) * conditionFactor(unit);
  if (againstCity) strength *= 1 + def.cityAttackPercent / 100;
  if (acrossRiver && !ranged) strength *= 1 + COMBAT.riverAttackPercent / 100;
  return strength;
}

/** Strength a unit defends with where it stands. */
export function defenceStrength(ctx: Ctx, unit: Unit): number {
  let strength = unitDef(unit.type).strength * conditionFactor(unit);
  if (ctx.map.hills[unit.hex] === 1) strength *= 1 + COMBAT.hillsDefencePercent / 100;
  if (unit.status === 'fortified') strength *= 1 + COMBAT.fortifyDefencePercent / 100;
  if (isEmbarked(ctx, unit)) strength *= 1 + COMBAT.embarkedPercent / 100;
  return strength;
}

/** Combat strength of a city, used both when it defends and when its walls strike. */
export function cityStrength(ctx: Ctx, city: City): number {
  let strength =
    CITY.strengthBase + CITY.strengthPerEra * at(ERA_STRENGTH, ctx.era) + CITY.strengthPerPop * city.pop;
  let percent = 0;
  for (const id of city.buildings) percent += BUILDINGS[id].cityStrengthPercent;
  strength *= 1 + percent / 100;
  const garrison = ctx.unitAt.get(at(ctx.map.zones, city.zone).siteHex);
  if (garrison !== undefined && garrison.owner === city.owner) {
    strength += CITY.garrisonShare * unitDef(garrison.type).strength * conditionFactor(garrison);
  }
  return strength;
}

/** A unit's total fighting value, for comparing armies. */
export function unitPower(unit: Unit): number {
  const def = unitDef(unit.type);
  return (Math.max(def.strength, def.rangedStrength) * unit.hp) / COMBAT.maxHp;
}

// ------------------------------------------------------------- experience

function gainXp(ctx: Ctx, unit: Unit, xp: number): void {
  unit.xp += xp;
  while (unit.level < COMBAT.levelXp.length && unit.xp >= at(COMBAT.levelXp, unit.level)) {
    unit.level++;
    ctx.events.push({ type: 'unitPromoted', unit: unit.id, level: unit.level });
  }
}

function killUnit(ctx: Ctx, unit: Unit): void {
  removeUnit(ctx, unit);
  ctx.events.push({ type: 'unitKilled', unit: unit.id, owner: unit.owner, hex: unit.hex, unitType: unit.type });
}

// ----------------------------------------------------------------- attack

function riverBetween(ctx: Ctx, from: number, to: number): boolean {
  for (let d = 0; d < 6; d++) {
    if (ctx.topo.neighbors[from * 6 + d] === to) return ((ctx.map.riverEdges[from] as number) & (1 << d)) !== 0;
  }
  return false;
}

export function hexesApart(ctx: Ctx, a: number, b: number): number {
  return hexDistance(indexToOffset(a, ctx.map.width), indexToOffset(b, ctx.map.width));
}

/** Resolves an attack that has already been validated. */
export function resolveAttack(ctx: Ctx, unit: Unit, target: number): void {
  const def = unitDef(unit.type);
  const ranged = def.range > 0;
  const from = unit.hex;
  unit.moves = 0;
  unit.acted = true;
  unit.status = 'ready';

  const city = cityAtHex(ctx, target);
  if (city !== null && city.owner !== unit.owner) {
    attackCity(ctx, unit, city, ranged, from, target);
    return;
  }
  const defender = ctx.unitAt.get(target);
  if (defender === undefined) return;
  const defenderDef = unitDef(defender.type);

  if (defenderDef.strength === 0) {
    // A unit that cannot fight is destroyed outright.
    ctx.events.push({
      type: 'combat', unit: unit.id, owner: unit.owner, from, target, ranged,
      defenderUnit: defender.id, defenderCity: -1, damageToDefender: defender.hp, damageToAttacker: 0,
    });
    killUnit(ctx, defender);
    if (!ranged) advance(ctx, unit, from, target);
    return;
  }

  const attack = attackStrength(unit, ranged, false, riverBetween(ctx, from, target));
  const defence = defenceStrength(ctx, defender);
  const damageToDefender = combatDamage(attack, defence, rollFactor(ctx));
  const damageToAttacker = ranged ? 0 : combatDamage(defence, attack, rollFactor(ctx));
  ctx.events.push({
    type: 'combat', unit: unit.id, owner: unit.owner, from, target, ranged,
    defenderUnit: defender.id, defenderCity: -1, damageToDefender, damageToAttacker,
  });

  defender.hp -= damageToDefender;
  if (defender.hp <= 0) {
    // The winner of a melee survives it.
    unit.hp = Math.max(1, unit.hp - damageToAttacker);
    killUnit(ctx, defender);
    gainXp(ctx, unit, COMBAT.xpAttack + COMBAT.xpKill);
    if (!ranged) advance(ctx, unit, from, target);
    return;
  }
  gainXp(ctx, defender, COMBAT.xpDefend);
  unit.hp -= damageToAttacker;
  if (unit.hp <= 0) {
    killUnit(ctx, unit);
    gainXp(ctx, defender, COMBAT.xpKill);
    return;
  }
  gainXp(ctx, unit, COMBAT.xpAttack);
}

/** After a melee kill the attacker takes the hex if it can stand there. */
function advance(ctx: Ctx, unit: Unit, from: number, target: number): void {
  const def = unitDef(unit.type);
  if (!terrainAllows(ctx, def, target) || !bordersOpen(ctx, unit.owner, target)) return;
  if ((ctx.topo.water[target] === 1) !== (def.domain === 'sea')) return;
  if (ctx.unitAt.has(target) || cityAtHex(ctx, target) !== null) return;
  placeUnit(ctx, unit, target);
  ctx.events.push({ type: 'unitMoved', unit: unit.id, owner: unit.owner, from, to: target });
}

function attackCity(ctx: Ctx, unit: Unit, city: City, ranged: boolean, from: number, target: number): void {
  const def = unitDef(unit.type);
  if (!ranged && city.hp <= 0 && def.domain === 'land') {
    captureCity(ctx, city, unit);
    return;
  }
  const strength = cityStrength(ctx, city);
  const attack = attackStrength(unit, ranged, true, riverBetween(ctx, from, target));
  const damageToDefender = combatDamage(attack, strength, rollFactor(ctx));
  const damageToAttacker = ranged
    ? 0
    : combatDamage(strength, attackStrength(unit, false, false, false), rollFactor(ctx));
  ctx.events.push({
    type: 'combat', unit: unit.id, owner: unit.owner, from, target, ranged,
    defenderUnit: -1, defenderCity: city.zone, damageToDefender, damageToAttacker,
  });
  city.hp = Math.max(0, city.hp - damageToDefender);
  city.attackedOn = ctx.state.turn;
  unit.hp -= damageToAttacker;
  if (unit.hp <= 0) {
    killUnit(ctx, unit);
    return;
  }
  gainXp(ctx, unit, COMBAT.xpAttack);

  // Walls answer the first attack of the turn.
  if (
    city.hp > 0 &&
    !city.struck &&
    hasBuilding(city, (building) => building.counterStrike) &&
    hexesApart(ctx, unit.hex, target) <= CITY.strikeRange
  ) {
    city.struck = true;
    const damage = combatDamage(strength, defenceStrength(ctx, unit), rollFactor(ctx));
    ctx.events.push({ type: 'cityStrike', city: city.zone, unit: unit.id, damage });
    unit.hp -= damage;
    if (unit.hp <= 0) killUnit(ctx, unit);
  }
}

// ------------------------------------------------- capture and annexation

/** `unit` takes the city: the city and its zone change owner. */
export function captureCity(ctx: Ctx, city: City, unit: Unit): void {
  const { state } = ctx;
  const from = city.owner;
  const to = unit.owner;
  const site = at(ctx.map.zones, city.zone).siteHex;
  const garrison = ctx.unitAt.get(site);
  if (garrison !== undefined) killUnit(ctx, garrison);
  const origin = unit.hex;
  placeUnit(ctx, unit, site);
  ctx.events.push({ type: 'unitMoved', unit: unit.id, owner: to, from: origin, to: site });

  city.owner = to;
  city.hp = Math.floor(maxCityHp(city) * CITY.captureHpFraction);
  city.unrest = CITY.unrestTurns;
  city.queue = [];
  city.progress = 0;
  city.struck = false;
  city.attackedOn = state.turn;
  state.zoneOwner[city.zone] = to;
  state.stats.citiesCaptured++;
  ctx.events.push({ type: 'cityCaptured', city: city.zone, from, to });
  ctx.events.push({ type: 'zoneTransferred', zone: city.zone, from, to });

  const loser = polityOf(ctx, from);
  loser.warWeariness = Math.min(WAR.wearinessMax, loser.warWeariness + WAR.wearinessPerCityLost);
  const remaining = state.cities.filter((other): other is City => other !== null && other.owner === from);
  if (remaining.length === 0) {
    annex(ctx, from, to);
  } else {
    if (loser.capital === city.zone) loser.capital = at(remaining, 0).zone;
    enforceBorders(ctx);
  }
  assignCitizens(ctx, city);
}

/** `by` takes everything `polity` still has: its zones without a city. Its units are removed and its wars end. */
function annex(ctx: Ctx, polity: number, by: number): void {
  const { state } = ctx;
  state.zoneOwner.forEach((owner, zone) => {
    if (owner !== polity) return;
    state.zoneOwner[zone] = by;
    ctx.events.push({ type: 'zoneTransferred', zone, from: polity, to: by });
  });
  for (const unit of state.units.filter((candidate) => candidate.owner === polity)) {
    removeUnit(ctx, unit);
    ctx.events.push({ type: 'unitDisbanded', unit: unit.id, owner: polity, hex: unit.hex });
  }
  for (let other = 0; other < ctx.n; other++) {
    const relation = relationOf(ctx, polity, other);
    if (relation === undefined || !relation.atWar) continue;
    relation.atWar = false;
    relation.since = state.turn;
    setWarFlag(ctx, polity, other, false);
  }
  const annexed = polityOf(ctx, polity);
  annexed.alive = false;
  annexed.capital = -1;
  annexed.aiTarget = -1;
  state.stats.politiesAnnexed++;
  ctx.events.push({ type: 'polityAnnexed', polity, by });
  enforceBorders(ctx);
}
