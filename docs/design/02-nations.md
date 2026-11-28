# Nations

50 nations, all playable. Each has a five-part kit:

1. **Trait** — a passive national ability.
2. **Unique unit** — replaces a generic unit. Unique units are spread across the six eras so nations peak at different times.
3. **Unique building or improvement.**
4. **Specialty** — a luxury resource found only inside the nation, tradeable.
5. **Leader** — a permanent minor buff and an AI personality (see [Leaders](#leaders)).

Nations are not equal starts: a one-city nation such as 琉球 or 琼崖 is much harder than a large one. This is accepted, and each nation carries a difficulty rating at nation select (see [Difficulty and architecture](#difficulty-and-architecture)).

Flavour is drawn from geography, produce, crafts and history. The numbers below are the ones the rules use (`src/core/kits.ts` and `src/core/uniques.ts`). They are sized, not balanced: a trait weighs about as much as one strong policy card, a leader buff about a quarter of that. Balancing who wins is a separate piece of work.

## Default full-AI nations

Twelve nations run the full AI by default: 秦, 燕, 楚, 蜀, 吴, 岭南, 吐蕃, 漠北, 高丽, 大和, 暹罗, 阇婆. The nation the player picks is added automatically. The list can be changed at game setup.

## Kits

In the tables below, "farms" means farms and irrigation canals unless it says otherwise, and a building or improvement named in a trait or buff includes the unique one that replaces it.

### North and Northwest China

| Nation | Based on | Trait | Unit | Building / improvement | Specialty |
|---|---|---|---|---|---|
| 燕 Yan | Beijing, Hebei | 京畿: the capital yields +1 production, gold, science and culture; one extra policy slot | 幽州突骑 Youzhou cavalry | 长城关隘 Great Wall pass | 景泰蓝 cloisonné |
| 晋 Jin | Shanxi | 表里山河: units defend +15% on hills, and on flat ground next to a mountain | 并州铁骑 Bingzhou heavy cavalry | 票号 draft bank (replaces bank) | 老陈醋 aged vinegar |
| 齐 Qi | Shandong | 鱼盐之利: +1 gold on every coast hex and on every land hex next to water | 技击士 Jiji infantry | 稷下学宫 Jixia academy | 海盐 sea salt |
| 中州 Zhongzhou | Henan | 天下之中: +3 gold on each trade route to a city of a nation whose land touches its own | 武卒 Wuzu heavy infantry | 常平仓 ever-normal granary | 牡丹 peony |
| 秦 Qin | Shaanxi | 耕战: farms give +1 production | 秦弩手 Qin crossbowman | 驰道 imperial highway | 柿饼 dried persimmon |
| 陇右 Longyou | Gansu | 河西走廊: land trade routes reach 50% farther (36 hexes) and earn +2 gold | 凉州大马 Liangzhou cavalry | 驿站 relay station | 葡萄酒 grape wine |
| 西夏 Xixia | Ningxia | 塞上江南: river hexes that are desert or next to desert give +2 food | 铁鹞子 Iron Hawk heavy cavalry | 引黄渠 Yellow River canal | 枸杞 goji |
| 青唐 Qingtang | Qinghai | 三江源: plateau land gives +1 food and +1 production | 青唐骑射 Qingtang horse archer | 茶马互市 tea-horse market | 青盐 lake salt |

### Southwest and Central China

| Nation | Based on | Trait | Unit | Building / improvement | Specialty |
|---|---|---|---|---|---|
| 蜀 Shu | Sichuan | 天府之国: a city with 2 or more mountain hexes within 2 hexes of its site gains +1 food and +20% city strength | 连弩兵 repeating crossbowman | 都江堰 Dujiangyan weir | 蜀锦 Shu brocade |
| 巴 Ba | Chongqing | 山城: a city whose site is hilly, or has 2 or more hills or mountains next to it, gains +3 production | 白杆兵 White Pole pikeman | 吊脚楼 diaojiaolou hillside house | 榨菜 pickled mustard |
| 滇 Dian | Yunnan | 彩云之南: +1 science on every forest and rainforest hex; +1 science per mountain hex in a city's zone, at most 2 per city | 罗苴子 Luojuzi mountain infantry | 茶马古道 tea-horse road | 普洱茶 pu'er tea |
| 夜郎 Yelang | Guizhou | 地无三尺平: farms and pastures may stand on hills; plain farms and mines may stand on mountains, which are then worked like any hex and give +1 food more | 藤甲兵 rattan-armour infantry | 屯堡 fortified village | 酱酒 sauce-aroma liquor |
| 吐蕃 Tubo | Tibet | 世界屋脊: a unit of a polity at war with it loses 10 HP each turn it ends on its plateau land (never below 1 HP) | 吐蕃重骑 Tubo heavy cavalry | 宗堡 dzong fortress | 虫草 cordyceps |
| 楚 Chu | Hubei | 九省通衢: its units cross rivers at the cost of the ground beyond; its trade routes earn +1 gold per 3 river hexes on their path, at most +4 | 楼船 tower ship | 章华台 Zhanghua terrace | 漆器 lacquerware |
| 潇湘 Xiaoxiang | Hunan | 湖广熟: rice paddies (farms) give +1 food | 湘军 Xiang army | 书院 shuyuan (private academy) | 辣椒 chili |
| 豫章 Yuzhang | Jiangxi | 物华天宝: each specialty gives 2 gold per city instead of 1; every resource hex gives +1 gold | 鄱阳水军 Poyang fleet | 御窑 imperial kiln | 青花瓷 blue-and-white porcelain |
| 淮南 Huainan | Anhui | 徽商: +3 gold on each trade route to another polity's city | 淮军 Huai army | 牌坊 memorial arch | 宣纸徽墨 Xuan paper and Hui ink |

### East, South and Northeast China

| Nation | Based on | Trait | Unit | Building / improvement | Specialty |
|---|---|---|---|---|---|
| 吴 Wu | Jiangsu | 漕运: a city with a river at its site or a canal in its zone gains +3 gold | 吴钩剑士 Wu hook swordsman | 园林 classical garden | 丝绸 silk |
| 越 Yue | Zhejiang | 卧薪尝胆: for 10 turns after it loses a city, every city has +25% production | 鸳鸯阵兵 mandarin-duck formation infantry | 海塘 seawall | 黄酒 yellow wine |
| 闽 Min | Fujian | 下南洋: each sea trade route brings people, as +2 food in the city it starts from | 福船 Fu ship | 土楼 tulou | 乌龙茶 oolong tea |
| 东宁 Dongning | Taiwan | 宝岛: +1 food on coast hexes and on forest and rainforest hexes | 铁人军 Iron Men | 糖廍 sugar mill | 樟脑 camphor |
| 岭南 Lingnan | Guangdong | 一口通商: double income from routes to off-map ports | 广船 Guang ship | 十三行 Thirteen Hongs | 荔枝 lychee |
| 骆越 Luoyue | Guangxi | 十万大山: units fight +15% in rainforest and on karst (hills) | 狼兵 Wolf soldiers | 灵渠 Lingqu canal | 八角 star anise |
| 琼崖 Qiongya | Hainan | 天涯海角: water hexes give +1 food and +1 gold | 黎峒弓手 Li archer | 骑楼 arcade house | 椰子 coconut |
| 辽东 Liaodong | Liaoning | 重工基地: from the Industrial era a city with a factory has +25% production | 关宁铁骑 Guanning cavalry | 铁西工坊 Tiexi works | 海参 sea cucumber |
| 扶余 Fuyu | Jilin | 黑土地: farms on plains give +1 food | 铁甲骑 armoured cavalry | 参场 ginseng farm | 鹿茸 deer antler |
| 黑水 Heishui | Heilongjiang | 北大荒: farms may stand on tundra and snow | 索伦兵 Solon soldiers | 林场 forestry | 鱼子酱 caviar |
| 漠南 Monan | Inner Mongolia | 敕勒川: pastures on grassland give +1 food and +1 production; rare earths are seen and used from the Modern era without Electronics | 察哈尔骑兵 Chahar cavalry | 板升 baishin settlement | 羊绒 cashmere |

### Steppe, Peninsula, Archipelago, Siberia

| Nation | Based on | Trait | Unit | Building / improvement | Specialty |
|---|---|---|---|---|---|
| 漠北 Mobei | Mongolia | 逐水草而居: unimproved grassland gives +1 food and +1 production; cavalry has no upkeep | 怯薛 Kheshig | 斡耳朵 ordo | 马奶酒 airag |
| 高丽 Goryeo | Korean Peninsula | 文治: +1 science per 5 population in each city | 龟船 turtle ship | 集贤殿 Hall of Worthies | 高丽参 Korean ginseng |
| 虾夷 Ezo | Hokkaido | 雪国: snow and tundra are fished and hunted for +2 food; forest on plains and grassland gives +1 food | 阿伊努猎手 Ainu hunter | 鲑鱼渔场 salmon fishery | 昆布 kelp |
| 东国 Togoku | Eastern Honshu | 武家: military units start with 8 experience (one level) | 武士 samurai | 城下町 castle town | 刀剑 swords |
| 大和 Yamato | Western Honshu, Shikoku | 风雅: +25% culture in every city | 僧兵 warrior monk | 神社 shrine | 清酒 sake |
| 筑紫 Tsukushi | Kyushu | 兰学: each trade route gives +2 science in the city it starts from | 铁炮队 arquebusiers | 出岛商馆 Dejima trading post | 有田烧 Arita ware |
| 琉球 Ryukyu | Okinawa | 万国津梁: takes 20% of the income of every other polity's trade route that passes within 4 hexes of one of its cities | 进贡船 tribute ship | 御城 gusuku | 黑糖 brown sugar |
| 北海 Beihai | Around Lake Baikal | 圣湖: lake hexes give +2 food and +2 gold | 驯鹿骑兵 reindeer cavalry | 冰上驿道 ice road | 白鲑 omul |
| 率宾 Shuaibin | Primorye, Sakhalin | 不冻港: +30% production towards ships | 海东水师 Haidong fleet | 船坞 dockyard | 帝王蟹 king crab |

### Mainland and Maritime Southeast Asia

| Nation | Based on | Trait | Unit | Building / improvement | Specialty |
|---|---|---|---|---|---|
| 交趾 Jiaozhi | Northern Vietnam | 丛林游击: units fight +15% in forest, rainforest and marsh | 丛林伏兵 jungle ambusher | 水上戏台 water puppet stage | 鱼露 fish sauce |
| 占城 Champa | Central and southern Vietnam | 占城稻: plain farms crop twice a year, for +1 food and +1 gold | 占婆战船 Cham warship | 占婆塔 Cham tower | 沉香 agarwood |
| 澜沧 Lan Xang | Laos | 万象之国: rainforest hexes give +1 production; war elephants have no upkeep | 战象 war elephant | 佛寺 wat | 安息香 benzoin |
| 真腊 Chenla | Cambodia | 水利帝国: population growth needs 10% less food | 象弩 ballista elephant | 巴莱水库 baray | 豆蔻 cardamom |
| 暹罗 Siam | Thailand | 竹外交: cannot be vassalised; the capital gains +2 gold and +1 culture for each nation at favour 15 or more, up to four | 皇家驳船 royal barge | 水上市场 floating market | 香米 jasmine rice |
| 蒲甘 Pagan | Myanmar | 万塔之邦: every temple gives +2 culture | 缅刀武士 dha swordsman | 佛塔 pagoda | 翡翠 jadeite |
| 满剌加 Malacca | Malay Peninsula | 海峡咽喉: takes 25% of the income of every other polity's sea route that passes within 3 hexes of one of its cities | 克里斯武士 kris warrior | 港务司 harbourmaster's office | 锡 tin |
| 三佛齐 Srivijaya | Sumatra | 海上霸权: ships fight +10% and see 1 hex farther | 海峡水军 strait fleet | 佛学院 Buddhist college | 胡椒 pepper |
| 阇婆 Shepo | Java, Bali and islands east | 火山沃土: farms next to a volcano give +2 food | 爪哇巨舶 Javanese jong | 陵庙 candi | 蜡染 batik |
| 渤泥 Boni | Borneo | 雨林之心: rainforest left unimproved gives +1 food and +1 gold | 吹箭猎手 blowpipe hunter | 长屋 longhouse | 燕窝 bird's nest |
| 吕宋 Luzon | Northern Philippines | 大帆船: sole access to the Pacific sea exit for off-map trade; a route there earns +3 gold | 藤盾武士 rattan-shield warrior | 高山梯田 highland rice terrace | 蕉麻 abaca |
| 苏禄 Sulu | Southern Philippines | 海上游牧: ships get double gold for pillaging trade routes | 兰农战船 Lanong warship | 高脚屋 sea stilt house | 珍珠 pearl |
| 美洛居 Maluku | Sulawesi, Maluku | 香料群岛: its specialties sell for double: 4 gold a turn in a deal, and 4 gold instead of 2 for each differing specialty on its trade routes | 科拉科拉战船 kora-kora | 香料园 spice garden | 丁香 clove |

### Words the traits use

- **Plateau**: a hex at or above 3,000 m.
- **Karst**: hills.
- **Rice paddies**: farms and irrigation canals.
- **Island**: any landmass other than the largest one.
- **Friendly nation**: a nation at favour 15 or more.
- **Passing through** (琉球, 满剌加): a trade route whose path comes within the stated distance of one of the nation's cities. The share is taken from the route's income before its owner is paid; nothing is taken from a polity it is at war with.
- A trait that names an improvement counts a pillaged one as absent.

## Unique unit details

Each unique unit replaces the generic unit of its class and era (see [04-tech-and-policies.md](04-tech-and-policies.md)): it needs the same tech, its nation builds it wherever another would build the generic one, and upgrades pass through it (the unit before it upgrades to it, and it upgrades to the next generic one). Only its nation can build it. The piece character is engraved in gold; it may match a generic character, since the gold fill and the nation colour tell them apart.

| Era | Count | Nations |
|---|---|---|
| Ancient | 7 | 齐, 中州, 夜郎, 琼崖, 虾夷, 渤泥, 吕宋 |
| Classical | 11 | 燕, 晋, 秦, 陇右, 蜀, 楚, 吴, 扶余, 北海, 交趾, 澜沧 |
| Medieval | 15 | 西夏, 青唐, 滇, 吐蕃, 豫章, 闽, 漠北, 东国, 大和, 占城, 真腊, 蒲甘, 满剌加, 三佛齐, 阇婆 |
| Early Modern | 13 | 巴, 越, 东宁, 岭南, 骆越, 辽东, 黑水, 高丽, 筑紫, 琉球, 暹罗, 苏禄, 美洛居 |
| Industrial | 4 | 潇湘, 淮南, 漠南, 率宾 |
| Modern | 0 | — |

The spread follows when each unit existed historically, so the late eras are thin and no nation peaks in the modern era through its unit.

The profile is given against the generic unit it replaces; where nothing is said, it is the same. A nation whose unique unit is of the Ancient era starts the game with it as its garrison.

| Nation | Unit | Era | Class | Piece | Profile | Ability |
|---|---|---|---|---|---|---|
| 燕 | 幽州突骑 | Classical | Cavalry | 突 | 5 moves | +15% attacking from flat, open ground |
| 晋 | 并州铁骑 | Classical | Cavalry | 并 | Strength +10% | +20% defending against ranged attacks |
| 齐 | 技击士 | Ancient | Infantry | 技 | Strength +10% | +15% attacking units |
| 中州 | 武卒 | Ancient | Infantry | 卒 | Strength +15%, cost +15% | +20% defending while fortified |
| 秦 | 秦弩手 | Classical | Ranged | 秦 | Strength +10% | +15% attacking units |
| 陇右 | 凉州大马 | Classical | Cavalry | 凉 | Strength +5% | +15% on desert and grassland |
| 西夏 | 铁鹞子 | Medieval | Cavalry | 鹞 | Strength +15%, cost +15% | +20% attacking infantry |
| 青唐 | 青唐骑射 | Medieval | Cavalry | 射 | Melee strength −15%; a ranged attack of range 2 at 80% of the era's strength | +15% attacking from hills |
| 蜀 | 连弩兵 | Classical | Ranged | 弩 | Strength +5% | +20% attacking a unit at full HP |
| 巴 | 白杆兵 | Early Modern | Infantry | 杆 | Strength +5% | +25% against cavalry |
| 滇 | 罗苴子 | Medieval | Infantry | 苴 | Needs no iron | Hills, forest, rainforest and marsh cost no extra movement; +15% on hills |
| 夜郎 | 藤甲兵 | Ancient | Infantry | 藤 | Strength +5% | +20% defending against melee attacks |
| 吐蕃 | 吐蕃重骑 | Medieval | Cavalry | 蕃 | Strength +10% | +20% on the plateau |
| 楚 | 楼船 | Classical | Naval | 楼 | Strength +10%; no penalty against cities | +15% attacking cities |
| 潇湘 | 湘军 | Industrial | Infantry | 湘 | Cost −15% | Heals 10 HP more each turn it rests |
| 豫章 | 鄱阳水军 | Medieval | Naval | 鄱 | — | +20% on coast and lake |
| 淮南 | 淮军 | Industrial | Infantry | 淮 | Strength +5% | +20% attacking cities |
| 吴 | 吴钩剑士 | Classical | Infantry | 钩 | Needs no iron | +25% attacking across a river, which cancels the river penalty |
| 越 | 鸳鸯阵兵 | Early Modern | Infantry | 阵 | — | +8% for each unit of its nation next to it |
| 闽 | 福船 | Medieval | Naval | 福 | Strength +5% | Heals 10 HP more each turn it rests |
| 东宁 | 铁人军 | Early Modern | Infantry | 铠 | Strength +5% | No penalty for attacking from the water |
| 岭南 | 广船 | Early Modern | Naval | 广 | — | No upkeep |
| 骆越 | 狼兵 | Early Modern | Infantry | 狼 | — | +15% attacking outside its own land |
| 琼崖 | 黎峒弓手 | Ancient | Ranged | 黎 | — | +20% in forest and rainforest |
| 辽东 | 关宁铁骑 | Early Modern | Cavalry | 关 | Strength +5% | +20% against cavalry |
| 扶余 | 铁甲骑 | Classical | Cavalry | 扶 | Strength +5% | +15% defending |
| 黑水 | 索伦兵 | Early Modern | Cavalry | 索 | — | +20% on tundra and snow; forest, rainforest and marsh cost no extra movement |
| 漠南 | 察哈尔骑兵 | Industrial | Cavalry | 察 | 5 moves | +50% gold from pillaging |
| 漠北 | 怯薛 | Medieval | Cavalry | 薛 | Strength +10% | Starts with 8 experience |
| 高丽 | 龟船 | Early Modern | Naval | 龟 | Strength +10%, 3 moves | +25% defending |
| 虾夷 | 阿伊努猎手 | Ancient | Ranged | 猎 | — | Forest, rainforest and marsh cost no extra movement; sees 1 hex farther |
| 东国 | 武士 | Medieval | Infantry | 侍 | Strength +5% | +20% against infantry |
| 大和 | 僧兵 | Medieval | Infantry | 僧 | Needs no iron | +6 culture for each unit it destroys |
| 筑紫 | 铁炮队 | Early Modern | Ranged | 铳 | — | +25% against cavalry |
| 琉球 | 进贡船 | Early Modern | Naval | 贡 | Strength −20%, cost −30%, 5 moves | Earns 3 gold each turn it ends in the waters a foreign city works, at peace with its owner |
| 北海 | 驯鹿骑兵 | Classical | Cavalry | 鹿 | Needs no horses | +20% on tundra and snow |
| 率宾 | 海东水师 | Industrial | Naval | 师 | 5 moves | +15% attacking ships |
| 交趾 | 丛林伏兵 | Classical | Infantry | 伏 | Needs no iron | +25% attacking from forest, rainforest or marsh |
| 占城 | 占婆战船 | Medieval | Naval | 占 | No penalty against cities | +10% attacking coastal cities |
| 澜沧 | 战象 | Classical | Cavalry | 象 | Strength +15%, 3 moves, needs no horses | +20% attacking infantry |
| 真腊 | 象弩 | Medieval | Siege | 床 | 3 moves | +25% attacking units |
| 暹罗 | 皇家驳船 | Early Modern | Naval | 驳 | — | +20% in home waters (next to its own land) |
| 蒲甘 | 缅刀武士 | Medieval | Infantry | 刀 | Needs no iron | +25% against ranged and siege units |
| 满剌加 | 克里斯武士 | Medieval | Infantry | 匕 | Needs no iron | +20% on land next to water |
| 三佛齐 | 海峡水军 | Medieval | Naval | 峡 | Strength +5% | +20% on coast hexes |
| 阇婆 | 爪哇巨舶 | Medieval | Naval | 舶 | Strength +20%, cost +20%, 3 moves | +15% defending |
| 渤泥 | 吹箭猎手 | Ancient | Ranged | 吹 | — | +25% attacking infantry |
| 吕宋 | 藤盾武士 | Ancient | Infantry | 盾 | — | +25% defending against ranged attacks |
| 苏禄 | 兰农战船 | Early Modern | Naval | 掠 | 5 moves | +50% gold from pillaging |
| 美洛居 | 科拉科拉战船 | Early Modern | Naval | 桨 | Cost −15%, 5 moves | +10% for each unit of its nation next to it |

The tribute ship's doc sentence was "may enter waters without open borders". No water is closed to anybody in the rules, so that clause holds for every ship; what sets the tribute ship apart is the trade it does where it calls.

## Unique building details

A unique building either replaces a generic building or improvement, keeping its base effect (and its cost and upkeep) and adding its own, or is an extra that only its nation can build. It unlocks with the tech shown. A nation builds its replacement instead of the generic one, and a city cannot have both. A unique building or improvement in a city that changes hands keeps working for its new owner. 秦's and 滇's are upgrades to their automatic roads: they apply by themselves once the nation knows the tech.

| Nation | Building | Kind | Unlock tech | Its own effect |
|---|---|---|---|---|
| 燕 | 长城关隘 | Improvement | Fortification | On hills. +1 production; a unit of the hex's owner on it defends +30%. Cost 50 |
| 晋 | 票号 | Replaces bank | Banking | +1 gold for each trade route of the nation, up to 4 |
| 齐 | 稷下学宫 | Replaces academy | Writing | +1 science, +1 culture |
| 中州 | 常平仓 | Replaces granary | Farming | +1 food, +1 gold, +5 morale |
| 秦 | 驰道 | Road upgrade, automatic | Currency | Its units pay a quarter of a movement point per road step on its own land; +1 gold in every city |
| 陇右 | 驿站 | Extra building | Currency | +1 gold; land routes from the city earn +2 gold. Cost 60, upkeep 1 |
| 西夏 | 引黄渠 | Replaces irrigation canal | Irrigation | +4 food and +1 gold instead of +3 food |
| 青唐 | 茶马互市 | Replaces market | Currency | +1 gold; +20% production towards cavalry |
| 蜀 | 都江堰 | Replaces irrigation canal | Irrigation | +4 food and +1 production instead of +3 food |
| 巴 | 吊脚楼 | Extra building | Mining | +1 food, +1 production. Cost 40, no upkeep |
| 滇 | 茶马古道 | Road upgrade, automatic | Currency | Land trade routes earn +1 gold, and +2 more where their path crosses hills |
| 夜郎 | 屯堡 | Replaces walls | Fortification | +25 city HP; +1 food, +1 production |
| 吐蕃 | 宗堡 | Replaces walls | Fortification | +10% city strength; +2 culture |
| 楚 | 章华台 | Replaces temple | Ritual | +2 culture, +1 gold |
| 潇湘 | 书院 | Replaces university | Printing | +2 culture, +1 science |
| 豫章 | 御窑 | Replaces workshop | Machinery | +3 gold, +1 culture |
| 淮南 | 牌坊 | Replaces print shop | Paper | +1 culture, +5 morale |
| 吴 | 园林 | Extra building | Guilds | +3 culture, +1 gold, +5 morale. Cost 80, upkeep 1 |
| 越 | 海塘 | Improvement | Irrigation | On flat plains or grassland next to water. +2 food, +1 production. Cost 40 |
| 闽 | 土楼 | Replaces walls | Fortification | +25 city HP; +1 food, +1 culture |
| 东宁 | 糖廍 | Replaces workshop | Machinery | +2 gold, +1 food |
| 岭南 | 十三行 | Replaces bank | Banking | One more trade route; routes from the city to off-map ports earn +2 gold |
| 骆越 | 灵渠 | Replaces canal | Irrigation | +1 food, +2 production and +3 gold instead of +1 production and +3 gold |
| 琼崖 | 骑楼 | Replaces market | Currency | +2 gold, +1 culture |
| 辽东 | 铁西工坊 | Replaces factory | Steam Engine | +2 production, +10% production |
| 扶余 | 参场 | Improvement | Farming | On forest. +1 food, +2 gold. Cost 30 |
| 黑水 | 林场 | Improvement | Machinery | On forest. +2 production, +1 gold. Cost 40 |
| 漠南 | 板升 | Replaces granary | Farming | +1 food, +1 production |
| 漠北 | 斡耳朵 | Extra building, capital only | Husbandry | +2 culture; cavalry built in the city starts with 4 experience. Cost 50, no upkeep |
| 高丽 | 集贤殿 | Replaces university | Printing | +2 science, +1 culture |
| 虾夷 | 鲑鱼渔场 | Replaces fishery | Boats | +2 food and +1 gold instead of +1 food and +1 gold |
| 东国 | 城下町 | Replaces market | Currency | +10% city strength; +1 production |
| 大和 | 神社 | Replaces temple | Ritual | +1 culture, +5 morale |
| 筑紫 | 出岛商馆 | Replaces observatory | Astronomy | One more trade route; +2 gold |
| 琉球 | 御城 | Replaces walls | Fortification | +2 culture, +1 gold |
| 北海 | 冰上驿道 | Improvement | Riding | On tundra or snow. +1 production, +1 gold, and the hex becomes a road. Cost 30 |
| 率宾 | 船坞 | Replaces harbour | Shipbuilding | +25% production towards ships |
| 交趾 | 水上戏台 | Replaces print shop | Paper | +2 culture, +1 gold |
| 占城 | 占婆塔 | Replaces temple | Ritual | +10% city strength; +1 culture |
| 澜沧 | 佛寺 | Replaces temple | Ritual | +1 culture, +1 science |
| 真腊 | 巴莱水库 | Improvement | Irrigation | On flat plains or grassland, river or not. +3 food, +1 gold. Cost 50 |
| 暹罗 | 水上市场 | Replaces market | Currency | +2 food, +1 gold |
| 蒲甘 | 佛塔 | Replaces temple | Ritual | +1 culture, +1 food |
| 满剌加 | 港务司 | Replaces harbour | Shipbuilding | +2 gold; sea routes from the city earn +1 gold |
| 三佛齐 | 佛学院 | Replaces academy | Writing | +2 culture |
| 阇婆 | 陵庙 | Replaces temple | Ritual | +1 culture, +1 production |
| 渤泥 | 长屋 | Replaces granary | Farming | +1 food, +1 culture |
| 吕宋 | 高山梯田 | Improvement | Farming | On hills of plains or grassland, forest or not. +3 food. Cost 40 |
| 苏禄 | 高脚屋 | Replaces harbour | Shipbuilding | +1 food on every water hex the city works, on top of the harbour's |
| 美洛居 | 香料园 | Improvement | Farming | On forest or rainforest. +1 food, +3 gold. Cost 40 |

## Leaders

Rules:

- **Naming.** The displayed name is a title or alias. The archetype is a real historical figure tied to the place.
- **Who qualifies.** Only people who died in or before 1910. No deities and no founders of religions.
- **Strength.** About a quarter of a national trait: one trigger condition, no downside, on the scale of "+1" or "5–10%".
- **Presentation.** Leaders never appear on the board or as portraits. They are a name and a permanent buff in the UI.
- **AI personality.** The leader sets the AI's behaviour style. This differentiates nations without touching the rules: a personality changes only what the AI chooses.

### Personalities

| Style | What it changes in the AI |
|---|---|
| 好战 Warlike | Declares war at 80% of the usual strength ratio; keeps a 25% larger army; military techs and cards first; slower to sign agreements |
| 重商 Mercantile | Builds the market first; economy techs and cards first; prefers trade routes to foreign cities; quicker to sign agreements; declares war only at 130% of the usual ratio |
| 守成 Defensive | Builds walls first; declares war only at 160% of the usual ratio; favours military cards |
| 崇文 Scholarly | Builds the academy first; science techs and civil cards first; declares war only at 130% of the usual ratio |
| 开拓 Expansionist | Builds the granary first; sends settlers before it finishes its buildings and 6 hexes farther; declares war at 90% of the usual ratio |
| 向海 Seafaring | Keeps twice the navy; naval techs first; builds the harbour first; prefers routes over the sea; declares war at 90% of the usual ratio |
| 纵横 Diplomatic | Builds the temple first; diplomacy cards first; proposes and accepts agreements at 10 favour less; prefers routes to foreign cities; declares war only at 140% of the usual ratio |

A polity without a kit (a city-state, a nation of a test map) has no style and uses the plain weights.

### Ambitions

A personality stays the same from game to game. On top of it every leader with a kit sets out, in each game, to win one of the three victories. This ambition is drawn from the game's seed, so the same nation plays differently in different games, and it is weighted by the personality. Like the personality it changes only what the AI chooses; a human player's nation has none.

| Ambition | What it changes in the AI |
|---|---|
| 征服 Conquest | Declares war at 80% of the usual strength ratio and keeps a 40% larger army; builds the workshop first; military techs and cards first. It goes for the nations that hold capitals of major nations, the nearest first, marches on their cities, takes a major nation as a vassal wherever it can, starts its next war while still weary of the last (up to weariness 40), sues for peace only at weariness 55, and lets go of enemies that hold no such capital. It does not build the Tiangong project |
| 治学 Learning | Starts no wars. Builds the academy and the university first; science techs and civil cards first. Builds the Tiangong project as soon as a stage is open, and researches what the project needs first once it is in the Modern era |
| 殖货 Wealth | Starts no wars. Builds the market and the bank first; economy techs and cards first; its cities turn to gold instead of production once they feed themselves. It does not build the Tiangong project |

A leader that starts no wars still fights when it is attacked or when an ally is.

Weights of conquest, learning and wealth by personality:

| Personality | Conquest | Learning | Wealth |
|---|---|---|---|
| Warlike, Expansionist | 3 | 1 | 2 |
| Scholarly, Defensive | 1 | 3 | 2 |
| Mercantile, Diplomatic | 1 | 2 | 3 |
| Seafaring | 2 | 1 | 3 |

A polity without a kit has no ambition: it is the all-rounder that goes to war with a weaker neighbour at the usual ratio and builds the project when it leads in science.

### North and Northwest China

| Nation | Leader (archetype) | Buff | Personality |
|---|---|---|---|
| 燕 | 昭王 (King Zhao of Yan) | Capital science +5% | Scholarly |
| 晋 | 重耳公 (Duke Wen of Jin) | Units heal 5 more HP per turn outside their own land | Diplomatic |
| 齐 | 仲父 (Guan Zhong) | +1 gold per market | Mercantile |
| 中州 | 则天女皇 (Wu Zetian) | Capital culture +10% | Scholarly |
| 秦 | 祖龙 (Qin Shi Huang) | Walls build 10% faster | Warlike |
| 陇右 | 飞将军 (Li Guang) | 没石饮羽: ranged units attack +3% | Defensive |
| 西夏 | 嵬名元昊 (Li Yuanhao) | New cavalry starts with 4 experience | Warlike |
| 青唐 | 唃厮啰 (Gusiluo) | +1 gold a turn from each deal that sells its horses (a deal pays 4) | Mercantile |

### Southwest and Central China

| Nation | Leader (archetype) | Buff | Personality |
|---|---|---|---|
| 蜀 | 卧龙丞相 (Zhuge Liang) | Improvements build 10% faster | Scholarly |
| 巴 | 良玉将军 (Qin Liangyu) | Units defend +5% on hills | Defensive |
| 滇 | 段氏思平 (Duan Siping) | +1 culture per temple | Diplomatic |
| 夜郎 | 奢香夫人 (She Xiang) | +1 gold on land trade routes that cross hills | Diplomatic |
| 吐蕃 | 松赞赞普 (Songtsen Gampo) | Alliances form faster: an AI accepts one with it at 10 favour less | Expansionist |
| 楚 | 庄王 (King Zhuang of Chu) | +40 culture on capturing another nation's original capital | Warlike |
| 潇湘 | 湘乡文正 (Zeng Guofan) | Unit upgrades cost 10% less | Defensive |
| 豫章 | 临川相公 (Wang Anshi) | Policy swap cooldown is 1 turn shorter | Scholarly |
| 淮南 | 魏武 (Cao Cao) | +1 food in garrisoned cities | Warlike |

### East, South and Northeast China

| Nation | Leader (archetype) | Buff | Personality |
|---|---|---|---|
| 吴 | 吴大帝 (Sun Quan) | Units defend +5% against a melee across a river | Seafaring |
| 越 | 海龙王 (Qian Liu) | Coastal city strength +10% | Mercantile |
| 闽 | 开闽王 (Wang Shenzhi) | +1 gold per harbour | Seafaring |
| 东宁 | 国姓爷 (Koxinga) | The penalty for attacking from the water is halved (−25% instead of −50%) | Seafaring |
| 岭南 | 谯国夫人 (Lady Xian) | Unrest in captured cities ends 1 turn sooner | Diplomatic |
| 骆越 | 瓦氏夫人 (Lady Washi) | Units fight +3% outside their own land | Warlike |
| 琼崖 | 海青天 (Hai Rui) | Building upkeep −5%, rounded down | Defensive |
| 辽东 | 天命汗 (Nurhaci) | A unit fights +2% for each unit of its nation next to it | Warlike |
| 扶余 | 震国王 (Dae Joyeong) | The first building in a city builds 20% faster | Expansionist |
| 黑水 | 阿骨打 (Wanyan Aguda) | Units fight +5% on snow and tundra | Warlike |
| 漠南 | 阿勒坦汗 (Altan Khan) | +1 gold on trade routes to the cities of nations whose land touches its own | Mercantile |

### Steppe, Peninsula, Archipelago, Siberia

| Nation | Leader (archetype) | Buff | Personality |
|---|---|---|---|
| 漠北 | 铁木真大汗 (Genghis Khan) | Pillage income +10% | Warlike |
| 高丽 | 世宗 (Sejong the Great) | +1 science per academy | Scholarly |
| 虾夷 | 沙牟奢允 (Shakushain) | Units defend +5% in forest | Defensive |
| 东国 | 东照公 (Tokugawa Ieyasu) | +5 morale in cities while at peace | Defensive |
| 大和 | 厩户皇子 (Prince Shōtoku) | +1 science in the capital per friendly nation, up to 4 | Scholarly |
| 筑紫 | 日巫女王 (Himiko) | Easier to open relations with stronger nations: an AI stronger than it accepts a trade pact or open borders at 10 favour less | Diplomatic |
| 琉球 | 尚真王 (Shō Shin) | +1 gold on sea trade routes | Mercantile |
| 北海 | 冒顿单于 (Modu Chanyu) | Cavalry attacks +5% against a unit at full HP | Warlike |
| 率宾 | 德尔苏 (Dersu Uzala) | Units see 1 hex farther from forest | Expansionist |

### Mainland and Maritime Southeast Asia

| Nation | Leader (archetype) | Buff | Personality |
|---|---|---|---|
| 交趾 | 兴道王 (Trần Hưng Đạo) | Units defend +5% on their own land | Defensive |
| 占城 | 制蓬峨 (Chế Bồng Nga) | Ships attack coastal cities +5% | Warlike |
| 澜沧 | 法昂王 (Fa Ngum) | +20 culture each time it enters an era | Expansionist |
| 真腊 | 阇耶跋摩 (Jayavarman VII) | +5 morale in cities with 10 or more population | Expansionist |
| 暹罗 | 朱拉大帝 (Chulalongkorn) | Techs already known by another polity cost 5% less | Diplomatic |
| 蒲甘 | 阿奴律陀 (Anawrahta) | Temples build 10% faster | Expansionist |
| 满剌加 | 拜里米苏拉 (Parameswara) | Every coastal city has a basic harbour: +1 gold | Mercantile |
| 三佛齐 | 阇耶那沙 (Dapunta Hyang Sri Jayanasa) | Ship upkeep −10% | Seafaring |
| 阇婆 | 加查玛达 (Gajah Mada) | +1 culture in the capital per island with one of its cities, up to 6 | Seafaring |
| 渤泥 | 麻那惹加那 (the King of Boni recorded under that name) | +1 gold on trade routes to the cities of 吴, 越, 闽, 东宁, 岭南, 骆越 and 琼崖 | Mercantile |
| 吕宋 | 黎刹 (José Rizal) | +1 culture per academy | Scholarly |
| 苏禄 | 东王叭哈剌 (Paduka Batara, East King of Sulu) | +10% from pillaging trade routes | Seafaring |
| 美洛居 | 巴布拉苏丹 (Sultan Baabullah) | Foreign units fight −3% inside its borders | Seafaring |

Some archetypes are obscure (唃厮啰, 德尔苏), because few figures are available for parts of Siberia and Southeast Asia. All are real people tied to the place.

Notes on the buffs: morale runs from 0 to 100, so "+1 morale" in the first draft became +5, which still shows only in a city below 100. The game has no fog yet, so the two vision bonuses (三佛齐's ships, 率宾's leader) set a number that nothing reads until fog of war is built.

## Difficulty and architecture

The difficulty rating shown at nation select follows the nation's size and position: how many city zones it has and how hemmed in it is. Each nation belongs to one of the seven architectural families of [06-visuals.md](06-visuals.md).

| Difficulty | Nations |
|---|---|
| Easy | 蜀, 吐蕃, 漠南, 漠北, 暹罗, 蒲甘, 渤泥 |
| Normal | 燕, 秦, 陇右, 青唐, 滇, 楚, 岭南, 骆越, 黑水, 高丽, 东国, 北海, 率宾, 交趾, 占城, 澜沧, 真腊, 三佛齐, 阇婆, 吕宋, 苏禄, 美洛居 |
| Hard | 晋, 齐, 中州, 夜郎, 潇湘, 豫章, 淮南, 越, 闽, 辽东, 扶余, 满剌加 |
| Very hard | 西夏, 巴, 吴, 东宁, 琼崖, 虾夷, 大和, 筑紫, 琉球 |

Easy nations have three or four city zones and room behind them. Hard ones have two zones in the crowded centre or on a contested coast. The very hard ones start with a single city.

| Family | Nations |
|---|---|
| Central Plains | 燕, 晋, 齐, 中州, 秦, 陇右, 西夏, 蜀, 巴, 滇, 楚, 潇湘, 淮南, 辽东, 扶余, 高丽 |
| Jiangnan | 豫章, 吴, 越, 闽, 东宁, 岭南, 骆越, 琼崖 |
| Tibetan | 青唐, 吐蕃 |
| Steppe yurt | 漠南, 漠北 |
| Japanese | 虾夷, 东国, 大和, 筑紫, 琉球 |
| Southeast Asian | 夜郎, 交趾, 占城, 澜沧, 真腊, 暹罗, 蒲甘, 满剌加, 三佛齐, 阇婆, 渤泥, 吕宋, 苏禄, 美洛居 |
| Siberian log house | 黑水, 北海, 率宾 |

## Rules added for the kits

The kits needed a few rules the game did not have. They apply to everybody.

- **Attacks from the water.** A melee land unit that is embarked may attack the land hex next to it, and may take a fallen city from the water. It attacks at −50% (the amphibious penalty). An embarked ranged unit cannot attack. Without this a city on an island of a single hex could never be taken.
- **Attrition.** A unit can lose HP at the end of a turn to the land it stands on (吐蕃). Attrition never kills.
- **Tolls.** A polity can take a share of other polities' trade routes that pass its cities (琉球, 满剌加).
- **Production surge.** The turn in which a polity last lost a city is remembered (越).
- **Mountains.** A mountain hex that carries an improvement is worked by its city (夜郎). Nobody can stand on it.
- **Vision.** A unit sees 2 hexes and a city 3, plus what modifiers add. What a polity does not see is hidden by the fog of war ([03-gameplay.md](03-gameplay.md)).
- **Islands.** The landmasses of the map are known to the rules: an island is any but the largest.
- **AI at sea.** A nation with a coast keeps warships: one for every two coastal cities, one more for each enemy warship afloat, two more while its army marches on a city it can only reach by sea, and at most 40% of the units it can pay for (one ship is always allowed beside the garrisons). At war the fleet goes with the embarked army or to the waters of the city the army marches on and fights what it meets; a battered ship sails home. A major nation counts a coastal city within 12 hexes by water of one of its own coastal cities as a neighbour when it looks for a war, once it knows Boats (and across ocean once it knows Compass).
