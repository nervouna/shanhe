# UI and Controls

Desktop (mouse and keyboard) and touch are both first-class. The UI ships in Chinese and English.

## Camera

- Drag to pan, wheel to zoom, right-button drag or Q/E to rotate.
- **Zoom sets the view.** Zoomed in, the camera tilts down to show the diorama with tilt-shift depth of field. Zoomed out, it rises to a top-down view and the terrain crossfades into a political map with borders, nation names and capitals. With 50 nations, the zoomed-out map is the main way to read the whole situation.

## Map interaction

| Action | Mouse | Touch |
|---|---|---|
| Pan | Drag | One-finger drag |
| Zoom | Wheel | Pinch |
| Rotate | Right-button drag, Q/E | Two-finger twist |
| Select | Left click | Tap |
| Order (move, attack) | Right click | Tap the target for a preview, tap again to confirm |
| Details | Hover | Long press |

- **Preview before commit.** A selected piece shows the area it can reach this turn. A target hex shows the path, with a marker where each turn's movement ends, and the number of turns; an enemy is marked as the target and shows the expected HP loss on both sides. The numbers are the rules' own with the random factor left out: every modifier of both sides counts (traits, leaders, unit abilities, policy cards, the ground), and so does the penalty for attacking from the water. An upgrade shows the price the nation really pays.
- **Only what is in sight.** Paths, reach and previews are worked out on what the player knows (see "Fog of war" below): a unit the fog hides is no target, blocks no planned path and answers no click. An order onto its hex is a move; the piece stops in front of it when the rules refuse the step.
- **Placing improvements.** After picking an improvement in a build queue, valid hexes are highlighted; the build list names the yield the improvement gives. The valid hexes are the rules': a nation whose trait opens more ground (夜郎's mountains) is offered it.
- **Keyboard.** Every control can be reached with Tab and pressed with Enter or Space; the control in focus has a ring. Until Tab is used, Enter is the main action button wherever the mouse left the focus, and holding Space speeds the animations up. A redraw keeps the focus on the control it was on.

## HUD layout

| Position | Element |
|---|---|
| Top bar | The player's nation (a click opens its kit); gold, supply (the fighting units the player has against the number its cities supply, in vermilion with the surcharge once it is over), science and culture per turn, average city morale; era and turn counter; the list of polities, victory progress, menu |
| Top left | Current research with the turns it takes, and culture stored towards the next policy card; each opens its overlay |
| Top right | The 12 major nations, each marked with its relation to the player; a click opens its panel |
| Right edge | Notifications |
| Bottom left | Minimap with lens toggles: political, resources, diplomacy |
| Bottom centre | Panel for the selected unit or city |
| Bottom right | The main action button |

## The main action button

Everything that needs attention goes through one button. The button shows the current item and a click goes to it; repeated clicks cycle through all of them. Only when nothing is pending does it become "Next turn". Enter is the same as clicking it, and one press of Enter while the other polities move is remembered and applied when they are done.

The queue, in order:

| Item | When | A click |
|---|---|---|
| Idle unit | It has moves left and no order | Selects it and flies to it |
| City | Its build queue is empty | Opens the city panel |
| Research | Nothing is being researched and a tech is open | Opens the tech tree. The player's research is never chosen for them |
| Policies | A card can be unlocked, or a slot is empty while an unlocked card is in no slot | Opens the policy overlay |
| Proposal | Another nation proposed an agreement or a resource deal | Opens that nation's panel, which shows the proposal with accept and decline |
| Peace offer | A polity at war with the player offered peace during the last turn | Opens its panel. Declining lasts for the turn |

Pending proposals and peace offers also appear as notifications with the same two buttons.

## Panels

