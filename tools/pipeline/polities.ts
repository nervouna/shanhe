/**
 * The polity table: the 50 nations, 10 city-states and 4 wasteland regions
 * of `docs/design/01-world-and-map.md` and `02-nations.md`, each with the
 * Natural Earth units that make it up, its city sites and its luxury
 * resource.
 *
 * Units are named by Natural Earth's `adm0_a3` country code and, inside a
 * country, by the `iso_3166_2` code of the first-level unit.
 */

import type { PolityKind } from '../../src/shared/mapData.ts';

/** West, south, east, north, in degrees. */
export type Box = readonly [west: number, south: number, east: number, north: number];

/** A whole country from `ne_10m_admin_0_countries`. */
export interface CountrySource {
  readonly layer: 'admin0';
  readonly adm0: string;
}

/** First-level units of one country from `ne_10m_admin_1_states_provinces`. */
export interface UnitSource {
  readonly layer: 'admin1';
  readonly adm0: string;
  /** Only these units. All units of the country if omitted. */
  readonly iso?: readonly string[];
  /** All units but these. */
  readonly exceptIso?: readonly string[];
  /** Only units whose label point lies at or north of this latitude. */
  readonly latMin?: number;
  /** Only units whose label point lies south of this latitude. */
  readonly latMax?: number;
  /** Only the polygon parts (islands) whose bounding-box centre lies in this box. */
  readonly partsIn?: Box;
}

/** A disc on the ground, for a place that is not a first-level unit. */
export interface CircleSource {
  readonly layer: 'circle';
  readonly lon: number;
  readonly lat: number;
  readonly radiusKm: number;
}

export type Source = (CountrySource | UnitSource | CircleSource) & {
  /**
   * Drawn after every plain source, so it takes its area out of the polity
   * that would otherwise hold it. City-state sources are always carved.
   */
  readonly carve?: boolean;
};

/** A city site: Chinese name, English name, longitude, latitude. */
export type City = readonly [zh: string, en: string, lon: number, lat: number];

export interface PolitySpec {
  readonly id: string;
  readonly kind: PolityKind;
  readonly nameZh: string;
  readonly nameEn: string;
  /** What the polity is based on, as the design docs put it. */
  readonly basedOn: string;
  /** For a city-state: the id of the nation it is carved from. */
  readonly carvedFrom?: string;
  readonly sources: readonly Source[];
  /** Map colour as `0xRRGGBB`, distinct from every other polity's. */
  readonly color: number;
  /**
   * City sites, the capital first. A nation uses the first one to four of
   * them, by its size (`zoneCountFor`); a city-state has one; a wasteland
   * region uses all of them.
   */
  readonly cities: readonly City[];
  /**
   * Fixed number of zones for a nation, where the size rule would leave a
   * detached main island without a city of its own.
   */
  readonly zones?: number;
  /** The nation's specialty or the wasteland region's luxury: Chinese and English name. */
  readonly luxury?: readonly [zh: string, en: string];
}

/** Number of city zones of a nation with `hexes` land hexes. */
export function zoneCountFor(hexes: number): number {
  if (hexes < 25) return 1;
  if (hexes < 60) return 2;
  if (hexes < 110) return 3;
  return 4;
}

const cn = (...iso: string[]): Source => ({ layer: 'admin1', adm0: 'CHN', iso });
const jp = (...numbers: number[]): Source => ({
  layer: 'admin1',
  adm0: 'JPN',
  iso: numbers.map((n) => `JP-${String(n).padStart(2, '0')}`),
});
const ru = (...codes: string[]): Source => ({
  layer: 'admin1',
  adm0: 'RUS',
  iso: codes.map((c) => `RU-${c}`),
});
const id = (...codes: string[]): Source => ({
  layer: 'admin1',
  adm0: 'IDN',
  iso: codes.map((c) => `ID-${c}`),
});
const country = (adm0: string): Source => ({ layer: 'admin0', adm0 });
const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** The provinces of the Luzon island group, Palawan excluded. */
const LUZON_PROVINCES = [
  'ILN', 'ILS', 'LUN', 'PAN', 'BTN', 'CAG', 'ISA', 'NUV', 'QUI', 'AUR', 'BAN', 'BUL', 'NUE',
  'PAM', 'TAR', 'ZMB', 'BTG', 'CAV', 'LAG', 'QUE', 'RIZ', 'ABR', 'APA', 'BEN', 'IFU', 'KAL',
  'MOU', 'MNL', 'ALB', 'CAN', 'CAS', 'CAT', 'MAS', 'SOR', 'MAD', 'MDC', 'MDR', 'ROM',
].map((c) => `PH-${c}`);

