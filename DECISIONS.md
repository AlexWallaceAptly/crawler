# Decisions

Assumptions made where [the spec](docs/SPEC.md) is silent or ambiguous. Newest milestone at the bottom.

## Milestone 0: Scaffold

- **Folder.** The project root is `crawler/`, matching the spec's folder layout. The spec itself lives at `docs/SPEC.md`.
- **Monorepo.** npm workspaces. Packages export their TypeScript source directly, with no build step between packages: Vite, Vitest and tsx all read `.ts`.
- **Versions.** TypeScript 7, Vite 8, Vitest 5, React 19, Zod 4, Hono 4.
- **Content wiring.** `@crawler/content/index.ts` imports every JSON file into one raw object, and the engine validates it in `loadContent()`. A new content *file* has to be added in two places: that index and `CONTENT_FILES` in `engine/src/content/load.ts`. New *entries* are JSON only.
- **Schemas are the source of truth.** TypeScript types are inferred from the Zod schemas (`z.infer`), so the spec's types aren't written out twice.
- **"Fails loudly"** works at three levels:
  - `npm run dev` runs `npm run validate` first and won't start if any file fails.
  - The server re-validates on every content edit (because of `tsx watch`) and prints the errors.
  - The client shows a full-screen list of the problems.
  
  Objects are strict, so a typo'd key is an error. Cross-references (skill and item ids) and duplicate ids are checked too. All problems are reported together, not just the first. A JSON syntax error fails with the file and line.
- **Server.** `/api/boss` returns 501 until Milestone 10. `.env` is loaded from the repo root with `process.loadEnvFile`.

## Milestone 1: Engine core

- **Check outcomes:**
  - Success means `total >= DC`.
  - Critical success means a success that also beats the DC by 10 or more. Critical failure means a failure that also misses by 10 or more.
  - A natural 20 always succeeds, but it's only a crit if the margin is also +10. A natural 1 always fails, but it's only a crit failure if the margin is also -10 or worse.
- **Opposed checks** ignore natural 1s and 20s and compare totals. Ties go to the defender, per the spec.
- **RNG.** `rng.ts` holds a swappable `[0,1)` source plus a `forceDice()` queue so tests can script exact die results. Every die roll goes through `die()`.
- **Reducer signature.** It's `step(world, action) -> { world, events }`, where `World = { game, account }`. Some actions change the account (rerolls, deaths), so the reducer sees both. They're still saved under separate `localStorage` keys.
- **State is plain JSON.** It's cloned with `JSON.parse(JSON.stringify())` at the start of each step, and the input world is never mutated (a test checks this).
- **The event log lives in `GameState`** (last 300 events), so a reload restores the panels exactly.
- **Free actions.** `help` and unknown commands don't advance the turn. Unknown commands get a System AI reply.

## Milestone 2: Character creation and UI shell

