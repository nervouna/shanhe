/**
 * The shape of a unit piece as plain numbers, without Three.js: the outline
 * of the disc that is drawn, and the much coarser disc that stands in for it
 * in the shadow map.
 */

/** Shape of a piece, as fractions of the hex size. */
export const PIECE_RADIUS = 0.54;
export const PIECE_HEIGHT = 0.3;
export const PIECE_BEVEL = 0.055;
/** Segments around the piece that is drawn. */
export const PIECE_AROUND = 36;

/** Steps of each rounded edge of the outline. */
const ARC = 3;

/**
 * The outline of the drawn piece from the centre of its top to the rim of
 * its open underside: radius, height and the normal in that plane.
 */
export function pieceOutline(): (readonly [r: number, y: number, nr: number, ny: number])[] {
  const outline: (readonly [r: number, y: number, nr: number, ny: number])[] = [
    [0, PIECE_HEIGHT, 0, 1],
    [PIECE_RADIUS - PIECE_BEVEL, PIECE_HEIGHT, 0, 1],
  ];
  for (let s = 1; s < ARC; s++) {
    const a = (s / ARC) * (Math.PI / 2);
    outline.push([
      PIECE_RADIUS - PIECE_BEVEL + PIECE_BEVEL * Math.sin(a),
      PIECE_HEIGHT - PIECE_BEVEL + PIECE_BEVEL * Math.cos(a),
      Math.sin(a),
      Math.cos(a),
    ]);
  }
  outline.push([PIECE_RADIUS, PIECE_HEIGHT - PIECE_BEVEL, 1, 0], [PIECE_RADIUS, PIECE_BEVEL, 1, 0]);
  for (let s = 1; s <= ARC; s++) {
    const a = Math.PI / 2 + (s / ARC) * (Math.PI / 2);
    outline.push([
      PIECE_RADIUS - PIECE_BEVEL + PIECE_BEVEL * Math.sin(a),
      PIECE_BEVEL + PIECE_BEVEL * Math.cos(a),
      Math.sin(a),
      Math.cos(a),
    ]);
  }
  return outline;
}

/** A triangle mesh as plain arrays. */
export interface PlainMesh {
  readonly positions: number[];
  readonly indices: number[];
}

/** Sides of the disc that casts a piece's shadow. */
const CASTER_SIDES = 20;
/** Its radius and height: a little inside the drawn piece, so that a piece does not shade its own face. */
const CASTER_RADIUS = PIECE_RADIUS - 0.035;
const CASTER_HEIGHT = PIECE_HEIGHT - 0.035;

/**
 * What casts a piece's shadow: a plain disc with a flat top and an open
 * underside, standing on y = 0. Faces are counter-clockwise seen from
 * outside. A tenth of the triangles of the drawn piece: the shadow map is
 * drawn again in every frame in which a piece moves.
 */
export function pieceCasterMesh(): PlainMesh {
  const positions: number[] = [0, CASTER_HEIGHT, 0];
  const indices: number[] = [];
  for (let s = 0; s < CASTER_SIDES; s++) {
    const angle = (s / CASTER_SIDES) * Math.PI * 2;
    const x = CASTER_RADIUS * Math.cos(angle);
    const z = CASTER_RADIUS * Math.sin(angle);
    positions.push(x, CASTER_HEIGHT, z, x, 0, z);
  }
  for (let s = 0; s < CASTER_SIDES; s++) {
    const next = (s + 1) % CASTER_SIDES;
    const top = 1 + s * 2;
    const bottom = top + 1;
    const nextTop = 1 + next * 2;
    const nextBottom = nextTop + 1;
    // the angle grows from +x towards +z, so seen from above the rim runs clockwise
    indices.push(0, nextTop, top);
    indices.push(top, nextTop, bottom, bottom, nextTop, nextBottom);
  }
  return { positions, indices };
}
