import { describe, expect, it } from 'vitest';
import { hexToWorld, worldToHex } from '../shared/hex.ts';
import { cameraLimits, politicalShare, zoomFraction } from './cameraRig.ts';
import { PIECE_RADIUS } from './pieceShape.ts';
import {
  GARRISON_OFFSET,
  GARRISON_SCALE,
  MIN_MARKER_PIXELS,
  MIN_PIECE_PIXELS,
  garrisonZoomScale,
  leastPiecePixels,
  markerShare,
  pieceFit,
  pieceHeightScale,
  pieceScreenDiameter,
  pieceStrength,
  pieceZoomScale,
  spreadMarkers,
  stackCountText,
  stackPieces,
  steppedScale,
} from './pieceLayout.ts';
import type { Standing } from './pieceLayout.ts';

const LAYOUT = { size: 1, originX: 0, originZ: 0 };

function standing(id: number, col: number, row: number, polity = 0, strength = 0): Standing {
  const p = hexToWorld({ col, row }, LAYOUT);
  return { id, polity, x: p.x, z: p.z, strength };
}

describe('the size of a piece on screen', () => {
  const distances = [5, 45, 90, 200, 420];
  // the real map: its farthest zoom is 420, and the political map is complete from about 180
  const limits = cameraLimits({ minX: -75.5, minZ: -134.9, maxX: 109, maxZ: 123.6 }, 1);
  const politicalAt = (distance: number): number => politicalShare(zoomFraction(distance, limits));

  it('never falls below the least size at distances 5, 45, 90, 200 and 420, on a desktop and on a small screen', () => {
    expect(limits.maxDistance).toBeCloseTo(420, -1);
    expect(politicalAt(90)).toBe(0);
    expect(politicalAt(420)).toBe(1);
    for (const height of [1200, 880, 540, 360]) {
      for (const distance of distances) {
        const political = politicalAt(distance);
        for (const garrison of [false, true]) {
          const diameter = pieceScreenDiameter(distance, height, 1, political, garrison);
          const where = `distance ${distance}, ${height} px${garrison ? ', garrison' : ''}`;
          // at any zoom, the size of a marker; and off the political map the full least size
          expect(diameter, where).toBeGreaterThanOrEqual(MIN_MARKER_PIXELS - 1e-9);
          expect(diameter, where).toBeGreaterThanOrEqual(leastPiecePixels(political) - 1e-9);
          if (political === 0) expect(diameter, where).toBeGreaterThanOrEqual(MIN_PIECE_PIXELS - 1e-9);
        }
      }
    }
    expect(MIN_PIECE_PIXELS).toBeGreaterThanOrEqual(30);
    expect(MIN_MARKER_PIXELS).toBeGreaterThanOrEqual(24);
  });

  it('is the size on the board while that is readable, and the least size beyond', () => {
    // near: 1.08 hex sizes across, far more than the least size
    expect(pieceZoomScale(5, 1200, 1)).toBe(1);
    expect(pieceScreenDiameter(5, 1200, 1)).toBeGreaterThan(300);
    expect(pieceZoomScale(45, 1200, 1)).toBe(1);
    expect(pieceScreenDiameter(45, 1200, 1)).toBeGreaterThan(MIN_PIECE_PIXELS);
    for (const distance of [90, 200, 420]) {
      const political = politicalAt(distance);
      expect(pieceZoomScale(distance, 1200, 1, political)).toBeGreaterThan(1);
      expect(pieceScreenDiameter(distance, 1200, 1, political)).toBeCloseTo(leastPiecePixels(political), 6);
    }
    expect(pieceScreenDiameter(420, 1200, 1, 1)).toBeCloseTo(MIN_MARKER_PIXELS, 6);
    // the scale grows in proportion to the distance
    expect(pieceZoomScale(420, 1200, 1) / pieceZoomScale(210, 1200, 1)).toBeCloseTo(2, 6);
    expect(pieceFit(45, 1200, 1)).toBeLessThan(1);
  });

  it('holds for any hex size', () => {
    expect(pieceScreenDiameter(900, 1200, 10)).toBeCloseTo(pieceScreenDiameter(90, 1200, 1), 6);
  });

  it('draws a garrison smaller than a piece in the field, but never below the least size', () => {
    expect(garrisonZoomScale(0.2)).toBe(GARRISON_SCALE);
    expect(garrisonZoomScale(0.9)).toBe(0.9);
    expect(garrisonZoomScale(2.5)).toBe(2.5);
    expect(pieceScreenDiameter(14, 1200, 1, 0, true)).toBeCloseTo(pieceScreenDiameter(14, 1200, 1) * GARRISON_SCALE, 6);
    // where a garrison would fall below the least size it is as large as any piece
    expect(pieceScreenDiameter(90, 1200, 1, 0, true)).toBeCloseTo(pieceScreenDiameter(90, 1200, 1), 6);
  });

  it('is applied in steps that never undercut it', () => {
    expect(steppedScale(1)).toBeCloseTo(1, 9);
    expect(steppedScale(0.4)).toBe(GARRISON_SCALE);
    let previous = 0;
    for (let scale = 0.5; scale < 8; scale += 0.013) {
      const stepped = steppedScale(scale);
      expect(stepped).toBeGreaterThanOrEqual(Math.min(scale, GARRISON_SCALE) - 1e-9);
      if (scale > GARRISON_SCALE) {
        expect(stepped).toBeGreaterThanOrEqual(scale - 1e-9);
        expect(stepped).toBeLessThanOrEqual(scale * 1.031);
      }
      expect(stepped).toBeGreaterThanOrEqual(previous);
      previous = stepped;
    }
  });

  it('turns a piece into a marker as it grows, and keeps it low', () => {
    expect(markerShare(1)).toBe(0);
    expect(markerShare(3)).toBe(1);
    expect(markerShare(1.3)).toBeGreaterThan(0);
    expect(markerShare(1.3)).toBeLessThan(1);
    expect(pieceHeightScale(1)).toBe(1);
    expect(pieceHeightScale(4)).toBe(2);
  });
});

