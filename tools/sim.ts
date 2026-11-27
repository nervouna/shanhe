/**
 * Headless run of the rules core on the fixture map: `npm run sim`.
 * Proves that the core works without a browser.
 */

import { advanceTurn, createGame } from '../src/core/game.ts';
import { createFixtureMap } from '../src/shared/fixtureMap.ts';

const TURNS = 10;

const map = createFixtureMap();
let state = createGame(map);
console.log(`map: ${map.width} x ${map.height} hexes`);
console.log(`polities: ${map.polities.length}`);
console.log(`zones: ${map.zones.length}`);
for (let i = 0; i < TURNS; i++) state = advanceTurn(state);
console.log(`advanced ${TURNS} turns, now at turn ${state.turn}`);
