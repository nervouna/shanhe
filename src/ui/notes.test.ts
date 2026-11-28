import { afterEach, describe, expect, it } from 'vitest';
import { createGame } from '../core/game.ts';
import type { GameEvent, GameState } from '../core/game.ts';
import { edit, put, withCity } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { setLanguage } from '../shared/i18n.ts';
import { canPoint, keepNotes, noteDrafts, pendingDrafts } from './notes.ts';
import { exportSave, importSave } from './saves.ts';
import { sightOf } from './sight.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const BING = 2;
const site = (zone: number): number => map.zones[zone]!.siteHex;
const yiSeat = map.polities[YI]!.capitalZone;
const bingSeat = map.polities[BING]!.capitalZone;
const played = createGame(map, { seed: 1, player: 'jia' });
const watched = createGame(map, { seed: 1 });

const texts = (state: GameState, events: readonly GameEvent[]): string[] =>
  noteDrafts(state, events, sightOf(state)).map((draft) => draft.text());

afterEach(() => {
  setLanguage('zh');
});

describe('noteDrafts', () => {
  const fall: GameEvent = { type: 'cityCaptured', city: yiSeat, from: YI, to: BING };

  it('does not tell a player of a city that falls out of their sight between others', () => {
    expect(sightOf(played)!.visible[site(yiSeat)]).toBe(0);
    expect(noteDrafts(played, [fall], sightOf(played))).toEqual([]);
    // the observer is told
    expect(texts(watched, [fall])).toHaveLength(1);
  });

  it('tells a player of a city that falls where they can see it', () => {
    const scouting = edit(played, (draft) => {
      put(draft, 'warrior', JIA, topo.neighbors[site(yiSeat) * 6] as number);
    });
    expect(sightOf(scouting)!.visible[site(yiSeat)]).toBe(1);
    const drafts = noteDrafts(scouting, [fall], sightOf(scouting));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.hex).toBe(site(yiSeat));
    expect(drafts[0]!.text()).toContain(map.polities[BING]!.nameZh);
  });

  it('tells a player of the gold another nation gives them, one notification for each giver', () => {
    const events: GameEvent[] = [
      { type: 'goldGifted', from: YI, to: JIA, amount: 120 },
      { type: 'goldGifted', from: YI, to: BING, amount: 120 },
      { type: 'goldGifted', from: YI, to: JIA, amount: 120 },
      { type: 'goldGifted', from: BING, to: JIA, amount: 30 },
    ];
    const drafts = noteDrafts(played, events, sightOf(played));
    expect(drafts.map((draft) => draft.text())).toEqual(['乙国赠予甲国 240 金', '丙国赠予甲国 30 金']);
    expect(drafts[0]!.hex).toBe(site(yiSeat));
    setLanguage('en');
    expect(drafts[0]!.text()).toBe('Yi gave Jia 240 gold');
    // what others give each other, and what the player gives, is no news
    expect(texts(played, [{ type: 'goldGifted', from: JIA, to: YI, amount: 30 }])).toEqual([]);
    expect(texts(watched, events)).toEqual([]);
  });

  it('tells a player of what they are a party to, in sight or not', () => {
    const lost: GameEvent = { type: 'cityCaptured', city: map.polities[JIA]!.capitalZone, from: JIA, to: YI };
    const taken: GameEvent = { type: 'cityCaptured', city: yiSeat, from: YI, to: JIA };
    const war: GameEvent = { type: 'warDeclared', by: YI, on: JIA };
    expect(texts(played, [lost, taken, war])).toHaveLength(3);
  });

  it('keeps the wars, annexations and vassals of others from a player, and shows them to the observer', () => {
    const events: GameEvent[] = [
      { type: 'warDeclared', by: YI, on: BING },
      { type: 'peaceMade', a: YI, b: BING },
      { type: 'polityAnnexed', polity: BING, by: YI },
      { type: 'vassalized', vassal: BING, overlord: YI, forced: true } as GameEvent,
      { type: 'unitKilled', unit: 99, owner: YI, hex: site(yiSeat), unitType: 'warrior' },
    ];
    expect(noteDrafts(played, events, sightOf(played))).toEqual([]);
    expect(texts(watched, events)).toHaveLength(4);
  });

  it('drops the earlier peace offers of whoever a new event settles with', () => {
    const offered = noteDrafts(played, [{ type: 'peaceOffered', from: YI, to: JIA }], sightOf(played));
    expect(offered).toHaveLength(1);
    expect(offered[0]!.offer).toEqual({ kind: 'peace', from: YI });
    expect(offered[0]!.settles).toEqual([YI]);
    const made = noteDrafts(played, [{ type: 'peaceMade', a: JIA, b: YI }], sightOf(played));
    expect(made[0]!.settles).toEqual([JIA, YI]);
  });

  it('names a peace offer for what accepting it does', () => {
    const war = edit(played, (draft) => {
      draft.turn = 20;
      draft.relations[`${JIA}:${YI}`] = { a: JIA, b: YI, atWar: true, since: 5, offerA: 0, offerB: 19 };
      const free = topo.zoneHexes[map.polities[JIA]!.capitalZone]!.filter(
        (hex) => topo.enterable[hex] === 1 && topo.water[hex] === 0 && !draft.units.some((unit) => unit.hex === hex),
      );
      for (const hex of free.slice(0, 5)) put(draft, 'warrior', JIA, hex);
    });
    const submits = edit(war, (draft) => {
      draft.polities[YI]!.cityLostOn = 12;
    });
    const offer: GameEvent = { type: 'peaceOffered', from: YI, to: JIA };
    expect(texts(war, [offer])).toEqual(['乙国求和']);
    expect(texts(submits, [offer])).toEqual(['乙国求和，愿为藩属']);
    setLanguage('en');
    expect(texts(submits, [offer])[0]).toContain('vassal');
    expect(texts(war, [offer])[0]).not.toContain('vassal');
    // the text follows the game: once the offer no longer makes a vassal, it no longer says so
    let now = submits;
    const draft = noteDrafts(submits, [offer], sightOf(submits), () => now)[0]!;
    expect(draft.text()).toContain('vassal');
    now = war;
    expect(draft.text()).not.toContain('vassal');
  });
});

