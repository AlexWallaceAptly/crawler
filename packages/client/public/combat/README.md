# Combat sprites (grid mode)

Every sprite here is optional. Until a file exists, the board draws a text glyph,
so art can land one file at a time.

## Format

- 128x128 PNG, in the same painted pixel-art style as `../tiles/`. The board shows them at 30-56px with `image-rendering: pixelated`.
- **Floor tiles** (`floor/`) are opaque, full-bleed and seamless, with no frame.
- **Everything else** is transparent: the subject centred in about 96px, lit from the top-left, with a 1-2px dark outline so it reads at 32px.
- The file name is the JSON id, in snake_case. Variants are `<id>_2.png`, `<id>_3.png`.

## Folders

| Folder | Named after | Source of ids |
| --- | --- | --- |
| `floor/` | `<theme>_<n>` (variant n = 1..floorVariants) and `door` | `floors.json` → `arena.floorVariants` |
| `obstacle/` | feature id | `arenaFeatures.json` (kind `obstacle`) |
| `terrain/` | feature id | `arenaFeatures.json` (kind `terrain`) |
| `hazard/` | feature id | `arenaFeatures.json` (kind `hazard`) |
| `unit/` | `crawler`, or the enemy family id | `enemies.json` |
| `item/` | item or consumable id; `junk_pile` is the generic fallback | `items/*.json` |
| `ui/` | overlay name | — |
| `status/` | status id | `statusEffects.json` |

## Needed for the first playable (16)

| Folder | Sprites |
| --- | --- |
| floor | `undercroft_1`, `door` |
| obstacle | `pillar` (blocks movement and sight), `rubble` (movement only), `crate` |
| terrain | `sludge` |
| hazard | `steam_vent`, `caltrops` |
| unit | `crawler` (a body, not the minimap chevron), `sump_rat`, `mold_shambler`, `scrap_goblin`, `pipe_snake`, `drain_leech`, `fuse_imp`, `gutter_crab` |

## Nice to have

| Folder | Sprites |
| --- | --- |
| floor | `undercroft_2`, `undercroft_3`, `undercroft_4` |
| obstacle | `barrel`, `pipe_cluster`, `dead_boiler`, `lockers`, `shopping_cart` |
| hazard | `live_wire`, `gas_leak`, `rust_spikes`, `tacks`, `barbed_wire`, `broken_glass`, `marbles`, `oil_slick`, `glue`, `fire`, `smoke`, `trip_wire` |
| item (on the floor) | `junk_pile`, then one per junk id (see `items/consumables.json` and `items/bases.json`, tag `junk`) |
| ui | `move`, `attack`, `target` (CSS highlights stand in for these) |
| status | the 14 statuses in `statusEffects.json` |
