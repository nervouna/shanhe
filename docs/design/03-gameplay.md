# Gameplay

A game is 150 turns over about two hours, so a turn averages under 50 seconds. The governing rule for every system is: fewer things to click per turn.

## Eras

Six eras of about 25 turns each: Ancient (上古), Classical (古典), Medieval (中古), Early Modern (近世), Industrial (工业), Modern (现代). The first is the shortest: in AI games at the middle difficulty level the leading major nation leaves the Ancient era on turn 20 or 21, and each later era lasts 19 to 34 turns for the first nation to enter it (20 to 32 in 98% of the eras played), so that the Modern era begins on turns 110–128.

## Yields

Five yields: food (粮), production (工), gold (金), science (科), culture (文).

Morale (民心) is a per-city satisfaction value. War weariness lowers it: the longer a war runs, the lower morale falls in every city. This is the brake on endless conquest.

**The capital.** A nation's capital yields 50% more gold and science than the same city would elsewhere. It is the seat of government, and it counts for more the smaller the realm is: a nation of one city gets it on everything it has, a nation of six on a sixth.

War weariness rises by 1 for every turn a polity is at war, however many enemies it has, and by 5 when it loses a city. It falls by 5 when the polity takes a city, by 10 when a war makes a nation its vassal (demanded at the gates of the fallen capital, or by a peace in which the beaten nation submits), and by 2 for every turn at peace. It never goes above 60.

## Cities

- City sites are preset (see [01-world-and-map.md](01-world-and-map.md)). A player ends a game with roughly 6–10 cities.
- Population runs from 1 to about 20.
- **Citizens are assigned to hexes automatically.** The player only sets a city focus: balanced, food, production or gold.
- One build project at a time, with a queue. Options: buildings, units, improvements.
- **There are no worker units.** An improvement is chosen in the city's build queue and then placed on a hex on the map.
- **City projects.** A city with nothing else to do can turn its production into something else. There are three: 庆典 Festival (Ritual) gives 1 culture for every 4 production, 铸钱 Minting (Currency) 1 gold for every 2, and 修书 Compilation (Writing) 1 science for every 4. A city project is queued like a building, costs nothing and is never finished: every turn in which it is the city's current item the turn's production is converted, in whole points (what is left over stays stored), until something else is queued behind it. Minted gold is income and counts for the Economic victory; the science goes to the research at hand, the culture towards the next policy card. A city project cannot be bought, and nothing that speeds up buildings speeds it up.
- A captured city goes through a period of unrest.
- **City defence.** A city has 130 HP, and 50 more with walls. Once it has walls it makes one ranged counter-strike per turn. When its HP reaches zero, a melee unit entering the hex captures it. A city regains 10 HP in a turn in which nobody attacks it.
- **Mustering.** A new unit appears on its city's hex or, when that is taken, on the nearest free hex it may stand on within 3 hexes of the city. With no such hex the unit waits.

## Roads

Roads are never built by hand. They form automatically between a nation's own cities and along land trade routes, and upgrade to railways automatically after the Railway tech.

- At the end of every turn each city is joined to its two nearest cities of the same owner within 10 hexes, where a land path of at most 16 hexes connects them. The path depends on the terrain alone, and a road once built stays whoever owns the land later.
- A land trade route lays a road along its whole path when it is opened.
- A step from a road hex onto a road hex costs half a movement point, whatever the terrain, and crosses a river without ending the turn. Anybody who may be on the hexes uses the road.
- Roads on the land of a nation that knows Railway become railways, and stay railways. A step between two railway hexes costs a quarter of a movement point.

## Gold

Gold pays building and unit upkeep. A unit costs 1 gold a turn, and two units per city are kept for nothing. A treasury never goes below zero: a polity that cannot pay stays at 0 gold and disbands its newest unit, one every turn until it can pay again.

**The supply limit.** A polity's cities and people supply a certain number of fighting units, on land and at sea: 2, plus 1.5 for every city, plus 1 for every 6 citizens, rounded down. A nation of four cities and 24 citizens supplies 12. Units beyond the limit can be kept, but each costs more than the one before: the first 1 gold a turn on top of its upkeep, the second 2, the third 3, so five units too many cost 15 gold a turn and ten cost 55. No policy card or trait lowers that. Settlers and tribes are not counted. This is what keeps the map of the middle game from being carpeted with pieces: an army is as large as the realm behind it, and a rich nation pays dearly for more. For the same reason wasteland holds one tribe for every 80 hexes of a zone, and at least one in each.

