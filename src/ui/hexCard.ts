/**
 * The details of a hex: what resting the pointer on it, or a long press,
 * shows. It holds only what the player knows (doc 03, "Fog of war"): units
 * on hexes in sight, a city as it is or as it was last seen, improvements
 * and roads as last seen, and the ground and the borders, which fog never
 * hides. No DOM here.
 */

import { maxCityHp } from '../core/cities.ts';
import { unitDef } from '../core/data.ts';
import type { ImprovementId } from '../core/data.ts';
import { NO_POLITY, hexOwner, resourceOnHex } from '../core/game.ts';
import type { GameState, UnitStatus } from '../core/game.ts';
import { cityDefence } from '../core/query.ts';
import { FogState, Improvement } from '../render/scene.ts';
import type { ImprovementId as ImprovementLook } from '../render/scene.ts';
import { t } from '../shared/i18n.ts';
import type { TranslationKey } from '../shared/i18n.ts';
import { Feature, NO_RESOURCE, Terrain } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import type { BoardView } from './board.ts';
import { cityName, improvementName, polityName, resourceName, unitName } from './names.ts';
import { isHidden } from './sight.ts';

/** How well the player knows a hex: in sight (their own land always is), seen before, or never seen. */
export type Knowledge = 'visible' | 'remembered' | 'unseen';

export interface CardUnit {
  readonly id: number;
  readonly type: string;
  /** Polity index, or `NO_POLITY` for a tribe. */
  readonly owner: number;
  readonly hp: number;
  /** Strength in melee and in defence. 0: it cannot fight. */
  readonly strength: number;
  /** Strength of its ranged attack. 0: melee only. */
  readonly ranged: number;
  readonly level: number;
  /** `ready` is no news. */
  readonly status: Exclude<UnitStatus, 'ready'> | null;
}

export interface CardCity {
  readonly zone: number;
  readonly owner: number;
  readonly population: number;
  /** Its defence now and at most, and its combat strength; null for a city out of sight. */
  readonly hp: number | null;
  readonly maxHp: number | null;
  readonly strength: number | null;
  /** True for a city out of sight: owner and size are those of the day it was last seen. */
  readonly remembered: boolean;
}

export interface HexCard {
  readonly hex: number;
  readonly knowledge: Knowledge;
  /** Every unit on the hex that the player knows of. */
  readonly units: readonly CardUnit[];
  readonly city: CardCity | null;
  /** A `Terrain` value. */
  readonly terrain: number;
  readonly hills: boolean;
  /** A `Feature` value. */
  readonly feature: number;
  /** `MapResource.id` of the resource the player can see there, or null. */
  readonly resource: string | null;
  /**
   * The improvement on the hex. Out of sight it is the one last seen, by its
   * look: the memory keeps the four looks the board draws, not the kind.
   */
  readonly improvement: ImprovementId | null;
  /** True if the improvement was pillaged and yields nothing yet. */
  readonly pillaged: boolean;
  /** The polity whose land the hex is, or `NO_POLITY`. Borders are common knowledge. */
  readonly owner: number;
  /** 0 for none, 1 for a road, 2 for a railway. */
  readonly road: 0 | 1 | 2;
  /** The owners of the trade routes the player knows to run over the hex. */
  readonly routes: readonly number[];
}

const LOOK_NAME: Readonly<Record<ImprovementLook, ImprovementId>> = {
  [Improvement.Farm]: 'farm',
  [Improvement.Pasture]: 'pasture',
  [Improvement.Mine]: 'mine',
  [Improvement.Fishery]: 'fishery',
};

/**
 * What the player knows about `hex`.
 *
 * @param view the player's sight and memory, or null for the observer, who sees everything.
 */
export function hexCard(state: GameState, hex: number, view: BoardView | null): HexCard {
  const { map } = state;
  const sight = view?.sight ?? null;
  const viewer = sight?.viewer ?? NO_POLITY;
  const owner = hexOwner(state, hex);
  const current = sight === null || sight.visible[hex] === 1 || (owner === viewer && viewer !== NO_POLITY);
  const knowledge: Knowledge = current ? 'visible' : sight.fog[hex] === FogState.Unseen ? 'unseen' : 'remembered';

  const units: CardUnit[] = [];
  for (const unit of state.units) {
    if (unit.hex !== hex || isHidden(sight, unit)) continue;
    const def = unitDef(unit.type);
    units.push({
      id: unit.id,
      type: unit.type,
      owner: unit.owner,
      hp: Math.round(unit.hp),
      strength: def.strength,
      ranged: def.rangedStrength,
      level: unit.level,
      status: unit.status === 'ready' ? null : unit.status,
    });
  }

  let city: CardCity | null = null;
  const zone = map.zones.findIndex((entry) => entry.siteHex === hex);
  if (zone >= 0) {
    const live = state.cities[zone] ?? null;
    if (sight === null || sight.visible[hex] === 1 || (live !== null && live.owner === viewer)) {
      if (live !== null) {
        city = {
          zone,
          owner: live.owner,
          population: live.pop,
          hp: Math.round(live.hp),
          maxHp: maxCityHp(live),
          strength: Math.round(cityDefence(state, zone)),
          remembered: false,
        };
      }
    } else {
      const record = view?.memory.cities.get(zone) ?? null;
      if (record !== null) {
        city = { zone, owner: record.owner, population: record.population, hp: null, maxHp: null, strength: null, remembered: true };
      }
    }
  }

  let improvement: ImprovementId | null = null;
  let pillaged = false;
  let road: 0 | 1 | 2 = 0;
  if (current) {
    improvement = state.improvements[hex] ?? null;
    pillaged = improvement !== null && (state.pillaged[hex] ?? 0) >= state.turn;
    const level = state.roads[hex] ?? 0;
    road = level >= 2 ? 2 : level >= 1 ? 1 : 0;
  } else if (view !== null) {
    const look = view.memory.improvements.get(hex);
    improvement = look === undefined ? null : LOOK_NAME[look];
    road = view.memory.roads.get(hex) ?? 0;
  }

  const routes: number[] = [];
  for (const route of state.routes) {
    const known = sight === null || route.owner === viewer || sight.visible[hex] === 1;
    if (known && route.path.includes(hex) && !routes.includes(route.owner)) routes.push(route.owner);
  }

  const resource = resourceOnHex(state, viewer, hex);
  return {
    hex,
    knowledge,
    units,
    city,
    terrain: map.terrain[hex] ?? Terrain.Ocean,
    hills: map.hills[hex] === 1,
    feature: map.feature[hex] ?? Feature.None,
    resource: resource === NO_RESOURCE ? null : (map.resources[resource]?.id ?? null),
    improvement,
    pillaged,
    owner,
    road,
    routes,
  };
}

