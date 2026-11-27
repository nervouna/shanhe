/**
 * The unique units, buildings, improvements and road upgrades of the 50
 * nations of doc 02. `data.ts` merges them into `UNITS`, `BUILDINGS` and
 * `IMPROVEMENTS`; this file only holds the tables, so that it needs nothing
 * from `data.ts` but types.
 */

import { Feature, Terrain } from '../shared/mapData.ts';
import type { ImprovementDef, TechId, UnitClass } from './data.ts';
import type { Modifier } from './mods.ts';

/** A unique unit: it replaces the generic unit of its class and era for its nation. */
export interface UniqueUnitSpec {
  /** `MapPolity.id`. */
  readonly nation: string;
  /** Index into `ERAS`. */
  readonly era: number;
  readonly unitClass: Exclude<UnitClass, 'civilian' | 'tribe'>;
  /** The character on its piece. */
  readonly piece: string;
  /** Its strength (melee and ranged) as a percentage of the replaced unit's. Default 100. */
  readonly strengthPercent?: number;
  /** A ranged strength of its own, as a fraction of the era's strength. */
  readonly rangedStrength?: number;
  readonly range?: number;
  readonly moves?: number;
  /** Its cost as a percentage of the replaced unit's. Default 100. */
  readonly costPercent?: number;
  readonly cityAttackPercent?: number;
  /** The strategic resource it needs, or null for none. Default: that of the replaced unit. */
  readonly resource?: string | null;
  /** Its ability. */
  readonly abilities: readonly Modifier[];
}

/** A unique building: a replacement keeps everything of the building it replaces and adds what is set here. */
export interface UniqueBuildingSpec {
  readonly nation: string;
  /** The generic building it replaces. Without it the building is an extra. */
  readonly replaces?: string;
  /** The tech that unlocks it. Default: that of the replaced building. */
  readonly tech?: TechId;
  readonly cost?: number;
  readonly upkeep?: number;
  /** Added to the replaced building's values. */
  readonly cityHp?: number;
  readonly cityStrengthPercent?: number;
  readonly tradeRoutes?: number;
  readonly coastal?: boolean;
  readonly capitalOnly?: boolean;
  readonly modifiers: readonly Modifier[];
}

/** A road upgrade: what a nation's automatic roads become once it knows the tech. */
export interface RoadUpgradeSpec {
  readonly nation: string;
  readonly tech: TechId;
  /** What the nation gains while it knows the tech. */
  readonly modifiers: readonly Modifier[];
}

const WOODS = [Feature.Forest, Feature.Jungle];
const COLD = [Terrain.Tundra, Terrain.Snow];
const SHALLOWS = [Terrain.Coast, Terrain.Lake];
const GREEN = [Terrain.Plains, Terrain.Grassland];

// ------------------------------------------------------------------- units

