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

- At the end of every turn each city is joined to its two nearest cities of the same owner within 10 hexes, where a land path of at most 16 hexes connects them. The path depends on the terrain alone, and a road once built stays whoever owns the land later.
- A land trade route lays a road along its whole path when it is opened.
- A step from a road hex onto a road hex costs half a movement point, whatever the terrain, and crosses a river without ending the turn. Anybody who may be on the hexes uses the road.
- Roads on the land of a nation that knows Railway become railways, and stay railways. A step between two railway hexes costs a quarter of a movement point.

## Gold

Gold pays building and unit upkeep. Beyond that it can:

- buy a building or unit outright instead of waiting for production;
- upgrade units;
- be gifted to city-states for influence;
- be used in diplomatic deals.

Buying costs 3 gold per point of production cost, and what was already put into the item does not count. A city buys only what it could build, and not while it is in unrest. A bought unit appears at once and moves from the next turn; a bought building works at once. Improvements, city foundings and the endgame project cannot be bought.

A gift of gold goes to a city-state for influence (1 for every 2 gold) or to a nation for favour (1 for every 10 gold).

## Resources

- **Specialties**: one luxury resource per nation, tradeable (see [02-nations.md](02-nations.md)). Every different specialty a nation has, on its own land or bought, gives +1 gold in each of its cities, up to five specialties.
- **Strategic resources**: horses, iron, coal, oil, rare earths. Each appears on the map when its tech is researched. Building a unit that depends on one requires at least one source, owned or obtained by trade. Quantity is not counted.

## Trade

- Trade routes are abstract slots, unlocked by techs and buildings. There are no caravan or cargo units.
- Each route has a path drawn on the map. Units standing on the path can pillage it, and some nations tax routes that pass through them.
- Off-map trade partners come in two kinds:
  - **land ports** on the edge of off-map land (towards Central Asia and India), usable from the Currency tech;
  - **sea exits** on the western and eastern sea edges of the map, usable from Ocean Navigation. The Pacific exit belongs to 吕宋 alone.

The rules of a route:

- **Slots.** Every nation and city-state has one slot from the start. Currency, Guilds and Banking add one each, the nation's first harbour adds one, and so does each Commerce city-state it is suzerain of. A route that loses its slot ends.
- **Destinations.** A route runs from one of the owner's cities to another city (its own, a city-state's, or a foreign one whose owner it is not at war with) or to an off-map port it has unlocked. One route per destination.
- **Path.** Between two cities the route takes a land path of at most 24 hexes if there is one, and otherwise a sea path of at most 40 hexes. A land path avoids the land of the owner's enemies and prefers roads (a hex without a road counts double). A sea path needs Boats and keeps to coast and lake until the owner knows Compass. A land port is reached by land, a sea exit by sea.
- **Income**, in gold per turn for the owner: 2, plus 1 for every 5 hexes of the path, plus 1 for every 5 citizens of the two cities together, plus 2 for every specialty that only one of the two cities' zones has. A port stands in for the second city with a flat 4. A route between two cities of the same nation earns half. A trade pact with the destination's owner adds 50%.
- **A trade pact is not needed for a route.** Peace is enough; the pact makes the route worth half as much again.
- **Ending.** A route ends when its owner goes to war with the destination's owner, when the owner loses the city it starts from, or when it is cancelled. A destination that changes hands keeps the route unless its new owner is at war with the route's owner.
- **Pillage.** A military unit of a polity at war with the owner, standing on a hex of the path (a ship for a sea path), can pillage the route: the pillager takes three turns of its income, and the route earns nothing for 5 turns.
- A route to a city-state gives its owner influence there, and a route to another nation's city raises favour between the two.

## Combat

- One unit per hex.
- Units have 100 HP. Damage is computed from the strength difference of the two sides, with a small random factor.
- Five classes: infantry, ranged, cavalry, siege, naval.
- **Air power is simplified.** In the modern era it is a ranged strike launched from a city with an airfield. There are no air units.
- Strength curve: about 20 in the ancient era and about 100 in the modern era, rising by roughly a third per era.
- **Experience.** Units gain experience in combat and have three levels; each level adds 10% strength. There are no promotion trees.
- **Upgrades.** Inside its own borders a unit can be upgraded with gold to the nearest later unit of the same class that its owner can build.
- **Crossing water.** Land units embark automatically when they step off the coast: onto coastal water after Boats, onto ocean after Compass. An embarked unit fights at greatly reduced strength.
- **Pillaging.** A unit can pillage an improvement, disabling it for a time and earning gold, or a trade route it stands on. The improvement must belong to a polity the unit's owner is at war with. It yields nothing for 10 turns and then works again by itself; the pillager gets half its production cost in gold. Pillaging takes the rest of the unit's turn. Where both stand on the hex, the improvement is pillaged first.
- Roster: one generic unit per class per era, 30 in total, plus 50 unique units. The generic roster is in [04-tech-and-policies.md](04-tech-and-policies.md).

Rules that the nation kits added to combat and to the AI (attacks from the water, attrition, tolls, vision ranges, AI navies) are listed under "Rules added for the kits" in [02-nations.md](02-nations.md).

## Diplomacy

