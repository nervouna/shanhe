# Open Questions

What the design still leaves open. Everything else in these docs is settled: on 2026-11-28 the user stated that whatever was agreed in the design discussion counts as decided, including Claude's proposals accepted without detailed review.

## Design

Nothing open.

## Known weak spots

Accepted for now; revisit after playtesting.

2. **Southeast Asian naval overlap.** Six of the thirteen Southeast Asian unique units are ships and may play alike.
3. **Late-era unique units.** Four unique units fall in the Industrial era and none in the Modern era, so staggered power peaks hold only for the first four eras.
4. **Fog of war.** The rules know how far a unit sees, but hide nothing yet, so the two vision bonuses of the kits (三佛齐's trait, 率宾's leader) have nothing to act on.

## Numbers

5. All yields, costs, strengths and percentages in the docs are directions, not balanced values. The kits of [02-nations.md](02-nations.md) have their numbers, sized against a policy card but not balanced against each other; with them the first nation reaches each era earlier than [03-gameplay.md](03-gameplay.md) aims at.
6. Exact hex counts per nation and the city zones of each province come out of the map data pipeline.

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