- **Backstory extras.** The crawler has a name, an age (from the occupation's `ageRange`) and a hometown, from `backstory/names.json`. Formative events, quirks and locations each have a `phrase` that slots into the roast sentence.
- **Quirk stat mods** are applied during stat generation, before the 3..12 clamp, as the spec's pseudocode says. They're baked into base stats.
- **Passive modifiers.** A generic `Modifier { to, value }` model covers quirks, item bases, statuses and skill perks. A roll sums every modifier whose `to` matches one of its tags. Examples: `skill:stealth`, `stat:DEX`, `attack:thrown`, `damage:blunt`, `flee`, `defense`, `dr`, `resist:poison`. The `perk:*` tags are flags for the rules to check later.
- **Starting kit equip order.** Clothing goes on first, then the occupation item. If the main hand already holds a weapon, the location weapon goes in the pack. Bases marked `generate: false` are starting-kit only and never drop as loot.
- **Rings.** The item slot `ring` maps to equipment slots `ring1` and `ring2`.
- **Rerolls.** A new account starts with 0. Rerolls are an account unlock, per the spec.
- **Ending a run.** `abandon` asks for confirmation, and `abandon confirm` ends the run as a death with cause `quit`. `new` starts the next crawler. Legacy points arrive in Milestone 8.
- **Old saves.** If the save version doesn't match, the run save is discarded but the account is kept.
- **Restoring MP** is written as `{ kind: "heal", flag: "mp" }`, because the spec's effect kinds have no `mana`.
- **Narrator memory** stores template variant ids (`key#index`) rather than rendered text, so a variant with different `{pick:}` results still counts as a repeat. If a template has only conditional variants and none match, any variant can be used. A missing template prints a visible placeholder instead of crashing.
- **Panels never read raw state.** The engine exposes `view(world)`, a UI projection. Log panels get events through `client/src/router.ts`.
- **Client-only commands:**
  - `i` or `inventory` toggles the inventory overlay, and `Esc` closes it.
  - `wipe save` deletes the run *and* the account, after a confirm dialog. It's a development convenience.
- **Status bar.** It shows `PRE-SHOW` until a floor exists.

## Content: spreadsheet import (backstory and item tables)

- **Source.** The backstory, item base and consumable tables came from a spreadsheet (`content-csv/dcc_game_data.xlsx`). Values that didn't fit the engine's vocabulary were mapped on import rather than rejected:
  - Damage types `electric` became `lightning`, `cold` became `frost` and `holy` became `light`. The modifier `resist:cold` became `resist:frost` so it still matches frost damage.
  - Mana restores written as `stat: "mp"` became `flag: "mp"`, per the Milestone 2 convention.
  - Weapon attack stat `CHA` became `DEX`, because the spec's attack roll only uses STR or DEX. This affects the inflatable tube man and the tour group flag.
  - Clothing worn on the hands (gloves, mittens, corsage, arm floaties, foam finger, arm sling) moved from `offHand` to `hands`, so it doesn't block shields or two-handed weapons.
- **`cure` effect kind.** The spec lists cure potions but its effect kinds have no way to remove a status. `{ kind: "cure", statusId }` removes that status, and a cure without a `statusId` fails validation.
- **New statuses.** `confused` (flag `randomTarget`) and `invisible` (flags `untargetable` and `breaksOnAttack`) extend the spec's starter set of 11, because the consumables use them. Combat (Milestone 4) must implement these flags.
- **Names.** Duplicate names are removed, so each name has the same chance of being picked. First names that belong to characters in the books (Carl, Odette, Yolanda, Imani) are removed, per the originality rule.
- **Stat-range test.** At starter-table sizes the full occupation × event × quirk set is millions of combinations. The test now pairs every occupation with every event and cycles through the quirks.
- **Eyes slot.** Added an `eyes` equipment slot, separate from `head`, so goggles, glasses, masks and eye patches can be worn with a hat or helmet. Full-face gear (welding helmet, racing helmet, mascot head, sheet face mask) stays in `head`. SPEC.md's slot list is updated to match. Old saves still load, because equipment is a partial record.

## Milestone 3: Undercroft writing ingested

- The Floor 1 text was authored by Alex and delivered as JSON (`floors.undercroft.json`, `narration.m3.json`); ingested verbatim, 305 lines total vs the 245 estimated.
- `floors.json` is a table of floor themes (`id`, `name`, `floor`, `roomNames`, `fragments`, `typeLines`) so Floor 2/3 themes are new array entries, not new files.
- Room shapes are a fixed trio (`corridor`/`chamber`/`small`): both name nouns and opening lines are keyed by shape, enforced by a strict object rather than a free record so a typo'd shape fails validation.
- `typeLines` covers exactly the six special room types (`stairwell`, `safe`, `treasure`, `puzzle`, `npc`, `empty`), each defaulting to an empty array — a theme may omit lines for a type and the describer just skips the closing line.
- New narration keys: `explore.interjection`, `timer.warn24h/6h/1h/10m`, `explore.searchNothing`, `explore.rest`, `explore.sleep`, `explore.blocked`, `explore.sleepRefused`, `explore.descendRefused`, `explore.revisit`, `died.collapse`, `floor.cleared`. Collapse death gets its own `died.collapse` key rather than a `when` clause on `died`, since it fires from the timer, not combat.

## Milestone 3: floor generation and exploration

- Grid is 12×9 (108 cells) for 60 rooms — ~55% density reads as tunnels with real dead ends; the spec's 14×10/120 example is denser than plays well. Grid size, room count and timer days live on the theme in `floors.json`.
- Carving is a branching random walk: 22% of steps (or any dead end) jump the cursor to a random carved room, which is what creates branches. Loops connect an extra 10–15% of adjacent unlinked pairs. Connectivity holds by construction; the 100-floor test re-proves it with BFS anyway.
- Stairwells (3–5) are placed greedily at the point maximizing min(distance from start, distance from other stairwells). Safe rooms are 1 per 15 rooms; the first is the tutorial one, forced 4–8 steps from the start; none may sit adjacent to a stairwell (spec).
- The start room is forced corridor/empty so turn one is never an ambush.
- Room types stay hidden from the player except safe rooms and stairwells, which get badges in the room header and status bar; lair/trap/event rooms generate now but behave as flavor until M4/M7.
- Descriptions are opening (by shape) + one sight + one sound *or* smell (50/50) + a type line if the theme has one; cached on the room at first entry so revisits read the same (spec).
- Revisits print the room name and exits only, plus a `explore.revisit` jab 30% of the time; first visits get an `explore.interjection` 10% of the time.
- `look` and `map` are free; move 10m, search 15m, rest 1h, sleep 8h per spec. Rest heals 25% of max HP/MP (spec leaves it open); sleep fully heals but only in safe rooms. Search finds nothing until the M5 loot tables — it still spends the 15 minutes, which is the joke.
- All time flows through `advanceTime()`: warnings fire once per threshold (tracked in `floor.warned`), and at zero anyone off a stairwell dies (`died.collapse`, counts as a death) while anyone on one is auto-descended (floor cleared, not a death).
- `descend` ends the run as a win until Floor 2 exists: `floorCleared` event, bestFloor=2, phase → dead so `new` works; `deaths` is not incremented.
- SAVE_VERSION bumped to 2 (GameState grew `floor`); v1 saves are discarded per the existing policy.

## Milestone 4: Combat

- Floor 1 encounter odds are first-entry 35% in chambers, 8% in corridors, guaranteed elite encounters in lairs, and 15% in event/NPC/puzzle rooms; revisit odds are lower. Safe rooms and stairwells do not spawn encounters. This makes lairs legible high-risk content while keeping ordinary exploration uncertain.
- Combat groups use one randomly selected floor family. Mobs use that family's group-size range; an elite lair encounter has one elite and a 40% chance of one or two supporting mobs. Enemy levels are `floor * 4 + random(-1, 2)`, with family stats shifted from the floor baseline.
- Initiative ties go to the crawler. Enemies above the crawler act before the crawler at the start of each round; the rest act after. The initiative order stays fixed. Combat rounds cost one game minute.
- Enemy damage adds `floor(stat / 4)` rather than the crawler's `floor(stat / 2)` so early crawlers retain a damage edge against groups. Enemy damage still respects crawler damage-reduction and damage-type resistance modifiers.
- A close-range attack can spend a minor action to close one band. If the enemy remains out of reach, the attempt still ends the turn so the fight cannot deadlock at near range. `Hasted` permits two movement minor actions per round; `Slowed` permits none.
- Status duration is counted after the affected combatant gets its first turn. Newly applied statuses keep their full duration through the round in which they land. Travel still ticks and expires statuses once per room moved.
- Talkable enemies use a medium CHA + Persuasion check; success pacifies them and awards half XP. A successful flee leaves combat without XP; failure gives each living enemy a free attack. Fled enemies do not award XP.
- Enemy mods are selected without replacement and baked into their spawned state. The first combat content set has seven Floor 1 families and a small mod table; broader family coverage and balance tuning are deferred to Milestone 13.
- `scripts/sim.ts` runs a headless Floor 1 policy. Its outcomes vary with `Math.random`; it is a reachability/playability check, not a seeded balance benchmark.
- Local M4 acceptance passed: scripted suite and typecheck are clean; a 500-run Floor 1 simulation produced both stair clears and deaths with zero stuck runs. The observed clear rate is a balance snapshot, not a target for this milestone.

## Minimap tiles

- The minimap now renders from `view.mapGrid` (structured cells from `mapGrid()` in `explore.ts`) as PNG tiles in `packages/client/public/tiles/<kind>.png`. `view.minimap` (ASCII) is kept for the `map` command and as the fallback when no grid exists. A tile whose PNG is missing falls back to an ASCII glyph, so art can land incrementally.
- Spoiler rule: a room's true type is shown only once visited. Seen-but-unvisited rooms use the `unknown` tile (the ASCII map already hid everything but `?`). The player marker is a `player.png` overlay on the current room. Room connectors are CSS bars, not images.
- Tile URLs use `import.meta.env.BASE_URL` so the GitHub Pages `/crawler/` base works. `trap-sprung.png` is optional and falls back to `trap.png`.

## Milestone 4b: grid combat, mob packs, junk and crafting

Inserted before Milestone 5 at the player's request (see the build-order row in SPEC.md). Built on the `grid-combat-crafting` branch.

### Combat refactor and fixes

- **Two combat modes, one rulebook.** `combat.ts` keeps every roll shared: `resolvePlayerHit`, `enemyDefense`, `enemyStrike`, `fleeContest`, `freeSwings`, `applyItemEffects` and `damageCrawler`. "bands" is the original model, and "grid" is the tactical arena. The mode is stored on `CombatState` when the fight starts, so changing the setting mid-fight only affects the next one.
- **The toggle** lives on the account (`account.settings.combatMode`), so it outlives a crawler. The field is optional, so older accounts still load without an `ACCOUNT_VERSION` bump. `set combat grid|bands` is a free action allowed in any phase, and like `help` it doesn't advance the turn counter.
- **Fleeing goes back where you came from.** `startCombat` used to record `fromRoom` after `enterRoom` had already moved the crawler, so a "clean getaway" left you standing in the ambush room. The `go` handler now passes the previous room through `travel()` → `maybeEncounter()` → `startCombat()`.
- **Items hit what they're aimed at.** Effects with `target: "target"` hit the first targetable enemy (bands) and `all_enemies` hit every enemy. Untargeted, `self` and `all_allies` effects hit the crawler. Pepper spray no longer blinds the user.
  - Out of combat, an item whose every effect needs an enemy is refused and not consumed.
  - Items with no effects ("junk" parts) are refused with a hint to combine them.
  - `heal` with `flag: "mp"` restores MP, `loot` with `flag: "gold"` adds gold, and `xp` adds XP.
  - `stat` buffs still wait for Milestone 5.
- **The turn start is idempotent.** `beginTurn()` (formerly `playerTurnStart`) sets `combat.turnBegun`, which resets at the end of the round. A command rejected after the start (e.g. an untargetable target) no longer ticks poison a second time when the player tries again.
- **A failed flee keeps the turn order.** Free swings replace the slower enemies' turns as before, but the round now closes through `closeRound()`, so faster enemies still open the next round.
- **Minor-action buttons read status flags** (`noMinor`, `extraMinor`) instead of the ids `slowed`/`hasted`.
- **Duct tape** is tagged `bind` (a crafting part), not `healing`. The heal button and the sim no longer burn it as a potion; it still heals 1d4 if used directly.
- **Crafted weapons** can carry `onHit` (a status with a chance), which `resolvePlayerHit` applies on any hit that doesn't kill.
- `SAVE_VERSION` is 4: `CombatState` gained `mode` and `turnBegun`. Version-3 run saves are discarded and accounts are kept.

### Mob packs

- **Ordinary fights are packs, never a lone enemy.** Chambers and other rooms roll `pack` (2-4 enemies on Floor 1) and corridors roll `corridor` (2-3). Lairs still roll an elite on the first visit. The ranges live on the floor theme as `encounters` in `floors.json`.
- **Minion tier.** Pack members are minions:
  - Two levels below a mob (minimum 1), so stats shift down 2.
  - 60% of a mob's HP multiplier and 60% of its XP.
  - No mods.
  
  A Floor 1 rat minion has about 5 HP and dies to one good hit. Mob and elite are unchanged; the boss tier arrives with Milestone 9.
- **Two families per pack at most.** The first family fills what its `groupSize` allows. A second family fills the rest, or joins anyway 35% of the time (`mixedChance`). If two small families still come up short of 2, the first family is topped up past its cap rather than leaving a lone enemy. Family `groupSize` now means "how many of this family a pack can hold": rats and leeches 2-4, goblins 2-3, the rest 1-2.
- **Elites** are alone half the time (`eliteAloneChance`). Otherwise 1-2 minion escorts of the same family join them, instead of full mobs.
- **Marks.** Same-named enemies get letters at combat start ("Sump Rat A", "Sump Rat B"), stored in `Enemy.mark` and baked into the name, so `attack rat b` works in both modes. Name matching prefers an exact name, then a substring.
- **Speed.** Families have `speed` (tiles per grid turn; the crawler has 4): rat and imp 5, goblin and snake 4, leech and crab 3, shambler 2. They also have an optional fallback `glyph`.
- **Balance snapshot** (bands mode, Floor 1):

  | | Enemies per encounter | XP | Total enemy HP | Sim clear rate |
  | --- | --- | --- | --- | --- |
  | Before | 1.7 | 24 | 23 | 28% (300 runs) |
  | After | 3.0 | 20 | 18 | 41% (400 runs) |

  Packs hit more often but die faster; tuning is Milestone 13's job.
- **Test flakes fixed along the way:**
  - The explore revisit test could walk into a lair, where the guaranteed elite fight blocked the walk back.
  - The initiative test used the random crawler's kit, so a missed ambush shifted the forced dice.

### Grid combat engine

- **Grid is the default** on this branch. A missing account setting means grid, and `set combat bands` switches back.
- **Arenas are generated per fight from the room's shape**:

  | Shape | Size | Obstacles |
  | --- | --- | --- |
  | Corridor | 9×4, or 4×9 when entered from north/south (the long axis follows you in) | 1-2 |
  | Small | 6×6 | 1-3 |
  | Chamber (also lairs and event rooms) | 8×8 | 3-6 |

  - **Doors.** Each room exit gets one door tile in the middle of that edge; the one you came through is the entry.
  - **No walls.** Obstacles are single-tile props, and the board edge is the wall. There's no wall auto-tiling, so the art list stays short.
  - **Dressing.** 0-2 terrain patches of 1-3 tiles, plus 0-1 standing hazards. All of it comes from the theme's `arena` lists in `floors.json`, with features defined in the new `arenaFeatures.json`.
  - **Reserved tiles.** Door tiles, the tile just inside each door, and spawns are never furnished.
  - **Validation.** Every enemy and every door must be reachable from the crawler. If not, it rerolls up to 20 times, then drops the furniture.
  - **Not cached.** Arenas aren't saved on the room, so a rematch gets a new board.
  - **Trap rooms.** A trap type can name an `arenaHazard` for fights in that room. Trap rooms don't roll encounters yet, so it's groundwork.
- **Spawns:**
  - **You** start just inside the entry door. With no entry (tests), the middle of the west side.
  - **Normal enemies** spawn at distance ≥ min(4, the farthest open tile − 1), clustered within 2 tiles of the previous one. Ranged families take the farthest tiles.
  - **Enemies that won initiative** spawn 2-3 tiles away and still take their ambush turn.
  - **Elites** take the farthest tile nearest the far centre.
- **Geometry:**
  - **Distance.** 8-way Chebyshev, so a diagonal costs 1. A diagonal step is blocked only when both orthogonal neighbours are obstacles.
  - **Bands.** They come from distance: close ≤ 1, near 2-3, far 4+. Each enemy's `range` is re-synced after every move, so `attack.range`, item ranges, `EnemyStrip` and bands-written content keep working unchanged.
  - **Line of sight.** Bresenham, symmetric, blocked only by `blocksSight` features (pillars, crates, smoke), never by units. Adjacent tiles always see each other. Anything beyond close range needs sight.
  - **Pathing.** Dijkstra with a fixed neighbour order (orthogonals first). Ties between equally good tiles go through `rng.pick`.
- **Turns.** SPEC's minor action becomes a movement budget:
  - **Speed.** The crawler moves 4 tiles (plus any `speed` modifiers); enemies use their family `speed`. Slowed (`noMinor`) caps movement at 1, hasted (`extraMinor`) adds 2, and terrain `moveCost` comes out of the budget (sludge costs 2).
  - **Moving.** `move` never ends the turn; any action does. Movement is set when the turn begins.
  - **Before your first command.** The view shows your full speed as available.
  - **Stun.** A stunned crawler's first command, even a move, ends the turn.
- **Attacking out of reach** walks you, with the movement you have left, to the cheapest tile from which your weapon reaches. If you get there you swing; otherwise the turn ends with `combat.cantReach`, the same contract as bands' auto-advance.
- **The pack bonus is the only positional rule.** An enemy attacking you while adjacent gets +1 to hit for each other living enemy also adjacent to you, up to +2, logged as `(+2 pack)`. There are no opportunity attacks, cover or facing.
- **Fleeing:**
  - **On a door tile.** The DEX contest runs only against enemies within 3 tiles that can see you and aren't stunned; with none, you're out automatically.
  - **Not on a door.** `flee` runs for the nearest one. If you reach it this turn, the contest happens right away; otherwise the turn ends.
  - **Where you end up.** The entry door returns you to `fromRoom`, at no time cost (as in bands). Any other door walks you into that room through `travel()`, with its time cost, traps and encounter roll.
  - **A failed flee** gives the chasers free swings.
- **Enemy AI** maps the existing tokens onto the board:
  - `attack` strikes if anything reaches, otherwise paths to the cheapest free tile from which an attack works and strikes if it arrives. Occupied tiles are off limits, so packs surround you naturally.
  - `keep_range` backs off to its preferred distance (close 1, near 3, far 5) while keeping sight of you.
  - `special_if_ready` moves into position for a ready cooldown attack if it can this turn.
  - Fleeing enemies run for the nearest door. Ending a move on a door means they escape, for no XP.
  - Hazards an enemy can see (`aiAvoids`) add 3 to its path cost.
  - **Stall guard.** An enemy that neither attacks nor closes in for two turns ignores `keep_range` for a turn.
- **Hazards** fire `enter` effects on every tile a unit steps into (including tiles it's pushed into) and `stay` effects at the start of the turn of a unit standing on them. `consumedOnTrigger` hazards vanish after firing. Placed hazards with `rounds` burn down at the end of each round.
- **Commands:**
  - Coordinates are chess-style: a column letter, then a row number from the top (`c4`).
  - `move c4`, `move 3 2`, `move ne 2`, and bare `n`/`ne`/`e`/… for one tile. In grid fights, `go north` means a tile, not a room.
  - `attack c4` targets by tile.
  - `wait` passes.
  - `advance`/`retreat` spend your movement toward the nearest enemy or away from all of them, without ending the turn.
  - In a grid fight, `look` prints the board.
- **View:**
  - `view.combat.grid` carries every tile's feature, hazard and door, plus `move`/`attack` highlights and a `tap` command (`attack d5`, `move c4`, or `flee` on your own door tile), units with sprite and glyph, and loose items.
  - Every `tap` and button is ordinary command text, and a test checks each one parses and is allowed.
- **The sim** takes `--mode grid|bands|both` and prints rounds and damage per fight, the flee rate, and a grid-vs-bands delta. A fight past 60 rounds counts as stuck.
- **Snapshot** (300 runs each):

  | Mode | Clear rate | Rounds per fight | Damage per fight | Flee rate | Stuck |
  | --- | --- | --- | --- | --- | --- |
  | Grid | 33% | 4.7 | 15.4 | 28% | 0 |
  | Bands | 41% | 4.9 | 15.4 | 24% | 0 |

  Grid crawlers die more to "their own wounds": fleeing on a board takes several turns of walking while bleeding. Worth tuning once hazards and crafting land.

### Grid combat client

- **The board** (`BattleGrid.tsx`) is a CSS grid of layered tiles: floor variant, door, feature, hazard, loose item, then the unit (with an HP pip, its A/B/C mark, a status count, and a gold outline for elites).
  - **Highlights come from the engine.** Walkable tiles are teal and hittable enemies have a red outline. The client paints flags; it never computes them.
  - **Tapping** submits the tile's `tap` command. Column and row labels make typed coordinates discoverable.
  - **Placement.** It sits above the enemy strip in the desktop battle panel. On phones it heads the battle screen, with a shorter log.
- **Sprites.** `Sprite.tsx` replaces the minimap's `Tile`.
  - **Fallback chain.** It tries each path in order, then the glyph.
  - **Failed URLs are remembered** module-wide, so a missing PNG costs one 404 per session rather than one per cell.
  - **Fixes a minimap bug.** A cell no longer stays stuck on a glyph when its tile changes.
  - **Combat art** lives in `public/combat/<folder>/<id>.png`, and `public/combat/README.md` is the manifest.
- **Armed targeting.** A command with `targets` (the next phase's throw and shove) arms when clicked instead of submitting. Tapping a highlighted tile submits `<command> <coord>`, and tapping anywhere else or pressing Esc cancels. Every button is still command text.
- **The combat toggle** is in the mobile corner menu and the desktop event-log header ("combat: grid ⇄"). Both submit `set combat …`.
- Checked in headless Chrome at 1440×900 and 390×844 with no combat art (glyphs only). The board fits a phone without sideways scrolling, and tap-to-move, tap-to-attack and fleeing enemies all work end to end.

### Junk and the minimal inventory (pulled forward from Milestone 5)

- **Pulled forward:**
  - room contents: `Room.items` (in plain sight) and `Room.hidden` (found by `search`)
  - loot tables (`lootTables.json`)
  - `take` / `take all` / `pick up`, `drop`, and `equip` / `wield` / `unequip`
  - a hard weight cap at `carryLimit`
  - consumable stacking by base id
  - `ItemInstance.onHit` and `crafted`
- **Still Milestone 5:** the generator (materials, rarity, affixes), shops, enemy drops and identification. Junk bases keep `generate: false`: seeding goes through loot tables, so `generate` still means "the Milestone 5 generator may roll this".
- **Seeding** runs in `accept`, right after `generateFloor()`, as `seedFloorLoot()`, so the map generator and its tests stay about the map. Per room type (`floors.json` → `loot.rooms`), visible / hidden counts:

  | Room | Table | Visible | Hidden |
  | --- | --- | --- | --- |
  | Treasure | treasure | 2-3 | 1-2 |
  | Lair | junk | 1-2 | 0-1 |
  | Chamber | junk | 0-2 | 0-1 |
  | Trap | sharp | 0-1 | 1 |
  | Corridor | junk | 0-1 | 0 |
  | Empty / puzzle / event / NPC | junk | 0-1 | 0-1 |
  | Safe | bind-only supplies | 1-2 | 0 |
  | Stairwell | none | — | — |

- **The first safe room** (nearest the start) always holds a lead pipe, thumbtacks and duct tape, so the first craft is waiting at the first bench.
- **Workshops.** Every safe room has a workbench. 1-2 more chamber, empty or puzzle rooms (not corridor-shaped, not the start, at least 3 steps from any safe room) get one too, plus 1-2 extra junk on the floor and a description line. Once visited, a workshop shows on the minimap as `workshop` (glyph ⚒, optional `tiles/workshop.png`).
- **Room blocks** list what's on the floor (`roomEntered.items`) and flag a workbench. `look` repeats both, and the first three items plus "Take all" become buttons.
- **`search`** moves hidden items onto the floor (with the `explore.searchFound` line) and still costs 15 minutes. With nothing hidden, the old `explore.searchNothing` joke plays.
- **Weight.** A hard cap with no encumbrance status. `take` moves as much of a stack as fits and leaves the rest; if nothing fits, the System AI says so. Taking and dropping cost no time.
- **Equipping** displaces the slot's item. A two-hander also clears the off hand, and an off-hand item knocks a two-hander out. Rings fill ring1, then ring2. Mid-fight, `equip` costs the minor action (bands) or 1 tile of movement (grid).
- **Name lookup** for take, drop, equip and crafting ranks candidates as: exact name, then whole words, then substring. So "tape" means all the tapes, and "duct tape" means one.
- **Junk content:**
  - **New parts.** 23 consumables (type `junk`, with no effects, so `use` replies "combine it").
  - **New outputs.** 5 crafted consumables (caltrop pouch, garage bola, trip wire kit, glue trap, duct-tape splint).
  - **New gear.** 6 junk weapons and shields (lead pipe, rebar, two-by-four, broom handle, table leg, trash can lid), plus 6 crafted ones (pipe spear, glass shiv, padlock in a sock, inner-tube sling, magazine armor, strapped trash-lid shield).
  - **Existing items join through tags only:** duct tape, gaffer tape, superglue, jacks, chains, hammers, hairspray, the bat, the crowbar, the existing lighter fluid, and so on.
- **Craft tags:** `bind sharp haft cord elastic pouch weight battery wire fuel wick bottle spark padding plate hammer`. An item's effective tags also include its weapon type and `weapon` / `armor` / `slot:<slot>`. Item details list its parts and weight.
- A test keeps a fully explored, seeded floor's save under 250 KB.

### Maneuvers and hazards

These are available to every crawler, so early fights aren't just trading swings.

- **`shove [name]`.** Opposed d20 + STR + athletics against the target's d20 + max(STR, DEX); you must be adjacent (grid fights auto-approach first).
  - **Win:** the target is pushed one tile directly away. If something is on that tile, its `enter` effect fires. If the push hits the board edge, an obstacle or another unit, the target slams into it for 1d4 and stays put.
  - **Bands:** a win pushes it out one band.
  - A braced target (`noShove`) doesn't budge.
- **`throw <item> [at <tile|name>]`.**
  - **Grid:**
    - Range is 3 tiles with line of sight, and a throw always lands on the tile (no roll).
    - `target` effects hit whoever is standing there.
    - `all_enemies` effects hit the 3×3 around the tile, including you if you're inside it (a molotov at your feet is your problem).
    - A consumable with a `hazard` field leaves that hazard in a `single`, `plus` or `square` shape. It replaces any hazard already there and never lands on an obstacle.
    - With no target given, it picks the nearest enemy you can hit.
  - **Bands:** `target` hits the named (or first) enemy, `all_enemies` hits them all, and hazards are ignored.
  - **`use`** on a throwable in a grid fight means throwing it at the nearest target.
  - **Hazard throwables:** caltrops (jacks, the caltrop pouch), marbles (ball bearings, the bag of marbles), oil (lotion), glue (superglue, glue trap), trip wire, smoke (blocks sight, 3 rounds), and fire (molotov 3×3, aerosol torch, lighter fluid; 3 rounds).
- **`dash <tile>`** (grid): move up to your remaining movement plus your speed again; it ends the turn.
- **`defend`**: the new `braced` status gives +4 defense and blocks shoves. Its new `endsOnTurnStart` flag drops it when your next turn begins.
- **Loose junk on the board.** The room's floor items, plus 0-2 scrap from the theme's `arena.scrap` table, are scattered on free tiles when a grid fight starts.
  - `take` (or tapping the tile) picks up something on your tile or an adjacent one, for 1 tile of movement. It's refused if you can't carry it.
  - `wield` readies a weapon for another tile of movement.
  - When the fight ends, whatever is still on the board goes back on the room's floor.
- **Buttons:** Shove, Throw <item> (the first two throwables) and Dash carry `targets`, so they arm and wait for a tile. Defend is a plain button. Take buttons appear for junk within reach.
- **Snapshot** (300 runs each):

  | Mode | Clear rate | Rounds per fight | Stuck |
  | --- | --- | --- | --- |
  | Grid | 39% | 4.6 | 0 |
  | Bands | 37% | 4.9 | 0 |

  The sim doesn't shove, throw or craft yet.

### Crafting

- **Recipes are discovered, not listed.** `combine <things>` at a workbench (any safe room, or a workshop). Out of combat only; in a fight it gets `command.notNow`.
  - **On a match:** it's made, and the recipe goes in your book (`crawler.recipes`, with a `recipeLearned` event).
  - **On no match:** the System AI insults you and 5 minutes pass. Nothing is used up.
  - **Names you aren't carrying:** a free error, since that's a typo, not an attempt.
  - **At the wrong spot:** away from a bench it's refused, with no cost.
- **`recipes.json` is tag-based:**
  - **Inputs.** Each takes any-of `tags` or an exact `id`, plus `qty` (from one stack or several items), `consumed` (`false` for tools like the hammer), and `base` (the item an upgrade improves).
  - **Outputs.** Either a new `item`, or an `upgrade` (prefix, damage bonus, die step, damage type, armor bonus, modifiers, on-hit status, range, tags).
  - **Extras.** An optional check (stat + skill vs a DC tier, with a mishap on a critical failure), the minutes it takes, a priority, a cryptic hint, and a success line.
- **Matching:**
  1. The typed text splits on `,` `+` `&` `and` `with`; otherwise every grouping of the words into 2-4 names is tried, fewest pieces first.
  2. Each name resolves to candidates (exact, then whole word, then substring).
  3. The search tries candidate choices × recipes × input slots. Every named item must fill a slot and every slot must be filled.
  4. The most specific recipe wins: an id counts 4, a single tag 2 and a tag list 1, plus 1 per input, plus `priority`. Ties go to file order.

  This settles ambiguous names ("tape" picks whichever tape makes a recipe work) and extra junk (an unrelated fourth item means no match).
- **Upgrades are baked in.** The name gains a prefix, the dice change (`addToDice`, plus a new `stepDice` d4→d6→…→d12), `onHit`/armor/modifiers are added, and `item.crafted` records the recipe id. Each recipe applies once per item, and an item takes at most two upgrades. The item keeps its uid, so equipped gear stays equipped. When Milestone 5 arrives, crafted prefixes become an affix group, so crafted gear can still roll loot affixes.
- **New items** auto-equip into a free slot. Consumed parts come off their stacks, and equipped parts are unequipped first.
- **A failed check** ruins one random consumed part (one unit), but the recipe is still learned, since you found the combination. A critical failure also applies the recipe's mishap (barbed wire cuts, electro-wiring shocks, molotovs set you burning).
- **The new `tinkering` skill** (INT, utility; +2 at rank 5) feeds the harder checks. Nobody starts with it, and the Junk Engineer class can grant it in Milestone 11. Other checks use DEX, `trap_engineering` or `explosives_handling`.
- **`craft <name>`** makes a known recipe, picking the parts itself: your equipped weapon is preferred as the upgrade base, and unequipped, cheaper junk as parts. At a bench, the first three makeable known recipes become buttons.
- **Hints:**
  - **In the book.** The recipe book (`recipes`, free) shows up to 3 cryptic hints, only for unknown recipes you're carrying every part for.
  - **On pickup.** The first time a pickup makes an unknown recipe possible, the System AI drops its hint once (`craft.idea`, tracked in `crawler.ideas`).
- **The 19 starter recipes:**
  - Upgrades: nail bat, hammered-in nails, barbed wrap, live wiring, taped grip, magazine lining.
  - Weapons: pipe spear, glass shiv, padlock in a sock, inner-tube sling, garage bola.
  - Traps and throwables: caltrop pouch, trip wire, molotov, aerosol torch, glue trap.
  - Armor and healing: magazine armor, strapped trash-lid shield, duct-tape splint.
  - Tests check that every input can be filled by some item in the content, and that the first safe room's kit makes a nail bat.
- **Client:** a recipe book sheet (mobile menu → Recipes, and in the desktop inventory overlay) with ✓ for recipes you can make now, a "make" button at a bench, and the hints. Learned recipes also print as a log divider and show in the System AI ticker.

### Sim and balance snapshot (end of Milestone 4b)

- `npm run sim -- <runs> [--mode grid|bands|both] [--craft]`.
  - `--craft` adds a policy: pick up everything, try any makeable recipe (up to 3) at each new bench, wield the hardest-hitting weapon, and throw junk at packs of 2+ in the first two rounds.
  - The auto-player only drinks potions that can be used in combat.
  - A stuck run now reports its last log lines.
- **Snapshot** (400 runs each, Floor 1):

  | Configuration | Clear rate | Rounds per fight | Damage per fight | Flee rate | Crafted per run | Stuck |
  | --- | --- | --- | --- | --- | --- | --- |
  | Grid | 35% | 4.8 | 16.4 | 33% | — | 0 |
  | Bands | 40% | 5.0 | 15.9 | 25% | — | 0 |
  | Grid + crafting | 37% | 4.5 | 14.9 | — | 5.2 | 0 |
  | Bands + crafting | 44% | 4.8 | 14.8 | — | 5.4 | 0 |

  Grid sits within the ±10-point target of bands, and both fall inside the 3-6 rounds per fight target. Tuning toward the spec's 30-60% Floor 3 target is Milestone 13's job.
- **Open questions for after the playtest:**
  - Keep bands as a text-only mode or drop it.
  - Whether the free round-1 retreat through the entry door needs a cost.
  - Whether trap rooms should host fights (their `arenaHazard` is already wired).
  - Whether arenas should persist per room, so caltrops you placed are still there on the rematch.