- A favour score between each pair of nations.
- Five agreements: trade pact, open borders, alliance, vassalage, truce.
- **Resource deals.** Specialties and strategic resources can be traded for gold per turn.
- **Vassals.** A vassal pays 20% of its income to its overlord and joins the overlord's wars. Vassalage ends if the overlord loses its own capital. A vassal's capital counts as held for the Conquest victory.
- Capturing a capital lets the attacker force vassalage.
- City-state influence and suzerainty are described in [01-world-and-map.md](01-world-and-map.md).

### Favour

Favour is a number from −100 to 100 for each pair of nations, starting at 0. Each turn it moves one point towards the sum of what stands between the two:

| Standing | Favour |
|---|---|
| Shared border | −5 |
| At war | −60 |
| Trade pact | +15 |
| Open borders | +10 |
| Alliance | +30 |
| Vassalage | +15 |
| Resource deal (each, at most two) | +5 |
| Trade route between them (each, at most two) | +5 |
| Shared enemy (each, at most two) | +10 |

Events change it at once: declaring war −30 (−15 more when it breaks an agreement, and −15 with each ally of the attacked nation), making peace +10, an agreement or deal that runs its full term +5, one that is cancelled or goes unpaid −15, a gift of gold +1 per 10 gold.

### Agreements

An agreement is proposed with an action. An AI answers at once; a human player gets a pending offer that stays open for 10 turns, the same way a peace offer does. Only nations make agreements.

| Agreement | Effect | Term |
|---|---|---|
| Trade pact | Trade routes between the two earn 50% more | 30 turns |
| Open borders | Each side's units may enter and cross the other's land, but not its cities | 30 turns |
| Alliance | When one is attacked the other goes to war with the attacker; opens borders; the Vertical and horizontal alliances card counts against any enemy an ally is also at war with | Until cancelled |
| Vassalage | See below | Until the overlord releases the vassal or loses its own capital |
| Truce | Follows every peace: no war between the two | 10 turns |

- A trade pact, open borders and an alliance can be cancelled after 10 turns. War between the two ends them at once.
- A nation has at most two alliances. An alliance is defensive: an ally does not follow its partner into a war the partner starts, and an ally that is also allied with the attacker stays out.
- War cannot be declared on an ally: the alliance has to be cancelled first.
- An ally that was drawn into a war is at war in its own right: it stays in until it makes its own peace, whatever the attacked nation does.
- A truce between two nations is listed among their agreements. Peace with a city-state brings the same 10 turns without war, but no agreement: city-states make none.
- When an agreement that opened borders ends, units standing on the other's land are moved out.

### Vassals

- At the gates of an enemy nation's fallen capital (0 HP), a melee land unit can demand vassalage instead of taking the city. The city stays with its owner, the war between the two ends, and the owner becomes a vassal. City-states cannot be made vassals.
- A nation can also be asked to become a vassal without a war.
- A new vassal lets its own vassals and allies go. Its wars end, except those its overlord is also fighting, and it joins the rest of its overlord's wars.
- A vassal pays 20% of its income (city gold and trade routes) to its overlord each turn. It joins every war its overlord enters and leaves it when its overlord makes peace. It cannot declare war or make peace itself, and war is declared on its overlord, not on it. Overlord and vassal have open borders.
- An overlord can release a vassal at any time. A vassal is also freed when its overlord loses its own capital or is annexed, or itself becomes a vassal.
- For the Conquest victory a major nation's original capital held by a vassal counts for the overlord.

### Resource deals

- A nation sells a specialty or a strategic resource it has on its own land to another nation for gold per turn, for 20 turns. Quantity is not counted: the seller keeps its own use and can sell the same resource to several buyers.
- A bought strategic resource lets the buyer build and upgrade to the units that need it. Units already built stay when the deal ends.
- A deal ends early when either side cancels it, when the two go to war, when the seller loses the resource, or when the buyer cannot pay.

### How the AI decides

- A major nation accepts a trade pact at favour −10 or more, open borders at 5, an alliance at 30. It never becomes a vassal by agreement.
- A nation on the simplified AI accepts every trade pact, open borders at favour 5, an alliance at 10, and vassalage at favour 40 when the other is eight times as strong.
- Nobody allies with an ally of its enemy or an enemy of its ally.
- A resource is sold at 4 gold a turn (strategic) or 2 (specialty) to anyone at favour −20 or more, and bought at that price by a nation that has a use for it and the income to pay.

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
- **What the full AI does with diplomacy and trade.** It picks policy cards for its situation (economy and civil cards at peace, military cards at war, a diplomacy card only when it has what the card works on). It fills its trade route slots with the destinations that pay best. Every few turns it offers its neighbours a trade pact, open borders and an alliance where favour allows, sells a resource a neighbour lacks, and sends a gift to the nearest city-state. It does not attack a nation it is on good terms with, and counts a target's allies and vassals before it declares war. At a fallen capital it takes a much weaker nation as a vassal when it is weary of war or has another war to fight, and takes the city otherwise. A city with an enemy at its gates and no garrison buys one.
- The simplified AI uses policy cards and accepts agreements, but proposes none and opens no trade routes.

## Turn pacing

- During AI turns only battles inside the player's vision are animated. Everything else resolves instantly. Holding Space speeds animations up.
- After a unit acts, selection jumps to the next unit that needs orders. Fortified and sleeping units stop asking.
- A city asks for a project only when its queue is empty. "Repeat last item" is available.

## Observer mode

All nations are AI-controlled and the camera follows wars and major events on its own. This is the mode for showing the game to someone without playing it.

## Saves

Autosave to browser storage every turn, plus export to and import from a file.
