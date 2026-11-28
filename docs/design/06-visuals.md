# Visuals

The look is a realistic war-room sand table: real terrain rendered as a physical diorama, with board-game pieces standing on it.

## The procedural rule

Every visual is produced by code: geometry from generators, materials from shaders. No model files, no texture files.

Public geographic datasets are input data, not art assets, and are allowed:

- elevation and bathymetry from a public global elevation dataset;
- national and province borders, rivers and lakes from Natural Earth (public domain);
- vegetation and climate zones from a public climate-classification dataset.

A build-time script turns these into one heightmap and one hex-grid data file. Because small nations and city-states are enlarged (see [01-world-and-map.md](01-world-and-map.md)), the script applies the same warp to every dataset — elevation, borders, rivers, climate — before gridding, so terrain and borders stay aligned. The game loads only those two. The datasets and their licences are listed in `tools/pipeline/DATA.md`, the method in `tools/pipeline/README.md`.

## Terrain

- **Projection**: equal-area conic centred near 105°E, 35°N.
- **Continuous surface**: the ground is one continuous height mesh, not hex-shaped blocks. The hex grid is a thin overlay shown when needed.
- **Vertical exaggeration**: about 10×. Without it even the Himalayas are flat at this scale.
- **Shader-only materials**: rock, grass, desert, snow and tundra come from noise, blended by slope, altitude and climate zone. The noise is one small texture generated at start-up and read at several scales, which is much cheaper than computing it per pixel.
- **No tiles**: the land cover of the hexes is blurred and read through a noise warp, so that one terrain class runs into the next along an irregular line and the ground does not show its hexes.
- **Snow line**: bare ground is under snow above a line that sinks towards the north, from about 5,400 m over the Himalaya to under 1,000 m on the Arctic coast.
- **Features**: a volcano is a dark cone with a glowing crater over a lava field; an oasis is a pond in a ring of green with palms; a marsh has pools of standing water.
- **Level of detail**: dense mesh near the camera, sparse far away.

## Water

- **Ocean**: colour follows real depth, read per pixel, so the shore is as fine as the relief; ripples, surf that runs up the shore and breaks into foam, and sky reflection.
- **Rivers**: drawn along their real courses as flowing water. The rules use the hex edges a river passes; the picture follows those edges as a smooth ribbon with rounded bends and joints, thin at the source. The Yangtze, Yellow River, Mekong and Lena should be recognisable.
- **Lakes**: Baikal, Qinghai Lake, Dongting, Tonlé Sap and others are modelled individually.

## Vegetation

Procedural trees in a few families — conifer, broadleaf, bamboo, palm, rainforest canopy — distributed by climate zone. Zoomed out, trees merge into forest colour and relief.

- **Which tree where**: jungle is rainforest canopy with palms in the tropics and broadleaf with bamboo north of them; forest turns from broadleaf with bamboo in the warm south to conifer in the north, on high ground and on tundra; an oasis has palms; open grassland and plains carry a stray tree or two.
- **How they are drawn**: the trees of a few hexes are merged into one mesh when the camera comes near, in a detailed version close by and a coarse one farther off. Beyond about 40 hex sizes they sink into the ground and the ground shader's forest takes over.

## Light and atmosphere

- Physically based sky; sunlight with cascaded shadows. The sky is never in view from the game camera, which always looks down: it is the environment that water and pieces mirror. The cascades are squares on the ground around the point the camera looks at, each drawn again only when something that casts a shadow changed or the view left it. Each cascade keeps a map of the ground and one of the pieces; a moving piece redraws only the latter.
- Aerial perspective: distant mountains turn blue-grey. This is one of the main sources of realism.
- A cloud layer, and cloud shadows drifting slowly over the ground. At the farthest zoom clouds sit over the map, thin over the political map so that it stays readable.
- Light is fixed at afternoon with slow drift. No day/night cycle and no seasons.

## Cities and buildings

- **Cities grow with population and era**: a few houses, then a walled town, then industrial works, then modern towers.
- **Seven architectural families**: Central Plains, Jiangnan, Tibetan, steppe yurt, Japanese, Southeast Asian (stilt houses and pagodas), Siberian log house. Each nation belongs to one.
- **50 unique buildings**, each with its own procedural model, act as landmarks. All of them, and the cities, are put together from six simple shapes and a small set of parametric pieces (hall, tiered tower, stupa, wall, arch, terrace, round house, pond, stilt house, works, boat), so that fifty models are affordable.
- **Improvements** are visible on the ground: field furrows, terraces, mines, pastures, fisheries.
- **Roads** run through the hex centres as trodden earth, **railways** as ballast with sleepers and rails. **Trade routes** are faint dotted lines in their owner's colour that creep along the route, over the water at sea; they are not shown on the political map.

The renderer's `familyOfPolity` gives the family of a polity; whoever builds the scene passes it with each city.

