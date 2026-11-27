# Tech Tree and Policies

## Tech tree

40 techs: 7 in each of the first four eras, 6 in each of the last two. Each takes 3–4 turns.

Rules:

- A nation researches one tech at a time with its science. Science beyond a tech's cost carries over, and at most one tech is finished per turn. A player who has chosen no tech gets the AI's choice, so research never stands still.
- Every tech after the Ancient era has 1–2 prerequisites, all from earlier eras (see [Prerequisites](#prerequisites)). Ancient techs have none. Within an era the order is free.
- A tech can be researched once its era has been entered. Entering the next era requires at least 4 techs of the current era; a nation's era is the highest it has entered, and each nation has its own.
- **Catch-up**: a tech already known by any other living nation or city-state costs 20% less.
- Cost per tech by era: 7, 32, 100, 250, 720, 1000 science. With these the leading major nation enters the Modern era around turn 110–127 and knows 35–40 of the 40 techs when the game ends (fewer when it wins by science before turn 150); the other major nations end with 22 or more.
- **Simplified-AI nations and city-states do not research.** They know a tech once half of the researching nations (the living major nations and the player) know it, and their era follows from what they know.
- A unit, building or improvement is available only with its tech. The settler needs no tech: it needs the Classical era.

### Ancient (上古)

| Tech | Unlocks |
|---|---|
| 农耕 Farming | Farm, granary |
| 畜牧 Husbandry | Pasture, reveals horses, chariot |
| 采矿 Mining | Mine |
| 弓矢 Archery | Archer |
| 筑城 Fortification | Walls, battering ram |
| 祭祀 Ritual | Temple |
| 舟楫 Boats | Fishery, galley, land units can embark on coastal water |

### Classical (古典)

| Tech | Unlocks |
|---|---|
| 文字 Writing | Academy |
| 货币 Currency | Market, +1 trade route, off-map land ports |
| 冶铁 Ironworking | Reveals iron, swordsman |
| 骑术 Riding | Horseman |
| 水利 Irrigation | Irrigation canal, canal (available to every nation) |
| 弩机 Crossbow | Crossbowman, catapult |
| 造船 Shipbuilding | Harbour, war junk (斗舰) |

### Medieval (中古)

| Tech | Unlocks |
|---|---|
| 造纸 Paper | Print shop (书坊, culture building) |
| 马镫 Stirrup | Heavy cavalry |
| 炼钢 Steel | Heavy infantry |
| 指南针 Compass | Ocean travel for ships and embarked land units, junk |
| 机械 Machinery | Workshop, trebuchet |
| 行会 Guilds | +1 trade route |
| 火药 Gunpowder | Rocket archer (火箭手) |

### Early Modern (近世)

| Tech | Unlocks |
|---|---|
| 印刷 Printing | University |
| 火器 Firearms | Musketeer, dragoon |
| 铸炮 Gun Casting | Heavy cannon (红夷大炮), field gun |
| 远洋航海 Ocean Navigation | Ship of the line, off-map sea exits |
| 银行 Banking | Bank, +1 trade route |
| 天文历算 Astronomy | Observatory |
| 新作物 New Crops | Extra food from farms on hills |

### Industrial (工业)

| Tech | Unlocks |
|---|---|
| 蒸汽机 Steam Engine | Factory, reveals coal |
| 铁路 Railway | Roads upgrade to railways automatically |
| 线膛枪 Rifling | Rifleman, mounted rifleman |
| 钢铁冶金 Steelmaking | Ironclad, howitzer, machine gun |
| 电力 Electricity | Power plant |
| 公共卫生 Public Health | Hospital |

### Modern (现代)

| Tech | Unlocks |
|---|---|
| 内燃机 Combustion Engine | Tank, reveals oil |
| 航空 Aviation | Airfield (air strike) |
| 电子 Electronics | Research institute, missile launcher, reveals rare earths |
| 石化 Petrochemicals | Mechanised infantry, destroyer |
| 火箭 Rocketry | Rocket artillery |
| 信息网络 Information Networks | Endgame project |

### Prerequisites

Ancient techs have no prerequisite.

| Era | Tech | Requires |
|---|---|---|
| Classical | Writing | Ritual |
| Classical | Currency | Mining |
| Classical | Ironworking | Mining |
| Classical | Riding | Husbandry |
| Classical | Irrigation | Farming |
| Classical | Crossbow | Archery, Fortification |
| Classical | Shipbuilding | Boats |
| Medieval | Paper | Writing |
| Medieval | Stirrup | Riding |
| Medieval | Steel | Ironworking |
| Medieval | Compass | Shipbuilding |
| Medieval | Machinery | Irrigation, Crossbow |
| Medieval | Guilds | Currency |
| Medieval | Gunpowder | Ironworking, Writing |
| Early Modern | Printing | Paper |
| Early Modern | Firearms | Gunpowder |
| Early Modern | Gun Casting | Gunpowder, Machinery |
| Early Modern | Ocean Navigation | Compass |
| Early Modern | Banking | Guilds |
| Early Modern | Astronomy | Compass, Paper |
| Early Modern | New Crops | Compass |
| Industrial | Steam Engine | Gun Casting, Astronomy |
| Industrial | Railway | Banking |
| Industrial | Rifling | Firearms |
| Industrial | Steelmaking | Gun Casting |
| Industrial | Electricity | Astronomy, Printing |
| Industrial | Public Health | Printing, New Crops |
| Modern | Combustion Engine | Steam Engine |
| Modern | Aviation | Steelmaking, Rifling |
| Modern | Electronics | Electricity |
| Modern | Petrochemicals | Steelmaking, Public Health |
| Modern | Rocketry | Rifling |
| Modern | Information Networks | Electricity, Railway |

### What the non-unit unlocks do

- **Irrigation canal** (Irrigation): an improvement for flat river land (plains, grassland, desert): +3 food.
- **Canal** (Irrigation): an improvement for flat river land: +1 production, +3 gold. Ships do not sail it yet.
- **New Crops**: farms may also be built on hills.
- **Railway**: the roads on the nation's land become railways (see "Roads" in [03-gameplay.md](03-gameplay.md)).
- **Trade routes and off-map ports** (Currency, Guilds, Banking, Ocean Navigation): each of the first three adds a trade route slot; Currency opens the off-map land ports to the nation's routes and Ocean Navigation the sea exits (see "Trade" in [03-gameplay.md](03-gameplay.md)).
- **Endgame project** 天宫工程: three stages built one after the other in the capital, 470 production each. The first needs Rocketry, the second Electronics, the third Information Networks. Only the major nations and the player can build it; completing the third stage wins the game.

## Generic unit roster

30 units: one per class per era. The warrior needs no tech and is available from turn 1. The character after each name is the one engraved on its piece.

| Era | Infantry | Ranged | Cavalry | Siege | Naval |
|---|---|---|---|---|---|
| Ancient | Warrior 兵 | Archer 弓 | Chariot 车 | Battering ram 冲 | Galley 舟 |
| Classical | Swordsman 剑 | Crossbowman 弩 | Horseman 骑 | Catapult 石 | War junk 斗 |
| Medieval | Heavy infantry 戟 | Rocket archer 火 | Heavy cavalry 重 | Trebuchet 砲 | Junk 帆 |
| Early Modern | Musketeer 枪 | Field gun 野 | Dragoon 龙 | Heavy cannon 炮 | Ship of the line 舰 |
| Industrial | Rifleman 步 | Machine gun 机 | Mounted rifleman 骠 | Howitzer 榴 | Ironclad 铁 |
| Modern | Mechanised infantry 装 | Rocket artillery 箭 | Tank 坦 | Missile launcher 弹 | Destroyer 驱 |

The settler is not a combat unit: it can be built from the Classical era and founds a city on a wasteland city site.

Strategic resources gate units as follows: horses for cavalry up to the Industrial era, iron for swordsmen and heavy infantry, coal for ironclads, oil for tanks, mechanised infantry and destroyers, rare earths for missile launchers.

A source counts when it lies inside the nation's territory, improved or not, and the nation knows the tech that reveals it: Husbandry for horses, Ironworking for iron, Steam Engine for coal, Combustion Engine for oil, Electronics for rare earths. Until then the resource is hidden from that nation.

**Upgrades skip what cannot be built.** A unit upgrades to the nearest later unit of its class that its owner has the tech and the resource for, so a nation without iron takes its warriors straight to musketeers.

## Generic buildings

Each building needs the tech named in the tech tree. Cost is in production, upkeep in gold per turn.

| Building | Tech | Cost | Upkeep | Effect |
|---|---|---|---|---|
| Granary | Farming | 40 | 1 | +2 food |
| Walls | Fortification | 50 | 0 | +50 city HP, +20% city strength, one ranged counter-strike per turn |
| Temple | Ritual | 40 | 1 | +2 culture |
| Academy | Writing | 60 | 1 | +3 science |
| Market | Currency | 60 | 0 | +2 gold, +25% gold |
| Harbour | Shipbuilding | 60 | 1 | Coastal cities only. +2 gold, +1 food on every worked water hex |
| Print shop | Paper | 80 | 1 | +3 culture, +1 science |
| Workshop | Machinery | 80 | 1 | +2 production, +25% production |
| University | Printing | 120 | 2 | +3 science, +25% science |
| Bank | Banking | 120 | 0 | +3 gold, +25% gold |
| Observatory | Astronomy | 120 | 1 | +4 science |
| Factory | Steam Engine | 180 | 3 | +4 production, +25% production |
| Power plant | Electricity | 180 | 3 | +25% production, +10% science |
| Hospital | Public Health | 180 | 2 | +4 food |
| Airfield | Aviation | 240 | 3 | One air strike per turn |
| Research institute | Electronics | 270 | 3 | +6 science, +25% science |

**Air strike.** Once per turn a city with an airfield strikes an enemy unit or city within 6 hexes, with the strength of a modern ranged unit (76). Nothing strikes back. A city is worn down to 0 HP but still has to be entered by a melee unit.

## Policies

24 cards. Each era unlocks four, one each in economy, military, civil and diplomacy.

Rules:

- Cards are unlocked with culture, about one every 6 turns.
- Slots are untyped: any card fits any slot. Slots grow with the eras from 2 to 6.
- Unlocking a card grants one free swap. Any other swap starts a 5-turn cooldown.
- No mutually exclusive pairs in v1.

In detail:

- **Unlocking.** A nation's culture of each turn is added to a store. The card after `n` unlocked ones costs `6 + 0.85 × n²` culture, rounded (6, 7, 9, 14, 20, 27, …, 456 for the last). The nation chooses which card to unlock among those of the eras it has entered. With this the leading major nation holds 20–23 cards when the game ends, about one every 6 turns; a nation that neglects culture gets about half as many.
- **Slots by era**: 2, 3, 4, 5, 6, 6. Only slotted cards have an effect.
- **Swaps.** Putting a card into an empty slot, or emptying a slot, is always allowed. Replacing a card is a swap: it uses a free swap if the nation has one (each card unlocked grants one, and they add up), and otherwise it is allowed only when no cooldown runs and starts a cooldown of 5 turns.
- City-states have no policy cards.

What the wording of some cards means:

- **Citizen levy, New Army, Industrial planning**: the percentage is added to the city's production while it builds an item of that kind. New Army's "modern land units" are the land combat units of the Industrial and Modern eras.
- **Merit ranks**: 5 culture for each enemy unit one of the nation's units destroys. It goes into the store for the next card too.
- **Vertical and horizontal alliances**: a unit "fights alongside an ally" when the enemy it fights is one that an ally of its owner is also at war with.
- **Tribute**: a vassal then pays 30% instead of 20%, and a city-state 15% instead of 10% (see [01-world-and-map.md](01-world-and-map.md)).
- **Firearms corps**: the firearm units are the gunpowder land units of the Early Modern and Industrial eras: musketeer, field gun, dragoon, heavy cannon, rifleman, machine gun, mounted rifleman, howitzer.
- **Industry first**: a city with a factory gets +15% production.
- **Treaty ports**: the holder gets +10% city gold while it has at least one trade pact, and so does every nation it has a trade pact with. The bonus counts once however many pacts carry it.
- **Total defence**: a unit standing on its owner's land, attacking or defending.
- **Regional cooperation**: doubles the income of the holder's trade routes that go to a city of a nation it is allied with.
- **Covenant**: every gain of influence, from a route or a gift, is 25% larger.

| Era | Economy | Military | Civil | Diplomacy |
|---|---|---|---|---|
| Ancient | 井田 Well-field: farms +1 food | 国人兵役 Citizen levy: unit production +15% | 宗法 Clan law: capital +2 culture | 会盟 Covenant: city-state influence grows 25% faster |
| Classical | 郡县 Commanderies: non-capital cities +10% production | 军功爵 Merit ranks: defeating enemy units gives culture | 百家争鸣 Hundred Schools: academies +2 science | 合纵连横 Vertical and horizontal alliances: +5% strength when fighting alongside an ally |
| Medieval | 两税法 Two-tax law: city gold +10% | 募兵 Paid army: unit upkeep −20% | 科举 Imperial examination: academies and print shops +1 culture each | 朝贡 Tribute: vassals and city-states pay 50% more gold |
| Early Modern | 一条鞭法 Single-whip law: markets and banks +2 gold | 火器营 Firearms corps: firearm units +5% strength | 书院讲学 Academy lectures: universities +3 science | 开海 Open seas: sea trade routes +2 gold |
| Industrial | 实业兴国 Industry first: factories +15% production | 新军 New Army: modern land unit production +20% | 新式学堂 New schools: +1 science per 5 population in each city | 通商口岸 Treaty ports: both sides of a trade pact +10% gold |
| Modern | 产业规划 Industrial planning: buildings build 15% faster | 全民国防 Total defence: +10% strength inside own borders | 义务教育 Compulsory education: national science +10% | 区域合作 Regional cooperation: double income from trade routes with allies |