Beyond upkeep, gold can:

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
- **Income**, in gold per turn for the owner: 3, plus 1 for every 5 hexes of the path, plus 1 for every 5 citizens of the two cities together, plus 2 for every specialty that only one of the two cities' zones has. A port stands in for the second city with a flat 6. A route between two cities of the same nation earns half. A trade pact with the destination's owner adds 50%.
- **A trade pact is not needed for a route.** Peace is enough; the pact makes the route worth half as much again.
- **Ending.** A route ends when its owner goes to war with the destination's owner, when the owner loses the city it starts from, or when it is cancelled. A destination that changes hands keeps the route unless its new owner is at war with the route's owner.
- **Pillage.** A military unit of a polity at war with the owner, standing on a hex of the path (a ship for a sea path), can pillage the route: the pillager takes three turns of its income, and the route earns nothing for 5 turns.
- A route to a city-state gives its owner influence there, and a route to another nation's city raises favour between the two.

## Combat

- One unit per hex.
- Units have 100 HP. Damage is computed from the strength difference of the two sides, with a small random factor.
- Five classes: infantry, ranged, cavalry, siege, naval.
- **Air power is simplified.** In the modern era it is a ranged strike launched from a city with an airfield. There are no air units.
- Strength curve: 20 in the ancient era and 84 in the modern era, rising by a third per era (20, 27, 36, 47, 63, 84).
- **Experience.** Units gain experience in combat and have three levels; each level adds 10% strength. There are no promotion trees.
- **Upgrades.** Inside its own borders a unit can be upgraded with gold to the nearest later unit of the same class that its owner can build.
- **Crossing water.** Land units embark automatically when they step off the coast: onto coastal water after Boats, onto ocean after Compass. An embarked unit fights at greatly reduced strength.
- **Pillaging.** A unit can pillage an improvement, disabling it for a time and earning gold, or a trade route it stands on. The improvement must belong to a polity the unit's owner is at war with. It yields nothing for 10 turns and then works again by itself; the pillager gets half its production cost in gold. Pillaging takes the rest of the unit's turn. Where both stand on the hex, the improvement is pillaged first.
- Roster: one generic unit per class per era, 30 in total, plus 50 unique units. The generic roster is in [04-tech-and-policies.md](04-tech-and-policies.md).

### Fog of war

- **Sight.** A polity sees every hex within the vision of its units (2 hexes) and its cities (3 hexes), plus what modifiers add, and what its allies and its vassals see. An overlord sees for itself and through its vassals; a vassal does not see through its overlord. Open borders and trade pacts share nothing.
- **Memory.** The major nations and the player remember every hex they have seen. Everybody else lives in the present.
- **What is always known.** Terrain, borders and the preset city sites are on the map. So are the capitals the polities started with. The strength of a nation's army is public, as its score is.
- **What fog hides.** The units on a hex that is not in sight, and whether a city stands on a site that was never seen.
- **Targets.** An attack or an air strike needs a unit its owner sees, or a city its owner knows of: one whose site it has seen, or a starting capital.
- **The AI** plans with what its polity sees or remembers. It counts as threats and as enemy ships only the units it sees, strikes from the air only at what it sees, and marches on the cities it knows of; with none known it marches on the nearest city site in enemy land.
- The observer sees everything.

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

**The balance of power.** The nations in the race for victory (the major nations and the player) are measured on three tracks, one for each victory: the gold a nation has earned in all, the science it has gathered in all, and the strength of its army. On each track its figure is set against the average of all of them. A figure far enough above the average is a lead, and the nation is feared for the largest of its leads:

| Track | A lead begins at | It is complete at |
|---|---|---|
| Income | 1.25 times the average | 1.75 times |
| Science | 1.5 times | 2.3 times |
| Army | 2.2 times | 3.6 times |

