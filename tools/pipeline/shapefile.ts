/**
 * Minimal ESRI shapefile reader: polygon and polyline geometry from the
 * `.shp` file, attributes from the `.dbf` file.
 */

/** One feature: its attributes and its rings or lines. */
export interface ShapeRecord {
  /** Attribute values by field name, trimmed. */
  readonly attributes: Readonly<Record<string, string>>;
  /** Each part is a flat list of longitude, latitude pairs in degrees. */
  readonly parts: readonly Float64Array[];
}

function readDbf(dbf: Buffer): Record<string, string>[] {
  const count = dbf.readUInt32LE(4);
  const headerLength = dbf.readUInt16LE(8);
  const recordLength = dbf.readUInt16LE(10);
  const fields: { name: string; length: number }[] = [];
  for (let at = 32; dbf[at] !== 0x0d; at += 32) {
    let end = at;
    while (end < at + 11 && dbf[end] !== 0) end++;
    fields.push({ name: dbf.toString('latin1', at, end), length: dbf[at + 16] as number });
  }
  const records: Record<string, string>[] = [];
  for (let i = 0; i < count; i++) {
    let at = headerLength + i * recordLength + 1;
    const record: Record<string, string> = {};
    for (const field of fields) {
      // values are padded with spaces or NUL bytes
      record[field.name] = dbf
        .toString('utf8', at, at + field.length)
        .replace(/\0/g, ' ')
        .trim();
      at += field.length;
    }
    records.push(record);
  }
  return records;
}

/** Reads a polygon or polyline shapefile. Records with no geometry have no parts. */
export function readShapefile(shp: Buffer, dbf: Buffer): ShapeRecord[] {
  const attributes = readDbf(dbf);
  const records: ShapeRecord[] = [];
  let at = 100;
  while (at < shp.length) {
    const contentBytes = shp.readUInt32BE(at + 4) * 2;
    const start = at + 8;
    const type = shp.readUInt32LE(start);
    const parts: Float64Array[] = [];
    if (type === 3 || type === 5 || type === 13 || type === 15) {
      const partCount = shp.readUInt32LE(start + 36);
      const pointCount = shp.readUInt32LE(start + 40);
      const pointsAt = start + 44 + partCount * 4;
      for (let p = 0; p < partCount; p++) {
        const from = shp.readUInt32LE(start + 44 + p * 4);
        const to = p + 1 < partCount ? shp.readUInt32LE(start + 44 + (p + 1) * 4) : pointCount;
        const part = new Float64Array((to - from) * 2);
        for (let k = from; k < to; k++) {
          part[(k - from) * 2] = shp.readDoubleLE(pointsAt + k * 16);
          part[(k - from) * 2 + 1] = shp.readDoubleLE(pointsAt + k * 16 + 8);
        }
        parts.push(part);
      }
    } else if (type !== 0) {
      throw new Error(`shapefile: unsupported shape type ${type}`);
    }
    const record = attributes[records.length];
    if (record === undefined) throw new Error('shapefile: more shapes than attribute records');
    records.push({ attributes: record, parts });
    at = start + contentBytes;
  }
  if (records.length !== attributes.length) {
    throw new Error('shapefile: shape and attribute counts differ');
  }
  return records;
}