export const UNIQUE_UNITS = {
  // North and Northwest China
  youzhouCavalry: {
    nation: 'yan', era: 1, unitClass: 'cavalry', piece: '突', moves: 5,
    // Shock charge: stronger when it attacks from open, flat ground.
    abilities: [{ type: 'strength', percent: 15, when: { role: 'attack', hex: { hills: false, feature: [Feature.None] } } }],
  },
  bingzhouCavalry: {
    nation: 'jin', era: 1, unitClass: 'cavalry', piece: '并', strengthPercent: 110,
    // Armoured riders: arrows do less.
    abilities: [{ type: 'strength', percent: 20, when: { role: 'defend', rangedAttack: true } }],
  },
  jijiInfantry: {
    nation: 'qi', era: 0, unitClass: 'infantry', piece: '技', strengthPercent: 110,
    // Trained strikers.
    abilities: [{ type: 'strength', percent: 15, when: { role: 'attack', vsCity: false } }],
  },
  wuzu: {
    nation: 'zhongzhou', era: 0, unitClass: 'infantry', piece: '卒', strengthPercent: 115, costPercent: 115,
    // Picked heavy infantry: it holds a line it has dug in on.
    abilities: [{ type: 'strength', percent: 20, when: { role: 'defend', fortified: true } }],
  },
  qinCrossbowman: {
    nation: 'qin', era: 1, unitClass: 'ranged', piece: '秦', strengthPercent: 110,
    // Massed volleys break formations in the field.
    abilities: [{ type: 'strength', percent: 15, when: { role: 'attack', vsCity: false } }],
  },
  liangzhouCavalry: {
    nation: 'longyou', era: 1, unitClass: 'cavalry', piece: '凉', strengthPercent: 105,
    // Big western horses, at home on dry and open land.
    abilities: [{ type: 'strength', percent: 15, when: { hex: { terrain: [Terrain.Desert, Terrain.Grassland] } } }],
  },
  ironHawk: {
    nation: 'xixia', era: 2, unitClass: 'cavalry', piece: '鹞', strengthPercent: 115, costPercent: 115,
    // Chained heavy cavalry rides infantry down.
    abilities: [{ type: 'strength', percent: 20, when: { role: 'attack', vsClasses: ['infantry'] } }],
  },
  qingtangHorseArcher: {
    nation: 'qingtang', era: 2, unitClass: 'cavalry', piece: '射', strengthPercent: 85, rangedStrength: 0.8, range: 2,
    // A mounted archer; from high ground its arrows carry.
    abilities: [{ type: 'strength', percent: 15, when: { role: 'attack', hex: { hills: true } } }],
  },
  // Southwest and Central China
  repeatingCrossbowman: {
    nation: 'shu', era: 1, unitClass: 'ranged', piece: '弩', strengthPercent: 105,
    // A storm of bolts against a fresh enemy.
    abilities: [{ type: 'strength', percent: 20, when: { role: 'attack', vsFullHp: true } }],
  },
  whitePolePikeman: {
    nation: 'ba', era: 3, unitClass: 'infantry', piece: '杆', strengthPercent: 105,
    // Hooked pikes stop horsemen.
    abilities: [{ type: 'strength', percent: 25, when: { vsClasses: ['cavalry'] } }],
  },
  luojuzi: {
    nation: 'dian', era: 2, unitClass: 'infantry', piece: '苴', resource: null,
    // Mountain infantry: hills and woods do not slow it, and it fights better on hills.
    abilities: [
      { type: 'movement', ignoreHills: true, ignoreRough: true },
      { type: 'strength', percent: 15, when: { hex: { hills: true } } },
    ],
  },
  rattanArmourInfantry: {
    nation: 'yelang', era: 0, unitClass: 'infantry', piece: '藤', strengthPercent: 105,
    // Oiled rattan turns blades.
    abilities: [{ type: 'strength', percent: 20, when: { role: 'defend', rangedAttack: false } }],
  },
  tuboHeavyCavalry: {
    nation: 'tubo', era: 2, unitClass: 'cavalry', piece: '蕃', strengthPercent: 110,
    // Mailed riders of the plateau.
    abilities: [{ type: 'strength', percent: 20, when: { hex: { plateau: true } } }],
  },
  towerShip: {
    nation: 'chu', era: 1, unitClass: 'naval', piece: '楼', strengthPercent: 110, cityAttackPercent: 0,
    // Its towers overlook walls: no penalty against cities, and more besides.
    abilities: [{ type: 'strength', percent: 15, when: { role: 'attack', vsCity: true } }],
  },
  xiangArmy: {
    nation: 'xiaoxiang', era: 4, unitClass: 'infantry', piece: '湘', costPercent: 85,
    // Raised at home, it keeps coming back.
    abilities: [{ type: 'heal', hp: 10 }],
  },
  poyangFleet: {
    nation: 'yuzhang', era: 2, unitClass: 'naval', piece: '鄱',
    // A fleet of lakes and river mouths.
    abilities: [{ type: 'strength', percent: 20, when: { hex: { terrain: SHALLOWS } } }],
  },
  huaiArmy: {
    nation: 'huainan', era: 4, unitClass: 'infantry', piece: '淮', strengthPercent: 105,
    // Drilled with foreign guns for siege work.
    abilities: [{ type: 'strength', percent: 20, when: { role: 'attack', vsCity: true } }],
  },
  wuHookSwordsman: {
    nation: 'wu', era: 1, unitClass: 'infantry', piece: '钩', resource: null,
    // Used to water: a river in the way costs it nothing.
    abilities: [{ type: 'strength', percent: 25, when: { role: 'attack', acrossRiver: true } }],
  },
  mandarinDuckInfantry: {
    nation: 'yue', era: 3, unitClass: 'infantry', piece: '阵',
    // The formation is as strong as its neighbours.
    abilities: [{ type: 'strength', percent: 8, when: { perAdjacentFriend: true } }],
  },
  fuShip: {
    nation: 'min', era: 2, unitClass: 'naval', piece: '福', strengthPercent: 105,
    // Watertight bulkheads: it mends at sea.
    abilities: [{ type: 'heal', hp: 10 }],
  },
  ironMen: {
    nation: 'dongning', era: 3, unitClass: 'infantry', piece: '铠', strengthPercent: 105,
    // Armoured assault troops who storm ashore.
    abilities: [{ type: 'amphibious', percent: 100 }],
  },
  guangShip: {
    nation: 'lingnan', era: 3, unitClass: 'naval', piece: '广',
    // An armed merchantman pays for itself.
    abilities: [{ type: 'unitUpkeep', percent: -100 }],
  },
  wolfSoldiers: {
    nation: 'luoyue', era: 3, unitClass: 'infantry', piece: '狼',
    // Fierce auxiliaries, at their best far from home.
    abilities: [{ type: 'strength', percent: 15, when: { role: 'attack', territory: 'foreign' } }],
  },
  liArcher: {
    nation: 'qiongya', era: 0, unitClass: 'ranged', piece: '黎',
    // Shoots from cover.
    abilities: [{ type: 'strength', percent: 20, when: { hex: { feature: WOODS } } }],
  },
  guanningCavalry: {
    nation: 'liaodong', era: 3, unitClass: 'cavalry', piece: '关', strengthPercent: 105,
    // Firearms on horseback, raised to stop steppe riders.
    abilities: [{ type: 'strength', percent: 20, when: { vsClasses: ['cavalry'] } }],
  },
  armouredCavalry: {
    nation: 'fuyu', era: 1, unitClass: 'cavalry', piece: '扶', strengthPercent: 105,
    // Horse and rider in iron.
    abilities: [{ type: 'strength', percent: 15, when: { role: 'defend' } }],
  },
  solonSoldiers: {
    nation: 'heishui', era: 3, unitClass: 'cavalry', piece: '索',
    // Hunters of the northern forest.
    abilities: [{ type: 'strength', percent: 20, when: { hex: { terrain: COLD } } }, { type: 'movement', ignoreRough: true }],
  },
  chaharCavalry: {
    nation: 'monan', era: 4, unitClass: 'cavalry', piece: '察', moves: 5,
    // Raiders who live off what they take.
    abilities: [{ type: 'pillage', percent: 50 }],
  },
  kheshig: {
    nation: 'mobei', era: 2, unitClass: 'cavalry', piece: '薛', strengthPercent: 110,
    // The khan's guard: veterans from the first day.
    abilities: [{ type: 'startXp', xp: 8 }],
  },
  turtleShip: {
    nation: 'goryeo', era: 3, unitClass: 'naval', piece: '龟', strengthPercent: 110, moves: 3,
    // An armoured deck.
    abilities: [{ type: 'strength', percent: 25, when: { role: 'defend' } }],
  },
  ainuHunter: {
    nation: 'ezo', era: 0, unitClass: 'ranged', piece: '猎',
    // A tracker: woods and marsh do not slow it, and it sees farther.
    abilities: [{ type: 'movement', ignoreRough: true }, { type: 'vision', range: 1 }],
  },
  samurai: {
    nation: 'togoku', era: 2, unitClass: 'infantry', piece: '侍', strengthPercent: 105,
    // A duellist.
    abilities: [{ type: 'strength', percent: 20, when: { vsClasses: ['infantry'] } }],
  },
  warriorMonk: {
    nation: 'yamato', era: 2, unitClass: 'infantry', piece: '僧', resource: null,
    // Its victories are told in the temples.
    abilities: [{ type: 'cultureOnKill', culture: 6 }],
  },
  arquebusiers: {
    nation: 'tsukushi', era: 3, unitClass: 'ranged', piece: '铳',
    // Volley fire from behind a palisade.
    abilities: [{ type: 'strength', percent: 25, when: { vsClasses: ['cavalry'] } }],
  },
  tributeShip: {
    nation: 'ryukyu', era: 3, unitClass: 'naval', piece: '贡', strengthPercent: 80, costPercent: 70, moves: 5,
    // A light ship that trades wherever it calls at peace.
    abilities: [{ type: 'tributeTrade', gold: 3 }],
  },
  reindeerCavalry: {
    nation: 'beihai', era: 1, unitClass: 'cavalry', piece: '鹿', resource: null,
    // Needs no horses, and the cold is its ground.
    abilities: [{ type: 'strength', percent: 20, when: { hex: { terrain: COLD } } }],
  },
  haidongFleet: {
    nation: 'shuaibin', era: 4, unitClass: 'naval', piece: '师', moves: 5,
    // Fast steamers that hunt ships.
    abilities: [{ type: 'strength', percent: 15, when: { role: 'attack', vsClasses: ['naval'] } }],
  },
  // Mainland and Maritime Southeast Asia
  jungleAmbusher: {
    nation: 'jiaozhi', era: 1, unitClass: 'infantry', piece: '伏', resource: null,
    // Strikes out of cover.
    abilities: [{ type: 'strength', percent: 25, when: { role: 'attack', hex: { feature: [Feature.Forest, Feature.Jungle, Feature.Marsh] } } }],
  },
  chamWarship: {
    nation: 'champa', era: 2, unitClass: 'naval', piece: '占', cityAttackPercent: 0,
    // A raider of harbours.
    abilities: [{ type: 'strength', percent: 10, when: { role: 'attack', vsCoastalCity: true } }],
  },
  warElephant: {
    nation: 'lanxang', era: 1, unitClass: 'cavalry', piece: '象', strengthPercent: 115, moves: 3, resource: null,
    // Needs no horses, and tramples infantry.
    abilities: [{ type: 'strength', percent: 20, when: { role: 'attack', vsClasses: ['infantry'] } }],
  },
  ballistaElephant: {
    nation: 'chenla', era: 2, unitClass: 'siege', piece: '床', moves: 3,
    // A ballista that keeps up with the army and hits troops as hard as walls.
    abilities: [{ type: 'strength', percent: 25, when: { role: 'attack', vsCity: false } }],
  },
  royalBarge: {
    nation: 'siam', era: 3, unitClass: 'naval', piece: '驳',
    // The pride of the home fleet.
    abilities: [{ type: 'strength', percent: 20, when: { territory: 'home' } }],
  },
  dhaSwordsman: {
    nation: 'pagan', era: 2, unitClass: 'infantry', piece: '刀', resource: null,
    // Closes fast with archers.
    abilities: [{ type: 'strength', percent: 25, when: { vsClasses: ['ranged', 'siege'] } }],
  },
  krisWarrior: {
    nation: 'malacca', era: 2, unitClass: 'infantry', piece: '匕', resource: null,
    // A fighter of ports and beaches.
    abilities: [{ type: 'strength', percent: 20, when: { hex: { shore: true } } }],
  },
  straitFleet: {
    nation: 'srivijaya', era: 2, unitClass: 'naval', piece: '峡', strengthPercent: 105,
    // Masters of narrow water.
    abilities: [{ type: 'strength', percent: 20, when: { hex: { terrain: [Terrain.Coast] } } }],
  },
  javaneseJong: {
    nation: 'shepo', era: 2, unitClass: 'naval', piece: '舶', strengthPercent: 120, costPercent: 120, moves: 3,
    // A giant with planking four layers thick.
    abilities: [{ type: 'strength', percent: 15, when: { role: 'defend' } }],
  },
  blowpipeHunter: {
    nation: 'boni', era: 0, unitClass: 'ranged', piece: '吹',
    // Poisoned darts stop men on foot.
    abilities: [{ type: 'strength', percent: 25, when: { role: 'attack', vsClasses: ['infantry'] } }],
  },
  rattanShieldWarrior: {
    nation: 'luzon', era: 0, unitClass: 'infantry', piece: '盾',
    // A shield against arrows.
    abilities: [{ type: 'strength', percent: 25, when: { role: 'defend', rangedAttack: true } }],
  },
  lanongWarship: {
    nation: 'sulu', era: 3, unitClass: 'naval', piece: '掠', moves: 5,
    // Built to raid.
    abilities: [{ type: 'pillage', percent: 50 }],
  },
  koraKora: {
    nation: 'maluku', era: 3, unitClass: 'naval', piece: '桨', costPercent: 85, moves: 5,
    // War canoes hunt in fleets: each one is stronger for every friend beside it.
    abilities: [{ type: 'strength', percent: 10, when: { perAdjacentFriend: true } }],
  },
} as const satisfies Record<string, UniqueUnitSpec>;

