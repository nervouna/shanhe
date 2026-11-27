# Map pipeline

Turns public geographic datasets into the game's map: the `MapData` files in `public/data/` (contract: `src/shared/mapData.ts`). The output is committed, so building or testing the game needs no download and CI does not run the pipeline.

| Command | What it does |
|---|---|
| `npm run pipeline` | Download the datasets into `data/raw/` if they are not there, build the map, check it, write `public/data/` |
| `npm run pipeline -- --offline` | The same, but fail instead of downloading |
| `npm run pipeline -- --dry` | Build and check, write nothing |
| `npm run pipeline -- --debug` | Also write `political.png` and `terrain.png` into `data/raw/debug/` (git-ignored; never commit them) |
| `npm run pipeline:check` | Check the committed map and print the polity table. Needs no datasets |

The datasets and their licences are in [DATA.md](DATA.md). The run is deterministic: the same datasets and the same code give byte-identical files.

## Files

| File | Content |
|---|---|
| `config.ts` | Projection, frame, hex size, heightmap size, the lens list |
| `polities.ts` | The polity table: 50 nations, 10 city-states, 4 wasteland regions, their source units, city sites and luxuries |
| `features.ts` | Hand-picked places: strategic resources, volcanoes, off-map ports |
| `albers.ts`, `warp.ts`, `mapping.ts` | Longitude and latitude to hex: the projection, the enlargement warp, both together |
| `sources.ts` | Natural Earth layers drawn onto rasters of the source plane |
| `etopo.ts`, `koppen.ts`, `shapefile.ts`, `zip.ts`, `fetch.ts` | Readers and the download cache |
| `build.ts` | The pipeline |
| `validate.ts`, `check.ts`, `loadMap.ts` | The checks, `pipeline:check`, reading `public/data/` |
| `hexEdges.ts` | Hex corners and edges as integers, for rivers |
| `debugImage.ts` | The debug pictures |

## Method

### One mapping for everything

    longitude, latitude --Albers--> source plane --warp--> map plane --> hex

- **Projection.** Albers equal-area conic on a sphere of radius 6371 km, origin 105°E 35°N, standard parallels 15°N and 55°N. This is `MapData.projection`.
- **Frame.** A rectangle on the map plane from 3050 km west to 4450 km east and from 5450 km north to 5000 km south of the origin: the Urals and the Pamirs in the west, the Bering Strait and the tip of Alaska in the east, the Arctic coast in the north, Java and Timor in the south. Near the top the frame reaches beyond the pole, which the projection does not cover; that part is drawn as the Arctic Ocean at the pole.
- **Hexes.** Pointy-top, 70 km across, one world unit from centre to corner, 106 columns by 172 rows.
- **Sampling.** Every hex takes its values at its centre: the centre is sent back through the warp to the source plane, and there the pipeline reads whether it is land, lake or sea and who holds it, and further back on the globe its climate class. Elevation is the mean of a lattice of points inside the hex, each sent through the same mapping. Rivers go the other way: their points are sent forward to the map plane. The heightmap is the elevation grid sampled through the same mapping at every one of its samples. So borders, coast, terrain, rivers and relief stay aligned, whatever the warp does.

### Enlargement

Doc 01 asks that every nation has at least 7 hexes, every city-state 1 to 3, and that islands and small coastal units are moderately exaggerated. The warp does it. It is a chain of **lenses**, listed in `config.ts`:

- A lens changes the map only inside a disc. For a map point `m` at distance `t·R` from the centre `c` of a lens with radius `R`, the source point is `m + (1 − t^p)(A − I)(m − c) + (1 − t²)² · shift`. `A` shrinks distances by the gains of the lens, so the surroundings of the focus are drawn `gain` times larger; the effect fades to nothing at the rim, and the ground between the focus and the rim is compressed to make room. Gains can differ along and across an axis (a thin island, a strait).
- A lens with `snap` also moves its focus onto the centre of the nearest hex (`shift`, at most half a hex). The hex is then sampled exactly at the focus, so a place far smaller than a hex, such as Macau, is certain to get its hex. The pipeline fails if such a hex does not come out as land of the polity, or as the lake, the lens names.
- The whole warp is the composition of the lenses. It is one-to-one (the pipeline checks that its Jacobian determinant stays positive), it is the identity outside the lens discs, and it moves no point by more than about 260 km (the Okinawa lens; elsewhere far less).

What the lenses do today:

| Lenses | Purpose |
|---|---|
| `hainan`, `taiwan`, `kyushu` | Islands drawn 1.3 times larger |
| `pearl-river-mouth`, then `hong-kong` and `macau` | The delta drawn 2.6 times larger, then each city put on a hex |
| `singapore`, `jeju`, `tsushima` | City-states put on a hex and enlarged |
| `okinawa` | Ryukyu: Okinawa drawn 8 times longer and 9 times wider, focus on Naha |
| `kei` | A hex for the Kei islands, the stepping stone between Tanimbar and Aru |
| `qiongzhou-strait`, `sunda-strait` | Straits narrower than a hex widened, so Hainan and Java stay islands |
| `seoul`, `vladivostok`, `hue`, `bangkok`, `zamboanga`, `makassar`, `vientiane`, `bandar-seri-begawan` | Capitals whose hex centre would fall into the sea or across a border river, put on a hex (no enlargement) |
| `dongting-lake`, `poyang-lake` | Lakes that would fall between hex centres |

