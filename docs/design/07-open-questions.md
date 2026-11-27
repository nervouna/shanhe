# Open Questions

What the design still leaves open. Everything else in these docs is settled: on 2026-11-28 the user stated that whatever was agreed in the design discussion counts as decided, including Claude's proposals accepted without detailed review.

## Design

1. **Tech prerequisites.** Each tech has 1–2 prerequisites, but the actual links are not drawn.
2. **Architectural families.** Seven families are defined in [06-visuals.md](06-visuals.md), but nations are not yet assigned to them.
3. **Difficulty ratings.** Every nation shows a rating at nation select; the ratings themselves are not set.
4. **AI personalities.** Each leader sets an AI behaviour style; the styles are not assigned.

## Known weak spots

Accepted for now; revisit after playtesting.

5. **Southeast Asian naval overlap.** Six of the thirteen Southeast Asian unique units are ships and may play alike.
6. **Late-era unique units.** Four unique units fall in the Industrial era and none in the Modern era, so staggered power peaks hold only for the first four eras.

## Numbers

7. All yields, costs, strengths and percentages in the docs are directions, not balanced values.
8. Exact hex counts per nation and the city zones of each province come out of the map data pipeline.

## Technology

9. Language, build tooling and project layout are not chosen. Only "browser, Three.js on WebGPU with a WebGL fallback" is fixed.
10. The specific geographic datasets and their licences.
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
