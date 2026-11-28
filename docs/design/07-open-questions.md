# Open Questions

What the design still leaves open. Everything else in these docs is settled: on 2026-11-28 the user stated that whatever was agreed in the design discussion counts as decided, including Claude's proposals accepted without detailed review.

## Design

Nothing open.

## Known weak spots

Accepted for now; revisit after playtesting.

2. **Southeast Asian naval overlap.** Six of the thirteen Southeast Asian unique units are ships and may play alike.
3. **Late-era unique units.** Four unique units fall in the Industrial era and none in the Modern era, so staggered power peaks hold only for the first four eras.
4. **Three nations win most AI games.** In 90 AI-only games on the real map at the middle difficulty level (seeds 1–30, which the numbers were set on, and 301–360, which they were not) 暹罗 wins 24, 漠北 22 and 蜀 19; each of the twelve majors wins at least once, eight or nine of them in a batch of 30. The cap of 8 wins in 30 for a nation holds in one of the three batches (暹罗 10 and 漠北 10; 漠北 9; 暹罗 7). The three are three of the four majors that start with four provinces. 暹罗 is still out of everybody's reach: the nearest major is four provinces away by land and 26 hexes by sea, and since the AI declares no war it cannot carry to the enemy, nobody tries. Its trait was halved (+1 gold for each friendly nation, was +2), which took two of its wins. 漠北 wins by conquest and, when that fails, on the income of the cities it took.
5. **Air power comes late.** Airfields need the Modern era, which starts on turns 110–128. A nation at war now buys the airfields of its cities near the enemy and every airfield strikes each turn, but strikes happen in only 5, 2 and 6 of 30 games at the middle level (2.7, 1.0 and 0.9 strikes a game), and in fewer at the higher levels, where the AI learns Aviation later.
6. **Conquest is back but can come early.** 6, 7 and 4 of 30 games end by conquest in the three batches. One game of the first batch ends on turn 106 and one of the second on turn 108, before the turn 110 the pacing asks for. Holding the vassals of the Industrial era to 3 instead of 4 removed the early game and half the conquests with it.
7. **The Science victory sits on an edge.** It is finished on turns 140–150, so a few percent on the cost of the last techs decide whether a game ends by science or runs to turn 150: 13, 10 and 19 of 30 games in the three batches. The share of each victory will move again with any change to yields.
8. **The higher levels keep the pace less well.** At Hard and Severe the AI's techs cost 25% and 60% more, which holds the Science victory back (8 and 7 of 30 games on the seeds the numbers were set on, 11 and 12 on the others) and lengthens the Ancient era by three turns, but its larger cities shorten the Classical and Medieval eras: at Severe they last 17 to 27 turns, and only 78–81% of the eras played lie within 20–32 turns (92% at Hard, 98–99% at the middle level). Treasuries at the end are 8 turns of income at Hard and 10 at Severe, against 6 at the middle level: the richer AI finds fewer takers for its gifts.
9. **Gifts are the last use of gold.** A major nation that has built everything gives its surplus away for influence and favour. That empties the treasuries (about 6 turns of income at the end, from 14), but it is a thin use: a nation that is everybody's friend at favour 60 and suzerain of every city-state in reach has nothing left to spend on.
10. **Tribes stand where they stood.** Nobody fights them, they never move, and one on a narrow pass closes it to settlers for the whole game. Settlers plan round them; a site behind one stays empty.
11. **Fear the interface does not list.** The two favour terms of the balance of power are in `FavourStanding.power`; the polity panel lists only `FavourStanding.terms`, so the causes it shows do not add up to the level it shows until it lists both.

## Numbers

12. All yields, costs, strengths and percentages in the docs are directions, not balanced values. The kits of [02-nations.md](02-nations.md) have their numbers, sized against a policy card but not balanced against each other.
13. Exact hex counts per nation and the city zones of each province come out of the map data pipeline.

## Technology

14. English names for nations are romanisations for now; the final English display names are not reviewed.
15. Audio was not discussed. The procedural rule implies synthesised sound.

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
