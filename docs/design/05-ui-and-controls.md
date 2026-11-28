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

- **Preview before commit.** A target hex shows the path and the number of turns; an enemy shows the expected HP loss on both sides.
- **Placing improvements.** After picking an improvement in a build queue, valid hexes are highlighted with the yield change each would give.

## HUD layout

| Position | Element |
|---|---|
| Top bar | Gold, science and culture per turn, average city morale; era and turn counter; the list of polities, victory progress, menu |
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

- **City**: slides in from the right, never full screen. Build queue, focus, yields. Every unit and building in the build list has a second button that buys it with gold. A city with an airfield has an air-strike button: it marks the hexes in reach, and a click on one strikes it. At the bottom are the trade routes: the slots, the routes in force with their income, and a picker of destinations ranked by the income they would give. Choosing a destination draws its path on the map; a second button opens the route.
- **Unit**: besides fortify, sleep, skip, upgrade and settle, a unit standing on something it can pillage gets a pillage button, and a melee land unit next to an enemy capital gets "demand vassalage", disabled with its reason until the city has fallen.
- **Tech tree**, on T: a full-screen overlay. Eras are columns and prerequisites are lines; each tech shows its cost, the turns it would take and what it unlocks. A click on an open tech sets the research and closes the overlay.
- **Policies**, on P: a full-screen overlay. The slots are on top; below, the 24 cards by era and kind, with the culture the next card costs. A click unlocks a card that can be unlocked and puts an unlocked card into the first empty slot. With every slot full it picks the card up, and a click on a slot swaps it in; a slot that cannot be swapped says why (the cooldown).
- **Diplomacy**: there is no wall of 50 portraits. Only the 12 major nations sit in the top right; any other nation is opened by clicking it on the map or in the list. A nation's panel shows the favour between it and the player with what moves it, the agreements and deals in force with their terms, the proposals waiting for an answer, and a button for everything the player can do: war or peace, each agreement (propose, or end one in force), gifts of gold, and each resource deal either way at the price the AI asks and pays. A button the rules refuse is disabled and carries the reason. A city-state's panel shows its type and what the suzerain gets, the suzerain, and the influence of each nation courting it.
- **List of polities**, from the top bar: every living nation and city-state with its relation to the player, sortable by favour, strength and distance. A row opens the polity's panel.
- **Victory progress**, from the top bar: for each of the three victories, the current leader with its standing and the player's own.
- **Nation select**: every nation shows a difficulty rating, since a one-city nation and a large one are not equal starts.
- **Leaders** appear only as a name and a permanent buff. There are no leader screens or portraits.

## Animation

What the player's own actions and the other polities' turns do on the board is played before the board takes the new state: pieces slide, strike and fall, cities shoot, a captured zone changes colour. Only what is in view is played. Many events in one turn play faster, so that a long turn does not hold the player up. Holding Space speeds the animations up; Escape skips them. Observer mode's camera goes to where a city fell or a war began. Runs of many turns and automated browsers play nothing.

## Camera at the start

A game opens on the player's capital with its whole zone in view. Observer mode opens on the whole map, from a distance worked out from the size of the map.

## Minimap lenses

- **Political**: the colour of each hex's owner.
- **Resources**: muted ground, with the resources the player can see marked: strategic ones in vermilion, specialties in gold.
- **Diplomacy**: each owner's relation to the player: at war, overlord or vassal, ally, partner in a trade pact or open borders, truce, peace.

## Interface size

The HUD is laid out for a 1280 × 720 window and scaled as a whole. The menu has four settings, stored locally: auto (the default: the window's size against 1280 × 720, between 0.8 and 2), small (0.85), normal (1) and large (1.3).

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

## Turn flow aids

See "Turn pacing", "Observer mode" and "Saves" in [03-gameplay.md](03-gameplay.md).
