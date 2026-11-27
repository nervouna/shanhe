/**
 * The nation kits of doc 02: for each of the 50 nations its trait, its
 * leader's buff and personality, and the ids of its unique unit, its unique
 * building and its specialty. The unique units and buildings themselves are
 * in `uniques.ts`. A kit belongs to the polity whose `MapPolity.id` it names;
 * a polity without one (the fixture and synthetic maps, city-states) plays
 * by the plain rules.
 *
 * Names are not here: the UI finds them in `i18n.ts` under `trait.<nation>`,
 * `leader.<nation>`, `leader.<nation>.archetype`, `unit.<id>`,
 * `building.<id>`, `improvement.<id>`, `road.<id>`, `specialty.<resource>`,
 * `personality.<id>`, `difficulty.<id>` and `family.<id>`.
 */

import { Feature, Terrain } from '../shared/mapData.ts';
import type { Modifier } from './mods.ts';

/** Constants the kit rules share. */
export const KIT = {
  /** A hex at or above this elevation is plateau. */
  plateauMetres: 3000,
  /** A city counts as a hill city when its site is hilly or this many of its neighbours are hills or mountains. */
  hillCityHills: 2,
  /** Mountains are counted within this distance of a city's site. */
  mountainRingRadius: 2,
  /** A nation is friendly at this favour or more. */
  friendlyFavour: 15,
  maxFriends: 4,
  maxIslands: 6,
  maxRoutesCounted: 4,
  maxMountainsCounted: 2,
  maxRiverGold: 4,
  /** Turns a production surge lasts after a city is lost. */
  surgeTurns: 10,
  /** How far a unit and a city see, before modifiers. */
  unitVision: 2,
  cityVision: 3,
} as const;

// ------------------------------------------------------------ personalities

export const PERSONALITY_IDS = [
  'balanced',
  'warlike',
  'mercantile',
  'defensive',
  'scholarly',
  'expansionist',
  'seafaring',
  'diplomatic',
] as const;
export type PersonalityId = (typeof PERSONALITY_IDS)[number];

/** How a leader's style bends the AI's weights. `balanced` leaves them as they are. */
export interface Personality {
  /** Multiplies the strength ratio at which it declares war: below 1 it attacks sooner. */
  readonly warRatio: number;
  /** Multiplies the share of its spare income it keeps for the army. */
  readonly armyShare: number;
  /** Multiplies the navy it wants. */
  readonly navy: number;
  /** The buildings (by generic kind) its cities build first. */
  readonly buildFirst: readonly string[];
  /** Added to how much it wants a tech of each kind. */
  readonly research: Readonly<Partial<Record<'economy' | 'military' | 'science' | 'naval', number>>>;
  /** Added to how much it wants a policy card of each kind. */
  readonly policy: Readonly<Partial<Record<'economy' | 'military' | 'civil' | 'diplomacy', number>>>;
  /** Added to the income it expects of a route to another polity's city, and of one to a port or across the sea. */
  readonly routeForeign: number;
  readonly routeSea: number;
  /** Added to the favour it needs before it proposes or accepts an agreement (negative: more willing). */
  readonly favour: number;
  /** Added to how far from its cities a wasteland site is still worth a settler. */
  readonly settleRange: number;
  /** True if its cities send a settler before they finish their buildings. */
  readonly settleFirst: boolean;
}

const BALANCED: Personality = {
  warRatio: 1,
  armyShare: 1,
  navy: 1,
  buildFirst: [],
  research: {},
  policy: {},
  routeForeign: 0,
  routeSea: 0,
  favour: 0,
  settleRange: 0,
  settleFirst: false,
};

export const PERSONALITIES: Readonly<Record<PersonalityId, Personality>> = {
  balanced: BALANCED,
  warlike: { ...BALANCED, warRatio: 0.8, armyShare: 1.25, research: { military: 3 }, policy: { military: 3 }, favour: 10 },
  mercantile: {
    ...BALANCED, warRatio: 1.3, armyShare: 0.9, buildFirst: ['market'],
    research: { economy: 2 }, policy: { economy: 2, diplomacy: 1 }, routeForeign: 3, favour: -5,
  },
  defensive: {
    ...BALANCED, warRatio: 1.6, buildFirst: ['walls'], research: { military: 1 }, policy: { military: 2 },
  },
  scholarly: {
    ...BALANCED, warRatio: 1.3, armyShare: 0.9, buildFirst: ['academy'],
    research: { science: 2 }, policy: { civil: 3 },
  },
  expansionist: {
    ...BALANCED, warRatio: 0.9, buildFirst: ['granary'], research: { economy: 1 }, settleRange: 6, settleFirst: true,
  },
  seafaring: {
    ...BALANCED, warRatio: 0.9, navy: 2, buildFirst: ['harbour'], research: { naval: 4 }, policy: { diplomacy: 1 },
    routeSea: 3,
  },
  diplomatic: {
    ...BALANCED, warRatio: 1.4, buildFirst: ['temple'], policy: { diplomacy: 3, civil: 1 }, routeForeign: 2, favour: -10,
  },
};

