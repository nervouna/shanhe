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
| Top bar | Gold, science and culture per turn, average city morale; era and turn counter; victory progress; menu |
| Top left | Current research and policy progress |
| Top right | The 12 major nations |
| Right edge | Notifications |
| Bottom left | Minimap with lens toggles: political, resources, diplomacy |
| Bottom centre | Panel for the selected unit or city |
| Bottom right | The main action button |

## The main action button

Everything that needs attention goes through one button: an idle unit, a city with an empty queue, a finished research. The button shows the current item and a click flies the camera to it. Only when nothing is pending does it become "Next turn". Enter is the same as clicking it.

## Panels

- **City**: slides in from the right, never full screen. Build queue, focus, yield breakdown.
- **Tech tree** and **policies**: full-screen overlays, on T and P.
- **Diplomacy**: there is no wall of 50 portraits. Only the 12 major nations sit in the top right; any other nation is opened by clicking it on the zoomed-out political map. A sortable list (by favour, strength, distance) is also available.
- **Victory progress**: for each of the three victories, the current leader and the player's gap.
- **Nation select**: every nation shows a difficulty rating, since a one-city nation and a large one are not equal starts.
- **Leaders** appear only as a name and a permanent buff. There are no leader screens or portraits.

## Bilingual text

- All UI strings exist in Chinese and English.
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
