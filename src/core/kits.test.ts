import { describe, expect, it } from 'vitest';
import { dictionaries } from '../shared/i18n.ts';
import { Feature, Terrain } from '../shared/mapData.ts';
import { validate } from './actions.ts';
import { canImprove, deliverItem, hexYields, maxCityHp } from './cities.ts';
import { cityStrength } from './combat.ts';
import {
  BUILDINGS,
  EXCLUSIVE_PORTS,
  IMPROVEMENTS,
  ROSTER,
  UNIQUE_UNIT_IDS,
  UNITS,
  baseBuilding,
  baseImprovement,
  rosterFor,
  unitDef,
} from './data.ts';
import type { BuildingDef, BuildingId, ImprovementDef, ImprovementId, TechId } from './data.ts';
import { applyAction } from './game.ts';
import { FOE, FOE_ZONE, HOME_ZONE, LAND, LAND2, SELF, WATER, hexAt, labGame, measure, resourceIndex } from './kitLab.ts';
import type { Lab } from './kitLab.ts';
import {
  DIFFICULTIES,
  FAMILIES,
  KITS,
  KIT_NATIONS,
  PERSONALITIES,
  PERSONALITY_IDS,
  WASTELAND_LUXURIES,
  portOwner,
} from './kits.ts';
import { roadUpgradeOf } from './modifiers.ts';
import type { Modifier } from './mods.ts';
import { policySlotsFor } from './policies.ts';
import { upgradeTargetFor } from './tech.ts';
import { edit, put } from './testUtil.ts';
import { routeSlots } from './trade.ts';
import type { BuildItem, Unit } from './types.ts';
import { ROAD_UPGRADES } from './uniques.ts';
import type { RoadUpgradeSpec } from './uniques.ts';

type UnitClassName = keyof typeof ROSTER;
type Kind = 'building' | 'improvement' | 'road';

/**
 * Doc 02, as lists: nation; trait; unique unit, its era, class and piece;
 * unique building, its kind, what it replaces and its tech; specialty;
 * leader. The Chinese names are those of the doc.
 */
