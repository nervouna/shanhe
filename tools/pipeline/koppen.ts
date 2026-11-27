/**
 * The Köppen-Geiger climate raster of Beck et al. (2018), 5 arc-minute
 * version: a tiled, PackBits-compressed, 8-bit TIFF covering the globe from
 * (-180°, 90°) with one class number per cell (see `legend.txt` in the
 * archive; 0 is "no data", used for the sea).
 */

/** The class numbers of the dataset. */
export const Koppen = {
  None: 0,
  Af: 1, Am: 2, Aw: 3,
  BWh: 4, BWk: 5, BSh: 6, BSk: 7,
  Csa: 8, Csb: 9, Csc: 10,
  Cwa: 11, Cwb: 12, Cwc: 13,
  Cfa: 14, Cfb: 15, Cfc: 16,
  Dsa: 17, Dsb: 18, Dsc: 19, Dsd: 20,
  Dwa: 21, Dwb: 22, Dwc: 23, Dwd: 24,
  Dfa: 25, Dfb: 26, Dfc: 27, Dfd: 28,
  ET: 29, EF: 30,
} as const;

export interface ClimateGrid {
  readonly width: number;
  readonly height: number;
  /** Cells per degree. */
  readonly perDegree: number;
  /** Row 0 is the northernmost, column 0 the westernmost. */
  readonly data: Uint8Array;
}

function unpackBits(source: Buffer, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let from = 0;
  let to = 0;
  while (to < size && from < source.length) {
    const n = source.readInt8(from++);
    if (n >= 0) {
      for (let i = 0; i <= n; i++) out[to++] = source[from++] as number;
    } else if (n !== -128) {
      const value = source[from++] as number;
      for (let i = 0; i < 1 - n; i++) out[to++] = value;
    }
  }
  if (to !== size) throw new Error('koppen: a tile did not decode to its full size');
  return out;
}

/** Decodes the TIFF. Throws if it is not laid out as described above. */
export function readKoppenTiff(tiff: Buffer): ClimateGrid {
  if (tiff.toString('latin1', 0, 2) !== 'II' || tiff.readUInt16LE(2) !== 42) {
    throw new Error('koppen: not a little-endian TIFF');
  }
  const ifd = tiff.readUInt32LE(4);
  const entries = tiff.readUInt16LE(ifd);
  const tags = new Map<number, { type: number; count: number; valueAt: number }>();
  for (let i = 0; i < entries; i++) {
    const at = ifd + 2 + i * 12;
    tags.set(tiff.readUInt16LE(at), {
      type: tiff.readUInt16LE(at + 2),
      count: tiff.readUInt32LE(at + 4),
      valueAt: at + 8,
    });
  }
  const values = (tag: number): number[] => {
    const entry = tags.get(tag);
    if (entry === undefined) throw new Error(`koppen: TIFF tag ${tag} is missing`);
    const bytes = entry.type === 3 ? 2 : entry.type === 4 ? 4 : entry.type === 12 ? 8 : 0;
    if (bytes === 0) throw new Error(`koppen: TIFF tag ${tag} has unsupported type ${entry.type}`);
    const at = entry.count * bytes <= 4 ? entry.valueAt : tiff.readUInt32LE(entry.valueAt);
    const out: number[] = [];
    for (let i = 0; i < entry.count; i++) {
      out.push(
        bytes === 2
          ? tiff.readUInt16LE(at + i * 2)
          : bytes === 4
            ? tiff.readUInt32LE(at + i * 4)
            : tiff.readDoubleLE(at + i * 8),
      );
    }
    return out;
  };
  const one = (tag: number): number => values(tag)[0] as number;

  const width = one(256);
  const height = one(257);
  if (one(258) !== 8 || one(259) !== 32773 || one(277) !== 1) {
    throw new Error('koppen: expected an 8-bit, single-band, PackBits TIFF');
  }
  const scale = values(33550);
  const tie = values(33922);
  const perDegree = Math.round(1 / (scale[0] as number));
  if (tie[3] !== -180 || tie[4] !== 90 || width !== 360 * perDegree || height !== 180 * perDegree) {
    throw new Error('koppen: the raster does not cover the globe from (-180, 90)');
  }
  const tileWidth = one(322);
  const tileHeight = one(323);
  const offsets = values(324);
  const byteCounts = values(325);
  const across = Math.ceil(width / tileWidth);
  const data = new Uint8Array(width * height);
  offsets.forEach((offset, t) => {
    const tile = unpackBits(
      tiff.subarray(offset, offset + (byteCounts[t] as number)),
      tileWidth * tileHeight,
    );
    const x0 = (t % across) * tileWidth;
    const y0 = Math.floor(t / across) * tileHeight;
    for (let y = 0; y < tileHeight && y0 + y < height; y++) {
      for (let x = 0; x < tileWidth && x0 + x < width; x++) {
        data[(y0 + y) * width + x0 + x] = tile[y * tileWidth + x] as number;
      }
    }
  });
  return { width, height, perDegree, data };
}

/**
 * The climate class at a place: the cell's own class, or the nearest class
 * within `reach` cells if the cell has no data (coasts, small islands).
 */
export function sampleClimate(grid: ClimateGrid, lon: number, lat: number, reach = 6): number {
  const cx = Math.floor((lon + 180) * grid.perDegree);
  const cy = Math.max(0, Math.min(grid.height - 1, Math.floor((90 - lat) * grid.perDegree)));
  const at = (x: number, y: number): number => {
    if (y < 0 || y >= grid.height) return 0;
    return grid.data[y * grid.width + (((x % grid.width) + grid.width) % grid.width)] as number;
  };
  const own = at(cx, cy);
  if (own !== 0) return own;
  let best = 0;
  let bestDistance = Infinity;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const value = at(cx + dx, cy + dy);
      const distance = dx * dx + dy * dy;
      if (value !== 0 && distance < bestDistance) {
        best = value;
        bestDistance = distance;
      }
    }
  }
  return best;
}
