# Visuals

The look is a realistic war-room sand table: real terrain rendered as a physical diorama, with board-game pieces standing on it.

## The procedural rule

Every visual is produced by code: geometry from generators, materials from shaders. No model files, no texture files.

Public geographic datasets are input data, not art assets, and are allowed:

- elevation and bathymetry from a public global elevation dataset;
- national and province borders, rivers and lakes from Natural Earth (public domain);
- vegetation and climate zones from a public land-cover dataset.

A build-time script turns these into one heightmap and one hex-grid data file. Because small nations and city-states are enlarged (see [01-world-and-map.md](01-world-and-map.md)), the script applies the same warp to every dataset — elevation, borders, rivers, land cover — before gridding, so terrain and borders stay aligned. The game loads only those two. The exact datasets are to be chosen, and their licences checked, when the pipeline is built.

## Terrain

- **Projection**: equal-area conic centred near 105°E, 35°N.
- **Continuous surface**: the ground is one continuous height mesh, not hex-shaped blocks. The hex grid is a thin overlay shown when needed.
- **Vertical exaggeration**: about 10×. Without it even the Himalayas are flat at this scale.
- **Shader-only materials**: rock, grass, desert, snow and tundra come from noise functions, blended by slope, altitude and climate zone.
- **Level of detail**: dense mesh near the camera, sparse far away.

## Water

- **Ocean**: colour follows real depth; waves, shore foam and sky reflection.
- **Rivers**: drawn along their real courses as flowing water. The rules use the hex edges a river passes, so the picture and the rule can differ slightly. The Yangtze, Yellow River, Mekong and Lena should be recognisable.
- **Lakes**: Baikal, Qinghai Lake, Dongting, Tonlé Sap and others are modelled individually.

## Vegetation

Procedural trees in a few families — conifer, broadleaf, bamboo, palm, rainforest canopy — distributed by climate zone and drawn with instancing. Zoomed out, trees merge into forest colour and relief.

## Light and atmosphere

- Physically based sky; sunlight with cascaded shadows.
- Aerial perspective: distant mountains turn blue-grey. This is one of the main sources of realism.
- A cloud layer, and cloud shadows drifting slowly over the ground. At the farthest zoom clouds sit over the map.
- Light is fixed at afternoon with slow drift. No day/night cycle and no seasons.

## Cities and buildings

- **Cities grow with population and era**: a few houses, then a walled town, then industrial works, then modern towers.
- **Seven architectural families**: Central Plains, Jiangnan, Tibetan, steppe yurt, Japanese, Southeast Asian (stilt houses and pagodas), Siberian log house. Each nation belongs to one.
- **50 unique buildings**, each with its own procedural model, act as landmarks.
- **Improvements** are visible on the ground: field furrows, terraces, mines, pastures, fisheries.

## Units: xiangqi-style pieces

Units are not figures. They are thick round game pieces, like xiangqi pieces, standing on the diorama.

- **Shape**: a round piece with one Chinese character engraved on top for its class, and a band in the nation's colour around the side.
- **Class characters**: each generic unit has its own character, changing with the era, for example 弓 to 弩 for ranged and 骑 to 坦 for cavalry. The full table is in [04-tech-and-policies.md](04-tech-and-policies.md).
- **Unique units** carry their own character with the engraving filled in gold, for example a gold 弩 for Shu's repeating crossbowman and 象 for Lan Xang's war elephant. The full list is in [02-nations.md](02-nations.md).
- **Material by era**: pottery and wood (Ancient), bronze (Classical), lacquer (Medieval), jade (Early Modern), brass (Industrial), steel (Modern).
- **HP**: a ring of ticks around the rim that go dark as HP is lost.

Motion and combat:

| Event | Animation |
|---|---|
| Move | The piece is lifted, slides along the path and is set down with a soft knock and a puff of dust |
| Melee | The attacker strikes the other piece and bounces back, like a capture in chess |
| Ranged and siege | The piece stays put; an arc of arrows or shells flies from it and lands in smoke |
| Destroyed | The piece cracks, falls and is taken off the table |
| Naval | The same piece on water, with ripples around it |

Why pieces and not figures: realistic rigged people are the weakest thing procedural generation can make. Pieces remove that weakness, read clearly at any zoom, are easy to hit on touch screens, and fit the sand-table concept. The cost is the spectacle of armies meeting; arrows, gunfire and smoke particles make up part of it.

Leaders are never rendered.

## Post-processing

Tilt-shift depth of field, ambient occlusion, tone mapping, slight bloom, anti-aliasing. Tilt-shift matters most: it makes the image read as a physical model.

## Political map

Zoomed out, the realistic ground crossfades into a political map: nations tinted in their colours, borders glowing, names laid out along the shape of each territory.

## Fog of war

Terrain is always visible; fog hides only foreign units and city details, and out-of-vision areas are slightly desaturated. The real terrain is the attraction, so it is never covered.

## Performance targets

- 60 fps on laptops and tablets of the last few years; older devices drop a quality tier and hold 30 fps.
- WebGPU first, with a WebGL fallback for browsers without it.
- Three.js's WebGPU side changes fast. Check the current documentation before relying on a specific API.

## Expected quality

| Part | Expectation |
|---|---|
| Terrain, water, atmosphere, clouds, the zoomed-out panorama | Strong. Pure maths and data, where procedural work is at its best |
| Buildings and cities | Good enough at strategic distance, simple up close |
| Units | Strong as pieces: realistic materials on simple shapes |