describe('canPoint', () => {
  it('points a player only at what they have seen and at the starting capitals', () => {
    const sight = sightOf(played);
    const second = map.zones.findIndex((zone, index) => zone.polity === YI && index !== yiSeat);
    const state = withCity(played, second, YI);
    expect(sightOf(state)!.visible[site(second)]).toBe(0);
    expect(canPoint(state, sightOf(state), site(second))).toBe(false);
    expect(canPoint(played, sight, site(map.polities[JIA]!.capitalZone))).toBe(true);
    // a starting capital is common knowledge
    expect(canPoint(played, sight, site(bingSeat))).toBe(true);
    expect(canPoint(played, sight, -1)).toBe(false);
    // the observer may be pointed anywhere
    expect(canPoint(state, null, site(second))).toBe(true);
  });

  it('gives a notification about a place the player has not seen no hex to fly to', () => {
    const second = map.zones.findIndex((zone, index) => zone.polity === YI && index !== yiSeat);
    const state = withCity(played, second, YI);
    // the player's own unit falls there: they are told, but the map is not opened for them
    const fallen: GameEvent = { type: 'cityCaptured', city: second, from: YI, to: JIA };
    const drafts = noteDrafts(state, [fallen], sightOf(state));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.hex).toBe(-1);
  });
});