| Family | Nations |
|---|---|
| Central Plains | 燕, 晋, 齐, 中州, 秦, 陇右, 西夏, 蜀, 巴, 滇, 夜郎, 楚, 潇湘, 辽东, 扶余, 高丽; city-states 津门, 耽罗, 沙州 |
| Jiangnan | 豫章, 淮南, 吴, 越, 闽, 东宁, 岭南, 骆越, 琼崖; city-states 香江, 濠镜, 申 |
| Tibetan | 吐蕃, 青唐 |
| Steppe | 漠南, 漠北; wasteland 西域 |
| Japanese | 东国, 大和, 筑紫, 琉球; city-state 对马 |
| Southeast Asian | 交趾, 占城, 澜沧, 真腊, 暹罗, 蒲甘, 满剌加, 三佛齐, 阇婆, 渤泥, 吕宋, 苏禄, 美洛居; city-states 淡马锡, 汶莱, 底门 |
| Siberian | 黑水, 虾夷, 北海, 率宾; wastelands 坚昆, 极北, 流鬼 |

## Units: xiangqi-style pieces

Units are not figures. They are thick round game pieces, like xiangqi pieces, standing on the diorama.

- **Shape**: a round piece with one Chinese character engraved on top for its class, and a band in the nation's colour around the side.
- **Class characters**: each generic unit has its own character, changing with the era, for example 弓 to 弩 for ranged and 骑 to 坦 for cavalry. The full table is in [04-tech-and-policies.md](04-tech-and-policies.md).
- **Unique units** carry their own character with the engraving filled in gold, for example a gold 弩 for Shu's repeating crossbowman and 象 for Lan Xang's war elephant. The full list is in [02-nations.md](02-nations.md).
- **Material by era**: pottery and wood (Ancient), bronze (Classical), lacquer (Medieval), jade (Early Modern), brass (Industrial), steel (Modern).
- **HP**: a ring of ticks around the rim that go dark as HP is lost.
- The polished materials mirror the sky, and every piece has a soft shade on the ground under it.

Motion and combat:

| Event | Animation |
|---|---|
| Move | The piece is lifted, slides along the path and is set down with a soft knock and a puff of dust |
| Melee | The attacker strikes the other piece and bounces back, like a capture in chess |
| Ranged and siege | The piece stays put; an arc of arrows or shells flies from it and lands in smoke |
| Destroyed | The piece cracks, falls and is taken off the table |
| Naval | The same piece on water, with ripples around it |
| City strike | A volley of arrows flies from the city and lands in dust |
| Promotion | The piece flashes gold and throws sparks |
| City capture | The zone takes the colour of its new owner in a sweep outwards from the city |

Animations are shown only for hexes in view; elsewhere the board changes at once. They have a speed factor and can be skipped.

Why pieces and not figures: realistic rigged people are the weakest thing procedural generation can make. Pieces remove that weakness, read clearly at any zoom, are easy to hit on touch screens, and fit the sand-table concept. The cost is the spectacle of armies meeting; arrows, gunfire and smoke particles make up part of it.

Leaders are never rendered.

## Post-processing

Tilt-shift depth of field, ambient occlusion, tone mapping, slight bloom, anti-aliasing. Tilt-shift matters most: it makes the image read as a physical model. It is strongest close to the ground and gone before the political map. Labels are laid over the finished picture and are never blurred.

| Quality | Effects |
|---|---|
| low | none: the scene is drawn straight to the screen, with the lights dimmed to make up for the missing tone mapping |
| medium | tilt-shift, tone mapping, anti-aliasing |
| high, auto | all five |

On the WebGL fallback ambient occlusion and bloom stay off at every tier.

## Political map

Zoomed out, the realistic ground crossfades into a political map: nations filled with their colours over lightly shaded relief, borders bright, and one name per nation laid out along the shape of its territory and sized to it, in Chinese or English.

Zoomed in, the territory tint is faint, so that the terrain's own colours carry the picture; the borders stay clear at every zoom.

City labels thin out with distance: all cities near, then only large cities and capitals, then only capitals, and none once the nations' names are shown. Labels never overlap: where two would, the less important one is hidden.

## Fog of war

Terrain is always visible; fog hides only foreign units and city details, and out-of-vision areas are slightly desaturated. The real terrain is the attraction, so it is never covered.

## Performance targets

- 60 fps on laptops and tablets of the last few years; older devices drop a quality tier and hold 30 fps.
- Quality tiers: low, medium, high and auto. Auto is the default: it lowers the internal resolution when frames run long and restores it when they do not. The other tiers hold a fixed resolution and terrain detail.
- WebGPU first, with a WebGL fallback for browsers without it.
- Three.js's WebGPU side changes fast. Check the current documentation before relying on a specific API.

## Expected quality

| Part | Expectation |
|---|---|
| Terrain, water, atmosphere, clouds, the zoomed-out panorama | Strong. Pure maths and data, where procedural work is at its best |
| Buildings and cities | Good enough at strategic distance, simple up close |
| Units | Strong as pieces: realistic materials on simple shapes |