const DOC: readonly (readonly [
  nation: string, trait: string,
  unit: string, unitZh: string, era: number, unitClass: UnitClassName, piece: string,
  building: string, buildingZh: string, kind: Kind, replaces: string | null, tech: TechId,
  specialty: string, specialtyZh: string, leaderZh: string,
])[] = [
  ['yan', '京畿', 'youzhouCavalry', '幽州突骑', 1, 'cavalry', '突', 'greatWallPass', '长城关隘', 'improvement', null, 'fortification', 'cloisonne', '景泰蓝', '昭王'],
  ['jin', '表里山河', 'bingzhouCavalry', '并州铁骑', 1, 'cavalry', '并', 'draftBank', '票号', 'building', 'bank', 'banking', 'aged-vinegar', '老陈醋', '重耳公'],
  ['qi', '鱼盐之利', 'jijiInfantry', '技击士', 0, 'infantry', '技', 'jixiaAcademy', '稷下学宫', 'building', 'academy', 'writing', 'sea-salt', '海盐', '仲父'],
  ['zhongzhou', '天下之中', 'wuzu', '武卒', 0, 'infantry', '卒', 'everNormalGranary', '常平仓', 'building', 'granary', 'farming', 'peony', '牡丹', '则天女皇'],
  ['qin', '耕战', 'qinCrossbowman', '秦弩手', 1, 'ranged', '秦', 'imperialHighway', '驰道', 'road', null, 'currency', 'dried-persimmon', '柿饼', '祖龙'],
  ['longyou', '河西走廊', 'liangzhouCavalry', '凉州大马', 1, 'cavalry', '凉', 'relayStation', '驿站', 'building', null, 'currency', 'grape-wine', '葡萄酒', '飞将军'],
  ['xixia', '塞上江南', 'ironHawk', '铁鹞子', 2, 'cavalry', '鹞', 'yellowRiverCanal', '引黄渠', 'improvement', 'irrigationCanal', 'irrigation', 'goji', '枸杞', '嵬名元昊'],
  ['qingtang', '三江源', 'qingtangHorseArcher', '青唐骑射', 2, 'cavalry', '射', 'teaHorseMarket', '茶马互市', 'building', 'market', 'currency', 'lake-salt', '青盐', '唃厮啰'],
  ['shu', '天府之国', 'repeatingCrossbowman', '连弩兵', 1, 'ranged', '弩', 'dujiangyan', '都江堰', 'improvement', 'irrigationCanal', 'irrigation', 'shu-brocade', '蜀锦', '卧龙丞相'],
  ['ba', '山城', 'whitePolePikeman', '白杆兵', 3, 'infantry', '杆', 'diaojiaolou', '吊脚楼', 'building', null, 'mining', 'pickled-mustard', '榨菜', '良玉将军'],
  ['dian', '彩云之南', 'luojuzi', '罗苴子', 2, 'infantry', '苴', 'teaHorseRoad', '茶马古道', 'road', null, 'currency', 'puer-tea', '普洱茶', '段氏思平'],
  ['yelang', '地无三尺平', 'rattanArmourInfantry', '藤甲兵', 0, 'infantry', '藤', 'fortifiedVillage', '屯堡', 'building', 'walls', 'fortification', 'sauce-aroma-liquor', '酱酒', '奢香夫人'],
  ['tubo', '世界屋脊', 'tuboHeavyCavalry', '吐蕃重骑', 2, 'cavalry', '蕃', 'dzong', '宗堡', 'building', 'walls', 'fortification', 'cordyceps', '虫草', '松赞赞普'],
  ['chu', '九省通衢', 'towerShip', '楼船', 1, 'naval', '楼', 'zhanghuaTerrace', '章华台', 'building', 'temple', 'ritual', 'lacquerware', '漆器', '庄王'],
  ['xiaoxiang', '湖广熟', 'xiangArmy', '湘军', 4, 'infantry', '湘', 'shuyuan', '书院', 'building', 'university', 'printing', 'chili', '辣椒', '湘乡文正'],
  ['yuzhang', '物华天宝', 'poyangFleet', '鄱阳水军', 2, 'naval', '鄱', 'imperialKiln', '御窑', 'building', 'workshop', 'machinery', 'blue-and-white-porcelain', '青花瓷', '临川相公'],
  ['huainan', '徽商', 'huaiArmy', '淮军', 4, 'infantry', '淮', 'memorialArch', '牌坊', 'building', 'printShop', 'paper', 'xuan-paper-and-hui-ink', '宣纸徽墨', '魏武'],
  ['wu', '漕运', 'wuHookSwordsman', '吴钩剑士', 1, 'infantry', '钩', 'classicalGarden', '园林', 'building', null, 'guilds', 'silk', '丝绸', '吴大帝'],
  ['yue', '卧薪尝胆', 'mandarinDuckInfantry', '鸳鸯阵兵', 3, 'infantry', '阵', 'seawall', '海塘', 'improvement', null, 'irrigation', 'yellow-wine', '黄酒', '海龙王'],
  ['min', '下南洋', 'fuShip', '福船', 2, 'naval', '福', 'tulou', '土楼', 'building', 'walls', 'fortification', 'oolong-tea', '乌龙茶', '开闽王'],
  ['dongning', '宝岛', 'ironMen', '铁人军', 3, 'infantry', '铠', 'sugarMill', '糖廍', 'building', 'workshop', 'machinery', 'camphor', '樟脑', '国姓爷'],
  ['lingnan', '一口通商', 'guangShip', '广船', 3, 'naval', '广', 'thirteenHongs', '十三行', 'building', 'bank', 'banking', 'lychee', '荔枝', '谯国夫人'],
  ['luoyue', '十万大山', 'wolfSoldiers', '狼兵', 3, 'infantry', '狼', 'lingquCanal', '灵渠', 'improvement', 'canal', 'irrigation', 'star-anise', '八角', '瓦氏夫人'],
  ['qiongya', '天涯海角', 'liArcher', '黎峒弓手', 0, 'ranged', '黎', 'arcadeHouse', '骑楼', 'building', 'market', 'currency', 'coconut', '椰子', '海青天'],
  ['liaodong', '重工基地', 'guanningCavalry', '关宁铁骑', 3, 'cavalry', '关', 'tiexiWorks', '铁西工坊', 'building', 'factory', 'steamEngine', 'sea-cucumber', '海参', '天命汗'],
  ['fuyu', '黑土地', 'armouredCavalry', '铁甲骑', 1, 'cavalry', '扶', 'ginsengFarm', '参场', 'improvement', null, 'farming', 'deer-antler', '鹿茸', '震国王'],
  ['heishui', '北大荒', 'solonSoldiers', '索伦兵', 3, 'cavalry', '索', 'forestry', '林场', 'improvement', null, 'machinery', 'caviar', '鱼子酱', '阿骨打'],
  ['monan', '敕勒川', 'chaharCavalry', '察哈尔骑兵', 4, 'cavalry', '察', 'baishin', '板升', 'building', 'granary', 'farming', 'cashmere', '羊绒', '阿勒坦汗'],
  ['mobei', '逐水草而居', 'kheshig', '怯薛', 2, 'cavalry', '薛', 'ordo', '斡耳朵', 'building', null, 'husbandry', 'airag', '马奶酒', '铁木真大汗'],
  ['goryeo', '文治', 'turtleShip', '龟船', 3, 'naval', '龟', 'hallOfWorthies', '集贤殿', 'building', 'university', 'printing', 'korean-ginseng', '高丽参', '世宗'],
  ['ezo', '雪国', 'ainuHunter', '阿伊努猎手', 0, 'ranged', '猎', 'salmonFishery', '鲑鱼渔场', 'improvement', 'fishery', 'boats', 'kelp', '昆布', '沙牟奢允'],
  ['togoku', '武家', 'samurai', '武士', 2, 'infantry', '侍', 'castleTown', '城下町', 'building', 'market', 'currency', 'swords', '刀剑', '东照公'],
  ['yamato', '风雅', 'warriorMonk', '僧兵', 2, 'infantry', '僧', 'shrine', '神社', 'building', 'temple', 'ritual', 'sake', '清酒', '厩户皇子'],
  ['tsukushi', '兰学', 'arquebusiers', '铁炮队', 3, 'ranged', '铳', 'dejima', '出岛商馆', 'building', 'observatory', 'astronomy', 'arita-ware', '有田烧', '日巫女王'],
  ['ryukyu', '万国津梁', 'tributeShip', '进贡船', 3, 'naval', '贡', 'gusuku', '御城', 'building', 'walls', 'fortification', 'brown-sugar', '黑糖', '尚真王'],
  ['beihai', '圣湖', 'reindeerCavalry', '驯鹿骑兵', 1, 'cavalry', '鹿', 'iceRoad', '冰上驿道', 'improvement', null, 'riding', 'omul', '白鲑', '冒顿单于'],
  ['shuaibin', '不冻港', 'haidongFleet', '海东水师', 4, 'naval', '师', 'dockyard', '船坞', 'building', 'harbour', 'shipbuilding', 'king-crab', '帝王蟹', '德尔苏'],
  ['jiaozhi', '丛林游击', 'jungleAmbusher', '丛林伏兵', 1, 'infantry', '伏', 'waterPuppetStage', '水上戏台', 'building', 'printShop', 'paper', 'fish-sauce', '鱼露', '兴道王'],
  ['champa', '占城稻', 'chamWarship', '占婆战船', 2, 'naval', '占', 'chamTower', '占婆塔', 'building', 'temple', 'ritual', 'agarwood', '沉香', '制蓬峨'],
  ['lanxang', '万象之国', 'warElephant', '战象', 1, 'cavalry', '象', 'wat', '佛寺', 'building', 'temple', 'ritual', 'benzoin', '安息香', '法昂王'],
  ['chenla', '水利帝国', 'ballistaElephant', '象弩', 2, 'siege', '床', 'baray', '巴莱水库', 'improvement', null, 'irrigation', 'cardamom', '豆蔻', '阇耶跋摩'],
  ['siam', '竹外交', 'royalBarge', '皇家驳船', 3, 'naval', '驳', 'floatingMarket', '水上市场', 'building', 'market', 'currency', 'jasmine-rice', '香米', '朱拉大帝'],
  ['pagan', '万塔之邦', 'dhaSwordsman', '缅刀武士', 2, 'infantry', '刀', 'pagoda', '佛塔', 'building', 'temple', 'ritual', 'jadeite', '翡翠', '阿奴律陀'],
  ['malacca', '海峡咽喉', 'krisWarrior', '克里斯武士', 2, 'infantry', '匕', 'harbourmastersOffice', '港务司', 'building', 'harbour', 'shipbuilding', 'tin', '锡', '拜里米苏拉'],
  ['srivijaya', '海上霸权', 'straitFleet', '海峡水军', 2, 'naval', '峡', 'buddhistCollege', '佛学院', 'building', 'academy', 'writing', 'pepper', '胡椒', '阇耶那沙'],
  ['shepo', '火山沃土', 'javaneseJong', '爪哇巨舶', 2, 'naval', '舶', 'candi', '陵庙', 'building', 'temple', 'ritual', 'batik', '蜡染', '加查玛达'],
  ['boni', '雨林之心', 'blowpipeHunter', '吹箭猎手', 0, 'ranged', '吹', 'longhouse', '长屋', 'building', 'granary', 'farming', 'birds-nest', '燕窝', '麻那惹加那'],
  ['luzon', '大帆船', 'rattanShieldWarrior', '藤盾武士', 0, 'infantry', '盾', 'riceTerrace', '高山梯田', 'improvement', null, 'farming', 'abaca', '蕉麻', '黎刹'],
  ['sulu', '海上游牧', 'lanongWarship', '兰农战船', 3, 'naval', '掠', 'stiltHouse', '高脚屋', 'building', 'harbour', 'shipbuilding', 'pearl', '珍珠', '东王叭哈剌'],
  ['maluku', '香料群岛', 'koraKora', '科拉科拉战船', 3, 'naval', '桨', 'spiceGarden', '香料园', 'improvement', null, 'farming', 'clove', '丁香', '巴布拉苏丹'],
];