A complete lead is feared at 50, a lead halfway at 25. Every stage of the Tiangong project a nation has completed adds 15 to its fear on the science track. Nothing is feared before turn 26, and the fear counts in full only from turn 90 on (at turn 45 for half): nobody minds who is ahead in the first age. The fear is public: it is worked out from the figures the victory screen shows.

| Standing | Favour |
|---|---|
| Fear of the leader: between a feared nation and every nation feared less | minus its fear, down to −50 |
| A common threat: between two nations that both stand against a leader feared at 12 or more | +15 |

A nation stands against a leader if it is feared less, is neither its ally, its vassal nor its overlord, and is either in the race itself or shares a border with it. The world then turns against the leader in ways that follow from favour: as favour falls, majors refuse it a new trade pact (below favour −10) and so do the other nations (below −20), open borders and alliances with it are no longer signed, and those who stand against it sign with each other more readily. The agreements a leader already has are kept, and each of them holds favour up. Three reactions go beyond favour:

- **Wars of containment.** An AI major that is nobody's vassal, has no war of its own and whose war weariness is at most 20 declares war on a leader feared at 20 or more once its favour with the leader is down to −15, if it can reach the leader's land (its allies' land counts as its own for that) and it, its allies, its vassals and everybody already at war with the leader are together 1.1 times as strong as the leader with its allies, vassals and cities. A leader out for learning or wealth, which starts no other war, joins this one. A major choosing a war of its own picks a feared leader it can beat before any other target, the most feared first.
- **Vassals drift away.** A vassal whose favour with its overlord has fallen to −10 leaves it, once the vassalage is 10 turns old, unless the overlord's army is at least 1.5 times its own.
- **Knowledge leaks.** A tech that a feared nation knows costs every nation that is feared less 1% less for each point of that fear, on top of the catch-up discount.

Events change it at once: declaring war −30 (−15 more when it breaks an agreement, and −15 with each ally of the attacked nation), making peace +10, an agreement or deal that runs its full term +5, one that is cancelled or goes unpaid −15, a gift of gold +1 per 10 gold.

### Agreements

An agreement is proposed with an action. An AI answers at once; a human player gets a pending offer that stays open for 10 turns, the same way a peace offer does. Only nations make agreements.

**War and peace.** A war cannot end before it is 10 turns old: until then neither side can make peace. An AI that wants peace with a human player leaves an offer, which the player can take up for 10 turns; then it lapses like any other offer, and the AI waits another 10 turns before it offers again. While no offer stands, the player's own proposal is answered on its merits.

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
- **Submission.** An AI nation that has lost a city in a war and asks an enemy at least 1.5 times as strong as itself for peace pays for the peace with its freedom: if the enemy accepts, it becomes the enemy's vassal. A human player who asks for peace never submits this way, and a player who accepts such an offer gets the vassal.
- **How many vassals.** A nation can hold 1 vassal in the Ancient era, 2 in the Classical and Medieval eras, 3 in the Early Modern era, 4 in the Industrial era and 5 in the Modern era. At that number a demand, a proposal or a submission is refused; the vassals it has stay.
- A new vassal lets its own vassals and allies go. Its wars end, except those its overlord is also fighting, and it joins the rest of its overlord's wars.
- A vassal pays 20% of its income (city gold and trade routes) to its overlord each turn. It joins every war its overlord enters and leaves it when its overlord makes peace. It cannot declare war or make peace itself, and war is declared on its overlord, not on it. Overlord and vassal have open borders.
- An overlord can release a vassal at any time. A vassal is also freed when its overlord loses its own capital or is annexed, or itself becomes a vassal. A vassal that has come to dislike an overlord too weak to hold it leaves by itself (see the balance of power under [Favour](#favour)).
- For the Conquest victory a major nation's original capital held by a vassal counts for the overlord.

### Resource deals

- A nation sells a specialty or a strategic resource it has on its own land to another nation for gold per turn, for 20 turns. Quantity is not counted: the seller keeps its own use and can sell the same resource to several buyers.
- A bought strategic resource lets the buyer build and upgrade to the units that need it. Units already built stay when the deal ends.
- A deal ends early when either side cancels it, when the two go to war, when the seller loses the resource, or when the buyer cannot pay.
- A deal is made only if the buyer holds at least one turn's price. An offered deal that is accepted while the buyer does not is refused with that reason, and the offer goes on waiting: it can be accepted once the gold is there, declined, or left to run out.

### How the AI decides

- A major nation accepts a trade pact at favour −10 or more, open borders at 5, an alliance at 30. It never becomes a vassal by agreement.
- A nation on the simplified AI accepts a trade pact at favour −20 or more, open borders at favour 5, an alliance at 10, and vassalage at favour 40 when the other is five times as strong.
- Nobody allies with an ally of its enemy or an enemy of its ally.
- A resource is sold at 4 gold a turn (strategic) or 2 (specialty) to anyone at favour −20 or more, and bought at that price by a nation that has a use for it and the income to pay.

## Victory

| Victory | Condition |
|---|---|
| Conquest | Hold 6 of the 12 major nations' original capitals at the same time |
| Science | Complete the endgame project 天宫工程 (Tiangong Project): three stages built in the capital, requiring Rocketry, Electronics and Information Networks. In AI games at the middle difficulty level it is finished on turns 140–150 |
| Economic | Highest cumulative gross income when turn 150 ends |

The 12 major nations are the full-AI list fixed at game setup. A player who picks one of them already holds one of the six capitals; a player who picks any other nation must capture all six. That difference is an accepted difficulty choice.

Economic victory counts cumulative income, not gold held, so that spending is never penalised. Only the 12 major nations and the player are ranked; simplified-AI nations cannot win it.

## Difficulty

A game is set up at one of five levels. At the middle level the AI plays by the same rules as the player. Below it the player's nation gets a bonus, above it the AI's major nations do; nobody else is ever touched. The bonus is a percentage on the yields of every city and a percentage on the strength of units and cities. The player's bonus is on all five yields (food, production, gold, science, culture). The AI's is on four: it leaves science out, and what an AI major learns costs it more besides. A harder AI is richer and stronger, but it does not learn faster: its larger cities, earlier buildings and greater production would otherwise bring the Science victory forward and leave the other two no time.

| Level | Player: yields | Player: strength | AI majors: yields (not science) | AI majors: strength | AI majors: cost of techs |
|---|---|---|---|---|---|
| 从容 Relaxed | +30% | +20% | — | — | — |
| 简单 Easy | +15% | +10% | — | — | — |
| 标准 Standard | — | — | — | — | — |
| 困难 Hard | — | — | +15% | +10% | +25% |
| 严酷 Severe | — | — | +30% | +20% | +60% |

In an observer game every major nation is the AI's.

## AI tiers

- All 50 nations are on the map in every game.
- 12 major nations run the **full AI** (the default list is in [02-nations.md](02-nations.md)). The player's nation is always a full participant, so there are 13 when the player picks a nation outside the twelve.
- The rest run a **simplified AI**. They develop their cities and defend themselves normally, and they settle wasteland. Their tech follows the world average instead of being researched. They never declare war on their own, but join wars through alliances. They can be courted, vassalised or annexed.
- City-states have their own minimal behaviour.
- **What the full AI does with diplomacy and trade.** It picks policy cards for its situation (economy and civil cards at peace, military cards at war, a diplomacy card only when it has what the card works on). It fills its trade route slots with the destinations that pay best. Every few turns it offers its neighbours a trade pact, open borders and an alliance where favour allows, sells a resource a neighbour lacks, and sends a gift to the nearest city-state. It does not attack a nation it is on good terms with, and counts a target's allies and vassals before it declares war. At a fallen capital it takes a much weaker nation as a vassal when it is weary of war or has another war to fight, and takes the city otherwise. A city with an enemy at its gates and no garrison buys one.
- **Ambitions.** In every game each leader of a major nation sets out for one of the three victories; which one is drawn from the game's seed and weighted by its personality (see [02-nations.md](02-nations.md)). A leader out for learning or wealth starts no wars; a leader out for conquest goes from one war to the next, after the nations that hold the capitals it needs.
- **Gold.** A major nation keeps a reserve (80 gold and four turns of its upkeep) and spends the rest: up to four times a turn it buys what one of its cities is building, or the next building the city would build, the slowest item first; at war the airfields of its cities near the enemy are bought before anything else. It upgrades its units as soon as it can pay. What it still holds beyond one and a half turns of its income (and 80 gold) it gives away for standing every few turns, in gifts of 120 gold: first to the city-states within 28 hexes of its capital, the nearest first, as long as its influence there can still grow; then to the nations it borders or whose capital lies within 28 hexes, the one it stands worst with first, until favour with each has reached 60. A human player is a neighbour like any other and gets such gifts too.
- **Idle cities.** A city with nothing left to build takes up a city project and drops it again as soon as there is something to build. Which one follows from the leader's ambition ([02-nations.md](02-nations.md)): learning compiles, wealth mints, conquest mints until the treasury holds four turns of income and then compiles; a leader without an ambition compiles. A project that would do nothing is passed over (science with every tech known, culture with every card unlocked). A nation on the simplified AI, which does not research, holds festivals while it has cards to unlock and mints after that; a city-state mints.
- **Wars.** A major declares a war of its own, or a war of containment, only on a nation it can carry the war to: one of the three cities of the target nearest to its own that it knows of must lie within a path cost of 36 of one of its cities without crossing water, or within 60 with a crossing once its units can embark (a water hex counts 3). The target's land and its vassals' count as open for this, other closed borders do not. A war it can only carry over the sea it declares with at least two warships and twice the strength a war by land would take. A war it cannot reach only costs it units, so it does not start one.
- **Settling.** A wasteland site within 24 hexes of a city (30 for an expansionist leader) is worth a settler if a chain of zones that are the nation's own, nobody's or open to it leads there, or if the site lies over the water and the nation can embark. At peace a city sends the settler once it has its first building, before it founds the cities of the nation's own sites, which nobody can take from it. A nation has at most two settlers on the way or in the making. A settler goes round other units and never plans its way over the hex of a tribe.
- **The size of armies.** No AI plans an army beyond its supply limit. At peace a leader out for conquest keeps the whole limit under arms and recruits before its cities' first buildings; the others keep 60% of it (80% for a nation without an ambition) and recruit half of that first. At war every leader fills the limit, and a leader out for conquest pays for units beyond it as long as the surcharge stays under 70% of its spare income. At a fallen capital it takes the owner as a vassal when it is 1.5 times as strong. A nation on the simplified AI keeps one garrison per city and one unit in the field.
- **Fog.** The AI plans its steps with what its polity sees: a unit in the fog does not stand in its way. If the rules then refuse the step, the unit stays where it is for the turn and looks for no other way, so a refusal tells it nothing.
- **Armies.** An army goes round units of other polities that stand in its way, and a column that is held up spreads out. A unit with no orders does not stay at the gates of its city, where new units muster. At war, a city within 10 hexes of an enemy city builds its airfield before anything else (and a major buys it), and a nation at war or out for conquest researches Aviation before the other techs of its kind. Every city with an airfield strikes each turn at the enemy unit it sees in reach that it hurts most, or failing that at an enemy city that still stands.
- **Peace.** A major sues for peace at war weariness 35 (a leader out for conquest at 55), after 24 turns in which the enemy has lost no city (a leader out for conquest after 36: a siege takes its time), or when its army is less than 60% of the enemy's. It accepts a peace that makes the other its vassal while it has room for one.
- The simplified AI uses policy cards and accepts agreements, but proposes none and opens no trade routes.

## Turn pacing

- During AI turns only battles inside the player's vision are animated. Everything else resolves instantly. Holding Space speeds animations up.
- After a unit acts, selection jumps to the next unit that needs orders. Fortified and sleeping units stop asking.
- A city asks for a project only when its queue is empty. "Repeat last item" is a switch of the city: while it is on, a city that finishes an item with nothing else queued queues the same item again, if it may still build it (a unit, but not a building it now has). A city project needs no such switch: it runs until something else is queued. A built-out city is therefore never a reason to queue an unwanted unit. A city with the switch on never asks for a project, also when its last item was one it cannot build again (a building): the player has said what the city does, and switching it off makes the city ask again. A city with nothing left to build but city projects asks like any other city with an empty queue, and its panel offers the projects.

## Observer mode

All nations are AI-controlled and the camera follows wars and major events on its own. This is the mode for showing the game to someone without playing it.

## Saves

Autosave to browser storage every turn, plus export to and import from a file.
