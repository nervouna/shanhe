import { describe, expect, it } from 'vitest';
import { createGame, endTurn, hashState } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { apply, around, edit, isPlainGround, put } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { createHost, createInlineRunner } from './host.ts';
import type { HostChange } from './host.ts';
import { findPath } from './path.ts';
import { sightOf } from './sight.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const capitalZone = map.polities[JIA]!.capitalZone;
const jiaCapital = map.zones[capitalZone]!.siteHex;
const jiaSouth = map.zones.find((zone) => zone.id === 'jia-3')!.siteHex;

/** A host playing Jia with one extra unit next to the capital. */
function hostWith(type: string, change?: (state: GameState) => GameState) {
  const host = createHost(map, createInlineRunner());
  const hex = around(map, jiaCapital).find((candidate) => isPlainGround(map, candidate))!;
  let id = 0;
  let state = edit(createGame(map, { player: 'jia', seed: 2 }), (draft) => {
    id = put(draft, type, JIA, hex).id;
  });
  if (change !== undefined) state = change(state);
  host.resume(state);
  return { host, id, hex };
}

describe('createHost', () => {
  it('shows a backdrop until a game starts, and refuses to play it', async () => {
    const host = createHost(map, createInlineRunner());
    expect(host.playing).toBe(false);
    expect(host.state.turn).toBe(1);
    expect(host.pending()).toEqual([]);
    expect(await host.endTurn()).toBe(false);
    expect(host.act({ type: 'declareWar', polity: 0, target: 1 }).ok).toBe(false);
    host.start({ player: 'jia', seed: 4 });
    expect(host.playing).toBe(true);
    expect(host.state.player).toBe(JIA);
    expect(host.pending()).toEqual([{ kind: 'city', city: capitalZone, hex: jiaCapital }, { kind: 'research' }]);
  });

  it('applies the player\'s actions and reports rejections without changing the state', () => {
    const host = createHost(map, createInlineRunner());
    host.start({ player: 'jia' });
    const changes: HostChange[] = [];
    host.subscribe((change) => changes.push(change));
    const before = host.state;
    const bad = host.act({ type: 'makePeace', polity: JIA, target: YI });
    expect(bad).toMatchObject({ ok: false, reason: 'notAtWar' });
    expect(host.state).toBe(before);
    expect(changes).toEqual([]);

    const good = host.act({ type: 'queueBuild', polity: JIA, city: capitalZone, item: { kind: 'unit', unit: 'warrior' } });
    expect(good.ok).toBe(true);
    expect(host.state.cities[capitalZone]!.queue).toHaveLength(1);
    expect(before.cities[capitalZone]!.queue).toHaveLength(0);
    expect(changes.map((change) => change.kind)).toEqual(['action']);
    expect(host.pending()).toEqual([{ kind: 'research' }]);
  });

  it('ends a turn through the runner exactly as the rules do', async () => {
    const host = createHost(map, createInlineRunner());
    host.start({ player: 'jia', seed: 9 });
    const expected = endTurn(host.state).state;
    const kinds: string[] = [];
    host.subscribe((change) => kinds.push(change.kind));
    expect(await host.endTurn()).toBe(true);
    expect(hashState(host.state)).toBe(hashState(expected));
    expect(host.state.turn).toBe(2);
    expect(host.busy).toBe(false);
    expect(kinds).toEqual(['busy', 'turn', 'busy']);
  });

  it('carries a move order over several turns until the unit arrives', async () => {
    const { host, id } = hostWith('warrior');
    const plan = findPath(host.state, id, jiaSouth)!;
    expect(plan.total).toBeGreaterThan(1);
    const result = host.order(id, jiaSouth);
    if (!result.ok) throw new Error(result.reason);
    // this turn's part is done at once
    const thisTurn = plan.hexes.filter((_, i) => plan.turns[i] === 1);
    expect(host.state.units.find((unit) => unit.id === id)!.hex).toBe(thisTurn.at(-1));
    expect(result.events.filter((event) => event.type === 'unitMoved')).toHaveLength(thisTurn.length);
    expect(host.orders.get(id)).toEqual({ target: jiaSouth, within: 0 });
    // a travelling unit asks for nothing
    expect(host.pending().some((item) => item.kind === 'unit' && item.unit === id)).toBe(false);

    for (let turn = 1; turn < plan.total; turn++) expect(await host.endTurn()).toBe(true);
    expect(host.state.units.find((unit) => unit.id === id)!.hex).toBe(jiaSouth);
    expect(host.orders.has(id)).toBe(false);
  });

  it('drops a move order when the player gives the unit something else to do', () => {
    const { host, id } = hostWith('warrior');
    expect(host.order(id, jiaSouth).ok).toBe(true);
    expect(host.orders.has(id)).toBe(true);
    expect(host.act({ type: 'sleep', polity: JIA, unit: id }).ok).toBe(true);
    expect(host.orders.has(id)).toBe(false);
  });

  it('refuses an order to a place the unit cannot reach, or for a unit that is not the player\'s', () => {
    const { host, id } = hostWith('warrior');
    const yiCapital = map.zones[map.polities[YI]!.capitalZone]!.siteHex;
    expect(host.order(id, yiCapital)).toEqual({ ok: false, reason: 'noPath' });
    expect(host.orders.has(id)).toBe(false);
    const foreign = host.state.units.find((unit) => unit.owner === YI)!;
    expect(host.order(foreign.id, jiaSouth)).toEqual({ ok: false, reason: 'notYourUnit' });
    expect(host.order(424242, jiaSouth)).toEqual({ ok: false, reason: 'noSuchUnit' });
  });

  it('turns an order onto an enemy into an attack, walking up to it first', () => {
    let enemy = 0;
    let enemyHex = -1;
    const { host, id, hex } = hostWith('warrior', (state) => {
      const next = edit(state, (draft) => {
        enemyHex = topo.zoneHexes[capitalZone]!.find(
          (candidate) =>
            isPlainGround(map, candidate) &&
            !draft.units.some((unit) => unit.hex === candidate) &&
            findPath(draft, draft.units.at(-1)!.id, candidate, 1)?.hexes.length === 1 &&
            findPath(draft, draft.units.at(-1)!.id, candidate, 1)?.total === 1 &&
            around(map, candidate).every((n) => n !== draft.units.at(-1)!.hex),
        )!;
        enemy = put(draft, 'warrior', YI, enemyHex).id;
      });
      return apply(next, { type: 'declareWar', polity: JIA, target: YI });
    });
    expect(enemyHex).toBeGreaterThanOrEqual(0);
    const result = host.order(id, enemyHex);
    if (!result.ok) throw new Error(result.reason);
    const types = result.events.map((event) => event.type);
    expect(types[0]).toBe('unitMoved');
    // one step on open ground leaves a warrior one point: enough to strike
    expect(types).toContain('combat');
    expect(host.state.units.find((unit) => unit.id === id)?.hex).not.toBe(hex);
    expect(host.orders.has(id)).toBe(false);
    void enemy;
  });

  it('treats a hex with an enemy the player does not see like an empty one', () => {
    let far = -1;
    const { host, id } = hostWith('warrior', (state) => {
      const visible = sightOf(state)!.visible;
      far = topo.zoneHexes[capitalZone]!.find(
        (candidate) =>
          visible[candidate] === 0 && isPlainGround(map, candidate) && findPath(state, state.units.at(-1)!.id, candidate) !== null,
      )!;
      return apply(state, { type: 'declareWar', polity: JIA, target: YI });
    });
    expect(far).toBeGreaterThanOrEqual(0);
    const empty = host.state;
    const asEmpty = host.order(id, far);
    // the same order with an enemy standing there, out of sight
    host.resume(edit(empty, (draft) => {
      put(draft, 'warrior', YI, far);
    }));
    expect(sightOf(host.state)!.visible[far]).toBe(0);
    const order = host.order(id, far);
    expect(order.ok).toBe(true);
    expect(order).toEqual(asEmpty);
    expect(order.ok && order.events.some((event) => event.type === 'combat')).toBe(false);
    // it is a walk onto the hex, not a walk up to a target
    expect(host.orders.get(id)).toEqual({ target: far, within: 0 });
  });

  it('skips a unit for the rest of the turn only', async () => {
    const { host, id } = hostWith('warrior');
    const asksFor = (): boolean => host.pending().some((item) => item.kind === 'unit' && item.unit === id);
    expect(asksFor()).toBe(true);
    host.skip(id);
    expect(asksFor()).toBe(false);
    await host.endTurn();
    expect(asksFor()).toBe(true);
  });

  it('plays an observer game to its result in one run', async () => {
    const host = createHost(map, createInlineRunner());
    host.start({ seed: 1 });
    let turns = 0;
    host.subscribe((change) => {
      if (change.kind === 'turn') {
        expect(change.burst).toBe(true);
        turns++;
      }
    });
    const report = await host.runTurns(500);
    expect(report.result).not.toBeNull();
    expect(report.result).toEqual(host.state.result);
    expect(report.turns).toBe(turns);
    expect(report.turns).toBeLessThan(500);
    expect(report.longestTurnMs).toBeGreaterThan(0);
    expect(report.ms).toBeGreaterThanOrEqual(report.longestTurnMs);
    expect(host.busy).toBe(false);
    // a finished game does not move any more
    expect((await host.runTurns(3)).turns).toBe(0);
    expect(await host.endTurn()).toBe(false);
  });

  it('stops asking about a policy card the player took out of its slot', () => {
    const host = createHost(map, createInlineRunner());
    host.resume(edit(createGame(map, { player: 'jia', seed: 2 }), (draft) => {
      const self = draft.polities[JIA]!;
      self.policies = ['wellField'];
      self.slots = ['wellField', null];
      self.research = 'farming';
      for (const city of draft.cities) if (city !== null && city.owner === JIA) city.queue = [{ kind: 'unit', unit: 'warrior' }];
      draft.units = draft.units.filter((unit) => unit.owner !== JIA);
    }));
    expect(host.pending()).toEqual([]);
    // both slots are empty afterwards, and the card waits for neither
    expect(host.act({ type: 'slotPolicy', polity: JIA, policy: null, slot: 0 }).ok).toBe(true);
    expect(host.state.polities[JIA]!.slots).toEqual([null, null]);
    expect(host.pending()).toEqual([]);
    // put back and taken out again, it still does not ask
    expect(host.act({ type: 'slotPolicy', polity: JIA, policy: 'wellField', slot: 1 }).ok).toBe(true);
    expect(host.pending()).toEqual([]);
    expect(host.act({ type: 'slotPolicy', polity: JIA, policy: null, slot: 1 }).ok).toBe(true);
    expect(host.pending()).toEqual([]);
    // another game starts with nothing emptied
    host.resume(host.state);
    expect(host.pending()).toEqual([{ kind: 'policy' }]);
  });

  it('runs turns for a player too, and forgets a game that is replaced while turns are running', async () => {
    const host = createHost(map, createInlineRunner());
    host.start({ player: 'jia', seed: 3 });
    const report = await host.runTurns(4);
    expect(report).toMatchObject({ turns: 4, turn: 5, result: null });

    const running = host.runTurns(50);
    host.start({ player: 'yi', seed: 8 });
    await running;
    expect(host.state.player).toBe(YI);
    expect(host.state.turn).toBe(1);
    expect(host.busy).toBe(false);
  });
});
