# Open Questions

What the design still leaves open. Everything else in these docs is settled: on 2026-11-28 the user stated that whatever was agreed in the design discussion counts as decided, including Claude's proposals accepted without detailed review.

## Design

Nothing open.

## Known weak spots

Accepted for now; revisit after playtesting.

2. **Southeast Asian naval overlap.** Six of the thirteen Southeast Asian unique units are ships and may play alike.
3. **Late-era unique units.** Four unique units fall in the Industrial era and none in the Modern era, so staggered power peaks hold only for the first four eras.
4. **Two nations win most AI games.** In 60 AI-only games on the real map 蜀 and 暹罗 win about three in four between them: 蜀 has the richest land of the four-city nations and 暹罗 the safest corner of the map, and each is the best at whatever its leader sets out for. Kit numbers move the lead from one to the other, not away from both.
5. **Air power comes late.** Airfields need the Modern era, which starts on turn 126, and a conquering nation with many cities seldom gets there. Air strikes happen in few games.

## Numbers

6. All yields, costs, strengths and percentages in the docs are directions, not balanced values. The kits of [02-nations.md](02-nations.md) have their numbers, sized against a policy card but not balanced against each other.
7. Exact hex counts per nation and the city zones of each province come out of the map data pipeline.

## Technology

9. English names for nations are romanisations for now; the final English display names are not reviewed.
10. Audio was not discussed. The procedural rule implies synthesised sound.

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