/** The Hoành Sơn range, the old border between Đại Việt and Champa. */
const VIETNAM_SPLIT_LAT = 18;

const KURILS_SOUTH: Box = [145, 43.2, 150.6, 46.6];
const KURILS_NORTH: Box = [150.6, 46.6, 157.5, 51.5];
/** The Amami islands of Kagoshima, part of the Ryukyu kingdom until 1609. */
const AMAMI: Box = [128, 26.5, 131, 29.1];
const TSUSHIMA: Box = [129.0, 34.0, 129.7, 34.9];
const NATUNA: Box = [107.3, 2.3, 109.6, 5.0];

function nation(
  idText: string,
  nameZh: string,
  nameEn: string,
  basedOn: string,
  sources: readonly Source[],
  cities: readonly City[],
  luxury: readonly [string, string],
  zones?: number,
): Omit<PolitySpec, 'color'> {
  const spec = { id: idText, kind: 'nation', nameZh, nameEn, basedOn, sources, cities, luxury } as const;
  return zones === undefined ? spec : { ...spec, zones };
}

function cityState(
  idText: string,
  nameZh: string,
  nameEn: string,
  basedOn: string,
  carvedFrom: string,
  source: Source,
  city: City,
): Omit<PolitySpec, 'color'> {
  return {
    id: idText,
    kind: 'cityState',
    nameZh,
    nameEn,
    basedOn,
    carvedFrom,
    sources: [{ ...source, carve: true }],
    cities: [city],
  };
}

function wasteland(
  idText: string,
  nameZh: string,
  nameEn: string,
  basedOn: string,
  sources: readonly Source[],
  cities: readonly City[],
  luxury: readonly [string, string],
): Omit<PolitySpec, 'color'> {
  return { id: idText, kind: 'wastelandRegion', nameZh, nameEn, basedOn, sources, cities, luxury };
}

