/**
 * `npm run pipeline:check`: loads the committed map from `public/data/` and
 * checks it against the rules in `validate.ts`. Needs no downloaded data.
 */

import { loadMap } from './loadMap.ts';
import { RULES, formatReport, validateMap } from './validate.ts';

const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

const { map, heightmapBytes, totalBytes } = loadMap();
const report = validateMap(map);
const errors = [...report.errors];

const expectedBytes = map.heightmap.width * map.heightmap.height * 2;
if (heightmapBytes !== expectedBytes) {
  errors.push(`heightmap file has ${heightmapBytes} bytes, expected ${expectedBytes}`);
}
if (totalBytes > MAX_TOTAL_BYTES) errors.push(`public/data holds ${totalBytes} bytes, over 25 MB`);

console.log(formatReport(report));
console.log(
  `grid ${map.width} x ${map.height}, heightmap ${map.heightmap.width} x ${map.heightmap.height} ` +
    `(at most ${RULES.maxHeightmapWidth} wide), public/data ${(totalBytes / 1024 / 1024).toFixed(1)} MB`,
);
const smallest = [...report.rows].sort((a, b) => a.hexes - b.hexes).slice(0, 5);
console.log(`smallest: ${smallest.map((r) => `${r.nameZh} ${r.nameEn} ${r.hexes}`).join(', ')}`);

if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`);
  console.error(`pipeline:check failed with ${errors.length} error(s)`);
  process.exit(1);
}
console.log('pipeline:check passed');