- **City**: slides in from the right, never full screen. Build queue, focus, yields. The capital has a line under its yields with what the seat adds to them (doc 03: gold and science), the percentages taken from the rules' data. Every unit and building in the build list has a second button that buys it with gold. When one more fighting unit would stand beyond the supply limit, the list of units opens with a warning that says what the unit would add to the surcharge per turn; units that do not fight are not marked. A city with an airfield has an air-strike button: it marks the targets in reach that the player sees, and a click on one strikes it. The rules also allow a strike at a city the player knows of but does not see; the interface does not offer it, and a button with no target but such a city says "target out of sight". At the bottom are the trade routes: the slots, the routes in force with their income, and a picker of destinations ranked by the income they would give. Choosing a destination draws its path on the map; a second button opens the route.
- **Unit**: besides fortify, sleep, skip, upgrade and settle, a unit standing on something it can pillage gets a pillage button, and a melee land unit next to an enemy capital gets "demand vassalage", disabled with its reason until the city has fallen. The button carries the vassals the player holds against the number their era allows.
- **Tech tree**, on T: a full-screen overlay. Eras are columns and prerequisites are lines; each tech shows its cost, the turns it would take and what it unlocks. A click on an open tech sets the research and closes the overlay.
- **Policies**, on P: a full-screen overlay. The slots are on top; below, the 24 cards by era and kind, with the culture the next card costs. A click unlocks a card that can be unlocked and puts an unlocked card into the first empty slot. With every slot full it picks the card up, and a click on a slot swaps it in; a slot that cannot be swapped says why (the cooldown). A filled slot has a button that takes its card out. A card the player took out is out on purpose: the main action button does not ask for it again until the player has put it back.
- **Diplomacy**: there is no wall of 50 portraits. Only the 12 major nations sit in the top right; any other nation is opened by clicking it on the map or in the list. A nation's panel shows the favour between it and the player with what moves it (the causes listed add up to the level favour moves towards; those of the balance of power, a feared leader and a common threat, name the leader), the agreements and deals in force with their terms, the proposals waiting for an answer, and a button for everything the player can do: war or peace, each agreement (propose, or end one in force), gifts of gold, and each resource deal either way at the price the AI asks and pays. A button the rules refuse is disabled and carries the reason. The proposal of vassalage carries the vassals the player holds against the number their era allows. A peace offer that would make the other nation the player's vassal (doc 03, "Submission") is named so wherever it can be accepted: in the notification, in the list of proposals and on the peace button. What a major nation's leader is out for in this game (the ambition) is hidden information: the panel shows it only for an ally or a vassal of the player, and to the observer. A city-state's panel shows its type and what the suzerain gets, the suzerain, and the influence of each nation courting it. A nation's panel names its leader with the personality that drives its AI, and ends with its kit.
- **List of polities**, from the top bar: every living nation and city-state with its relation to the player, sortable by favour, strength and distance. A row opens the polity's panel.
- **Victory progress**, from the top bar: for each of the three victories, the current leader with its standing and the player's own. Below it is the balance of power: every nation in the race, the most feared first, with the track it leads on (income, science or army) and how much it is feared, which is the favour it loses with every nation that fears it.
- **Nation select** is the cover of the game: the title, the list of nations on the left, the map in the middle, and on the right the kit of the highlighted nation with the button that starts the game. The map flies to the highlighted nation. The list can be narrowed to one region and ordered by region or by difficulty either way; every nation shows its difficulty rating as one to four pips, since a one-city nation and a large one are not equal starts, and the 12 default major nations carry a small vermilion seal. Above the button that starts the game is the difficulty level of the game (doc 03, "Difficulty"): five levels with the middle one chosen, and under them what the chosen level changes, its numbers taken from the rules' table. The level is stored with the game and the menu shows it. An observer's game is always at the middle level.
- **Kit**: the same five rows wherever a kit is shown (nation select, the player's own kit from the top bar, another nation's panel): the trait with its effect, the leader with the archetype and the buff's effect, the unique unit with its piece, era and class, the unique building, improvement or road upgrade with the tech that unlocks it, and the specialty. The effect texts carry no numbers of their own: every number is filled in from the rules' data.
- **Unique items** take the place of the generic ones everywhere: the tech tree is the player's own (its unique unit, building and improvement stand where they replace a generic one, its extra ones and its road upgrade are added, nobody else's are listed), and the build list, the buy buttons, the queue and the unit panel use the unique names. A unique unit's piece has its own character filled with gold, on the board and in the unit panel.
- **Leaders** appear only as a name and a permanent buff. There are no leader screens or portraits.

## Animation

What the player's own actions and the other polities' turns do on the board is played before the board takes the new state: pieces slide, strike and fall, cities shoot, a captured zone changes colour. Only what is in view is played. Many events in one turn play faster, so that a long turn does not hold the player up. Holding Space speeds the animations up; Escape skips them. Observer mode's camera goes to where a city fell or a war began. Runs of many turns and automated browsers play nothing.

## Fog of war

A player sees what their nation sees (doc 03, "Fog of war"); the observer sees everything. The interface applies it everywhere:

- **The board.** The renderer gets the fog per hex (unseen, remembered, in sight) and dims what is out of sight; the terrain is never covered. The player's own units, cities and land are shown as they are. A foreign unit is shown only on a hex in sight. A foreign city in sight is shown as it is; out of sight it is shown as the player last saw it, with the owner and size it then had, and a city on a site the player has never seen is not shown, except the capitals the polities start with, which everybody knows. Improvements and roads out of sight stay as last seen, and of a foreign trade route only the parts in sight are drawn. Borders are always the current ones: they are common knowledge.
- **What the player remembers** of cities, improvements and roads is kept by the interface, since a save holds only which hexes were seen. It is stored next to the autosave, so a continued game has it. A game loaded from a file starts with what is in sight and the starting capitals as they were on the first turn.
- **Animation and sound.** Only what the player's nation saw is played: nothing a hidden unit does, no step between two hexes out of sight, no strike at a hex out of sight, no fall of a city out of sight.
- **Notifications.** A player is told of what their nation is a party to, of what the whole world knows (a new era, a stage of the endgame project), and of a city that falls where they can see it. A notification never flies to a hex the player has not seen.
- **The camera** never moves by itself to a hex the player has not seen. Where the player looks is theirs to choose: the terrain is open.
- **The minimap** lays a light veil over what the player has seen but does not see now, and a darker one over what they have never seen. Its lenses show borders, resources and relations, which fog does not hide.
- **The list of polities** shows favour, army strength and distance: all public (doc 03).

