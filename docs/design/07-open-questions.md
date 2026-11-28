# Open Questions

What the design still leaves open. Everything else in these docs is settled: on 2026-11-28 the user stated that whatever was agreed in the design discussion counts as decided, including Claude's proposals accepted without detailed review.

## Design

Nothing open.

## Known weak spots

Accepted for now; revisit after playtesting.

2. **Southeast Asian naval overlap.** Six of the thirteen Southeast Asian unique units are ships and may play alike.
3. **Late-era unique units.** Four unique units fall in the Industrial era and none in the Modern era, so staggered power peaks hold only for the first four eras.
4. **暹罗 wins a third of AI games.** In 60 AI-only games on the real map 暹罗 wins 21, 漠北 12 and 蜀 10; nine nations win at least once across the two batches of 30, eight in one and seven in the other. The balance of power brought 蜀 down from 27 wins, because its neighbours can reach it. Nobody can reach 暹罗: the nearest major is four provinces away by land and 26 hexes by sea, its neighbours are its allies, and so no war of containment is ever declared on it. Its income and its science are those of any four-city nation that is never at war. What is left of the world's reactions (lost favour, refused pacts, leaked knowledge) does not cost it a game.
5. **Air power comes late.** Airfields need the Modern era, which starts on turn 126, and a conquering nation with many cities seldom gets there. Air strikes happen in few games.
6. **Conquest hangs on a few games.** With armies held to the supply limit a conqueror is seldom three times as strong as its neighbour. Five of 30 games ended by conquest in the batch the numbers were set on and none in the next 30. Two of the five ended on turns 94 and 98: a conqueror whose neighbours are all at war with each other can still run through them before the world reacts.
7. **Treasuries pile up.** With armies capped, a major nation that has built everything has nothing left to buy: the majors end a game with about 13 turns of income unspent.
8. **Fear the interface does not list.** The two favour terms of the balance of power are in `FavourStanding.power`; the polity panel lists only `FavourStanding.terms`, so the causes it shows do not add up to the level it shows until it lists both.

## Numbers

9. All yields, costs, strengths and percentages in the docs are directions, not balanced values. The kits of [02-nations.md](02-nations.md) have their numbers, sized against a policy card but not balanced against each other.
10. Exact hex counts per nation and the city zones of each province come out of the map data pipeline.

## Technology

11. English names for nations are romanisations for now; the final English display names are not reviewed.
12. Audio was not discussed. The procedural rule implies synthesised sound.

## Resolved on 2026-11-28

- 西域, 坚昆, 极北 and 流鬼 are wasteland regions, not nations; the nation count is 50.
- Generic unit gaps filled; every class has a unit in every era.
- Canals stay available to every nation; 吴's trait changed to 漕运.
- Conquest victory is always 6 of the 12 major capitals; a vassal's capital counts.
- Added rules for experience, upgrades, strategic resources, embarking, city defence, pillaging, uses of gold, resource deals, off-map land ports and sea exits, vassals, economic ranking, settlers, tribes, automatic roads, city-state defence and conquest, and simplified-AI behaviour.
- 澜沧's trait, and the leader buffs of 秦, 夜郎 and 北海, changed to fit those rules.
- Era, class and piece character set for all unique units; kind and unlock tech set for all unique buildings.
- One-city nations stay playable; the imbalance is accepted.
- Every nation has its architectural family, its difficulty rating and its leader's AI personality, and every kit has its numbers: see [02-nations.md](02-nations.md).
- Tech prerequisites are drawn in [04-tech-and-policies.md](04-tech-and-policies.md); the stack and layout are in `CLAUDE.md`; the datasets and their licences are in `tools/pipeline/DATA.md`.
