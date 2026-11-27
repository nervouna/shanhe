# Gameplay

A game is 150 turns over about two hours, so a turn averages under 50 seconds. The governing rule for every system is: fewer things to click per turn.

## Eras

Six eras of about 25 turns each: Ancient (上古), Classical (古典), Medieval (中古), Early Modern (近世), Industrial (工业), Modern (现代).

## Yields

Five yields: food (粮), production (工), gold (金), science (科), culture (文).

Morale (民心) is a per-city satisfaction value. War weariness lowers it: the longer a war runs, the lower morale falls in every city. This is the brake on endless conquest.

## Cities

- City sites are preset (see [01-world-and-map.md](01-world-and-map.md)). A player ends a game with roughly 6–10 cities.
- Population runs from 1 to about 20.
- **Citizens are assigned to hexes automatically.** The player only sets a city focus: balanced, food, production or gold.
- One build project at a time, with a queue. Options: buildings, units, improvements.
- **There are no worker units.** An improvement is chosen in the city's build queue and then placed on a hex on the map.
- A captured city goes through a period of unrest.
- **City defence.** A city has HP. Once it has walls it makes one ranged counter-strike per turn. When its HP reaches zero, a melee unit entering the hex captures it.

## Roads

Roads are never built by hand. They form automatically between a nation's own cities and along land trade routes, and upgrade to railways automatically after the Railway tech.

## Gold

Gold pays building and unit upkeep. Beyond that it can:

- buy a building or unit outright instead of waiting for production;
- upgrade units;
- be gifted to city-states for influence;
- be used in diplomatic deals.

## Resources

- **Specialties**: one luxury resource per nation, tradeable (see [02-nations.md](02-nations.md)).
- **Strategic resources**: horses, iron, coal, oil, rare earths. Each appears on the map when its tech is researched. Building a unit that depends on one requires at least one source, owned or obtained by trade. Quantity is not counted.

## Trade

- Trade routes are abstract slots, unlocked by techs and buildings. There are no caravan or cargo units.
- Each route has a path drawn on the map. Units standing on the path can pillage it, and some nations tax routes that pass through them.
- Off-map trade partners come in two kinds:
  - **land ports** on the edge of off-map land (towards Central Asia and India), usable from the Currency tech;
  - **sea exits** on the western and eastern sea edges of the map, usable from Ocean Navigation. The Pacific exit belongs to 吕宋 alone.

## Combat

- One unit per hex.
- Units have 100 HP. Damage is computed from the strength difference of the two sides, with a small random factor.
- Five classes: infantry, ranged, cavalry, siege, naval.
- **Air power is simplified.** In the modern era it is a ranged strike launched from a city with an airfield. There are no air units.
- Strength curve: about 20 in the ancient era and about 100 in the modern era, rising by roughly a third per era.
- **Experience.** Units gain experience in combat and have three levels; each level adds 10% strength. There are no promotion trees.
- **Upgrades.** Inside its own borders a unit can be upgraded with gold to the next era's unit of the same class.
- **Crossing water.** Land units embark automatically when they step off the coast: onto coastal water after Boats, onto ocean after Compass. An embarked unit fights at greatly reduced strength.
- **Pillaging.** A unit can pillage an improvement, disabling it for a time and earning gold, or a trade route it stands on.
- Roster: one generic unit per class per era, 30 in total, plus 50 unique units. The generic roster is in [04-tech-and-policies.md](04-tech-and-policies.md).

## Diplomacy

- A favour score between each pair of nations.
- Five agreements: trade pact, open borders, alliance, vassalage, truce.
- **Resource deals.** Specialties and strategic resources can be traded for gold per turn.
- **Vassals.** A vassal pays 20% of its income to its overlord and joins the overlord's wars. Vassalage ends if the overlord loses its own capital. A vassal's capital counts as held for the Conquest victory.
- Capturing a capital lets the attacker force vassalage.
- City-state influence and suzerainty are described in [01-world-and-map.md](01-world-and-map.md).

## Victory

| Victory | Condition |
|---|---|
| Conquest | Hold 6 of the 12 major nations' original capitals at the same time |
| Science | Complete the endgame project 天宫工程 (Tiangong Project): three stages built in the capital, requiring Rocketry, Electronics and Information Networks. Earliest around turn 130 |
| Economic | Highest cumulative gross income when turn 150 ends |

The 12 major nations are the full-AI list fixed at game setup. A player who picks one of them already holds one of the six capitals; a player who picks any other nation must capture all six. That difference is an accepted difficulty choice.

Economic victory counts cumulative income, not gold held, so that spending is never penalised. Only the 12 major nations and the player are ranked; simplified-AI nations cannot win it.

## AI tiers

- All 50 nations are on the map in every game.
- 12 major nations run the **full AI** (the default list is in [02-nations.md](02-nations.md)). The player's nation is always a full participant, so there are 13 when the player picks a nation outside the twelve.
- The rest run a **simplified AI**. They develop their cities and defend themselves normally, and they settle wasteland. Their tech follows the world average instead of being researched. They never declare war on their own, but join wars through alliances. They can be courted, vassalised or annexed.
- City-states have their own minimal behaviour.

## Turn pacing

- During AI turns only battles inside the player's vision are animated. Everything else resolves instantly. Holding Space speeds animations up.
- After a unit acts, selection jumps to the next unit that needs orders. Fortified and sleeping units stop asking.
- A city asks for a project only when its queue is empty. "Repeat last item" is available.

## Observer mode

All nations are AI-controlled and the camera follows wars and major events on its own. This is the mode for showing the game to someone without playing it.

## Saves

Autosave to browser storage every turn, plus export to and import from a file.