Polities that needed a lens to reach their size: 琉球 (1 hex without it), 香江, 濠镜, 淡马锡, 耽罗 and 对马 (none without it). 东宁, 琼崖 and 筑紫 had 8 or 9 hexes and were enlarged as islands. No polity needed shrinking.

To tune: edit `config.ts`, run `npm run pipeline -- --dry --debug`, read the polity table and look at the pictures. A snapped lens whose focus misses its target fails with the nearest place that would do.

### Ownership

`polities.ts` names the Natural Earth units of each polity by country code (`adm0_a3`) and `iso_3166_2` code. They are drawn onto a 2.5 km raster of the source plane: all countries first, as foreign ground; then the nations; then the carved pieces (the city-states, and islands moved between polities). Land that ends up with no polity is off-map. The pipeline fails if a first-level unit of a play country belongs to no polity.

Two steps follow the sampling:

- **Enclaves.** Where a border runs through a narrow neck, sampling can leave one to three hexes of a polity behind a neighbour's land, out of reach of the rest. Such a piece goes to the neighbour it shares the most edges with. The run prints each one (today: one hex of 吴 to 齐, one hex of 蒲甘 to 滇).
- **Water.** Every body of water that touches playable land is the sea of the play area (`OWNER_SEA`), lakes included. The outermost ring of the grid, and water that touches only off-map land, is off-map.

### Zones

A nation has 1 zone below 25 hexes, 2 below 60, 3 below 110 and 4 from there; `zones` in the table overrides this where a detached main island needs a city of its own (苏禄: Palawan; 美洛居: the south-eastern islands). A city-state has one zone, a wasteland region one per preset site. The site of a city is the hex that shows the city, or the nearest free land hex of the polity if that hex is water or belongs to a neighbour.

Every hex goes to the site it is nearest to, travelling over the polity's own land; only hexes that cannot be reached over land are reached across sea.

**Contiguity.** A zone is in one piece if every hex of it can be reached from its site by steps to adjacent hexes of the zone or across at most 3 sea hexes of the play area (`RULES.maxSeaGap`). Land of other zones, off-map hexes and the outermost ring do not carry a link. Strict contiguity over land is impossible for archipelagos with at most four zones; `pipeline:check` prints how many zones use a sea link, and a test pins which polities may.

### Terrain

- **Water.** A hex whose centre is in a Natural Earth lake is a lake; other water is coast next to land and ocean elsewhere. A small body of sea shut in by hexes (up to 8 hexes, not touching the edge) is a lake.
- **Land** takes its base terrain from the Köppen-Geiger class at its centre: tropical classes are grassland or plains with jungle, deserts are desert, hot steppe is plains and cold steppe grassland, temperate classes grassland, continental classes plains, subarctic classes tundra with forest (taiga), polar tundra is tundra and, north of 74°N or above 5300 m, snow.
- **Relief** is the standard deviation of the elevation inside the hex: 180 m makes it hilly, 600 m (450 m above 3500 m) an impassable mountain.
- **Features**: forest and jungle by the climate's share and a fixed pseudo-random number per hex; marsh on low flat ground next to a river or lake; oasis on desert next to a river or lake; volcanoes from the list in `features.ts`.
- City sites are cleared: no hills, no mountain.

### Rivers

Natural Earth river and lake centre lines up to `scalerank` 6 are sent to the map plane and snapped to the corners of the hexes; consecutive corners are joined along hex edges. An edge counts where both of its hexes are land, and is stored on both.

**"40 rivers' worth".** The check counts rivers from the edges alone: river edges form a graph on the hex corners; in each connected piece a corner where one river edge ends is a spring or a mouth, and a piece with `n` such ends counts as `n − 1` rivers (the main stream and one per tributary), a piece without ends as one.

### Resources, ports, heightmap

- **Strategic resources** (horses, iron, coal, oil, rare earths) are placed at the real regions listed in `features.ts`, on the nearest free hex within 3, preferably in the same polity.
- **Luxuries**: each nation's specialty and each wasteland region's luxury gets 1 to 4 hexes inside its territory, chosen by a fixed pseudo-random order and kept apart.
- **Off-map ports**: each port of `features.ts` is put on the off-map hex bordering the play area that is nearest to its place. Land ports sit on off-map land next to playable land, sea exits on the outermost ring next to the sea of the play area.
- **Heightmap**: 2048 samples per row, `Uint16` little-endian, 0.5 m per unit from −11000 m, covering the whole grid.

## Checks

`validate.ts` holds the rules and `pipeline:check` runs them on the committed files: 50 nations, 10 city-states, 4 wasteland regions; sizes; playable land between 6000 and 8000 hexes; every zone in one piece around a site it owns; one capital zone per nation and city-state; every hex classified consistently; at least 40 rivers; ports present; file sizes.

"Playable land" is the land of the 64 polities: what nations and city-states own at the start plus the wasteland, which is part of the play area but owned by nobody. The totals line prints both parts.