const TERRAIN_KEY: Readonly<Record<number, TranslationKey>> = {
  [Terrain.Ocean]: 'terrain.ocean',
  [Terrain.Coast]: 'terrain.coast',
  [Terrain.Lake]: 'terrain.lake',
  [Terrain.Plains]: 'terrain.plains',
  [Terrain.Grassland]: 'terrain.grassland',
  [Terrain.Desert]: 'terrain.desert',
  [Terrain.Tundra]: 'terrain.tundra',
  [Terrain.Snow]: 'terrain.snow',
  [Terrain.Mountain]: 'terrain.mountain',
};

const FEATURE_KEY: Readonly<Record<number, TranslationKey>> = {
  [Feature.Forest]: 'feature.forest',
  [Feature.Jungle]: 'feature.jungle',
  [Feature.Marsh]: 'feature.marsh',
  [Feature.Oasis]: 'feature.oasis',
  [Feature.Volcano]: 'feature.volcano',
};

export type CardLineKind = 'unit' | 'unitFacts' | 'city' | 'cityFacts' | 'ground' | 'resource' | 'works' | 'owner' | 'fog';

/** One line of the card: its parts are set side by side. `unit` lines come with `unitFacts`, `city` with `cityFacts`. */
export interface CardLine {
  readonly kind: CardLineKind;
  readonly parts: readonly string[];
  /** For a `unit` line: the unit, so that its piece can be drawn. For `city` and `owner`: the polity whose colour marks it. */
  readonly unit?: CardUnit;
  readonly polity?: number;
}

/**
 * The card as text in the current language, line by line.
 *
 * @param travelling the player's units that are under a travel order.
 */
export function cardLines(card: HexCard, map: MapData, travelling?: { has(unit: number): boolean }): CardLine[] {
  const lines: CardLine[] = [];
  for (const unit of card.units) {
    lines.push({ kind: 'unit', parts: [unitName(unit.type), polityName(map, unit.owner)], unit, polity: unit.owner });
    const status =
      travelling?.has(unit.id) === true
        ? t('status.travelling')
        : unit.status === 'fortified'
          ? t('status.fortified')
          : unit.status === 'asleep'
            ? t('status.asleep')
            : null;
    lines.push({
      kind: 'unitFacts',
      parts: [
        t('unit.hp', { hp: unit.hp }),
        ...(unit.strength > 0 ? [t('card.strength', { strength: unit.strength })] : []),
        ...(unit.ranged > 0 ? [t('card.ranged', { strength: unit.ranged })] : []),
        ...(unit.level > 0 ? [t('unit.level', { level: unit.level })] : []),
        ...(status === null ? [] : [status]),
      ],
    });
  }
  const { city } = card;
  if (city !== null) {
    lines.push({ kind: 'city', parts: [cityName(map, city.zone), polityName(map, city.owner)], polity: city.owner });
    lines.push({
      kind: 'cityFacts',
      parts: [
        t('city.pop', { pop: city.population }),
        ...(city.hp === null || city.maxHp === null ? [] : [t('city.hp', { hp: city.hp, max: city.maxHp })]),
        ...(city.strength === null ? [] : [t('card.strength', { strength: city.strength })]),
        ...(city.remembered ? [t('card.remembered')] : []),
      ],
    });
  }
  const terrain = TERRAIN_KEY[card.terrain];
  const feature = FEATURE_KEY[card.feature];
  lines.push({
    kind: 'ground',
    parts: [
      ...(terrain === undefined ? [] : [t(terrain)]),
      ...(card.hills ? [t('terrain.hills')] : []),
      ...(feature === undefined ? [] : [t(feature)]),
    ],
  });
  if (card.resource !== null) lines.push({ kind: 'resource', parts: [resourceName(map, card.resource)] });
  const works = [
    ...(card.improvement === null
      ? []
      : [card.pillaged ? t('card.pillaged', { name: improvementName(card.improvement) }) : improvementName(card.improvement)]),
    ...(card.road === 0 ? [] : [t(card.road === 2 ? 'card.railway' : 'card.road')]),
    ...card.routes.map((owner) => t('card.route', { name: polityName(map, owner) })),
  ];
  if (works.length > 0) lines.push({ kind: 'works', parts: works });
  // a city's line already names who holds the hex
  if (card.owner !== NO_POLITY && city?.owner !== card.owner) {
    lines.push({ kind: 'owner', parts: [polityName(map, card.owner)], polity: card.owner });
  }
  if (card.knowledge === 'remembered' && city?.remembered !== true) lines.push({ kind: 'fog', parts: [t('card.remembered')] });
  else if (card.knowledge === 'unseen' && city === null) lines.push({ kind: 'fog', parts: [t('card.unseen')] });
  return lines;
}
