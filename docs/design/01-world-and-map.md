# World and Map

## Extent

- **West**: the Urals and the Pamirs.
- **South**: Java.
- **East**: the Bering Strait.
- **North**: the Arctic coast.

Projection is an equal-area conic centred near 105°E, 35°N, so that high-latitude Siberia is not inflated.

## Grid and scale

- Hex grid, 6000–8000 hexes over the playable area. One hex is about 70 km across; the grid is 106 × 172, of which 6707 hexes are playable land (3994 owned by nations and city-states, 2713 wasteland).
- The map is **not strictly to scale**. Small units are enlarged so they are playable:
  - every nation has at least 7 hexes (a city and one ring);
  - every city-state has 1–3 hexes;
  - islands and small coastal units are moderately exaggerated.

## Territory rules

- **Fixed borders at the start.** Every nation owns all hexes inside its province border from turn 1. There is no land grab between nations.
- **City zones.** Each province is pre-divided into 1–4 city zones, each with one preset city site. Only the capital exists at the start; the nation builds the other cities itself on their sites. Cities cannot be founded anywhere else inside owned provinces.
- **Conquest is per zone.** Capturing a city transfers only that city's zone. Capturing every city annexes the nation. Capturing the capital lets the attacker force vassalage.
- **Free development inside the province.** Improvements can be placed on any owned hex in the building city's zone.

## Splitting rules

- China is cut at province level. That is the guiding principle.
- Outside China, small first-level divisions are merged into whole countries or large regions.
- Very small units that should stay distinct become city-states.
- Names are fictional: historical and literary names of the regions, not modern state or province names.

The full nation list is in [02-nations.md](02-nations.md).

## City-states

A city-state is one city with a few hexes. It never expands. It can be courted into a suzerain relationship or conquered.

| City-state | Based on | Carved from | Type |
|---|---|---|---|
| 香江 Xiangjiang | Hong Kong | 岭南 | Finance |
| 濠镜 Haojing | Macau | 岭南 | Culture |
| 申 Shen | Shanghai | 吴 | Finance |
| 津门 Jinmen | Tianjin | 燕 | Industry |
| 淡马锡 Temasek | Singapore | 满剌加 | Commerce |
| 汶莱 Wenlai | Brunei | 渤泥 | Commerce |
| 底门 Dimen | Timor-Leste | 阇婆 | Commerce (sandalwood) |
| 耽罗 Tamna | Jeju Island | 高丽 | Naval |
| 对马 Tsushima | Tsushima Island | 筑紫 | Naval |
| 沙州 Shazhou | Dunhuang | 陇右 | Culture |

Suzerain bonus by type:

| Type | Bonus to the suzerain |
|---|---|
| Finance | Percentage bonus to gold |
| Culture | Bonus culture |
| Industry | Bonus production in the capital |
| Commerce | One extra trade route |
| Naval | Experience for newly built naval units |

Influence is gained through trade routes and gifts of gold. The nation with the most influence is the suzerain.

- Influence with a city-state runs from 0 to 200. A trade route to it gives 4 a turn, a gift of gold 1 for every 2 gold, and everybody's influence fades by 1 a turn.
- The suzerain is the polity with the most influence, once that reaches 60. A tie leaves the current suzerain in place.
- Going to war with a city-state wipes out the attacker's influence with it.
- A city-state pays its suzerain 10% of its gold income each turn, on top of the bonus of its type.
- The bonuses, per city-state: Finance +10% city gold; Culture +3 culture in the capital; Industry +15% production in the capital; Commerce one extra trade route; Naval 8 experience (one level) for every ship built or bought.
- City-states make no agreements and have no favour: influence is their whole diplomacy. They have no policy cards.
- A city-state on a map that is not in the table above gets a type by its position in the list of city-states.

A city-state defends itself with walls and one garrison unit. A nation that conquers it gains the city, and every nation loses its suzerain bonus.

## Wasteland

Some land starts without an owner, holding only tribes. It is the expansion space of the middle and late game.

Four regions are wasteland. They are not nations and cannot be played.

| Region | Based on | Luxury resource |
|---|---|---|
| 西域 Xiyu | Xinjiang | 和田玉 Hetian jade |
| 坚昆 Jiankun | Western Siberia | 貂皮 sable fur |
| 极北 Jibei | Sakha | 钻石 diamond |
| 流鬼 Liugui | Kamchatka, Chukotka | 海象牙 walrus ivory |

Wasteland is settled with a settler unit on preset city sites, first come first served. Settlers can be built from the Classical era, and each one costs more than the last. The luxury resources give a reason to expand there.

Tribes are neutral. Each defends its own hex and never raids. A wasteland zone starts with one tribe for every 80 of its land hexes that a unit can enter, rounded, and at least one; they stand on hexes drawn at random, never on the city site.

## Off-map land

India, Central Asia, New Guinea, the tip of Alaska and any other land inside the visible frame but outside the play area:

- is rendered with complete terrain, the same as the play area;
- has no owner and cannot be entered;
- has trade ports on its edge, used as off-map trade partners. A trade route to a port ends on the hex next to it: on land for a land port, on water for a sea exit.

The terrain inside the visible frame is always complete. Nothing is cut off at the play boundary.

## Fog of war

Terrain is always visible. Fog hides only other nations' units and city details. Areas outside vision are slightly desaturated.