// --------------------------------------------------------------- buildings

export const UNIQUE_BUILDINGS = {
  draftBank: {
    nation: 'jin', replaces: 'bank',
    // Remittances: gold for every trade route of the nation.
    modifiers: [{ type: 'cityYield', yields: { gold: 1 }, per: 'routes' }],
  },
  jixiaAcademy: {
    nation: 'qi', replaces: 'academy',
    modifiers: [{ type: 'cityYield', yields: { science: 1, culture: 1 } }],
  },
  everNormalGranary: {
    nation: 'zhongzhou', replaces: 'granary',
    // Stable grain prices: food, gold and a calmer city.
    modifiers: [{ type: 'cityYield', yields: { food: 1, gold: 1 } }, { type: 'morale', morale: 5 }],
  },
  relayStation: {
    nation: 'longyou', tech: 'currency', cost: 60, upkeep: 1,
    modifiers: [{ type: 'cityYield', yields: { gold: 1 } }, { type: 'routeGold', gold: 2, route: { sea: false } }],
  },
  teaHorseMarket: {
    nation: 'qingtang', replaces: 'market',
    modifiers: [{ type: 'cityYield', yields: { gold: 1 } }, { type: 'production', percent: 20, item: 'unit', unit: { classes: ['cavalry'] } }],
  },
  diaojiaolou: {
    nation: 'ba', tech: 'mining', cost: 40, upkeep: 0,
    modifiers: [{ type: 'cityYield', yields: { food: 1, production: 1 } }],
  },
  fortifiedVillage: {
    nation: 'yelang', replaces: 'walls', cityHp: 25,
    // A garrison that farms.
    modifiers: [{ type: 'cityYield', yields: { food: 1, production: 1 } }],
  },
  dzong: {
    nation: 'tubo', replaces: 'walls', cityStrengthPercent: 10,
    // Fortress and monastery in one.
    modifiers: [{ type: 'cityYield', yields: { culture: 2 } }],
  },
  zhanghuaTerrace: {
    nation: 'chu', replaces: 'temple',
    modifiers: [{ type: 'cityYield', yields: { culture: 2, gold: 1 } }],
  },
  shuyuan: {
    nation: 'xiaoxiang', replaces: 'university',
    modifiers: [{ type: 'cityYield', yields: { culture: 2, science: 1 } }],
  },
  imperialKiln: {
    nation: 'yuzhang', replaces: 'workshop',
    modifiers: [{ type: 'cityYield', yields: { gold: 3, culture: 1 } }],
  },
  memorialArch: {
    nation: 'huainan', replaces: 'printShop',
    modifiers: [{ type: 'cityYield', yields: { culture: 1 } }, { type: 'morale', morale: 5 }],
  },
  classicalGarden: {
    nation: 'wu', tech: 'guilds', cost: 80, upkeep: 1,
    modifiers: [{ type: 'cityYield', yields: { culture: 3, gold: 1 } }, { type: 'morale', morale: 5 }],
  },
  tulou: {
    nation: 'min', replaces: 'walls', cityHp: 25,
    // A clan under one roof.
    modifiers: [{ type: 'cityYield', yields: { food: 1, culture: 1 } }],
  },
  sugarMill: {
    nation: 'dongning', replaces: 'workshop',
    modifiers: [{ type: 'cityYield', yields: { gold: 2, food: 1 } }],
  },
  thirteenHongs: {
    nation: 'lingnan', replaces: 'bank', tradeRoutes: 1,
    // The licensed houses of the overseas trade.
    modifiers: [{ type: 'routeGold', gold: 2, route: { to: 'port' } }],
  },
  arcadeHouse: {
    nation: 'qiongya', replaces: 'market',
    modifiers: [{ type: 'cityYield', yields: { gold: 2, culture: 1 } }],
  },
  tiexiWorks: {
    nation: 'liaodong', replaces: 'factory',
    modifiers: [{ type: 'cityYield', yields: { production: 2 } }, { type: 'cityPercent', percent: { production: 10 } }],
  },
  baishin: {
    nation: 'monan', replaces: 'granary',
    // A settled town on the steppe.
    modifiers: [{ type: 'cityYield', yields: { food: 1, production: 1 } }],
  },
  ordo: {
    nation: 'mobei', tech: 'husbandry', cost: 50, upkeep: 0, capitalOnly: true,
    // The khan's camp: riders trained there start experienced.
    modifiers: [{ type: 'cityYield', yields: { culture: 2 } }, { type: 'startXp', xp: 4, unit: { classes: ['cavalry'] } }],
  },
  hallOfWorthies: {
    nation: 'goryeo', replaces: 'university',
    modifiers: [{ type: 'cityYield', yields: { science: 2, culture: 1 } }],
  },
  castleTown: {
    nation: 'togoku', replaces: 'market', cityStrengthPercent: 10,
    modifiers: [{ type: 'cityYield', yields: { production: 1 } }],
  },
  shrine: {
    nation: 'yamato', replaces: 'temple',
    modifiers: [{ type: 'cityYield', yields: { culture: 1 } }, { type: 'morale', morale: 5 }],
  },
  dejima: {
    nation: 'tsukushi', replaces: 'observatory', tradeRoutes: 1,
    // The one door left open: a trade route, and gold with it.
    modifiers: [{ type: 'cityYield', yields: { gold: 2 } }],
  },
  gusuku: {
    nation: 'ryukyu', replaces: 'walls',
    modifiers: [{ type: 'cityYield', yields: { culture: 2, gold: 1 } }],
  },
  dockyard: {
    nation: 'shuaibin', replaces: 'harbour',
    modifiers: [{ type: 'production', percent: 25, item: 'unit', unit: { domain: 'sea' } }],
  },
  waterPuppetStage: {
    nation: 'jiaozhi', replaces: 'printShop',
    modifiers: [{ type: 'cityYield', yields: { culture: 2, gold: 1 } }],
  },
  chamTower: {
    nation: 'champa', replaces: 'temple', cityStrengthPercent: 10,
    // Brick towers on the heights.
    modifiers: [{ type: 'cityYield', yields: { culture: 1 } }],
  },
  wat: {
    nation: 'lanxang', replaces: 'temple',
    // Temple and school.
    modifiers: [{ type: 'cityYield', yields: { culture: 1, science: 1 } }],
  },
  floatingMarket: {
    nation: 'siam', replaces: 'market',
    modifiers: [{ type: 'cityYield', yields: { food: 2, gold: 1 } }],
  },
  pagoda: {
    nation: 'pagan', replaces: 'temple',
    modifiers: [{ type: 'cityYield', yields: { culture: 1, food: 1 } }],
  },
  harbourmastersOffice: {
    nation: 'malacca', replaces: 'harbour',
    modifiers: [{ type: 'cityYield', yields: { gold: 2 } }, { type: 'routeGold', gold: 1, route: { sea: true } }],
  },
  buddhistCollege: {
    nation: 'srivijaya', replaces: 'academy',
    modifiers: [{ type: 'cityYield', yields: { culture: 2 } }],
  },
  candi: {
    nation: 'shepo', replaces: 'temple',
    modifiers: [{ type: 'cityYield', yields: { culture: 1, production: 1 } }],
  },
  longhouse: {
    nation: 'boni', replaces: 'granary',
    modifiers: [{ type: 'cityYield', yields: { food: 1, culture: 1 } }],
  },
  stiltHouse: {
    nation: 'sulu', replaces: 'harbour',
    // A village on the water.
    modifiers: [{ type: 'hexYield', yields: { food: 1 }, hex: { water: true } }],
  },
} as const satisfies Record<string, UniqueBuildingSpec>;