describe('pendingDrafts', () => {
  const DING = 3;
  /** Yi proposes open borders, Bing offers to sell horses, and Ding, at war with the player, offered peace last turn. */
  const waiting = edit(played, (draft) => {
    draft.turn = 14;
    draft.offers.push({ id: draft.nextId++, type: 'agreement', from: YI, to: JIA, turn: 14, agreement: 'openBorders' });
    draft.offers.push({ id: draft.nextId++, type: 'deal', from: BING, to: JIA, turn: 14, seller: BING, resource: 'horses', goldPerTurn: 3 });
    draft.relations[`${JIA}:${DING}`] = { a: JIA, b: DING, atWar: true, since: 2, offerA: 0, offerB: 13 };
  });
  /** The game as a load brings it back: through the save format, onto the map. */
  const load = (state: GameState): GameState => {
    const result = importSave(exportSave(state), map);
    if (!result.ok) throw new Error(`the save was refused: ${result.error}`);
    return result.state;
  };

  it('gives a loaded game a notification for every proposal and every peace offer that waits for the player', () => {
    const loaded = load(waiting);
    const drafts = pendingDrafts(loaded, sightOf(loaded));
    const [borders, horses] = loaded.offers;
    expect(drafts.map((draft) => draft.offer)).toEqual([
      { kind: 'offer', id: borders!.id },
      { kind: 'offer', id: horses!.id },
      { kind: 'peace', from: DING },
    ]);
    expect(drafts.map((draft) => draft.text())).toEqual(['乙国向你提议：开放边界', '丙国向你提议：出售马，每回合 3 金', '丁国求和']);
    // each points at the capital of the nation that asks
    expect(drafts.map((draft) => draft.hex)).toEqual([YI, BING, DING].map((polity) => site(map.polities[polity]!.capitalZone)));
    setLanguage('en');
    expect(drafts.map((draft) => draft.text())).toEqual([
      'Yi proposes to you: Open borders',
      'Bing proposes to you: sells you Horses for 3 gold a turn',
      'Ding offers peace',
    ]);
  });

  it('says the same as the notifications the events made when the offers came', () => {
    const [borders, horses] = waiting.offers;
    const events: GameEvent[] = [
      { type: 'offerMade', offer: borders! },
      { type: 'offerMade', offer: horses! },
      { type: 'peaceOffered', from: DING, to: JIA },
    ];
    const made = noteDrafts(waiting, events, sightOf(waiting));
    const again = pendingDrafts(waiting, sightOf(waiting));
    expect(again.map((draft) => [draft.text(), draft.hex, draft.offer, draft.settles])).toEqual(
      made.map((draft) => [draft.text(), draft.hex, draft.offer, draft.settles]),
    );
  });

  it('has nothing for a game without offers, for a peace offer that has lapsed, or for the observer', () => {
    expect(pendingDrafts(played, sightOf(played))).toEqual([]);
    const stale = edit(waiting, (draft) => {
      draft.turn = 16;
      draft.offers.length = 0;
    });
    expect(pendingDrafts(stale, sightOf(stale))).toEqual([]);
    const observed = edit(watched, (draft) => {
      draft.offers.push({ id: draft.nextId++, type: 'agreement', from: YI, to: JIA, turn: 1, agreement: 'openBorders' });
    });
    expect(pendingDrafts(observed, sightOf(observed))).toEqual([]);
  });
});

describe('keepNotes', () => {
  const news = (id: number) => ({ id, offer: null });
  const proposal = (id: number) => ({ id, offer: { kind: 'offer', id } as const });

  it('keeps the newest notifications', () => {
    expect(keepNotes([news(1), news(2), news(3)], 2).map((note) => note.id)).toEqual([2, 3]);
    expect(keepNotes([news(1), news(2)], 7).map((note) => note.id)).toEqual([1, 2]);
  });

  it('never drops the notification of a proposal for news that came later', () => {
    const notes = [proposal(1), news(2), proposal(3), news(4), news(5), news(6)];
    expect(keepNotes(notes, 4).map((note) => note.id)).toEqual([1, 3, 5, 6]);
    // more proposals than there is room for: all of them stay, and no news
    expect(keepNotes(notes, 1).map((note) => note.id)).toEqual([1, 3]);
  });
});