describe('stackPieces', () => {
  it('leaves pieces on neighbouring hexes alone while they do not overlap', () => {
    const pieces = [standing(1, 3, 3), standing(2, 4, 3), standing(3, 3, 4)];
    for (const scale of [1, 1.4, 1.7]) {
      const markers = stackPieces(pieces, PIECE_RADIUS * scale);
      expect(markers).toHaveLength(3);
      expect(markers.every((marker) => marker.count === 1)).toBe(true);
    }
  });

  it('merges neighbours of one owner once they would overlap, under the strongest', () => {
    const pieces = [standing(1, 3, 3, 0, 5), standing(2, 4, 3, 0, 9), standing(3, 4, 4, 0, 1)];
    const markers = stackPieces(pieces, PIECE_RADIUS * 2);
    expect(markers).toHaveLength(1);
    const [stack] = markers;
    expect(stack!.id).toBe(2);
    expect(stack!.count).toBe(3);
    expect(stack!.members).toEqual([2, 1, 3]);
    // drawn where the strongest stands
    expect(stack!.x).toBeCloseTo(pieces[1]!.x, 9);
    expect(stack!.z).toBeCloseTo(pieces[1]!.z, 9);
  });

  it('never merges pieces of different owners', () => {
    const pieces = [standing(1, 3, 3, 0), standing(2, 4, 3, 1), standing(3, 3, 4, 0), standing(4, 4, 4, 1)];
    const markers = stackPieces(pieces, PIECE_RADIUS * 3);
    expect(markers).toHaveLength(2);
    for (const marker of markers) {
      expect(marker.count).toBe(2);
      for (const id of marker.members) expect(pieces.find((p) => p.id === id)!.polity).toBe(marker.polity);
    }
  });

  it('puts every piece into exactly one stack, and keeps the stacks of one owner apart', () => {
    const pieces: Standing[] = [];
    let id = 0;
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 12; col++) {
        if ((col * 7 + row * 13) % 3 === 0) continue;
        pieces.push(standing(id++, col, row, (col + row) % 2, (col * 31 + row * 17) % 11));
      }
    }
    for (const scale of [1, 1.9, 3.3, 6.9]) {
      const radius = PIECE_RADIUS * scale;
      const markers = stackPieces(pieces, radius);
      const seen = markers.flatMap((marker) => marker.members);
      expect(seen.slice().sort((a, b) => a - b)).toEqual(pieces.map((p) => p.id));
      for (const marker of markers) {
        expect(marker.members[0]).toBe(marker.id);
        expect(marker.count).toBe(marker.members.length);
        // the drawn piece is the strongest of its stack
        const strengths = marker.members.map((member) => pieces.find((p) => p.id === member)!.strength);
        expect(Math.max(...strengths)).toBe(strengths[0]);
      }
      for (const a of markers) {
        for (const b of markers) {
          if (a.id >= b.id || a.polity !== b.polity) continue;
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(2 * radius * 0.9 - 1e-9);
        }
      }
      if (scale === 1) expect(markers).toHaveLength(pieces.length);
      if (scale > 3) expect(markers.length).toBeLessThan(pieces.length / 2);
    }
  });

  it('gives the same stacks whatever the order of the pieces', () => {
    const pieces = [standing(1, 3, 3, 0, 5), standing(2, 4, 3, 0, 9), standing(3, 6, 3, 0, 9), standing(4, 7, 3, 0, 2)];
    const forward = stackPieces(pieces, PIECE_RADIUS * 2);
    const backward = stackPieces(pieces.slice().reverse(), PIECE_RADIUS * 2);
    expect(backward).toEqual(forward);
  });

  it('shows the count with at most two digits', () => {
    expect(stackCountText(1)).toBe('1');
    expect(stackCountText(12)).toBe('12');
    expect(stackCountText(250)).toBe('99');
  });

  it('ranks pieces by the strength it is given, or by era, uniqueness and health', () => {
    expect(pieceStrength({ era: 0, unique: false, hp: 1, strength: 40 })).toBe(40);
    expect(pieceStrength({ era: 3, unique: false, hp: 0.2 })).toBeGreaterThan(pieceStrength({ era: 2, unique: true, hp: 1 }));
    expect(pieceStrength({ era: 2, unique: true, hp: 0.5 })).toBeGreaterThan(pieceStrength({ era: 2, unique: false, hp: 1 }));
    expect(pieceStrength({ era: 2, unique: false, hp: 1 })).toBeGreaterThan(pieceStrength({ era: 2, unique: false, hp: 0.5 }));
  });
});

