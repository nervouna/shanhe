import { describe, expect, it } from 'vitest';
import { cameraLimits, zoomFraction } from './cameraRig.ts';
import { mapWorldRect } from './heightField.ts';
import {
  CLOUD_LAYER_EDGES,
  CLOUD_SHADOW_EDGES,
  cloudCoverage,
  cloudDensity,
  cloudLayerOpacity,
  cloudLayerShare,
  cloudShadowEdges,
} from './lightMath.ts';
import { buildNoiseTile } from './noiseTile.ts';
import { loadRealMap } from './realMapForTests.ts';

const NOISE_SIZE = 256;

describe('the cloud layer', () => {
  const tile = buildNoiseTile(NOISE_SIZE);

  it('covers at most about a sixth of the land, whatever the distance', () => {
    const covered = cloudCoverage(tile, NOISE_SIZE);
    expect(covered).toBeGreaterThan(0.08);
    expect(covered).toBeLessThanOrEqual(0.18);
    // the broad shadows near the ground lie over far more of it
    expect(cloudCoverage(tile, NOISE_SIZE, CLOUD_SHADOW_EDGES)).toBeGreaterThan(0.5);
  });

  it('is cut the same way at distances 60, 90 and 130 on the real map, where it is in view', async () => {
    const { map } = await loadRealMap();
    const limits = cameraLimits(mapWorldRect(map), map.projection.hexLayout.size);
    for (const distance of [60, 90, 130]) {
      const zoom = zoomFraction(distance, limits);
      // in view, and never opaque: the ground shows through the thickest cloud
      expect(cloudLayerOpacity(zoom), `distance ${distance}`).toBeGreaterThan(0.1);
      expect(cloudLayerOpacity(zoom)).toBeLessThanOrEqual(0.5);
      // the shadows on the ground have closed in on the clouds that are seen
      const edges = cloudShadowEdges(zoom);
      expect(edges[0]).toBeGreaterThan(CLOUD_SHADOW_EDGES[0]);
      expect(edges[0]).toBeLessThanOrEqual(CLOUD_LAYER_EDGES[0]);
      expect(cloudCoverage(tile, NOISE_SIZE, edges)).toBeLessThan(cloudCoverage(tile, NOISE_SIZE, CLOUD_SHADOW_EDGES));
    }
    // by distance 130 every shadow lies under a cloud of the layer
    expect(cloudShadowEdges(zoomFraction(130, limits))[0]).toBeCloseTo(CLOUD_LAYER_EDGES[0], 2);
    // close to the ground there is no layer, only the broad shadows
    expect(cloudLayerOpacity(zoomFraction(14, limits))).toBe(0);
    expect(cloudShadowEdges(zoomFraction(14, limits))).toEqual(CLOUD_SHADOW_EDGES);
  });

  it('thickens between its edges', () => {
    expect(cloudDensity(CLOUD_LAYER_EDGES[0], CLOUD_LAYER_EDGES)).toBe(0);
    expect(cloudDensity(CLOUD_LAYER_EDGES[1], CLOUD_LAYER_EDGES)).toBe(1);
    expect(cloudDensity(0.2, CLOUD_LAYER_EDGES)).toBe(0);
    const middle = cloudDensity((CLOUD_LAYER_EDGES[0] + CLOUD_LAYER_EDGES[1]) / 2, CLOUD_LAYER_EDGES);
    expect(middle).toBeCloseTo(0.5, 6);
    expect(cloudLayerShare(0)).toBe(0);
    expect(cloudLayerShare(1)).toBe(1);
  });
});
