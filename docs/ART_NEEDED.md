# Crawler: art still needed

As of 2026-11-20, after Floors 2 and 3 and the story layer (Echo, bosses, the Codex) went in.

Every piece is optional to the game. Until a file exists, the game draws a text glyph instead, so art can land one file at a time and shows up on the next deploy. The full format notes are in [`packages/client/public/combat/README.md`](../packages/client/public/combat/README.md).

**Needed now: 62 drawings** (13 characters, 11 status icons, 37 floor tiles in three floor sets, 1 map tile).

## How to deliver

- **Transparent PNG**, in the same painted pixel-art style as the existing sprites. Draw around 128px; the board shrinks each image to fit its square (30-56px on screen, pixelated), so it has to read at small size.
- **The file name is the id in the tables below**, plus `.png`, dropped into the folder named in each section.
- Floor tiles are the exception: opaque, top-down, low-contrast, filling the square edge to edge. They have their own format (section 3).

## 1. Characters: `packages/client/public/combat/unit/`

### Floor 2 and Floor 3 enemies (10)

Shown as a single letter until drawn.

| File | Name | Floor | What it is |
| --- | --- | --- | --- |
| `tag_moth.png` | Claim-Tag Moth | 2 | A moth whose wings are two paper claim tags, stapled on. Drawn to light, and to anyone who has lost something, which is everyone. |
| `unclaimed_suitcase.png` | Unclaimed Suitcase | 2 | A hard-shell suitcase that waited on the carousel so long it learned to walk. The zipper is the mouth. |
| `umbrella_bat.png` | Umbrella Bat | 2 | A black umbrella that opens and shuts like a wing. Roosts upside down and drops on whatever walks under. |
| `odd_sock_wraith.png` | Odd Sock Wraith | 2 | The ghost of every sock that came out of the dryer alone. Floats at arm's length and clings, statically, to anything warm. |
| `finders_keeper.png` | Finders Keeper | 2 | A grubby little goblin in a coat of claim tags who has decided everything down here is his. |
| `brake_eel.png` | Brake-Line Eel | 3 | A long black eel with a brake line for a spine. Lives in the flooded drive aisles. |
| `hubcap_crab.png` | Hubcap Crab | 3 | A crab wearing a chrome hubcap as a shell. It spins it when it's angry, which is always. |
| `oil_slick.png` | Oil Slick | 3 | A puddle of motor oil with ambitions. It flows uphill toward warmth. There is already an oil-slick *hazard* tile, so this one needs to read as a creature (eyes, a raised edge, a reaching tendril). |
| `valet_imp.png` | Valet Imp | 3 | A red-vested imp with a ring of keys to cars that drowned years ago. |
| `car_alarm.png` | Car Alarm | 3 | A car's alarm, loose from the car. It hangs in the dark like a jellyfish made of headlights and grief. |

### Floor bosses (3)

Each floor has one optional boss in a dead-end lair. A boss takes one square like everything else, so it's shrunk to the same size as a rat. More detail is fine, but it still has to read small. The board adds a highlight to mark it as a boss.

| File | Name | Floor | What it is |
| --- | --- | --- | --- |
| `free_sample_mimic.png` | The Free Sample Mimic | 1 | A courtesy table that never stops offering. The tray is its tongue, and the tablecloth goes all the way to the floor for a reason. |
| `lost_property_golem.png` | The Lost Property Golem | 2 | A heap of unclaimed things that stood up: coats for arms, a filing cabinet for a chest, a hundred claim tags rustling where its face should be. |
| `valet_kraken.png` | The Valet Kraken | 3 | A kraken in a red valet vest, living in the flooded valet lot. It parks your car. It parks you. It keeps the keys. |

## 2. Status icons: `packages/client/public/combat/status/` (11)

Small symbols drawn in a unit's top-right corner, two at most. A status with no icon shows its first letter. The existing six (bleeding, burning, confused, poisoned, stunned as a shock bolt, slowed as a snowflake) set the style.

| File | Status | Meaning | Where it shows up on Floors 1-3 |
| --- | --- | --- | --- |
| `blinded.png` | Blinded | Can't see well; worse attacks | The Valet Kraken's ink; Echo's Glow at full brightness; some enemies and items |
| `braced.png` | Braced | Feet planted, guard up | The crawler's brace move (seen often) |
| `tethered.png` | Tethered | Tied in place by Echo's rope | On enemies, from Echo's Rope Bind |
| `sated.png` | Politely Declined | You said no thank you twice; it can't attack you | On the Free Sample Mimic |
| `sorting.png` | Sorting | Busy re-filing the item you returned | On the Lost Property Golem |
| `parked.png` | Parked | Has parked itself, as the ticket demands | On the Valet Kraken |
| `hasted.png` | Hasted | Extra action each turn | From some drinks |
| `shielded.png` | Shielded | Absorbs damage | From some items |
| `regenerating.png` | Regenerating | Heals every round | Regenerating enemies; some items |
| `feared.png` | Feared | Can only flee or cower | Some enemies; one oddity item |
| `invisible.png` | Invisible | Can't be targeted until it attacks | From some items |

