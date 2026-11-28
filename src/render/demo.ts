/**
 * The render demo (`/?demo=render`): sample pieces and cities placed from
 * the map's own data, a gallery of cities of every family and era with
 * improvements, roads and routes (`demoGallery.ts`), a frame-time readout,
 * and buttons that play every animation, switch the quality tier and each
 * effect of the finish, turn the fog of war on, and jump between the views.
 */

import { indexToOffset, hexNeighbors } from '../shared/hex.ts';
import { t } from '../shared/i18n.ts';
import type { TranslationKey } from '../shared/i18n.ts';
import { Terrain, isWaterTerrain } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import { createDemoGallery } from './demoGallery.ts';
import { FogState, POST_EFFECTS, PieceEra, QUALITY_TIERS, familyOfPolity } from './scene.ts';
import type { PieceEraId, Renderer, RenderCity, RenderScene, RenderUnit, VisualEvent } from './scene.ts';

const DEMO_UNITS = 60;
const DEMO_CITIES = 6;

/** Sample class characters per era: two land classes, then the naval one. */
const CHARACTERS: readonly (readonly [era: PieceEraId, characters: string])[] = [
  [PieceEra.Ancient, '兵弓舟'],
  [PieceEra.Classical, '戟弩船'],
  [PieceEra.Medieval, '士炮船'],
  [PieceEra.EarlyModern, '铳骑舰'],
  [PieceEra.Industrial, '枪炮舰'],
  [PieceEra.Modern, '步坦舰'],
];
const UNIQUE_CHARACTERS = '象弩';