/** The luxuries of the four wasteland regions of doc 01. */
const WASTELAND: readonly (readonly [region: string, resource: string, zh: string])[] = [
  ['xiyu', 'hetian-jade', '和田玉'],
  ['jiankun', 'sable-fur', '貂皮'],
  ['jibei', 'diamond', '钻石'],
  ['liugui', 'walrus-ivory', '海象牙'],
];

const STRATEGIC = ['horses', 'iron', 'coal', 'oil', 'rare-earths'];

/** Puts a source of every strategic resource on the land of polities 0 and 1, so that no unit is held back by one. */
function withResources(m: Lab): void {
  STRATEGIC.forEach((id, i) => {
    m.resource[LAND2 + 1 + i] = resourceIndex(m, id);
    m.resource[hexAt(17 + i, 5)] = resourceIndex(m, id);
  });
}

function text(language: 'zh' | 'en', key: string): string | undefined {
  return (dictionaries[language] as Record<string, string>)[key];
}

/** Expects the modifier to change its number when `on` has it and `off` does not. */
function expectEffect(modifier: Modifier, on: Parameters<typeof measure>[1], off: Parameters<typeof measure>[1], what: string): void {
  const withIt = measure(modifier, on);
  const without = measure(modifier, off);
  expect(withIt, `${what}: ${JSON.stringify(modifier)} measures ${withIt} with and ${without} without`).not.toBe(without);
}