// --------------------------------------------------------------------- kits

export const DIFFICULTIES = ['easy', 'normal', 'hard', 'veryHard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** The seven architectural families of doc 06. */
export const FAMILIES = ['centralPlains', 'jiangnan', 'tibetan', 'steppe', 'japanese', 'southeastAsian', 'siberian'] as const;
export type Family = (typeof FAMILIES)[number];

/** What kind of thing a nation's unique building is. */
export type UniqueKind = 'building' | 'improvement' | 'road';

export interface Kit {
  /** `MapPolity.id`. */
  readonly nation: string;
  /** The national trait. */
  readonly trait: readonly Modifier[];
  /** Id of its unique unit in `UNITS`. */
  readonly unit: string;
  /** Id of its unique building in `BUILDINGS`, improvement in `IMPROVEMENTS` or road upgrade in `ROAD_UPGRADES`. */
  readonly building: string;
  readonly buildingKind: UniqueKind;
  /** `MapResource.id` of its specialty. */
  readonly specialty: string;
  /** The leader's permanent buff. */
  readonly leader: readonly Modifier[];
  readonly personality: PersonalityId;
  readonly difficulty: Difficulty;
  readonly family: Family;
}

const WOODS = [Feature.Forest, Feature.Jungle];
const COLD = [Terrain.Tundra, Terrain.Snow];
const FARMS = ['farm', 'irrigationCanal'];
/** The land terrains other than desert. */
const NOT_DESERT = [Terrain.Plains, Terrain.Grassland, Terrain.Tundra, Terrain.Snow];
/** The nations of East and South China, for 渤泥's leader. */
const EAST_AND_SOUTH_CHINA = ['wu', 'yue', 'min', 'dongning', 'lingnan', 'luoyue', 'qiongya'];

type KitSpec = Omit<Kit, 'nation'>;

const KIT_TABLE = {
  // ---------------------------------------------- North and Northwest China
  yan: {
    // 京畿: the capital yields more, and one more policy slot.
    trait: [
      { type: 'cityYield', yields: { production: 1, gold: 1, science: 1, culture: 1 }, city: { capital: true } },
      { type: 'policySlots', slots: 1 },
    ],
    unit: 'youzhouCavalry', building: 'greatWallPass', buildingKind: 'improvement', specialty: 'cloisonne',
    leader: [{ type: 'cityPercent', percent: { science: 5 }, city: { capital: true } }],
    personality: 'scholarly', difficulty: 'normal', family: 'centralPlains',
  },
  jin: {
    // 表里山河: units defend better on hills and under the mountains.
    trait: [
      { type: 'strength', percent: 15, when: { role: 'defend', hex: { hills: true } } },
      { type: 'strength', percent: 15, when: { role: 'defend', hex: { hills: false, nextToTerrain: [Terrain.Mountain] } } },
    ],
    unit: 'bingzhouCavalry', building: 'draftBank', buildingKind: 'building', specialty: 'aged-vinegar',
    leader: [{ type: 'heal', hp: 5, territory: 'foreign' }],
    personality: 'diplomatic', difficulty: 'hard', family: 'centralPlains',
  },
  qi: {
    // 鱼盐之利: gold from the coast, on the water and on the shore.
    trait: [
      { type: 'hexYield', yields: { gold: 1 }, hex: { terrain: [Terrain.Coast] } },
      { type: 'hexYield', yields: { gold: 1 }, hex: { shore: true } },
    ],
    unit: 'jijiInfantry', building: 'jixiaAcademy', buildingKind: 'building', specialty: 'sea-salt',
    leader: [{ type: 'cityYield', yields: { gold: 1 }, per: { building: 'market' } }],
    personality: 'mercantile', difficulty: 'hard', family: 'centralPlains',
  },
  zhongzhou: {
    // 天下之中: trade routes to the cities of neighbouring nations earn more.
    trait: [{ type: 'routeGold', gold: 3, route: { to: 'neighbour' } }],
    unit: 'wuzu', building: 'everNormalGranary', buildingKind: 'building', specialty: 'peony',
    leader: [{ type: 'cityPercent', percent: { culture: 10 }, city: { capital: true } }],
    personality: 'scholarly', difficulty: 'hard', family: 'centralPlains',
  },
  qin: {
    // 耕战: farms also give production.
    trait: [{ type: 'hexYield', yields: { production: 1 }, hex: { improvement: FARMS } }],
    unit: 'qinCrossbowman', building: 'imperialHighway', buildingKind: 'road', specialty: 'dried-persimmon',
    leader: [{ type: 'production', percent: 10, item: 'building', building: 'walls' }],
    personality: 'warlike', difficulty: 'normal', family: 'centralPlains',
  },
  longyou: {
    // 河西走廊: land trade routes reach farther and earn more.
    trait: [{ type: 'routeRange', percent: 50 }, { type: 'routeGold', gold: 2, route: { sea: false } }],
    unit: 'liangzhouCavalry', building: 'relayStation', buildingKind: 'building', specialty: 'grape-wine',
    leader: [{ type: 'strength', percent: 3, when: { role: 'attack', unit: { classes: ['ranged'] } } }],
    personality: 'defensive', difficulty: 'normal', family: 'centralPlains',
  },
  xixia: {
    // 塞上江南: river hexes in or next to the desert give food.
    trait: [
      { type: 'hexYield', yields: { food: 2 }, hex: { river: true, terrain: [Terrain.Desert] } },
      { type: 'hexYield', yields: { food: 2 }, hex: { river: true, terrain: NOT_DESERT, nextToTerrain: [Terrain.Desert] } },
    ],
    unit: 'ironHawk', building: 'yellowRiverCanal', buildingKind: 'improvement', specialty: 'goji',
    leader: [{ type: 'startXp', xp: 4, unit: { classes: ['cavalry'] } }],
    personality: 'warlike', difficulty: 'veryHard', family: 'centralPlains',
  },
  qingtang: {
    // 三江源: plateau land yields food and production.
    trait: [{ type: 'hexYield', yields: { food: 1, production: 1 }, hex: { plateau: true, water: false } }],
    unit: 'qingtangHorseArcher', building: 'teaHorseMarket', buildingKind: 'building', specialty: 'lake-salt',
    leader: [{ type: 'dealGold', gold: 1, resource: 'horses' }],
    personality: 'mercantile', difficulty: 'normal', family: 'tibetan',
  },
  // ---------------------------------------------- Southwest and Central China
  shu: {
    // 天府之国: cities ringed by mountains gain food and defence.
    trait: [
      { type: 'cityYield', yields: { food: 2 }, city: { mountainsNear: 2 } },
      { type: 'cityStrength', percent: 20, city: { mountainsNear: 2 } },
    ],
    unit: 'repeatingCrossbowman', building: 'dujiangyan', buildingKind: 'improvement', specialty: 'shu-brocade',
    leader: [{ type: 'production', percent: 10, item: 'improvement' }],
    personality: 'scholarly', difficulty: 'easy', family: 'centralPlains',
  },
  ba: {
    // 山城: cities on or among hills gain production.
    trait: [{ type: 'cityYield', yields: { production: 3 }, city: { hillSite: true } }],
    unit: 'whitePolePikeman', building: 'diaojiaolou', buildingKind: 'building', specialty: 'pickled-mustard',
    leader: [{ type: 'strength', percent: 5, when: { role: 'defend', hex: { hills: true } } }],
    personality: 'defensive', difficulty: 'veryHard', family: 'centralPlains',
  },
  dian: {
    // 彩云之南: forest, rainforest and mountains give science.
    trait: [
      { type: 'hexYield', yields: { science: 1 }, hex: { feature: WOODS } },
      { type: 'cityYield', yields: { science: 1 }, per: 'zoneMountains' },
    ],
    unit: 'luojuzi', building: 'teaHorseRoad', buildingKind: 'road', specialty: 'puer-tea',
    leader: [{ type: 'cityYield', yields: { culture: 1 }, per: { building: 'temple' } }],
    personality: 'diplomatic', difficulty: 'normal', family: 'centralPlains',
  },
  yelang: {
    // 地无三尺平: farms and pastures on hills, farms and mines on mountains, and food from an improved mountain.
    trait: [
      { type: 'improvementSite', improvements: ['farm', 'pasture'], hills: true },
      { type: 'improvementSite', improvements: ['farm', 'mine'], terrains: [Terrain.Mountain] },
      { type: 'hexYield', yields: { food: 1 }, hex: { terrain: [Terrain.Mountain], improvement: 'any' } },
    ],
    unit: 'rattanArmourInfantry', building: 'fortifiedVillage', buildingKind: 'building', specialty: 'sauce-aroma-liquor',
    leader: [{ type: 'routeGold', gold: 1, route: { sea: false, crossesHills: true } }],
    personality: 'diplomatic', difficulty: 'hard', family: 'southeastAsian',
  },
  tubo: {
    // 世界屋脊: enemy units lose HP every turn on its plateau.
    trait: [{ type: 'attrition', hp: 10, hex: { plateau: true } }],
    unit: 'tuboHeavyCavalry', building: 'dzong', buildingKind: 'building', specialty: 'cordyceps',
    leader: [{ type: 'favourNeeded', favour: -10, agreements: ['alliance'] }],
    personality: 'expansionist', difficulty: 'easy', family: 'tibetan',
  },
  chu: {
    // 九省通衢: units ford rivers freely, and trade routes earn along rivers.
    trait: [{ type: 'movement', fordRivers: true }, { type: 'routeGold', gold: 1, perRiverHexes: 3 }],
    unit: 'towerShip', building: 'zhanghuaTerrace', buildingKind: 'building', specialty: 'lacquerware',
    leader: [{ type: 'cultureOn', event: 'captureCapital', culture: 40 }],
    personality: 'warlike', difficulty: 'normal', family: 'centralPlains',
  },
  xiaoxiang: {
    // 湖广熟: paddies (farms and irrigation canals) give more food.
    trait: [{ type: 'hexYield', yields: { food: 1 }, hex: { improvement: FARMS } }],
    unit: 'xiangArmy', building: 'shuyuan', buildingKind: 'building', specialty: 'chili',
    leader: [{ type: 'upgradeCost', percent: -10 }],
    personality: 'defensive', difficulty: 'hard', family: 'centralPlains',
  },
  yuzhang: {
    // 物华天宝: resources yield double, on the hex and as specialties.
    trait: [{ type: 'specialtyGold', percent: 100 }, { type: 'hexYield', yields: { gold: 1 }, hex: { resource: true } }],
    unit: 'poyangFleet', building: 'imperialKiln', buildingKind: 'building', specialty: 'blue-and-white-porcelain',
    leader: [{ type: 'swapCooldown', turns: -1 }],
    personality: 'scholarly', difficulty: 'hard', family: 'jiangnan',
  },
  huainan: {
    // 徽商: trade routes to foreign cities earn more.
    trait: [{ type: 'routeGold', gold: 3, route: { to: 'foreign' } }],
    unit: 'huaiArmy', building: 'memorialArch', buildingKind: 'building', specialty: 'xuan-paper-and-hui-ink',
    leader: [{ type: 'cityYield', yields: { food: 1 }, city: { garrisoned: true } }],
    personality: 'warlike', difficulty: 'hard', family: 'centralPlains',
  },
  // ------------------------------------------ East, South and Northeast China
  wu: {
    // 漕运: cities on a river or with a canal gain gold.
    trait: [{ type: 'cityYield', yields: { gold: 3 }, city: { waterway: true } }],
    unit: 'wuHookSwordsman', building: 'classicalGarden', buildingKind: 'building', specialty: 'silk',
    leader: [{ type: 'strength', percent: 5, when: { role: 'defend', acrossRiver: true } }],
    personality: 'seafaring', difficulty: 'veryHard', family: 'jiangnan',
  },
  yue: {
    // 卧薪尝胆: production surges everywhere after a city is lost.
    trait: [{ type: 'cityPercent', percent: { production: 25 }, city: { afterCityLoss: true } }],
    unit: 'mandarinDuckInfantry', building: 'seawall', buildingKind: 'improvement', specialty: 'yellow-wine',
    leader: [{ type: 'cityStrength', percent: 10, city: { coastal: true } }],
    personality: 'mercantile', difficulty: 'hard', family: 'jiangnan',
  },
  min: {
    // 下南洋: sea trade routes bring people, as food in the city they start from.
    trait: [{ type: 'routeYield', yields: { food: 2 }, route: { sea: true } }],
    unit: 'fuShip', building: 'tulou', buildingKind: 'building', specialty: 'oolong-tea',
    leader: [{ type: 'cityYield', yields: { gold: 1 }, per: { building: 'harbour' } }],
    personality: 'seafaring', difficulty: 'hard', family: 'jiangnan',
  },
  dongning: {
    // 宝岛: coast and woods give food.
    trait: [
      { type: 'hexYield', yields: { food: 1 }, hex: { terrain: [Terrain.Coast] } },
      { type: 'hexYield', yields: { food: 1 }, hex: { feature: WOODS } },
    ],
    unit: 'ironMen', building: 'sugarMill', buildingKind: 'building', specialty: 'camphor',
    leader: [{ type: 'amphibious', percent: 50 }],
    personality: 'seafaring', difficulty: 'veryHard', family: 'jiangnan',
  },
  lingnan: {
    // 一口通商: double income from routes to off-map ports.
    trait: [{ type: 'routeGold', multiplier: 2, route: { to: 'port' } }],
    unit: 'guangShip', building: 'thirteenHongs', buildingKind: 'building', specialty: 'lychee',
    leader: [{ type: 'unrest', turns: -1 }],
    personality: 'diplomatic', difficulty: 'normal', family: 'jiangnan',
  },
  luoyue: {
    // 十万大山: units fight better in rainforest and on karst hills.
    trait: [
      { type: 'strength', percent: 15, when: { hex: { feature: [Feature.Jungle] } } },
      { type: 'strength', percent: 15, when: { hex: { hills: true, feature: [Feature.None, Feature.Forest, Feature.Marsh] } } },
    ],
    unit: 'wolfSoldiers', building: 'lingquCanal', buildingKind: 'improvement', specialty: 'star-anise',
    leader: [{ type: 'strength', percent: 3, when: { territory: 'foreign' } }],
    personality: 'warlike', difficulty: 'normal', family: 'jiangnan',
  },
  qiongya: {
    // 天涯海角: water yields more.
    trait: [{ type: 'hexYield', yields: { food: 1, gold: 1 }, hex: { water: true } }],
    unit: 'liArcher', building: 'arcadeHouse', buildingKind: 'building', specialty: 'coconut',
    leader: [{ type: 'buildingUpkeep', percent: -5 }],
    personality: 'defensive', difficulty: 'veryHard', family: 'jiangnan',
  },
  liaodong: {
    // 重工基地: factories give more production from the industrial era.
    trait: [{ type: 'cityPercent', percent: { production: 25 }, building: 'factory', city: { minEra: 4 } }],
    unit: 'guanningCavalry', building: 'tiexiWorks', buildingKind: 'building', specialty: 'sea-cucumber',
    leader: [{ type: 'strength', percent: 2, when: { perAdjacentFriend: true } }],
    personality: 'warlike', difficulty: 'hard', family: 'centralPlains',
  },
  fuyu: {
    // 黑土地: farms on plains give more food.
    trait: [{ type: 'hexYield', yields: { food: 1 }, hex: { terrain: [Terrain.Plains], improvement: FARMS } }],
    unit: 'armouredCavalry', building: 'ginsengFarm', buildingKind: 'improvement', specialty: 'deer-antler',
    leader: [{ type: 'production', percent: 20, item: 'building', firstBuilding: true }],
    personality: 'expansionist', difficulty: 'hard', family: 'centralPlains',
  },
  heishui: {
    // 北大荒: tundra and snow can be farmed.
    trait: [{ type: 'improvementSite', improvements: ['farm'], terrains: COLD }],
    unit: 'solonSoldiers', building: 'forestry', buildingKind: 'improvement', specialty: 'caviar',
    leader: [{ type: 'strength', percent: 5, when: { hex: { terrain: COLD } } }],
    personality: 'warlike', difficulty: 'normal', family: 'siberian',
  },
  monan: {
    // 敕勒川: pastures on grassland yield more; rare earths show themselves in the modern era.
    trait: [
      { type: 'hexYield', yields: { food: 1, production: 1 }, hex: { terrain: [Terrain.Grassland], improvement: ['pasture'] } },
      { type: 'reveal', resource: 'rare-earths', era: 5 },
    ],
    unit: 'chaharCavalry', building: 'baishin', buildingKind: 'building', specialty: 'cashmere',
    leader: [{ type: 'routeGold', gold: 1, route: { to: 'neighbour' } }],
    personality: 'mercantile', difficulty: 'easy', family: 'steppe',
  },
  // ------------------------------ Steppe, Peninsula, Archipelago, Siberia
  mobei: {
    // 逐水草而居: unimproved grassland yields like pasture, and cavalry has no upkeep.
    trait: [
      { type: 'hexYield', yields: { food: 1, production: 1 }, hex: { terrain: [Terrain.Grassland], improvement: 'none' } },
      { type: 'unitUpkeep', percent: -100, unit: { classes: ['cavalry'] } },
    ],
    unit: 'kheshig', building: 'ordo', buildingKind: 'building', specialty: 'airag',
    leader: [{ type: 'pillage', percent: 10 }],
    personality: 'warlike', difficulty: 'easy', family: 'steppe',
  },
  goryeo: {
    // 文治: one science per five citizens in every city.
    trait: [{ type: 'cityYield', yields: { science: 1 }, per: { pop: 5 } }],
    unit: 'turtleShip', building: 'hallOfWorthies', buildingKind: 'building', specialty: 'korean-ginseng',
    leader: [{ type: 'cityYield', yields: { science: 1 }, per: { building: 'academy' } }],
    personality: 'scholarly', difficulty: 'normal', family: 'centralPlains',
  },
  ezo: {
    // 雪国: snow and tundra feed the city, and so do the forests.
    trait: [
      { type: 'hexYield', yields: { food: 2 }, hex: { terrain: COLD } },
      { type: 'hexYield', yields: { food: 1 }, hex: { terrain: [Terrain.Plains, Terrain.Grassland], feature: [Feature.Forest] } },
    ],
    unit: 'ainuHunter', building: 'salmonFishery', buildingKind: 'improvement', specialty: 'kelp',
    leader: [{ type: 'strength', percent: 5, when: { role: 'defend', hex: { feature: [Feature.Forest] } } }],
    personality: 'defensive', difficulty: 'veryHard', family: 'japanese',
  },
  togoku: {
    // 武家: military units start with experience.
    trait: [{ type: 'startXp', xp: 8, unit: { military: true } }],
    unit: 'samurai', building: 'castleTown', buildingKind: 'building', specialty: 'swords',
    leader: [{ type: 'morale', morale: 5, city: { atPeace: true } }],
    personality: 'defensive', difficulty: 'normal', family: 'japanese',
  },
  yamato: {
    // 风雅: more culture in every city.
    trait: [{ type: 'cityPercent', percent: { culture: 25 } }],
    unit: 'warriorMonk', building: 'shrine', buildingKind: 'building', specialty: 'sake',
    leader: [{ type: 'cityYield', yields: { science: 1 }, city: { capital: true }, per: 'friends' }],
    personality: 'scholarly', difficulty: 'veryHard', family: 'japanese',
  },
  tsukushi: {
    // 兰学: trade routes bring science to the city they start from.
    trait: [{ type: 'routeYield', yields: { science: 2 } }],
    unit: 'arquebusiers', building: 'dejima', buildingKind: 'building', specialty: 'arita-ware',
    leader: [{ type: 'favourNeeded', favour: -10, agreements: ['tradePact', 'openBorders'], vsStronger: true }],
    personality: 'diplomatic', difficulty: 'veryHard', family: 'japanese',
  },
  ryukyu: {
    // 万国津梁: a share of every other polity's trade route that passes its cities.
    trait: [{ type: 'routeToll', percent: 20, range: 4 }],
    unit: 'tributeShip', building: 'gusuku', buildingKind: 'building', specialty: 'brown-sugar',
    leader: [{ type: 'routeGold', gold: 1, route: { sea: true } }],
    personality: 'mercantile', difficulty: 'veryHard', family: 'japanese',
  },
  beihai: {
    // 圣湖: lake hexes yield much more.
    trait: [{ type: 'hexYield', yields: { food: 2, gold: 2 }, hex: { terrain: [Terrain.Lake] } }],
    unit: 'reindeerCavalry', building: 'iceRoad', buildingKind: 'improvement', specialty: 'omul',
    leader: [{ type: 'strength', percent: 5, when: { role: 'attack', unit: { classes: ['cavalry'] }, vsFullHp: true } }],
    personality: 'warlike', difficulty: 'normal', family: 'siberian',
  },
  shuaibin: {
    // 不冻港: ships are built faster.
    trait: [{ type: 'production', percent: 30, item: 'unit', unit: { domain: 'sea' } }],
    unit: 'haidongFleet', building: 'dockyard', buildingKind: 'building', specialty: 'king-crab',
    leader: [{ type: 'vision', range: 1, hex: { feature: [Feature.Forest] } }],
    personality: 'expansionist', difficulty: 'normal', family: 'siberian',
  },
  // --------------------------------- Mainland and Maritime Southeast Asia
  jiaozhi: {
    // 丛林游击: units fight better in forest, rainforest and marsh.
    trait: [{ type: 'strength', percent: 15, when: { hex: { feature: [Feature.Forest, Feature.Jungle, Feature.Marsh] } } }],
    unit: 'jungleAmbusher', building: 'waterPuppetStage', buildingKind: 'building', specialty: 'fish-sauce',
    leader: [{ type: 'strength', percent: 5, when: { role: 'defend', territory: 'own' } }],
    personality: 'defensive', difficulty: 'normal', family: 'southeastAsian',
  },
  champa: {
    // 占城稻: farms crop twice, for food and for sale.
    trait: [{ type: 'hexYield', yields: { food: 1, gold: 1 }, hex: { improvement: ['farm'] } }],
    unit: 'chamWarship', building: 'chamTower', buildingKind: 'building', specialty: 'agarwood',
    leader: [{ type: 'strength', percent: 5, when: { role: 'attack', unit: { domain: 'sea' }, vsCoastalCity: true } }],
    personality: 'warlike', difficulty: 'normal', family: 'southeastAsian',
  },
  lanxang: {
    // 万象之国: rainforest gives production, and war elephants have no upkeep.
    trait: [
      { type: 'hexYield', yields: { production: 1 }, hex: { feature: [Feature.Jungle] } },
      { type: 'unitUpkeep', percent: -100, unit: { types: ['warElephant'] } },
    ],
    unit: 'warElephant', building: 'wat', buildingKind: 'building', specialty: 'benzoin',
    leader: [{ type: 'cultureOn', event: 'era', culture: 20 }],
    personality: 'expansionist', difficulty: 'normal', family: 'southeastAsian',
  },
  chenla: {
    // 水利帝国: cities need less food to grow.
    trait: [{ type: 'growth', percent: -10 }],
    unit: 'ballistaElephant', building: 'baray', buildingKind: 'improvement', specialty: 'cardamom',
    leader: [{ type: 'morale', morale: 5, city: { minPop: 10 } }],
    personality: 'expansionist', difficulty: 'normal', family: 'southeastAsian',
  },
  siam: {
    // 竹外交: cannot be made a vassal, and the capital gains for every friendly nation.
    trait: [
      { type: 'noVassal' },
      { type: 'cityYield', yields: { gold: 2, culture: 1 }, city: { capital: true }, per: 'friends' },
    ],
    unit: 'royalBarge', building: 'floatingMarket', buildingKind: 'building', specialty: 'jasmine-rice',
    leader: [{ type: 'techCost', percent: -5, knownByOther: true }],
    personality: 'diplomatic', difficulty: 'easy', family: 'southeastAsian',
  },
  pagan: {
    // 万塔之邦: every temple gives culture.
    trait: [{ type: 'cityYield', yields: { culture: 2 }, per: { building: 'temple' } }],
    unit: 'dhaSwordsman', building: 'pagoda', buildingKind: 'building', specialty: 'jadeite',
    leader: [{ type: 'production', percent: 10, item: 'building', building: 'temple' }],
    personality: 'expansionist', difficulty: 'easy', family: 'southeastAsian',
  },
  malacca: {
    // 海峡咽喉: a tax on every other polity's sea route that passes its cities.
    trait: [{ type: 'routeToll', percent: 25, range: 3, sea: true }],
    unit: 'krisWarrior', building: 'harbourmastersOffice', buildingKind: 'building', specialty: 'tin',
    leader: [{ type: 'cityYield', yields: { gold: 1 }, city: { coastal: true } }],
    personality: 'mercantile', difficulty: 'hard', family: 'southeastAsian',
  },
  srivijaya: {
    // 海上霸权: ships are stronger and see farther.
    trait: [
      { type: 'strength', percent: 10, when: { unit: { domain: 'sea' } } },
      { type: 'vision', range: 1, unit: { domain: 'sea' } },
    ],
    unit: 'straitFleet', building: 'buddhistCollege', buildingKind: 'building', specialty: 'pepper',
    leader: [{ type: 'unitUpkeep', percent: -10, unit: { domain: 'sea' } }],
    personality: 'seafaring', difficulty: 'normal', family: 'southeastAsian',
  },
  shepo: {
    // 火山沃土: farms next to a volcano give more food.
    trait: [{ type: 'hexYield', yields: { food: 2 }, hex: { improvement: FARMS, nextToFeature: [Feature.Volcano] } }],
    unit: 'javaneseJong', building: 'candi', buildingKind: 'building', specialty: 'batik',
    leader: [{ type: 'cityYield', yields: { culture: 1 }, city: { capital: true }, per: 'islands' }],
    personality: 'seafaring', difficulty: 'normal', family: 'southeastAsian',
  },
  boni: {
    // 雨林之心: rainforest left standing yields food and gold.
    trait: [{ type: 'hexYield', yields: { food: 1, gold: 1 }, hex: { feature: [Feature.Jungle], improvement: 'none' } }],
    unit: 'blowpipeHunter', building: 'longhouse', buildingKind: 'building', specialty: 'birds-nest',
    leader: [{ type: 'routeGold', gold: 1, route: { toPolities: EAST_AND_SOUTH_CHINA } }],
    personality: 'mercantile', difficulty: 'easy', family: 'southeastAsian',
  },
  luzon: {
    // 大帆船: it alone may use the Pacific sea exit, and earns more there.
    trait: [
      { type: 'exclusivePort', port: 'Great Eastern Ocean' },
      { type: 'routeGold', gold: 3, route: { port: 'Great Eastern Ocean' } },
    ],
    unit: 'rattanShieldWarrior', building: 'riceTerrace', buildingKind: 'improvement', specialty: 'abaca',
    leader: [{ type: 'cityYield', yields: { culture: 1 }, per: { building: 'academy' } }],
    personality: 'scholarly', difficulty: 'normal', family: 'southeastAsian',
  },
  sulu: {
    // 海上游牧: ships get twice as much for pillaging trade routes.
    trait: [{ type: 'pillage', percent: 100, what: 'route', unit: { domain: 'sea' } }],
    unit: 'lanongWarship', building: 'stiltHouse', buildingKind: 'building', specialty: 'pearl',
    leader: [{ type: 'pillage', percent: 10, what: 'route' }],
    personality: 'seafaring', difficulty: 'normal', family: 'southeastAsian',
  },
  maluku: {
    // 香料群岛: its specialties sell for double, in deals and along routes.
    trait: [{ type: 'specialtySale', percent: 100 }],
    unit: 'koraKora', building: 'spiceGarden', buildingKind: 'improvement', specialty: 'clove',
    leader: [{ type: 'enemyStrength', percent: -3 }],
    personality: 'seafaring', difficulty: 'normal', family: 'southeastAsian',
  },
} as const satisfies Record<string, KitSpec>;

/** The kits by `MapPolity.id`. */
export const KITS: Readonly<Record<string, Kit>> = Object.fromEntries(
  Object.entries(KIT_TABLE as Record<string, KitSpec>).map(([nation, spec]) => [nation, { nation, ...spec }]),
);

/** The nations that have a kit, in the order of doc 02. */
export const KIT_NATIONS: readonly string[] = Object.keys(KIT_TABLE);

/** The specialty of each wasteland region of doc 01, by `MapPolity.id`. */
export const WASTELAND_LUXURIES: Readonly<Record<string, string>> = {
  xiyu: 'hetian-jade',
  jiankun: 'sable-fur',
  jibei: 'diamond',
  liugui: 'walrus-ivory',
};

/** The kit of the nation, or null. */
export function kitOfNation(nation: string): Kit | null {
  return Object.hasOwn(KITS, nation) ? (KITS[nation] ?? null) : null;
}

/** The personality of the nation's leader; `balanced` for a polity without a kit. */
export function personalityOf(nation: string): Personality {
  return PERSONALITIES[kitOfNation(nation)?.personality ?? 'balanced'];
}

/** The nation whose routes alone may use the off-map port (`MapOffMapPort.nameEn`), or null. */
export function portOwner(port: string): string | null {
  for (const nation of KIT_NATIONS) {
    const kit = KITS[nation];
    if (kit?.trait.some((modifier) => modifier.type === 'exclusivePort' && modifier.port === port) === true) return nation;
  }
  return null;
}