const TABLE: readonly Omit<PolitySpec, 'color'>[] = [
  // North and Northwest China
  nation('yan', '燕', 'Yan', 'Beijing, Hebei', [cn('CN-BJ', 'CN-HE')], [
    ['北京', 'Beijing', 116.4, 39.9],
    ['石家庄', 'Shijiazhuang', 114.51, 38.04],
    ['承德', 'Chengde', 117.96, 40.95],
  ], ['景泰蓝', 'Cloisonné']),
  nation('jin', '晋', 'Jin', 'Shanxi', [cn('CN-SX')], [
    ['太原', 'Taiyuan', 112.55, 37.87],
    ['大同', 'Datong', 113.3, 40.08],
    ['临汾', 'Linfen', 111.52, 36.09],
  ], ['老陈醋', 'Aged vinegar']),
  nation('qi', '齐', 'Qi', 'Shandong', [cn('CN-SD')], [
    ['济南', 'Jinan', 117.0, 36.65],
    ['青岛', 'Qingdao', 120.38, 36.07],
    ['临沂', 'Linyi', 118.35, 35.05],
  ], ['海盐', 'Sea salt']),
  nation('zhongzhou', '中州', 'Zhongzhou', 'Henan', [cn('CN-HA')], [
    ['郑州', 'Zhengzhou', 113.62, 34.75],
    ['南阳', 'Nanyang', 112.53, 33.0],
    ['洛阳', 'Luoyang', 112.45, 34.62],
  ], ['牡丹', 'Peony']),
  nation('qin', '秦', 'Qin', 'Shaanxi', [cn('CN-SN')], [
    ['西安', "Xi'an", 108.94, 34.34],
    ['延安', "Yan'an", 109.49, 36.59],
    ['汉中', 'Hanzhong', 107.03, 33.07],
  ], ['柿饼', 'Dried persimmon']),
  nation('longyou', '陇右', 'Longyou', 'Gansu', [cn('CN-GS')], [
    ['兰州', 'Lanzhou', 103.83, 36.06],
    ['张掖', 'Zhangye', 100.45, 38.93],
    ['天水', 'Tianshui', 105.72, 34.58],
    ['酒泉', 'Jiuquan', 98.51, 39.74],
  ], ['葡萄酒', 'Grape wine']),
  nation('xixia', '西夏', 'Xixia', 'Ningxia', [cn('CN-NX')], [
    ['银川', 'Yinchuan', 106.23, 38.49],
    ['固原', 'Guyuan', 106.24, 36.02],
  ], ['枸杞', 'Goji']),
  nation('qingtang', '青唐', 'Qingtang', 'Qinghai', [cn('CN-QH')], [
    ['西宁', 'Xining', 101.78, 36.62],
    ['格尔木', 'Golmud', 94.9, 36.4],
    ['玉树', 'Yushu', 97.01, 33.0],
    ['德令哈', 'Delingha', 97.37, 37.37],
  ], ['青盐', 'Lake salt']),

  // Southwest and Central China
  nation('shu', '蜀', 'Shu', 'Sichuan', [cn('CN-SC')], [
    ['成都', 'Chengdu', 104.07, 30.57],
    ['康定', 'Kangding', 101.96, 30.05],
    ['西昌', 'Xichang', 102.26, 27.89],
    ['南充', 'Nanchong', 106.11, 30.84],
  ], ['蜀锦', 'Shu brocade']),
  nation('ba', '巴', 'Ba', 'Chongqing', [cn('CN-CQ')], [
    ['重庆', 'Chongqing', 106.55, 29.56],
    ['万州', 'Wanzhou', 108.41, 30.81],
  ], ['榨菜', 'Pickled mustard']),
  nation('dian', '滇', 'Dian', 'Yunnan', [cn('CN-YN')], [
    ['昆明', 'Kunming', 102.83, 24.88],
    ['大理', 'Dali', 100.27, 25.61],
    ['景洪', 'Jinghong', 100.8, 22.01],
    ['昭通', 'Zhaotong', 103.72, 27.34],
  ], ['普洱茶', "Pu'er tea"]),
  nation('yelang', '夜郎', 'Yelang', 'Guizhou', [cn('CN-GZ')], [
    ['贵阳', 'Guiyang', 106.63, 26.65],
    ['遵义', 'Zunyi', 106.93, 27.73],
    ['凯里', 'Kaili', 107.98, 26.57],
  ], ['酱酒', 'Sauce-aroma liquor']),
  nation('tubo', '吐蕃', 'Tubo', 'Tibet', [cn('CN-XZ')], [
    ['拉萨', 'Lhasa', 91.13, 29.65],
    ['日喀则', 'Shigatse', 88.88, 29.27],
    ['昌都', 'Chamdo', 97.17, 31.14],
    ['噶尔', 'Gar', 80.1, 32.5],
  ], ['虫草', 'Cordyceps']),
  nation('chu', '楚', 'Chu', 'Hubei', [cn('CN-HB')], [
    ['武汉', 'Wuhan', 114.31, 30.59],
    ['襄阳', 'Xiangyang', 112.14, 32.04],
    ['宜昌', 'Yichang', 111.29, 30.69],
  ], ['漆器', 'Lacquerware']),
  nation('xiaoxiang', '潇湘', 'Xiaoxiang', 'Hunan', [cn('CN-HN')], [
    ['长沙', 'Changsha', 112.94, 28.23],
    ['衡阳', 'Hengyang', 112.57, 26.89],
    ['怀化', 'Huaihua', 110.0, 27.57],
  ], ['辣椒', 'Chili']),
  nation('yuzhang', '豫章', 'Yuzhang', 'Jiangxi', [cn('CN-JX')], [
    ['南昌', 'Nanchang', 115.86, 28.68],
    ['赣州', 'Ganzhou', 114.93, 25.83],
    ['九江', 'Jiujiang', 116.0, 29.71],
  ], ['青花瓷', 'Blue-and-white porcelain']),
  nation('huainan', '淮南', 'Huainan', 'Anhui', [cn('CN-AH')], [
    ['合肥', 'Hefei', 117.23, 31.82],
    ['蚌埠', 'Bengbu', 117.39, 32.92],
    ['黄山', 'Huangshan', 118.34, 29.71],
  ], ['宣纸徽墨', 'Xuan paper and Hui ink']),

  // East, South and Northeast China
  nation('wu', '吴', 'Wu', 'Jiangsu', [cn('CN-JS')], [
    ['南京', 'Nanjing', 118.8, 32.06],
    ['徐州', 'Xuzhou', 117.28, 34.21],
    ['苏州', 'Suzhou', 120.58, 31.3],
  ], ['丝绸', 'Silk']),
  nation('yue', '越', 'Yue', 'Zhejiang', [cn('CN-ZJ')], [
    ['杭州', 'Hangzhou', 120.16, 30.27],
    ['温州', 'Wenzhou', 120.7, 28.0],
    ['宁波', 'Ningbo', 121.55, 29.87],
  ], ['黄酒', 'Yellow wine']),
  nation('min', '闽', 'Min', 'Fujian', [
    cn('CN-FJ'),
    // Kinmen lies in Xiamen Bay, off the Fujian coast
    { layer: 'admin1', adm0: 'TWN', iso: ['TW-KIN'] },
  ], [
    ['福州', 'Fuzhou', 119.3, 26.07],
    ['厦门', 'Xiamen', 118.09, 24.48],
    ['南平', 'Nanping', 118.18, 26.64],
  ], ['乌龙茶', 'Oolong tea']),
  nation('dongning', '东宁', 'Dongning', 'Taiwan', [
    { layer: 'admin1', adm0: 'TWN', exceptIso: ['TW-KIN'] },
  ], [
    ['台北', 'Taipei', 121.56, 25.03],
    ['台南', 'Tainan', 120.21, 22.99],
  ], ['樟脑', 'Camphor']),
  nation('lingnan', '岭南', 'Lingnan', 'Guangdong', [cn('CN-GD')], [
    ['广州', 'Guangzhou', 113.26, 23.13],
    ['汕头', 'Shantou', 116.68, 23.35],
    ['湛江', 'Zhanjiang', 110.36, 21.27],
    ['韶关', 'Shaoguan', 113.6, 24.81],
  ], ['荔枝', 'Lychee']),
  nation('luoyue', '骆越', 'Luoyue', 'Guangxi', [cn('CN-GX')], [
    ['南宁', 'Nanning', 108.37, 22.82],
    ['桂林', 'Guilin', 110.29, 25.27],
    ['百色', 'Baise', 106.62, 23.9],
  ], ['八角', 'Star anise']),
  nation('qiongya', '琼崖', 'Qiongya', 'Hainan', [cn('CN-HI', 'CN-X01~')], [
    ['海口', 'Haikou', 110.2, 20.04],
    ['三亚', 'Sanya', 109.51, 18.25],
  ], ['椰子', 'Coconut']),
  nation('liaodong', '辽东', 'Liaodong', 'Liaoning', [cn('CN-LN')], [
    ['沈阳', 'Shenyang', 123.43, 41.8],
    ['大连', 'Dalian', 121.61, 38.91],
    ['锦州', 'Jinzhou', 121.13, 41.1],
  ], ['海参', 'Sea cucumber']),
  nation('fuyu', '扶余', 'Fuyu', 'Jilin', [cn('CN-JL')], [
    ['长春', 'Changchun', 125.32, 43.82],
    ['延吉', 'Yanji', 129.51, 42.89],
    ['白城', 'Baicheng', 122.84, 45.62],
  ], ['鹿茸', 'Deer antler']),
  nation('heishui', '黑水', 'Heishui', 'Heilongjiang', [cn('CN-HL')], [
    ['哈尔滨', 'Harbin', 126.64, 45.76],
    ['齐齐哈尔', 'Qiqihar', 123.92, 47.35],
    ['佳木斯', 'Jiamusi', 130.32, 46.8],
    ['黑河', 'Heihe', 127.5, 50.25],
  ], ['鱼子酱', 'Caviar']),
  nation('monan', '漠南', 'Monan', 'Inner Mongolia', [cn('CN-NM')], [
    ['呼和浩特', 'Hohhot', 111.75, 40.84],
    ['海拉尔', 'Hailar', 119.76, 49.21],
    ['巴彦浩特', 'Bayanhot', 105.7, 38.84],
    ['赤峰', 'Chifeng', 118.89, 42.26],
  ], ['羊绒', 'Cashmere']),

  // Steppe, Peninsula, Archipelago, Siberia
  nation('mobei', '漠北', 'Mobei', 'Mongolia', [country('MNG')], [
    ['乌兰巴托', 'Ulaanbaatar', 106.92, 47.92],
    ['科布多', 'Khovd', 91.64, 48.01],
    ['乔巴山', 'Choibalsan', 114.53, 48.07],
    ['达兰扎德嘎德', 'Dalanzadgad', 104.42, 43.57],
  ], ['马奶酒', 'Airag']),
  nation('goryeo', '高丽', 'Goryeo', 'Korean Peninsula', [country('KOR'), country('PRK')], [
    ['首尔', 'Seoul', 126.98, 37.57],
    ['平壤', 'Pyongyang', 125.75, 39.03],
    ['釜山', 'Busan', 129.08, 35.18],
    ['咸兴', 'Hamhung', 127.54, 39.92],
  ], ['高丽参', 'Korean ginseng']),
  nation('ezo', '虾夷', 'Ezo', 'Hokkaido', [
    jp(1),
    // Kunashir, Iturup and Urup: the southern Kurils, off Hokkaido
    { layer: 'admin1', adm0: 'RUS', iso: ['RU-SAK'], partsIn: KURILS_SOUTH, carve: true },
  ], [
    ['札幌', 'Sapporo', 141.35, 43.06],
    ['钏路', 'Kushiro', 144.38, 42.98],
  ], ['昆布', 'Kelp']),
  nation('togoku', '东国', 'Togoku', 'Eastern Honshu', [jp(...range(2, 23))], [
    ['东京', 'Tokyo', 139.69, 35.69],
    ['仙台', 'Sendai', 140.87, 38.27],
    ['名古屋', 'Nagoya', 136.91, 35.18],
    ['新潟', 'Niigata', 139.04, 37.92],
  ], ['刀剑', 'Swords']),
  nation('yamato', '大和', 'Yamato', 'Western Honshu, Shikoku', [jp(...range(24, 39))], [
    ['京都', 'Kyoto', 135.77, 35.01],
    ['广岛', 'Hiroshima', 132.46, 34.39],
    ['高知', 'Kochi', 133.53, 33.56],
  ], ['清酒', 'Sake']),
  nation('tsukushi', '筑紫', 'Tsukushi', 'Kyushu', [jp(...range(40, 46))], [
    ['福冈', 'Fukuoka', 130.4, 33.59],
    ['鹿儿岛', 'Kagoshima', 130.56, 31.6],
  ], ['有田烧', 'Arita ware']),
  nation('ryukyu', '琉球', 'Ryukyu', 'Okinawa', [
    jp(47),
    { layer: 'admin1', adm0: 'JPN', iso: ['JP-46'], partsIn: AMAMI, carve: true },
  ], [['那霸', 'Naha', 127.68, 26.21]], ['黑糖', 'Brown sugar']),
  nation('beihai', '北海', 'Beihai', 'Around Lake Baikal', [ru('IRK', 'BU', 'ZAB')], [
    ['伊尔库茨克', 'Irkutsk', 104.28, 52.29],
    ['赤塔', 'Chita', 113.5, 52.03],
    ['布拉茨克', 'Bratsk', 101.63, 56.15],
    ['乌兰乌德', 'Ulan-Ude', 107.61, 51.83],
  ], ['白鲑', 'Omul']),
  nation('shuaibin', '率宾', 'Shuaibin', 'Primorye, Sakhalin', [ru('PRI', 'SAK', 'KHA', 'AMU', 'YEV')], [
    ['海参崴', 'Vladivostok', 131.89, 43.12],
    ['伯力', 'Khabarovsk', 135.07, 48.48],
    ['海兰泡', 'Blagoveshchensk', 127.53, 50.29],
    ['南萨哈林斯克', 'Yuzhno-Sakhalinsk', 142.73, 46.96],
  ], ['帝王蟹', 'King crab']),

  // Mainland and Maritime Southeast Asia
  nation('jiaozhi', '交趾', 'Jiaozhi', 'Northern Vietnam', [
    { layer: 'admin1', adm0: 'VNM', latMin: VIETNAM_SPLIT_LAT },
  ], [
    ['河内', 'Hanoi', 105.85, 21.03],
    ['荣市', 'Vinh', 105.69, 18.67],
    ['老街', 'Lao Cai', 103.97, 22.49],
  ], ['鱼露', 'Fish sauce']),
  nation('champa', '占城', 'Champa', 'Central and southern Vietnam', [
    { layer: 'admin1', adm0: 'VNM', latMax: VIETNAM_SPLIT_LAT },
  ], [
    ['顺化', 'Hue', 107.59, 16.46],
    ['胡志明市', 'Ho Chi Minh City', 106.7, 10.78],
    ['芽庄', 'Nha Trang', 109.19, 12.24],
  ], ['沉香', 'Agarwood']),
  nation('lanxang', '澜沧', 'Lan Xang', 'Laos', [country('LAO')], [
    ['万象', 'Vientiane', 102.63, 17.97],
    ['巴色', 'Pakse', 105.78, 15.12],
    ['琅勃拉邦', 'Luang Prabang', 102.14, 19.89],
  ], ['安息香', 'Benzoin']),
  nation('chenla', '真腊', 'Chenla', 'Cambodia', [country('KHM')], [
    ['金边', 'Phnom Penh', 104.92, 11.56],
    ['暹粒', 'Siem Reap', 103.86, 13.36],
    ['上丁', 'Stung Treng', 105.97, 13.53],
  ], ['豆蔻', 'Cardamom']),
  nation('siam', '暹罗', 'Siam', 'Thailand', [country('THA')], [
    ['曼谷', 'Bangkok', 100.5, 13.75],
    ['清迈', 'Chiang Mai', 98.98, 18.79],
    ['呵叻', 'Nakhon Ratchasima', 102.1, 14.98],
    ['合艾', 'Hat Yai', 100.47, 7.01],
  ], ['香米', 'Jasmine rice']),
  nation('pagan', '蒲甘', 'Pagan', 'Myanmar', [country('MMR')], [
    ['内比都', 'Naypyidaw', 96.13, 19.75],
    ['仰光', 'Yangon', 96.16, 16.87],
    ['曼德勒', 'Mandalay', 96.08, 21.97],
    ['密支那', 'Myitkyina', 97.4, 25.38],
  ], ['翡翠', 'Jadeite']),
  nation('malacca', '满剌加', 'Malacca', 'Malay Peninsula', [
    {
      layer: 'admin1',
      adm0: 'MYS',
      iso: [...range(1, 11), 14, 16].map((n) => `MY-${String(n).padStart(2, '0')}`),
    },
  ], [
    ['吉隆坡', 'Kuala Lumpur', 101.69, 3.14],
    ['关丹', 'Kuantan', 103.33, 3.81],
    ['乔治市', 'George Town', 100.33, 5.41],
  ], ['锡', 'Tin']),
  nation('srivijaya', '三佛齐', 'Srivijaya', 'Sumatra', [
    id('AC', 'SU', 'SB', 'RI', 'JA', 'SS', 'BE', 'LA', 'BB', 'KR'),
  ], [
    ['巨港', 'Palembang', 104.75, -2.99],
    ['棉兰', 'Medan', 98.67, 3.59],
    ['巴东', 'Padang', 100.35, -0.95],
    ['班达亚齐', 'Banda Aceh', 95.32, 5.55],
  ], ['胡椒', 'Pepper']),
  nation('shepo', '阇婆', 'Shepo', 'Java, Bali and islands east', [
    id('BT', 'JK', 'JB', 'JT', 'YO', 'JI', 'BA', 'NB', 'NT'),
    // the Oecusse exclave of Timor-Leste, inside western Timor
    { layer: 'admin1', adm0: 'TLS', iso: ['TL-OE'] },
  ], [
    ['雅加达', 'Jakarta', 106.85, -6.21],
    ['泗水', 'Surabaya', 112.75, -7.25],
    ['古邦', 'Kupang', 123.61, -10.18],
    ['登巴萨', 'Denpasar', 115.22, -8.65],
  ], ['蜡染', 'Batik']),
  nation('boni', '渤泥', 'Boni', 'Borneo', [
    id('KB', 'KT', 'KS', 'KI'),
    { layer: 'admin1', adm0: 'MYS', iso: ['MY-12', 'MY-13', 'MY-15'] },
    // the Natuna islands of Riau Islands province lie off Borneo, far from Sumatra
    { layer: 'admin1', adm0: 'IDN', iso: ['ID-KR'], partsIn: NATUNA, carve: true },
  ], [
    ['古晋', 'Kuching', 110.34, 1.55],
    ['马辰', 'Banjarmasin', 114.59, -3.32],
    ['亚庇', 'Kota Kinabalu', 116.07, 5.98],
    ['三马林达', 'Samarinda', 117.15, -0.5],
  ], ['燕窝', "Bird's nest"]),
  nation('luzon', '吕宋', 'Luzon', 'Northern Philippines', [
    { layer: 'admin1', adm0: 'PHL', iso: LUZON_PROVINCES },
  ], [
    ['马尼拉', 'Manila', 120.98, 14.6],
    ['土格加劳', 'Tuguegarao', 121.73, 17.61],
    ['黎牙实比', 'Legazpi', 123.74, 13.14],
  ], ['蕉麻', 'Abaca']),
  nation('sulu', '苏禄', 'Sulu', 'Southern Philippines', [
    { layer: 'admin1', adm0: 'PHL', exceptIso: LUZON_PROVINCES },
  ], [
    ['三宝颜', 'Zamboanga', 122.08, 6.91],
    ['宿务', 'Cebu', 123.89, 10.32],
    ['公主港', 'Puerto Princesa', 118.74, 9.74],
    ['达沃', 'Davao', 125.61, 7.07],
    // Palawan is too far from the other islands to share a city with them
  ], ['珍珠', 'Pearl'], 3),
  nation('maluku', '美洛居', 'Maluku', 'Sulawesi, Maluku', [
    id('SA', 'GO', 'ST', 'SR', 'SN', 'SG', 'MA', 'MU'),
  ], [
    ['望加锡', 'Makassar', 119.43, -5.14],
    ['特尔纳特', 'Ternate', 127.38, 0.79],
    ['安汶', 'Ambon', 128.18, -3.7],
    ['图阿尔', 'Tual', 132.75, -5.63],
    // the Kei, Aru and Tanimbar islands are too far from Ambon to share a city with it
  ], ['丁香', 'Clove'], 4),

  // City-states
  cityState('xiangjiang', '香江', 'Xiangjiang', 'Hong Kong', 'lingnan', country('HKG'),
    ['香港', 'Hong Kong', 114.17, 22.32]),
  cityState('haojing', '濠镜', 'Haojing', 'Macau', 'lingnan', country('MAC'),
    ['澳门', 'Macau', 113.55, 22.16]),
  cityState('shen', '申', 'Shen', 'Shanghai', 'wu', cn('CN-SH'),
    ['上海', 'Shanghai', 121.47, 31.23]),
  cityState('jinmen', '津门', 'Jinmen', 'Tianjin', 'yan', cn('CN-TJ'),
    ['天津', 'Tianjin', 117.2, 39.13]),
  cityState('temasek', '淡马锡', 'Temasek', 'Singapore', 'malacca', country('SGP'),
    ['新加坡', 'Singapore', 103.82, 1.35]),
  cityState('wenlai', '汶莱', 'Wenlai', 'Brunei', 'boni', country('BRN'),
    ['斯里巴加湾', 'Bandar Seri Begawan', 114.94, 4.89]),
  cityState('dimen', '底门', 'Dimen', 'Timor-Leste', 'shepo',
    { layer: 'admin1', adm0: 'TLS', exceptIso: ['TL-OE'] },
    ['帝力', 'Dili', 125.57, -8.56]),
  cityState('tamna', '耽罗', 'Tamna', 'Jeju Island', 'goryeo',
    { layer: 'admin1', adm0: 'KOR', iso: ['KR-49'] },
    ['济州', 'Jeju', 126.53, 33.5]),
  cityState('tsushima', '对马', 'Tsushima', 'Tsushima Island', 'tsukushi',
    { layer: 'admin1', adm0: 'JPN', iso: ['JP-42'], partsIn: TSUSHIMA },
    ['严原', 'Izuhara', 129.29, 34.2]),
  cityState('shazhou', '沙州', 'Shazhou', 'Dunhuang', 'longyou',
    { layer: 'circle', lon: 94.66, lat: 40.14, radiusKm: 45 },
    ['敦煌', 'Dunhuang', 94.66, 40.14]),

  // Wasteland regions
  wasteland('xiyu', '西域', 'Xiyu', 'Xinjiang', [cn('CN-XJ')], [
    ['乌鲁木齐', 'Urumqi', 87.62, 43.83],
    ['喀什', 'Kashgar', 75.99, 39.47],
    ['和田', 'Hotan', 79.92, 37.11],
    ['伊宁', 'Yining', 81.32, 43.92],
    ['哈密', 'Hami', 93.51, 42.83],
    ['库尔勒', 'Korla', 86.15, 41.76],
  ], ['和田玉', 'Hetian jade']),
  wasteland('jiankun', '坚昆', 'Jiankun', 'Western Siberia', [
    ru('CHE', 'KGN', 'KHM', 'SVE', 'TYU', 'YAN', 'X01~'),
    ru('OMS', 'TOM', 'NVS', 'KEM', 'ALT', 'AL', 'KK', 'KYA', 'TY'),
  ], [
    ['新西伯利亚', 'Novosibirsk', 82.93, 55.03],
    ['叶卡捷琳堡', 'Yekaterinburg', 60.61, 56.84],
    ['克拉斯诺亚尔斯克', 'Krasnoyarsk', 92.87, 56.01],
    ['鄂木斯克', 'Omsk', 73.37, 54.99],
    ['苏尔古特', 'Surgut', 73.4, 61.25],
    ['诺里尔斯克', 'Norilsk', 88.2, 69.35],
  ], ['貂皮', 'Sable fur']),
  wasteland('jibei', '极北', 'Jibei', 'Sakha', [ru('SA')], [
    ['雅库茨克', 'Yakutsk', 129.73, 62.03],
    ['米尔内', 'Mirny', 113.96, 62.54],
    ['季克西', 'Tiksi', 128.87, 71.64],
    ['涅留恩格里', 'Neryungri', 124.71, 56.66],
    ['上扬斯克', 'Verkhoyansk', 133.39, 67.55],
  ], ['钻石', 'Diamond']),
  wasteland('liugui', '流鬼', 'Liugui', 'Kamchatka, Chukotka', [
    ru('KAM', 'CHU', 'MAG'),
    // Paramushir and the islands down to Simushir: the northern Kurils, off Kamchatka
    { layer: 'admin1', adm0: 'RUS', iso: ['RU-SAK'], partsIn: KURILS_NORTH, carve: true },
  ], [
    ['彼得罗巴甫洛夫斯克', 'Petropavlovsk-Kamchatsky', 158.65, 53.02],
    ['马加丹', 'Magadan', 150.8, 59.56],
    ['阿纳德尔', 'Anadyr', 177.51, 64.73],
    ['佩韦克', 'Pevek', 170.31, 69.7],
  ], ['海象牙', 'Walrus ivory']),
];

