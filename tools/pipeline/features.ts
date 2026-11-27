/**
 * Hand-picked places: strategic resource regions, volcanoes and off-map
 * ports. Each is a point on the globe; the pipeline puts it on the nearest
 * suitable hex. They are general geographic knowledge, not taken from a
 * dataset.
 */

/** Longitude, latitude and a note for the reader. */
export type Place = readonly [lon: number, lat: number, note: string];

export interface StrategicResource {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly places: readonly Place[];
}

export const STRATEGIC_RESOURCES: readonly StrategicResource[] = [
  {
    id: 'horses',
    nameZh: '马',
    nameEn: 'Horses',
    places: [
      [102.8, 47.2, 'Orkhon valley'],
      [96.0, 48.5, 'western Mongolia'],
      [113.0, 46.5, 'eastern Mongolia'],
      [116.5, 44.2, 'Xilingol grassland'],
      [119.8, 48.6, 'Hulunbuir grassland'],
      [108.5, 38.9, 'Ordos'],
      [101.3, 38.2, 'Shandan, Hexi corridor'],
      [100.2, 36.9, 'Qinghai Lake pastures'],
      [91.8, 31.4, 'Nagqu, northern Tibet'],
      [82.6, 43.4, 'Ili valley'],
      [88.1, 47.8, 'Altay'],
      [102.9, 32.9, 'Zoige grassland'],
      [104.3, 26.6, 'Wumeng highlands'],
      [124.0, 45.6, 'Songnen plain'],
      [108.3, 52.5, 'Buryat steppe'],
      [92.0, 51.5, 'Tuva'],
      [127.6, 39.9, 'Hamgyong uplands'],
      [141.2, 39.7, 'Nanbu, Tohoku'],
      [130.9, 32.9, 'Aso grasslands'],
      [99.0, 16.5, 'upper Chao Phraya'],
      [120.0, -9.7, 'Sumba'],
      [69.5, 55.3, 'Ishim steppe'],
      [129.7, 62.2, 'Lena valley, Yakut horse'],
    ],
  },
  {
    id: 'iron',
    nameZh: '铁',
    nameEn: 'Iron',
    places: [
      [123.0, 41.1, 'Anshan'],
      [118.5, 39.9, 'eastern Hebei'],
      [112.8, 38.5, 'Shanxi'],
      [101.7, 26.6, 'Panzhihua'],
      [114.9, 30.1, 'Daye'],
      [118.5, 31.7, "Ma'anshan"],
      [109.9, 41.8, 'Bayan Obo'],
      [109.0, 19.2, 'Shilu, Hainan'],
      [117.6, 36.2, 'Laiwu'],
      [98.3, 39.8, 'Jingtieshan'],
      [129.2, 42.2, 'Musan'],
      [141.7, 39.3, 'Kamaishi'],
      [133.0, 35.2, 'Chugoku iron sand'],
      [87.2, 53.8, 'Kuznetsk'],
      [60.0, 58.0, 'Urals'],
      [103.0, 56.5, 'Angara'],
      [133.0, 48.9, 'Kimkan'],
      [105.8, 21.7, 'Thai Nguyen'],
      [103.4, 4.6, 'Terengganu'],
      [125.5, 9.6, 'Surigao'],
      [121.5, -2.6, 'Sorowako'],
      [115.4, -3.6, 'South Kalimantan'],
      [96.4, 21.0, 'Shan hills'],
      [124.5, 58.6, 'Aldan'],
      [86.9, 45.9, 'Junggar'],
    ],
  },
  {
    id: 'coal',
    nameZh: '煤',
    nameEn: 'Coal',
    places: [
      [113.2, 39.9, 'Datong'],
      [110.2, 38.9, 'Shenmu'],
      [110.0, 39.7, 'Ordos'],
      [113.3, 33.8, 'Pingdingshan'],
      [117.0, 35.2, 'Yanzhou'],
      [105.0, 26.6, 'Liupanshui'],
      [117.0, 32.6, 'Huainan'],
      [131.0, 46.6, 'Hegang and Shuangyashan'],
      [123.9, 41.9, 'Fushun'],
      [106.4, 38.1, 'Ningdong'],
      [107.0, 28.9, 'Songzao'],
      [104.0, 27.8, 'Zhaotong'],
      [89.2, 44.1, 'Zhundong'],
      [86.1, 54.4, 'Kuzbass'],
      [124.7, 56.7, 'Neryungri'],
      [90.0, 56.0, 'Kansk-Achinsk'],
      [105.5, 43.6, 'Tavan Tolgoi'],
      [130.7, 33.7, 'Chikuho'],
      [141.9, 43.2, 'Ishikari'],
      [125.9, 39.4, 'Anju'],
      [107.2, 21.0, 'Quang Ninh'],
      [117.3, 0.6, 'East Kalimantan'],
      [103.8, -3.7, 'Bukit Asam'],
      [142.2, 49.1, 'Sakhalin'],
      [99.7, 19.3, 'Mae Moh'],
    ],
  },
  {
    id: 'oil',
    nameZh: '石油',
    nameEn: 'Oil',
    places: [
      [125.0, 46.6, 'Daqing'],
      [118.5, 37.5, 'Shengli'],
      [122.0, 41.1, 'Liaohe'],
      [84.9, 45.6, 'Karamay'],
      [84.0, 41.2, 'Tarim'],
      [97.5, 39.8, 'Yumen'],
      [109.3, 37.1, 'Yanchang'],
      [112.5, 30.4, 'Jianghan'],
      [90.9, 38.2, 'Qaidam'],
      [105.6, 30.5, 'central Sichuan gas'],
      [76.6, 61.0, 'Samotlor'],
      [72.5, 66.0, 'Yamal'],
      [75.5, 57.5, 'Vasyugan'],
      [143.0, 52.5, 'northern Sakhalin'],
      [114.0, 4.4, 'Miri and Seria'],
      [101.4, 1.3, 'Minas, Riau'],
      [104.0, -2.6, 'Palembang'],
      [116.9, -1.2, 'Balikpapan'],
      [111.6, -7.1, 'Cepu'],
      [94.9, 20.5, 'Yenangyaung'],
      [107.5, 9.8, 'Cuu Long basin'],
      [100.5, 16.5, 'Sirikit'],
      [112.0, 60.0, 'Talakan'],
      [117.8, 39.0, 'Bohai Bay'],
    ],
  },
  {
    id: 'rare-earths',
    nameZh: '稀土',
    nameEn: 'Rare earths',
    places: [
      [110.0, 41.8, 'Bayan Obo'],
      [115.0, 25.3, 'Ganzhou'],
      [114.5, 24.4, 'northern Guangdong'],
      [102.1, 28.5, 'Mianning'],
      [117.2, 35.0, 'Weishan'],
      [116.5, 25.1, 'Longyan'],
      [110.5, 25.0, 'northern Guangxi'],
      [98.2, 25.9, 'Kachin'],
      [103.3, 22.4, 'Lai Chau'],
      [116.9, 71.0, 'Tomtor'],
      [101.2, 4.4, 'Perak'],
      [93.3, 51.5, 'Tuva'],
      [103.9, 44.0, 'southern Gobi'],
      [126.5, 39.6, 'Jongju'],
    ],
  },
];

