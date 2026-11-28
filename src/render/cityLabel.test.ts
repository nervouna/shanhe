import { describe, expect, it } from 'vitest';
import { hexNeighbors, hexToWorld } from '../shared/hex.ts';
import { CAMERA_FOV, cameraLimits, cameraPose, screenPoint } from './cameraRig.ts';
import { cityFootprint } from './cityLayout.ts';
import {
  LABEL_SIDES,
  characterRect,
  discRect,
  labelRectAt,
  placeCityLabel,
  rectsOverlap,
  unionRect,
} from './labelLayout.ts';
import type { ProjectPoint, ScreenRect } from './labelLayout.ts';
import { GARRISON_OFFSET, pieceHeightScale, pieceZoomScale, spreadMarkers, stackPieces, steppedScale } from './pieceLayout.ts';
import type { Standing } from './pieceLayout.ts';
import { PIECE_HEIGHT, PIECE_RADIUS } from './pieceShape.ts';

describe('placeCityLabel', () => {
  const around: ScreenRect = { minX: 100, minY: 100, maxX: 160, maxY: 150 };

  it('puts the label below what it names when nothing is in the way', () => {
    const placed = placeCityLabel(around, 70, 24, []);
    expect(placed?.side).toBe('below');
    expect(placed?.rect.minY).toBeGreaterThanOrEqual(around.maxY);
    expect((placed!.rect.minX + placed!.rect.maxX) / 2).toBeCloseTo(130, 9);
    expect(rectsOverlap(placed!.rect, around)).toBe(false);
  });

  it('tries the sides in order and never returns a place that covers a character', () => {
    const below = labelRectAt(around, 70, 24, 'below', 3);
    const right = labelRectAt(around, 70, 24, 'right', 3);
    const left = labelRectAt(around, 70, 24, 'left', 3);
    const above = labelRectAt(around, 70, 24, 'above', 3);
    const inside = (r: ScreenRect): ScreenRect => ({ minX: r.minX + 5, minY: r.minY + 5, maxX: r.minX + 15, maxY: r.minY + 15 });
    expect(placeCityLabel(around, 70, 24, [inside(below)])?.side).toBe('right');
    expect(placeCityLabel(around, 70, 24, [inside(below), inside(right)])?.side).toBe('left');
    expect(placeCityLabel(around, 70, 24, [inside(below), inside(right), inside(left)])?.side).toBe('above');
    expect(placeCityLabel(around, 70, 24, [inside(below), inside(right), inside(left), inside(above)])).toBeNull();
    for (const side of LABEL_SIDES) expect(rectsOverlap(labelRectAt(around, 70, 24, side, 3), around)).toBe(false);
  });
});

describe('the label of a garrisoned city', () => {
  const layout = { size: 1, originX: 0, originZ: 0 };
  const limits = cameraLimits({ minX: -10, minZ: -10, maxX: 60, maxZ: 60 }, 1);
  const WIDTH = 1560;
  const HEIGHT = 880;
  const LABEL_HEIGHT = 24;
  const city = { col: 10, row: 10 };
  const centre = hexToWorld(city, layout);

  /** The label of the city for a view, the characters it had to avoid and the garrison's own. */
  function lay(distance: number, yaw: number, neighbours: boolean, labelWidth: number) {
    const pose = cameraPose({ x: centre.x + 0.4, z: centre.z - 0.3, distance, yaw }, limits, 0);
    const project: ProjectPoint = (x, y, z) => screenPoint(pose, CAMERA_FOV, WIDTH, HEIGHT, [x, y, z]);
    const pixelsPerUnit = HEIGHT / (2 * Math.tan((CAMERA_FOV * Math.PI) / 360));
    const zoom = steppedScale(pieceZoomScale(distance, HEIGHT, 1));
    const radius = PIECE_RADIUS * zoom;
    const top = PIECE_HEIGHT * pieceHeightScale(zoom);
    // the garrison before the gate, and a piece of another owner on each hex around
    const standing: Standing[] = [{ id: 0, polity: 0, x: centre.x, z: centre.z + GARRISON_OFFSET * zoom, strength: 1 }];
    if (neighbours) {
      hexNeighbors(city).forEach((hex, i) => {
        const p = hexToWorld(hex, layout);
        standing.push({ id: i + 1, polity: i + 1, x: p.x, z: p.z, strength: 1 });
      });
    }
    const markers =
      zoom > 1 ? spreadMarkers(stackPieces(standing, radius), radius) : standing.map((s) => ({ ...s, count: 1, members: [s.id] }));
    const tops = markers.map((marker) => ({ id: marker.id, x: marker.x, y: top, z: marker.z, radius }));
    const characters = tops.map((marker) => characterRect(project, pixelsPerUnit, marker)!);
    const footprint = cityFootprint(6);
    const cityRect = discRect(
      project,
      { x: centre.x, y: 0, z: centre.z + footprint.z, radius: footprint.halfWidth, radiusZ: footprint.halfDepth },
      0.3,
    )!;
    const garrison = tops.find((marker) => marker.id === 0)!;
    const around = unionRect(cityRect, discRect(project, garrison));
    return {
      placed: placeCityLabel(around, labelWidth, LABEL_HEIGHT, characters),
      characters,
      garrison: characters[tops.indexOf(garrison)]!,
      around,
    };
  }

  it('never lies on the character of the garrison or of any piece around, at any distance and turn of the view', () => {
    let placedCount = 0;
    for (const distance of [5, 10, 14, 20, 32, 45, 65, 90, 130, 200]) {
      for (const yaw of [0, 0.6, -1.3, Math.PI / 2, 2.5, Math.PI]) {
        for (const neighbours of [false, true]) {
          for (const labelWidth of [58, 74, 120]) {
            const { placed, characters, garrison } = lay(distance, yaw, neighbours, labelWidth);
            if (placed === null) continue;
            placedCount++;
            expect(rectsOverlap(placed.rect, garrison), `garrison at ${distance}, yaw ${yaw}`).toBe(false);
            for (const character of characters) expect(rectsOverlap(placed.rect, character)).toBe(false);
          }
        }
      }
    }
    expect(placedCount).toBeGreaterThan(200);
  });

  it('is shown below the city and its garrison when the city stands alone', () => {
    for (const distance of [10, 14, 32, 45, 90]) {
      const { placed, around, garrison } = lay(distance, 0, false, 74);
      expect(placed?.side).toBe('below');
      expect(placed!.rect.minY).toBeGreaterThanOrEqual(around.maxY);
      // the garrison's character is above the label, inside what the label names
      expect(garrison.maxY).toBeLessThan(placed!.rect.minY);
    }
  });

  it('finds a place among pieces on all six hexes around at the near distances', () => {
    for (const distance of [10, 14, 20]) {
      expect(lay(distance, 0, true, 74).placed, `distance ${distance}`).not.toBeNull();
    }
  });
});