describe('the kits of doc 02', () => {
  it('are the 50 nations of the doc, in its order', () => {
    expect(KIT_NATIONS).toEqual(DOC.map((row) => row[0]));
    expect(KIT_NATIONS).toHaveLength(50);
    expect(UNIQUE_UNIT_IDS).toHaveLength(50);
  });

  it('name every trait, unit, building, specialty and leader of the doc, in Chinese and in English', () => {
    for (const [nation, trait, unit, unitZh, , , , building, buildingZh, kind, , , specialty, specialtyZh, leaderZh] of DOC) {
      const kit = KITS[nation]!;
      expect(kit.unit, nation).toBe(unit);
      expect(kit.building, nation).toBe(building);
      expect(kit.buildingKind, nation).toBe(kind);
      expect(kit.specialty, nation).toBe(specialty);
      const names: [string, string][] = [
        [`trait.${nation}`, trait],
        [`unit.${unit}`, unitZh],
        [`${kind}.${building}`, buildingZh],
        [`specialty.${specialty}`, specialtyZh],
        [`leader.${nation}`, leaderZh],
      ];
      for (const [key, zh] of names) {
        expect(text('zh', key), key).toBe(zh);
        expect(text('en', key), key).toBeTruthy();
        expect(text('en', key), key).not.toBe(zh);
      }
      expect(text('zh', `leader.${nation}.archetype`), nation).toBeTruthy();
      expect(text('en', `leader.${nation}.archetype`), nation).toBeTruthy();
      expect(text('zh', `personality.${kit.personality}`), nation).toBeTruthy();
      expect(text('en', `difficulty.${kit.difficulty}`), nation).toBeTruthy();
      expect(text('zh', `family.${kit.family}`), nation).toBeTruthy();
    }
  });

  it('name the luxuries of the four wasteland regions too: 54 specialties in all', () => {
    for (const [region, resource, zh] of WASTELAND) {
      expect(WASTELAND_LUXURIES[region]).toBe(resource);
      expect(text('zh', `specialty.${resource}`)).toBe(zh);
      expect(text('en', `specialty.${resource}`)).toBeTruthy();
    }
    const specialties = new Set([...DOC.map((row) => row[12]), ...WASTELAND.map((row) => row[1])]);
    expect(specialties.size).toBe(54);
    const keys = Object.keys(dictionaries.zh).filter((key) => key.startsWith('specialty.'));
    expect(keys.sort()).toEqual([...specialties].map((id) => `specialty.${id}`).sort());
  });

  it('give every nation a personality, a difficulty and an architectural family', () => {
    for (const nation of KIT_NATIONS) {
      const kit = KITS[nation]!;
      expect(PERSONALITY_IDS, nation).toContain(kit.personality);
      expect(kit.personality, nation).not.toBe('balanced');
      expect(DIFFICULTIES, nation).toContain(kit.difficulty);
      expect(FAMILIES, nation).toContain(kit.family);
    }
    for (const id of PERSONALITY_IDS) {
      expect(PERSONALITIES[id]).toBeDefined();
      expect(text('zh', `personality.${id}`)).toBeTruthy();
      expect(text('en', `personality.${id}`)).toBeTruthy();
    }
    // Every style is some leader's, and every family houses some nation.
    const used = new Set(KIT_NATIONS.map((nation) => KITS[nation]!.personality));
    expect([...used].sort()).toEqual(PERSONALITY_IDS.filter((id) => id !== 'balanced').sort());
    expect(new Set(KIT_NATIONS.map((nation) => KITS[nation]!.family)).size).toBe(FAMILIES.length);
    expect(new Set(KIT_NATIONS.map((nation) => KITS[nation]!.difficulty)).size).toBe(DIFFICULTIES.length);
  });

  it('keep the Pacific sea exit for the nation whose trait says so', () => {
    for (const [port, nation] of Object.entries(EXCLUSIVE_PORTS)) expect(portOwner(port)).toBe(nation);
    expect(portOwner('Western Ocean')).toBeNull();
  });

  it('add policy slots only where a kit says so', () => {
    expect(policySlotsFor('yan', 0)).toBe(policySlotsFor('', 0) + 1);
    expect(policySlotsFor('qin', 0)).toBe(policySlotsFor('', 0));
  });
});