describe('spreadMarkers', () => {
  it('does nothing to pieces at their size on the board', () => {
    const pieces = [standing(1, 3, 3, 0), standing(2, 4, 3, 1), standing(3, 3, 4, 2)];
    const markers = stackPieces(pieces, PIECE_RADIUS);
    expect(spreadMarkers(markers, PIECE_RADIUS)).toEqual(markers);
  });

  it('moves enemies on neighbouring hexes apart until neither covers the other’s character', () => {
    for (const scale of [2.5, 3.3, 6.9]) {
      const radius = PIECE_RADIUS * scale;
      const markers = stackPieces([standing(1, 3, 3, 0), standing(2, 4, 3, 1)], radius);
      expect(markers).toHaveLength(2);
      const spread = spreadMarkers(markers, radius);
      const [a, b] = spread;
      const gap = Math.hypot(a!.x - b!.x, a!.z - b!.z);
      // the character sits within 0.65 of the radius around the middle
      expect(gap).toBeGreaterThanOrEqual(radius * 1.65);
      spread.forEach((marker, i) => {
        expect(marker.id).toBe(markers[i]!.id);
        expect(Math.hypot(marker.x - markers[i]!.x, marker.z - markers[i]!.z)).toBeLessThanOrEqual(radius * 0.95 + 1e-9);
      });
    }
  });
});

describe('the garrison’s place', () => {
  it('is inside the city’s hex, wherever the hex is', () => {
    for (const hex of [{ col: 0, row: 0 }, { col: 5, row: 3 }, { col: 2, row: 8 }]) {
      const centre = hexToWorld(hex, LAYOUT);
      expect(worldToHex({ x: centre.x, z: centre.z + GARRISON_OFFSET }, LAYOUT)).toEqual(hex);
    }
    expect(GARRISON_OFFSET).toBeGreaterThan(0.3);
    // and clear of the pieces on the two hexes south of it
    const south = Math.hypot(Math.sqrt(3) / 2, 1.5 - GARRISON_OFFSET);
    expect(south).toBeGreaterThan(PIECE_RADIUS * (1 + GARRISON_SCALE));
    // the whole piece is on the hex: its far edge is short of the corner
    expect(GARRISON_OFFSET + PIECE_RADIUS * GARRISON_SCALE).toBeLessThan(1);
  });
});