/**
 * Units that must all belong to some polity: a unit of these countries (and,
 * for Russia, federal districts) that no source selects stops the pipeline,
 * so a renamed or new unit cannot silently become off-map land.
 */
export const FULL_COVERAGE: readonly { adm0: string; exceptIso?: readonly string[]; regions?: readonly string[] }[] = [
  { adm0: 'CHN' },
  { adm0: 'TWN' },
  { adm0: 'JPN' },
  { adm0: 'VNM' },
  { adm0: 'MYS' },
  { adm0: 'PHL' },
  { adm0: 'TLS' },
  // western New Guinea is off-map
  { adm0: 'IDN', exceptIso: ['ID-PA', 'ID-PB'] },
  { adm0: 'RUS', regions: ['Urals', 'Siberian', 'Far Eastern'] },
];

/** Stable id of a resource from its English name. */
export function resourceId(nameEn: string): string {
  return nameEn
    .normalize('NFD')
    .replace(/[^A-Za-z0-9 -]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[ -]+/g, '-');
}

/**
 * Map colour of entry `index` of the table, as `0xRRGGBB`. Hues step by the
 * golden angle, so neighbours in the table, which are mostly neighbours on
 * the map, differ clearly; city-states are bright and wasteland is dull.
 */
function polityColor(index: number, kind: PolityKind): number {
  const hue = (index * 137.508) % 360;
  let saturation = 0.5 + 0.12 * (index % 3);
  let lightness = 0.4 + 0.07 * (index % 4);
  if (kind === 'cityState') {
    saturation = 0.9;
    lightness = 0.62 + 0.03 * (index % 3);
  } else if (kind === 'wastelandRegion') {
    saturation = 0.2;
    lightness = 0.5 + 0.05 * (index % 4);
  }
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - c / 2;
  const sector = Math.floor(hue / 60);
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[sector] as readonly [number, number, number];
  const byte = (v: number): number => Math.round((v + m) * 255);
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}

/** The polity table, in the order of the design docs: nations, city-states, wasteland regions. */
export const POLITIES: readonly PolitySpec[] = TABLE.map((spec, index) => ({
  ...spec,
  color: polityColor(index, spec.kind),
}));