// ------------------------------------------------------------ improvements

const OPEN = [Feature.None];

export const UNIQUE_IMPROVEMENTS = {
  /** A gate in the wall: on hills, and the nation's units on it hold. */
  greatWallPass: {
    nation: 'yan', cost: 50, tech: 'fortification',
    yields: { food: 0, production: 1, gold: 0 },
    terrains: [Terrain.Plains, Terrain.Grassland, Terrain.Desert, Terrain.Tundra],
    hills: 'yes', features: [Feature.None, Feature.Forest],
    modifiers: [{ type: 'strength', percent: 30, when: { role: 'defend' } }],
  },
  yellowRiverCanal: {
    nation: 'xixia', replaces: 'irrigationCanal', cost: 50, tech: 'irrigation', river: true,
    yields: { food: 4, production: 0, gold: 1 },
    terrains: [Terrain.Plains, Terrain.Grassland, Terrain.Desert], hills: 'no', features: OPEN,
  },
  dujiangyan: {
    nation: 'shu', replaces: 'irrigationCanal', cost: 50, tech: 'irrigation', river: true,
    yields: { food: 4, production: 1, gold: 0 },
    terrains: [Terrain.Plains, Terrain.Grassland, Terrain.Desert], hills: 'no', features: OPEN,
  },
  /** A dyke along the shore: flat land next to water. */
  seawall: {
    nation: 'yue', cost: 40, tech: 'irrigation', shore: true,
    yields: { food: 2, production: 1, gold: 0 },
    terrains: GREEN, hills: 'no', features: [Feature.None, Feature.Marsh],
  },
  lingquCanal: {
    nation: 'luoyue', replaces: 'canal', cost: 60, tech: 'irrigation', river: true,
    yields: { food: 1, production: 2, gold: 3 },
    terrains: [Terrain.Plains, Terrain.Grassland, Terrain.Desert, Terrain.Tundra, Terrain.Snow],
    hills: 'no', features: [Feature.None, Feature.Marsh],
  },
  /** Grown under the trees. */
  ginsengFarm: {
    nation: 'fuyu', cost: 30, tech: 'farming',
    yields: { food: 1, production: 0, gold: 2 },
    terrains: [Terrain.Plains, Terrain.Grassland, Terrain.Tundra], hills: 'any', features: [Feature.Forest],
  },
  forestry: {
    nation: 'heishui', cost: 40, tech: 'machinery',
    yields: { food: 0, production: 2, gold: 1 },
    terrains: [Terrain.Plains, Terrain.Grassland, Terrain.Tundra], hills: 'any', features: [Feature.Forest],
  },
  salmonFishery: {
    nation: 'ezo', replaces: 'fishery', cost: 30, tech: 'boats',
    yields: { food: 2, production: 0, gold: 1 },
    terrains: [Terrain.Coast, Terrain.Lake], hills: 'any', features: OPEN,
  },
  /** A winter road over frozen ground: it pays, and it is a road. */
  iceRoad: {
    nation: 'beihai', cost: 30, tech: 'riding', road: true,
    yields: { food: 0, production: 1, gold: 1 },
    terrains: COLD, hills: 'any', features: [Feature.None, Feature.Forest],
  },
  /** A reservoir: it waters flat land without a river. */
  baray: {
    nation: 'chenla', cost: 50, tech: 'irrigation',
    yields: { food: 3, production: 0, gold: 1 },
    terrains: GREEN, hills: 'no', features: OPEN,
  },
  /** A farm cut into a hillside. */
  riceTerrace: {
    nation: 'luzon', cost: 40, tech: 'farming',
    yields: { food: 3, production: 0, gold: 0 },
    terrains: GREEN, hills: 'yes', features: [Feature.None, Feature.Forest, Feature.Jungle],
  },
  spiceGarden: {
    nation: 'maluku', cost: 40, tech: 'farming',
    yields: { food: 1, production: 0, gold: 3 },
    terrains: GREEN, hills: 'any', features: WOODS,
  },
} as const satisfies Record<string, ImprovementDef>;

// ------------------------------------------------------------ road upgrades

export const ROAD_UPGRADES = {
  /** Straight roads for armies: half the cost of a road step at home, and gold in every city. */
  imperialHighway: {
    nation: 'qin', tech: 'currency',
    modifiers: [{ type: 'movement', roadCost: 0.25 }, { type: 'cityYield', yields: { gold: 1 } }],
  },
  /** A caravan trail over the mountains: land routes earn more, and more again where they cross hills. */
  teaHorseRoad: {
    nation: 'dian', tech: 'currency',
    modifiers: [
      { type: 'routeGold', gold: 1, route: { sea: false } },
      { type: 'routeGold', gold: 2, route: { sea: false, crossesHills: true } },
    ],
  },
} as const satisfies Record<string, RoadUpgradeSpec>;