Later: `charmed.png` (nothing in the game applies it yet).

## 3. Floor tiles: `packages/client/public/combat/floor/` (37)

The floor is drawn by an autotiler that works like Godot's terrains. Each floor has a **base** terrain and a second terrain the game paints over it in patches. The game picks the right edge or corner piece for every square from its neighbours. All three floors show programmer-art placeholders now: Undercroft stone with water, claim tags or carpet drawn on top.

Each floor needs:

- **4 base tiles**: the main tile, used on most squares, plus 3 accents, mixed in at 10 : 1 : 3 : 1.
- **The transition pieces** for its second terrain. How many depends on the floor's mode.

| Floor | Base | Painted over it | Mode | Transition pieces | Total |
| --- | --- | --- | --- | --- | --- |
| 1: The Welcome Lobby | Marble with hairline cracks that all point down | A carpet runner across the room, patterned "in swirls designed by someone who hated eyes", with a border | Corners and sides | 14 | 18 |
| 2: The Lost-and-Found Warrens | Worn concrete or linoleum aisle | Drifts of paper claim tags, "drifting in the corners like snow" | Sides | 6 | 10 |
| 3: The Flooded Parking Garage | Wet concrete, maybe a painted line on an accent | Ankle-deep water with a rainbow oil sheen | Corners | 5 | 9 |

### The pieces, by mode

The game flips and rotates each piece to cover every direction, so one drawing per shape is enough. That only works if the art has no direction: no light from one side, no text, no brick courses. If a set has a direction, say so. It will then only be flipped, or you can draw each direction.

- **Corners (Garage water): 5 pieces.** Water in all four corners (full water), in one corner, along one edge (two corners next to each other), in two opposite corners, and in three corners.
- **Sides (Warrens tags): 6 pieces.** Tags reaching all four sides (full), three sides, two sides next to each other, two opposite sides, one side, and a lone patch touching no side.
- **Corners and sides (Lobby carpet): 14 pieces.** The standard 47-tile "blob" set, cut down to one piece per shape. The full carpet and a lone square are two of the 14. If the carpet's pattern has a direction, draw all 47 instead.

Wherever the second terrain meets the base at a tile's edge, cross the edge at the same place on every tile (the middle of the edge for corners mode, the same distance in for the other two). That way neighbouring squares join up.

### Two ways to deliver

1. **A sheet:** 128px squares in a grid, any order, with a note saying which piece is which.
2. **A Godot 4 TileSet:** open the project in `sprites/tilesets/` in Godot, make an atlas from your sheet, paint the terrain bits, and save the `.tres`. It's imported with `npm run import:tileset -- sprites/tilesets/<floor>.tres --id <floor>`. `lobby.tres` there is a worked example (the placeholder carpet).

The placeholders show what each piece does: `garage_water.png`, `warrens_tags.png` and `lobby.png` in `packages/client/public/combat/floor/`.

## 4. Map tile: `packages/client/public/tiles/` (1)

| File | What it is |
| --- | --- |
| `workshop.png` | A room with a workbench, where you craft. 128x128 transparent, in the style of the other map tiles. It shows ⚒ until drawn. |

## Already covered

All the props, terrain and hazards on Floors 1-3 reuse existing art, so no new obstacle, terrain or hazard art is needed.

## Not needed yet

**Later floors.** Each new floor will need its enemies, a floor tile set and its boss. The bosses are already named: The Lunch Lady Colossus (4), The House (5), The Overdue Librarian Wraith (6), The Fern Matriarch (7), The Executive Producer's Intern (8), The Ringmaster of Chargebacks (9), The Curator of Tanks (10), The Anchor Store (11), The Foreman (12) and The Mother Below (13).

**Art that needs code first.** The game has nowhere to show these yet, so they'd go unused for now:

- **Item icons.** Only loose junk on the battle board uses item art today. Inventory icons would cover Echo's module parts, the tagged lost property and the 30 hand-written oddities.
- **Echo's vessel.** A small portrait for the Echo panel, in four versions: a handheld, a music box, a ticket stub and a snow globe (one is picked per run).
- **A boss-lair map tile.** Today it's a red `!` over the normal lair tile.