function hash(value: number): number {
  let h = Math.imul(value + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** `count` entries of `items`, evenly spread over the list. */
function spread<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(items[Math.floor(((i + 0.5) * items.length) / count)] as T);
  return out;
}

/** About 60 pieces of several polities and eras and a few cities, on any map. */
export function createDemoScene(map: MapData): RenderScene {
  const cities: RenderCity[] = spread(
    map.zones.filter((zone) => map.polities[zone.polity]?.kind !== 'wastelandRegion'),
    DEMO_CITIES,
  ).map((zone, i) => ({
    hex: zone.siteHex,
    polity: zone.polity,
    population: zone.capital ? 9 + (i % 3) * 4 : 2 + (i % 4) * 2,
    name: zone.cityNameZh,
    family: familyOfPolity(map.polities[zone.polity]?.id ?? ''),
  }));
  const cityHexes = new Set(cities.map((city) => city.hex));

  // owned land for armies, coast next to owned land for fleets
  const land: number[] = [];
  const coast: { hex: number; polity: number }[] = [];
  for (let i = 0; i < map.width * map.height; i++) {
    const terrain = map.terrain[i] as number;
    if ((map.owner[i] as number) >= 0 && terrain !== Terrain.Mountain && !cityHexes.has(i)) {
      land.push(i);
    } else if (terrain === Terrain.Coast) {
      for (const n of hexNeighbors(indexToOffset(i, map.width))) {
        if (n.col < 0 || n.col >= map.width || n.row < 0 || n.row >= map.height) continue;
        const owner = map.owner[n.row * map.width + n.col] as number;
        if (owner >= 0) {
          coast.push({ hex: i, polity: owner });
          break;
        }
      }
    }
  }
  const fleets = spread(coast, Math.min(8, Math.floor(DEMO_UNITS / 7)));
  const armies = spread(land, DEMO_UNITS - fleets.length);

  const units: RenderUnit[] = [];
  const add = (hex: number, polity: number, naval: boolean): void => {
    const id = units.length;
    const h = hash(hex);
    const [era, characters] = CHARACTERS[h % CHARACTERS.length] as (typeof CHARACTERS)[number];
    const unique = !naval && h % 9 === 0;
    // per era: two land classes, then the naval one
    const [first, second, ship] = [...characters] as [string, string, string];
    const uniques = [...UNIQUE_CHARACTERS];
    const pick = h >>> 8;
    const character = naval
      ? ship
      : unique
        ? (uniques[pick % uniques.length] as string)
        : pick % 2 === 0
          ? first
          : second;
    const hp = id % 5 === 0 ? 0.25 + ((h >>> 4) % 60) / 100 : 1;
    units.push({ id, hex, polity, character, unique, era, hp });
  };
  for (const hex of armies) add(hex, map.owner[hex] as number, false);
  for (const fleet of fleets) add(fleet.hex, fleet.polity, true);

  return { units, cities, ownerOverrides: new Map(), fog: null };
}

/** Shows the frame time in a corner of the page. Returns a function that removes it. */
export function attachFrameReadout(renderer: Renderer): () => void {
  const readout = document.createElement('output');
  readout.id = 'frame-time';
  Object.assign(readout.style, {
    position: 'fixed',
    right: '12px',
    top: '12px',
    padding: '4px 8px',
    borderRadius: '6px',
    background: 'rgb(16 21 28 / 75%)',
    color: '#e8e4da',
    font: '12px/1.4 ui-monospace, Menlo, Consolas, monospace',
    pointerEvents: 'none',
  });
  const details = document.createElement('output');
  details.id = 'render-stats';
  Object.assign(details.style, {
    position: 'fixed',
    right: '12px',
    top: '40px',
    padding: '4px 8px',
    borderRadius: '6px',
    background: 'rgb(16 21 28 / 75%)',
    color: '#e8e4da',
    font: '12px/1.4 ui-monospace, Menlo, Consolas, monospace',
    pointerEvents: 'none',
  });
  document.body.append(readout, details);
  let shown = 0;
  const stop = renderer.onFrame((stats) => {
    // a few updates per second are enough to read
    if (stats.frames - shown < 15 && shown !== 0) return;
    shown = stats.frames;
    readout.textContent = `${stats.frameMs.toFixed(1)} ms`;
    details.textContent = `${t('demo.stats', {
      scale: stats.renderScale.toFixed(2),
      draws: stats.drawCalls,
      triangles: stats.triangles,
      labels: stats.labels,
    })} · ${t('demo.stats.more', { trees: stats.trees, shadows: stats.shadowDraws })} · ${t('demo.stats.board', {
      scale: stats.pieceScale.toFixed(2),
      markers: stats.pieceMarkers,
      stacks: stats.pieceStacks,
      cities: stats.cityMarkers.toFixed(2),
    })}`;
  });
  return () => {
    stop();
    readout.remove();
    details.remove();
  };
}

/** The actors of the animation buttons: an attacker, a defender next to it, a path and a city. */
export interface DemoStage {
  /** Hex and polity of the city whose zone is captured and which strikes. */
  readonly city: { readonly hex: number; readonly polity: number };
  /** Every hex of the city's zone. */
  readonly zoneHexes: readonly number[];
  readonly attacker: RenderUnit;
  readonly defender: RenderUnit;
  /** Where the attacker walks: from its hex, four hexes in all. */
  readonly path: readonly number[];
  /** Hexes around the attacker, for the reachable area. */
  readonly reachable: readonly number[];
}

const ATTACKER_ID = 9001;
const DEFENDER_ID = 9002;
const FIRST_GARRISON_ID = 9100;

/**
 * Finds room for the actors next to one of the scene's cities. `null` on a
 * map without a city that has open land around it.
 */
export function createDemoStage(map: MapData, scene: RenderScene): DemoStage | null {
  const count = map.width * map.height;
  const cityHexes = new Set(scene.cities.map((city) => city.hex));
  const open = (hex: number): boolean => {
    const terrain = map.terrain[hex] as number;
    return !isWaterTerrain(terrain) && terrain !== Terrain.Mountain && !cityHexes.has(hex);
  };
  const neighborsOf = (hex: number): number[] =>
    hexNeighbors(indexToOffset(hex, map.width))
      .filter((n) => n.col >= 0 && n.col < map.width && n.row >= 0 && n.row < map.height)
      .map((n) => n.row * map.width + n.col);

  for (const city of scene.cities) {
    // open land around the city, nearest first
    const order: number[] = [];
    const seen = new Set([city.hex]);
    let frontier = [city.hex];
    for (let ring = 0; ring < 4 && frontier.length > 0; ring++) {
      const next: number[] = [];
      for (const hex of frontier) {
        for (const n of neighborsOf(hex)) {
          if (seen.has(n) || !open(n)) continue;
          seen.add(n);
          order.push(n);
          next.push(n);
        }
      }
      frontier = next;
    }
    for (const start of order) {
      const defenderHex = neighborsOf(start).find((n) => open(n));
      if (defenderHex === undefined) continue;
      // a walk of three steps that never turns back
      const path = [start];
      while (path.length < 4) {
        const here = path[path.length - 1] as number;
        const step = neighborsOf(here).find((n) => open(n) && n !== defenderHex && !path.includes(n));
        if (step === undefined) break;
        path.push(step);
      }
      if (path.length < 4) continue;

      const zone = map.zone[city.hex] as number;
      const zoneHexes: number[] = [];
      for (let i = 0; i < count; i++) if (map.zone[i] === zone) zoneHexes.push(i);
      const rival = map.polities.findIndex((polity, i) => i !== city.polity && polity.kind === 'nation');
      const reachable = new Set<number>([start]);
      let edge = [start];
      for (let ring = 0; ring < 3; ring++) {
        const next: number[] = [];
        for (const hex of edge) {
          for (const n of neighborsOf(hex)) {
            if (reachable.has(n) || !open(n)) continue;
            reachable.add(n);
            next.push(n);
          }
        }
        edge = next;
      }
      return {
        city: { hex: city.hex, polity: city.polity },
        zoneHexes,
        attacker: {
          id: ATTACKER_ID,
          hex: start,
          polity: rival < 0 ? city.polity : rival,
          character: '骑',
          unique: false,
          era: PieceEra.Medieval,
          hp: 1,
        },
        defender: {
          id: DEFENDER_ID,
          hex: defenderHex,
          polity: city.polity,
          character: '戟',
          unique: false,
          era: PieceEra.Classical,
          hp: 0.6,
        },
        path,
        reachable: [...reachable],
      };
    }
  }
  return null;
}

/**
 * Adds the demo's buttons to the page: one per animation, the quality tiers
 * and the three views. For automated checks the element carries
 * `data-played`, the number of animations that have finished,
 * `data-stage-hex`, the hex the animations start on, `data-stage`, the
 * actors as JSON (the unit ids of attacker and defender, the defender's hex
 * and the attacker's path), `data-gallery`, what the gallery holds, as
 * JSON (with the garrisons that stand before every other of its cities),
 * `data-effects`, the effects that run, as JSON, and `data-fog`.
 *
 * @returns a function that removes the buttons.
 */
export function attachDemoControls(renderer: Renderer, map: MapData, scene: RenderScene): () => void {
  const stage = createDemoStage(map, scene);
  const panel = document.createElement('div');
  panel.id = 'demo-controls';
  panel.dataset.played = '0';
  if (stage !== null) {
    panel.dataset.stageHex = String(stage.attacker.hex);
    panel.dataset.stage = JSON.stringify({
      attacker: stage.attacker.id,
      defender: stage.defender.id,
      defenderHex: stage.defender.hex,
      path: stage.path,
    });
  }
  Object.assign(panel.style, {
    position: 'fixed',
    left: '12px',
    bottom: '12px',
    display: 'grid',
    gap: '6px',
    padding: '8px',
    borderRadius: '8px',
    background: 'rgb(16 21 28 / 75%)',
    font: '13px/1.2 system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
  });
  const row = (): HTMLDivElement => {
    const element = document.createElement('div');
    Object.assign(element.style, { display: 'flex', gap: '6px', flexWrap: 'wrap' });
    panel.append(element);
    return element;
  };
  const button = (parent: HTMLElement, id: string, label: TranslationKey, onClick: () => void): HTMLButtonElement => {
    const element = document.createElement('button');
    element.type = 'button';
    element.id = id;
    element.textContent = t(label);
    Object.assign(element.style, {
      padding: '5px 10px',
      border: '1px solid rgb(232 228 218 / 30%)',
      borderRadius: '6px',
      background: 'transparent',
      color: '#e8e4da',
      font: 'inherit',
      cursor: 'pointer',
    });
    element.addEventListener('click', onClick);
    parent.append(element);
    return element;
  };

  // the gallery: cities of every family and era, pieces of every material,
  // improvements, roads and routes, laid out around the stage
  const taken = new Set<number>([...scene.cities.map((city) => city.hex), ...scene.units.map((unit) => unit.hex)]);
  if (stage !== null) {
    for (const hex of [stage.attacker.hex, stage.defender.hex, ...stage.path, ...stage.reachable]) taken.add(hex);
  }
  const gallery = createDemoGallery(
    map,
    taken,
    (family, era) => t('demo.city', { family: t(`demo.family.${family}`), era: era + 1 }),
    stage?.attacker.hex ?? scene.cities[0]?.hex ?? 0,
  );
  // a garrison before the gate of every other city of the gallery, in the city's era
  const garrisons: RenderUnit[] = gallery.cities
    .filter((_, i) => i % 2 === 0)
    .map((city, i) => ({
      id: FIRST_GARRISON_ID + i,
      hex: city.hex,
      polity: city.polity,
      character: i % 3 === 0 ? '象' : '戍',
      unique: i % 3 === 0,
      era: city.era ?? PieceEra.Ancient,
      hp: 1,
    }));
  panel.dataset.gallery = JSON.stringify({
    cities: gallery.cities.length,
    firstCity: gallery.cities[0]?.hex ?? null,
    garrisons: garrisons.length,
    garrisonedCity: garrisons[0]?.hex ?? null,
    units: gallery.units.length,
    improvements: gallery.improvements.size,
    roads: gallery.roads.size,
    routes: gallery.routes.length,
  });

  // the board as the demo last set it
  let units = stage === null ? [...scene.units, ...gallery.units, ...garrisons] : [
    ...scene.units.filter((unit) => unit.hex !== stage.attacker.hex && unit.hex !== stage.defender.hex && !stage.path.includes(unit.hex)),
    ...gallery.units,
    ...garrisons,
    stage.attacker,
    stage.defender,
  ];
  let overrides = new Map(scene.ownerOverrides);
  let fog: Uint8Array | null = null;
  const show = (): void => {
    renderer.setScene({
      ...scene,
      units,
      cities: [...scene.cities, ...gallery.cities],
      ownerOverrides: overrides,
      fog,
      improvements: gallery.improvements,
      roads: gallery.roads,
      routes: gallery.routes,
    });
  };
  show();

  if (stage !== null) {
    const attackerHex = (): number => units.find((unit) => unit.id === ATTACKER_ID)?.hex ?? stage.attacker.hex;
    const ensureDefender = (): void => {
      if (units.some((unit) => unit.id === DEFENDER_ID)) return;
      units = [...units, stage.defender];
      show();
    };
    /** Plays events, then shows the board as it is after them. */
    const play = (events: readonly VisualEvent[], after: () => void = () => {}): void => {
      void renderer.play(events).then(() => {
        after();
        show();
        panel.dataset.played = String(Number(panel.dataset.played) + 1);
      });
    };
    const animations = row();
    button(animations, 'demo-move', 'demo.move', () => {
      const from = attackerHex();
      const path = from === stage.path[0] ? stage.path : [...stage.path].reverse();
      const to = path[path.length - 1] as number;
      play([{ type: 'move', unit: ATTACKER_ID, path }], () => {
        units = units.map((unit) => (unit.id === ATTACKER_ID ? { ...unit, hex: to } : unit));
      });
    });
    for (const type of ['melee', 'ranged', 'siege'] as const) {
      button(animations, `demo-${type}`, `demo.${type}`, () => {
        ensureDefender();
        play([{ type, unit: ATTACKER_ID, targetHex: stage.defender.hex }]);
      });
    }
    button(animations, 'demo-city-strike', 'demo.cityStrike', () => {
      play([{ type: 'cityStrike', cityHex: stage.city.hex, targetHex: attackerHex() }]);
    });
    button(animations, 'demo-destroy', 'demo.destroy', () => {
      ensureDefender();
      play([{ type: 'destroy', unit: DEFENDER_ID }], () => {
        units = units.filter((unit) => unit.id !== DEFENDER_ID);
      });
    });
    button(animations, 'demo-promote', 'demo.promote', () => {
      play([{ type: 'promote', unit: ATTACKER_ID }]);
    });
    button(animations, 'demo-capture', 'demo.capture', () => {
      // back and forth between the city's owner and the attacker's
      const captured = overrides.size > 0;
      const polity = captured ? stage.city.polity : stage.attacker.polity;
      play([{ type: 'capture', cityHex: stage.city.hex, hexes: stage.zoneHexes, polity }], () => {
        overrides = new Map(captured ? [] : stage.zoneHexes.map((hex) => [hex, polity]));
      });
    });
    let aids = false;
    button(animations, 'demo-aids', 'demo.aids', () => {
      aids = !aids;
      renderer.setSelectionAids(
        aids
          ? {
              reachable: stage.reachable,
              path: { hexes: stage.path, turnEnds: [1, 3] },
              attackTarget: stage.defender.hex,
            }
          : null,
      );
    });
  }

  const views = row();
  const limits = (): { min: number; max: number } => {
    // the camera clamps what it is given: ask it for its own limits
    const now = renderer.getCamera();
    renderer.setCamera({ distance: 0 }, true);
    const min = renderer.getCamera().distance;
    renderer.setCamera({ distance: Infinity }, true);
    const max = renderer.getCamera().distance;
    renderer.setCamera(now, true);
    return { min, max };
  };
  const focus = stage?.attacker.hex ?? scene.cities[0]?.hex;
  const view = (distance: number): void => {
    if (focus === undefined) renderer.setCamera({ distance });
    else renderer.focusHex(focus, { distance });
  };
  button(views, 'demo-zoom-near', 'demo.zoom.near', () => {
    view(limits().min * 2.6);
  });
  button(views, 'demo-zoom-middle', 'demo.zoom.middle', () => {
    const { min, max } = limits();
    view(Math.sqrt(min * max));
  });
  button(views, 'demo-zoom-political', 'demo.zoom.political', () => {
    renderer.setCamera({ distance: limits().max });
  });
  let names: 'zh' | 'en' = 'zh';
  button(views, 'demo-names', 'demo.names', () => {
    names = names === 'zh' ? 'en' : 'zh';
    renderer.setLanguage(names);
  });

  const galleryCity = gallery.cities[0];
  if (galleryCity !== undefined) {
    button(views, 'demo-gallery', 'demo.gallery', () => {
      renderer.focusHex(galleryCity.hex, { distance: limits().min * 3.2 });
    });
  }
  button(views, 'demo-fog', 'demo.fog', () => {
    // the western half of the map out of view: remembered, with a strip never seen
    if (fog === null) {
      fog = new Uint8Array(map.width * map.height).fill(FogState.Visible);
      for (let hex = 0; hex < fog.length; hex++) {
        const col = hex % map.width;
        if (col < map.width / 2) fog[hex] = col < map.width / 6 ? FogState.Unseen : FogState.Remembered;
      }
    } else {
      fog = null;
    }
    panel.dataset.fog = fog === null ? 'off' : 'on';
    show();
  });
  panel.dataset.fog = 'off';

  const tiers = row();
  const tierButtons = QUALITY_TIERS.map((tier) =>
    button(tiers, `demo-quality-${tier}`, `demo.quality.${tier}`, () => {
      renderer.setQuality(tier);
      mark();
    }),
  );
  // one switch per effect of the finish; a lit button is an effect that runs
  const effects = row();
  const effectButtons = POST_EFFECTS.map((effect) =>
    button(effects, `demo-fx-${effect}`, `demo.fx.${effect}`, () => {
      renderer.setEffects({ [effect]: !renderer.getEffects()[effect] });
      mark();
    }),
  );
  const mark = (): void => {
    tierButtons.forEach((element, i) => {
      element.style.background = QUALITY_TIERS[i] === renderer.quality ? '#b3382a' : 'transparent';
    });
    const running = renderer.getEffects();
    effectButtons.forEach((element, i) => {
      element.style.background = running[POST_EFFECTS[i] as (typeof POST_EFFECTS)[number]] ? '#2f6f5e' : 'transparent';
    });
    panel.dataset.effects = JSON.stringify(running);
  };
  mark();

  document.body.append(panel);
  return () => {
    panel.remove();
  };
}
