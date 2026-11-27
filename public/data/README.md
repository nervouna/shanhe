# Generated map data

Output of the map pipeline (`npm run pipeline`, see `tools/pipeline/README.md`), in the `MapData` format defined in `src/shared/mapData.ts`. Do not edit these files by hand.

| File | Content |
|---|---|
| `map.json` | Grid size, polities, zones, resources, off-map ports, projection, and the names of the files below |
| `map.<layer>.bin` | One per-hex array each: `terrain`, `hills`, `feature`, `elevation`, `owner`, `zone`, `riverEdges`, `resource` |
| `map.height.bin` | The heightmap that `map.json` describes: little-endian `Uint16`, row by row from north to south |

The data are derived from Natural Earth, ETOPO 2022 and the Köppen-Geiger maps of Beck et al. (2018); see `tools/pipeline/DATA.md` for licences and attribution.
