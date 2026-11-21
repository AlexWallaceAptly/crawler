# Combat sprites (grid mode)

Every sprite here is optional. Until a file exists, the board draws a text glyph (or, for highlights, a CSS tint), so art can land one file at a time.

## Format

- **Any size works.** Each image is scaled to fit its board square (30-56px on screen, with `image-rendering: pixelated`). Images cropped to the subject are fine, but every sprite then fills its square, so a rat is drawn as big as a crab.
- **Floor tiles** (`floor/`) are opaque and top-down, filling the square with no frame. A 1px dark gap separates squares, so perfect seams aren't needed. Keep them low-contrast so things on top read. They're drawn by the autotiler from `packages/content/tilesets.json` (see "Floor tiling" in docs/DESIGN.md), as separate squares or cut from a sheet, and may be flipped and rotated.
- **Everything else** is transparent PNG.
- **Names.** The file name is the JSON id in snake_case. Status icons are named by status id.

## Folders

| Folder | Named after | Used for |
| --- | --- | --- |
| `floor/` | Whatever the floor's tileset names (an `image` per tile, or an atlas `texture`), plus `door` | Ground under each square, and door tiles on the board edge. The tileset sets which tile fits where and how often each variant appears (the stone base: 10/1/3/1, so `undercroft_1` is the main tile and the rest are accents). |
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
| floor | `undercroft_1`-`_4`, `door`, and placeholder sheets `garage_water`, `warrens_tags`, `lobby` | Real tilesets for Floors 1-3 (base tiles plus transition pieces). See [docs/ART_NEEDED.md](../../../../docs/ART_NEEDED.md) |
| obstacle | All 52 obstacles: the original eight (pillar, rubble, crate, barrel, pipe_cluster, dead_boiler, lockers, shopping_cart), 21 props (appliances, storage, bathroom fixtures, trash_can), and 23 pieces of furniture (carts, tables, benches, the vise workbench) | — |
| terrain | `sludge` | — |
| hazard | All 14 | — |
| unit | `crawler` + all 7 Floor 1 families | The 10 Floor 2-3 families and the 3 floor bosses (see docs/ART_NEEDED.md) |
| item | `junk_pile` | Per-item icons (optional) |
| ui | `move`, `attack`, `target` | — |
| status | `bleeding`, `burning`, `confused`, `poisoned`, `stunned` (the "shock" icon), `slowed` (the "freeze" icon) | `blinded`, `hasted`, `feared`, `charmed`, `shielded`, `regenerating`, `invisible`, `braced`, plus the boss and Echo ones: `tethered`, `sated`, `sorting`, `parked` |

Also still missing: the minimap tile `../tiles/workshop.png` (glyph ⚒ until then).

## Masters vs. published copies

The furniture set (`sprites/furniture_carts/`) was drawn at 180-314px. The copies in `obstacle/` are resized to fit 128px; it's a cleaner downscale than the browser's, and a third of the download. To change one, edit the master and re-export at 128px or smaller.

Four of the furniture pieces (park_bench, wood_bench, padded_bench, round_table_stools) and the food_service_cart are defined in `arenaFeatures.json` but not in the Undercroft's list. They're waiting for the Floor 2 food courts.

## Not used yet

Art in the repo-root `sprites/` folder that the board can't use yet:
- **Flat clutter** (papers, debris, pizza box, food tray, rags, bottles, box, trash bag), the floor drain, vents, and the pipe grate. These need a non-blocking "decoration" feature kind.
- **The pipe set** (straight, elbow, T, cross, valve, gauge, duct). This needs pieces that connect to their neighbours.

Some clutter could double as item icons by renaming: `rags` → `item/oily_rags`, `papers` → `item/old_magazines`, `trash_bag` → `item/plastic_bag`.