describe.each(DOC.map((row) => [row[0], row] as const))('%s', (nation, row) => {
  const [, , unitId, , era, unitClass, piece, buildingId, , kind, replaces, tech] = row;
  const kit = KITS[nation]!;

  it('has a trait that changes a number', () => {
    expect(kit.trait.length).toBeGreaterThan(0);
    for (const modifier of kit.trait) expectEffect(modifier, { nation }, { nation: null }, 'trait');
  });

  it('has a leader whose buff changes its number', () => {
    expect(kit.leader.length).toBeGreaterThan(0);
    for (const modifier of kit.leader) expectEffect(modifier, { nation }, { nation: null }, 'leader');
  });

  it('builds its unique unit in place of the generic one', () => {
    const def = unitDef(unitId);
    const generic = ROSTER[unitClass][era]!;
    expect(def.nation).toBe(nation);
    expect(def.replaces).toBe(generic);
    expect(def.era).toBe(era);
    expect(def.unitClass).toBe(unitClass);
    expect(def.piece).toBe(piece);
    expect(def.tech).toBe(unitDef(generic).tech);
    expect(rosterFor(nation, unitClass)[era]).toBe(unitId);
    expect(rosterFor('', unitClass)[era]).toBe(generic);

    const w = labGame(nation, { tweak: withResources, prepare: (draft) => (draft.polities[SELF]!.gold = 100000) });
    // Queued under the generic name, it is the unique unit that is queued, built and bought.
    const queued = applyAction(w.state, { type: 'queueBuild', polity: SELF, city: HOME_ZONE, item: { kind: 'unit', unit: generic } });
    expect(queued.ok, 'queue').toBe(true);
    expect(queued.state.cities[HOME_ZONE]!.queue).toEqual([{ kind: 'unit', unit: unitId }]);
    const bought = applyAction(w.state, { type: 'buy', polity: SELF, city: HOME_ZONE, item: { kind: 'unit', unit: generic } });
    expect(bought.ok, 'buy').toBe(true);
    expect(bought.state.units[bought.state.units.length - 1]!.type).toBe(unitId);
    // Nobody else can build it.
    expect(validate(w.ctx, { type: 'queueBuild', polity: FOE, city: FOE_ZONE, item: { kind: 'unit', unit: unitId } })).toBe('badItem');
    expect(validate(w.ctx, { type: 'queueBuild', polity: FOE, city: FOE_ZONE, item: { kind: 'unit', unit: generic } })).toBeNull();

    // The upgrade chain passes through it.
    let before = 0;
    let own = 0;
    const chain = labGame(nation, {
      tweak: withResources,
      prepare: (draft) => {
        const afloat = def.domain === 'sea';
        if (era > 0) before = put(draft, ROSTER[unitClass][era - 1]!, SELF, afloat ? WATER : LAND).id;
        own = put(draft, unitId, SELF, afloat ? WATER + 1 : LAND2).id;
      },
    });
    if (era > 0) expect(upgradeTargetFor(chain.ctx, chain.ctx.unitById.get(before) as Unit)?.id).toBe(unitId);
    expect(upgradeTargetFor(chain.ctx, chain.ctx.unitById.get(own) as Unit)?.id).toBe(ROSTER[unitClass][era + 1]);
  });

  it('has a unique unit with a profile of its own and an ability that has an effect', () => {
    const def = unitDef(unitId);
    const generic = unitDef(def.replaces!);
    expect(def.abilities.length).toBeGreaterThan(0);
    for (const ability of def.abilities) {
      // A city delivers its nation's unit whatever name it is asked for, so starting experience is
      // compared in a polity without a kit; everything else in the nation itself.
      const owner = ability.type === 'startXp' ? null : nation;
      expectEffect(ability, { nation: owner, unit: unitId }, { nation: owner, unit: generic.id }, 'ability');
    }
    expect(def.strength).toBeGreaterThan(0);
    expect(def.cost).toBeGreaterThan(0);
    expect(def.moves).toBeGreaterThan(0);
  });

  if (kind === 'building') {
    it('has its unique building with its tech, and the building has its effect', () => {
      const id = buildingId as BuildingId;
      const def: BuildingDef = BUILDINGS[id];
      expect(def.nation).toBe(nation);
      expect(def.replaces).toBe(replaces);
      expect(def.tech).toBe(tech);
      expect(baseBuilding(id)).toBe(replaces ?? id);
      const item: BuildItem = { kind: 'building', building: id };
      const queue = (polity: number, city: number, what: BuildItem, techs: readonly TechId[] | 'all') =>
        validate(labGame(nation, { techs }).ctx, { type: 'queueBuild', polity, city, item: what });
      expect(queue(SELF, HOME_ZONE, item, [])).toBe('needsTech');
      expect(queue(SELF, HOME_ZONE, item, [tech])).toBeNull();
      expect(queue(FOE, FOE_ZONE, item, 'all')).toBe('badItem');

      const base: BuildingDef | null = replaces === null ? null : BUILDINGS[replaces as BuildingId];
      if (base !== null) {
        // It stands in for the generic building: its nation builds no other, and it keeps the base effect.
        expect(queue(SELF, HOME_ZONE, { kind: 'building', building: replaces as BuildingId }, 'all')).toBe('badItem');
        expect(queue(FOE, FOE_ZONE, { kind: 'building', building: replaces as BuildingId }, 'all')).toBeNull();
        expect(def.yields).toEqual(base.yields);
        expect(def.percent).toEqual(base.percent);
        expect(def.waterYields).toEqual(base.waterYields);
        expect(def.counterStrike).toBe(base.counterStrike);
        expect(def.cost).toBe(base.cost);
        expect(def.cityHp).toBeGreaterThanOrEqual(base.cityHp);
        expect(def.cityStrengthPercent).toBeGreaterThanOrEqual(base.cityStrengthPercent);
        expect(def.tradeRoutes).toBeGreaterThanOrEqual(base.tradeRoutes);
      }
      // Its own effect: every modifier, and what it adds to the plain fields.
      const withIt = { nation, buildings: [id] };
      const without = { nation, buildings: replaces === null ? [] : [replaces as BuildingId] };
      for (const modifier of def.modifiers) expectEffect(modifier, withIt, without, 'building');
      const having = (buildings: readonly BuildingId[]) =>
        labGame(nation, { prepare: (draft) => draft.cities[HOME_ZONE]!.buildings.push(...buildings) });
      const a = having(withIt.buildings);
      const b = having(without.buildings);
      const plain =
        (maxCityHp(a.city) - maxCityHp(b.city)) +
        (cityStrength(a.ctx, a.city) - cityStrength(b.ctx, b.city)) +
        (routeSlots(a.ctx, SELF) - routeSlots(b.ctx, SELF));
      expect(def.modifiers.length + plain).toBeGreaterThan(0);
      if (base !== null && def.cityHp > base.cityHp) expect(maxCityHp(a.city)).toBe(maxCityHp(b.city) + def.cityHp - base.cityHp);
      if (base !== null && def.tradeRoutes > base.tradeRoutes) expect(routeSlots(a.ctx, SELF)).toBeGreaterThan(routeSlots(b.ctx, SELF));
      if (base !== null && def.cityStrengthPercent > base.cityStrengthPercent) {
        expect(cityStrength(a.ctx, a.city)).toBeGreaterThan(cityStrength(b.ctx, b.city));
      }
    });
  }

  if (kind === 'improvement') {
    it('has its unique improvement with its tech, and the improvement has its effect', () => {
      const id = buildingId as ImprovementId;
      const def: ImprovementDef = IMPROVEMENTS[id];
      expect(def.nation).toBe(nation);
      expect(def.replaces ?? null).toBe(replaces);
      expect(def.tech).toBe(tech);
      expect(baseImprovement(id)).toBe(replaces ?? id);
      // A hex it fits: its first terrain, with what else it asks for.
      const afloat = def.terrains[0] === Terrain.Coast || def.terrains[0] === Terrain.Lake;
      const hex = afloat ? WATER : LAND;
      const tweak = (m: Lab): void => {
        m.terrain[hex] = def.terrains[0]!;
        m.hills[hex] = def.hills === 'yes' ? 1 : 0;
        m.feature[hex] = def.features.includes(Feature.None) ? Feature.None : def.features[0]!;
        if (def.river === true) m.riverEdges[hex] = 1;
      };
      const item: BuildItem = { kind: 'improvement', improvement: id, hex };
      const queue = (polity: number, city: number, what: BuildItem, techs: readonly TechId[] | 'all') =>
        validate(labGame(nation, { tweak, techs }).ctx, { type: 'queueBuild', polity, city, item: what });
      expect(queue(SELF, HOME_ZONE, item, [])).toBe('needsTech');
      expect(queue(SELF, HOME_ZONE, item, [tech])).toBeNull();
      expect(queue(FOE, FOE_ZONE, item, 'all')).toBe('badItem');
      expect(canImprove(labGame(nation, { tweak }).ctx, SELF, id, hex)).toBe(true);
      if (replaces !== null) {
        expect(queue(SELF, HOME_ZONE, { kind: 'improvement', improvement: replaces as ImprovementId, hex }, 'all')).toBe('badItem');
      }

      // It yields more than the hex does without it, and more than the improvement it replaces.
      const yields = (improvement: ImprovementId | null): number => {
        const w = labGame(nation, {
          tweak,
          prepare: (draft) => {
            if (improvement !== null) draft.improvements[hex] = improvement;
          },
        });
        const y = hexYields(w.ctx, w.city, hex);
        return y.food + y.production + y.gold + y.science + y.culture;
      };
      expect(yields(id)).toBeGreaterThan(yields(null));
      if (replaces !== null) expect(yields(id)).toBeGreaterThan(yields(replaces as ImprovementId));
      for (const modifier of def.modifiers ?? []) {
        expectEffect(modifier, { nation, improvement: id }, { nation }, 'improvement');
      }
      if (def.road === true) {
        const w = labGame(nation, { tweak });
        expect(w.ctx.state.roads[hex]).toBeUndefined();
        expect(deliverItem(w.ctx, w.city, item)).toBe(true);
        expect(w.ctx.state.roads[hex]).toBe(1);
      }
    });
  }

  if (kind === 'road') {
    it('has its road upgrade with its tech, and the upgrade has its effect', () => {
      const spec: RoadUpgradeSpec = (ROAD_UPGRADES as Record<string, RoadUpgradeSpec>)[buildingId]!;
      expect(spec.nation).toBe(nation);
      expect(spec.tech).toBe(tech);
      expect(roadUpgradeOf(labGame(nation, { techs: [] }).ctx, SELF)).toBeNull();
      expect(roadUpgradeOf(labGame(nation, { techs: [tech] }).ctx, SELF)).toBe(spec);
      expect(roadUpgradeOf(labGame(null).ctx, SELF)).toBeNull();
      expect(spec.modifiers.length).toBeGreaterThan(0);
      for (const modifier of spec.modifiers) expectEffect(modifier, { nation }, { nation: null }, 'road');
    });
  }
});

describe('units and kits together', () => {
  it('starts a nation whose unique unit is of the first era with that unit as its garrison', () => {
    expect(labGame('qi').state.units.find((unit) => unit.owner === SELF)!.type).toBe('jijiInfantry');
    expect(labGame('qin').state.units.find((unit) => unit.owner === SELF)!.type).toBe('warrior');
    expect(labGame(null).state.units.find((unit) => unit.owner === SELF)!.type).toBe('warrior');
  });

  it('counts a unique building as the building it replaces', () => {
    // 齐's leader pays for every market; 琼崖's arcade house is a market.
    const state = edit(labGame('qiongya').state, (draft) => draft.cities[HOME_ZONE]!.buildings.push('arcadeHouse'));
    const again = applyAction(state, { type: 'queueBuild', polity: SELF, city: HOME_ZONE, item: { kind: 'building', building: 'arcadeHouse' } });
    expect(again).toMatchObject({ ok: false, reason: 'alreadyBuilt' });
    expect(UNITS.warElephant!.resource).toBeNull();
    expect(UNITS.reindeerCavalry!.resource).toBeNull();
  });
});