/** Volcanoes: longitude, latitude, name. */
export const VOLCANOES: readonly Place[] = [
  [138.73, 35.36, 'Fuji'],
  [131.1, 32.88, 'Aso'],
  [130.66, 31.59, 'Sakurajima'],
  [140.84, 42.83, 'Yotei'],
  [142.69, 43.42, 'Tokachi'],
  [141.0, 39.85, 'Iwate'],
  [128.06, 42.0, 'Changbai / Paektu'],
  [126.53, 33.36, 'Halla'],
  [121.55, 25.18, 'Datun'],
  [120.35, 15.14, 'Pinatubo'],
  [123.69, 13.26, 'Mayon'],
  [125.27, 6.99, 'Apo'],
  [123.13, 10.41, 'Kanlaon'],
  [110.44, -7.54, 'Merapi'],
  [112.92, -8.11, 'Semeru'],
  [107.6, -6.77, 'Tangkuban Perahu'],
  [105.42, -6.1, 'Krakatau'],
  [115.51, -8.34, 'Agung'],
  [116.46, -8.41, 'Rinjani'],
  [118.0, -8.25, 'Tambora'],
  [121.82, -8.77, 'Kelimutu'],
  [101.26, -1.7, 'Kerinci'],
  [98.39, 3.17, 'Sinabung'],
  [100.47, -0.38, 'Marapi'],
  [124.79, 1.36, 'Lokon'],
  [127.33, 0.8, 'Gamalama'],
  [160.64, 56.06, 'Klyuchevskaya'],
  [158.83, 53.26, 'Avachinsky'],
  [160.33, 54.75, 'Kronotsky'],
  [157.2, 51.36, 'Koshelev'],
  [155.25, 50.33, 'Ebeko'],
  [147.88, 45.03, 'Bogdan Khmelnitsky, Iturup'],
  [98.47, 25.23, 'Tengchong'],
  [126.12, 48.72, 'Wudalianchi'],
  [95.26, 20.92, 'Popa'],
  [100.63, 48.17, 'Khorgo'],
];

export interface PortSpec {
  readonly kind: 'land' | 'sea';
  readonly nameZh: string;
  readonly nameEn: string;
  /** The port is put on the off-map hex bordering the play area nearest to this place. */
  readonly lon: number;
  readonly lat: number;
  /** What it stands for. */
  readonly towards: string;
}

export const PORTS: readonly PortSpec[] = [
  { kind: 'land', nameZh: '碎叶', nameEn: 'Suyab', lon: 79.2, lat: 43.6, towards: 'Central Asia, over the Ili valley' },
  { kind: 'land', nameZh: '大宛', nameEn: 'Dayuan', lon: 73.4, lat: 39.9, towards: 'Central Asia, over the Pamir passes to Ferghana' },
  { kind: 'land', nameZh: '天竺', nameEn: 'Tianzhu', lon: 88.6, lat: 27.2, towards: 'India, over the Himalayan passes' },
  { kind: 'land', nameZh: '迦摩缕波', nameEn: 'Kamarupa', lon: 94.3, lat: 25.6, towards: 'India, over the Patkai hills from Myanmar' },
  { kind: 'land', nameZh: '罗刹', nameEn: 'Rus', lon: 57.5, lat: 57.5, towards: 'Europe, over the Urals' },
  { kind: 'sea', nameZh: '西洋', nameEn: 'Western Ocean', lon: 79.0, lat: 2.0, towards: 'the western sea edge: the Indian Ocean' },
  { kind: 'sea', nameZh: '大东洋', nameEn: 'Great Eastern Ocean', lon: 148.0, lat: 15.0, towards: 'the Pacific edge' },
];
