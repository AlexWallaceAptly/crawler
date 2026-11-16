# Combat sprites (grid mode)

Every sprite here is optional. Until a file exists, the board draws a text glyph (or, for highlights, a CSS tint), so art can land one file at a time.

## Format

- **Any size works.** Each image is scaled to fit its board square (30-56px on screen, with `image-rendering: pixelated`). Images cropped to the subject are fine, but every sprite then fills its square, so a rat is drawn as big as a crab.
- **Floor tiles** (`floor/`) are opaque and top-down, filling the square with no frame. A 1px dark gap separates squares, so perfect seams aren't needed. Keep them low-contrast so things on top read.
- **Everything else** is transparent PNG.
- **Names.** The file name is the JSON id in snake_case. Status icons are named by status id.

## Folders

| Folder | Named after | Used for |
| --- | --- | --- |
| `floor/` | `<theme>_<n>` (n = 1..`floorVariants`), plus `door` | Ground under each square, and door tiles on the board edge. `floors.json` → `arena.floorWeights` sets how often each variant appears (Undercroft: 10/1/3/1, so `_1` is the main tile and the rest are accents). |
| `obstacle/` | `arenaFeatures.json` id (kind `obstacle`) | Pillars, crates and props; they block movement, and some block sight |
| `terrain/` | `arenaFeatures.json` id (kind `terrain`) | Sludge (slow ground) |
| `hazard/` | `arenaFeatures.json` id (kind `hazard`) | Standing and thrown hazards. Small debris (caltrops, tacks, glass, marbles, barbed wire, spikes, trip wire) gets a CSS dark outline so it reads on stone. |
| `unit/` | `crawler`, or the enemy family id | Units. The crawler also gets an amber selection ring. |
| `item/` | Item or consumable id; `junk_pile` is the fallback | Loose junk lying on the board |
| `ui/` | `move`, `attack`, `target` | Walkable tiles, enemies you can hit, and tiles you can pick while aiming a throw/shove/dash. Drawn under units. |
| `status/` | Status id | Up to two icons on a unit's top-right corner, plus a "+N" count. A status with no icon shows its first letter. |

## What's here

| Folder | Have | Still missing |
| --- | --- | --- |
| floor | `undercroft_1`-`_4`, `door` | Sets for later floor themes |
| obstacle | All 29 obstacles: pillar, rubble, crate, barrel, pipe_cluster, dead_boiler, lockers, shopping_cart, plus the props fridge, freezer, washer, dryer, stove, dish_sink, tool_chest, shelf, rack, file_cabinet, workbench, cot, chair, bathtub, shower, stall, sink, toilet, trough_sink, urinal, trash_can | — |
| terrain | `sludge` | — |
| hazard | All 14 | — |
| unit | `crawler` + all 7 Floor 1 families | Floor 2+ families |
| item | `junk_pile` | Per-item icons (optional) |
| ui | `move`, `attack`, `target` | — |
| status | `bleeding`, `burning`, `confused`, `poisoned`, `stunned` (the "shock" icon), `slowed` (the "freeze" icon) | `blinded`, `hasted`, `feared`, `charmed`, `shielded`, `regenerating`, `invisible`, `braced` |

Also still missing: the minimap tile `../tiles/workshop.png` (glyph ⚒ until then).

## Not used yet

Art in the repo-root `sprites/` folder that the board can't use yet:
- **Flat clutter** (papers, debris, pizza box, food tray, rags, bottles, box, trash bag), the floor drain, vents, and the pipe grate. These need a non-blocking "decoration" feature kind.
- **The pipe set** (straight, elbow, T, cross, valve, gauge, duct). This needs pieces that connect to their neighbours.

Some clutter could double as item icons by renaming: `rags` → `item/oily_rags`, `papers` → `item/old_magazines`, `trash_bag` → `item/plastic_bag`.