## Camera at the start

A game opens on the player's capital with its whole zone in view. Observer mode opens on the whole map, from a distance worked out from the size of the map.

## Minimap lenses

- **Political**: the colour of each hex's owner.
- **Resources**: muted ground, with the resources the player can see marked: strategic ones in vermilion, specialties in gold.
- **Diplomacy**: each owner's relation to the player: at war, overlord or vassal, ally, partner in a trade pact or open borders, truce, peace.

## The board

The interface gives the renderer everything the rules know about the board:

- **Pieces** in the material of their era; a unique unit with its own character, filled with gold.
- **Cities** in the architectural family of the nation that founded them (doc 02's table; the renderer's own for a polity without a kit), which stays when a city changes hands; in the era of their owner; with walls once they have them (or what replaces them); growing with the number of their buildings.
- **Landmarks**: a nation's landmark stands in the city where its unique building was built, in the city on whose land its unique improvement lies, and, for the two nations whose unique building is a road upgrade, in their capital once they know the tech. It follows what was built, not who holds the city.
- **Improvements**: the renderer has four looks (farm, pasture, mine, fishery) and each improvement takes the nearest: canals, paddies, terraces, gardens and reservoirs are fields, a pass and a forestry are works, the ice road is the road it lays. A pillaged improvement is not drawn until it yields again.
- **Roads, railways and trade routes.**

## Settings

The menu has the settings, stored locally and in force again at the next visit:

| Setting | Values |
|---|---|
| Quality | Auto (the default: the renderer lowers its resolution when frames run long), low, medium, high |
| Interface size | The HUD is laid out for a 1280 × 720 window and scaled as a whole: auto (the default: the window's size against 1280 × 720, between 0.8 and 2), small (0.85), normal (1) and large (1.3) |
| Animation speed | 0.5×, 1× (the default), 2×, 4×; holding Space multiplies it by four |
| Volume | A master volume, and mute |
| Language | Chinese or English |

## Sound

All sound is synthesised in the browser; there are no audio files. Each sound is a few layers of an oscillator or of filtered noise under a short envelope:

| Sound | When | Made of |
|---|---|---|
| Piece set down | A piece moves | A click of noise and a short low thump |
| Melee | A piece strikes | A scrape of noise, a clank and a ring |
| Ranged volley | A piece or a city shoots | Three rising swishes, then a thud |
| Siege | A siege engine shoots | A crack, a low boom and its rumble |
| City captured | A zone changes hands | Three drum beats and a gong |
| Turn start | The player's turn begins | Two soft notes a fifth apart |
| Research finished | The player's research is done | A pentatonic run upwards |
| Click | A button is pressed | One tick, much quieter than the rest |

Battle sounds follow what the board plays: only what is in view sounds, a run of the same sound counts once, and one batch of events sounds at most six times, so that a long turn of the other polities does not pile up; a falling city is always heard. Under everything lies a quiet ambient bed, a drone of three voices with wind, that moves to another root with each era and drops to a hum in the industrial age. Nothing sounds before the player's first click or key press, and an automated browser makes no sound at all.

## Bilingual text

- All UI strings exist in Chinese and English. The names on the political map follow the interface's language.
- Unit pieces carry a Chinese character in both languages. It is the game's visual signature; for readers who do not know the character it works as an icon, and hover or long press shows the English name.

## Visual style of the UI

The map is realistic, so the UI is restrained:

- ink-black translucent panels;
- vermilion as the only accent colour;
- a Song-style serif for titles, a sans-serif for body text;
- line icons, nothing skeuomorphic;
- no subtitles or helper text that only restate what the interface already shows.

How this is built:

- **Colour.** Ink, paper (the text), a dimmed paper and vermilion; nothing else belongs to the interface. Vermilion marks what is chosen, what is at war, what needs an answer and the one button that commits (next turn, play, declare war). The standing of a major nation is told without more colours: a vermilion foot for war, dotted for a truce, a paper foot for an alliance or a vassalage, dotted for a friendly nation. Colours that come from the map (a nation's band, the minimap, a piece's material and its gold) are the map's, not the interface's.
- **Type.** Titles, names and the main action button are set in the system's Song-style serif (Songti SC, STSong, Noto Serif CJK, Source Han Serif, SimSun, then Georgia); everything else in the system's sans-serif. No font is shipped.
- **Icons** are line drawings on a 16 × 16 grid, built in code as inline SVG and drawn in the colour of the text around them. There are no image files. Yields are shown by their icon; the name is in the tooltip.
- **Spacing** comes from one scale: 4, 8, 12, 16 and 24 pixels.
- **A piece in the interface** looks like the piece on the board: the material of its era, the band of its nation, the character on top.

## Turn flow aids

See "Turn pacing", "Observer mode" and "Saves" in [03-gameplay.md](03-gameplay.md).
