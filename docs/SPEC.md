# Crawler: Game Design Spec

Nov 5, 2026 · @Alex Wallace

## Overview

Crawler is a browser-based text adventure inspired by Dungeon Crawler Carl: an original crawler descends a procedurally generated dungeon run by a sarcastic alien game-show AI. The first playable build ends when the player completes Floor 3, chooses a race and class, and finishes that floor's big quest.

This is a personal, non-commercial project. All in-game names, characters, text and items are original; the books inspire the systems and tone, not the content. No content should go past the events of book 8 (the player hasn't read further).

**How Claude Code should use this doc:** treat it as the source of truth. Build in the order given in the Build order section. Where the spec is silent, pick the simplest option that fits the pillars and note it in `DECISIONS.md`.

### Design pillars

1. **Everything is generated from data.** Items, enemies, rooms, achievements and quests come from JSON tables plus generator functions. Adding content means editing JSON, not code.
2. **The System AI is a character.** Every reward, death and achievement is narrated by a crude, bored, cruel and funny host AI. Profanity and weirdness are welcome.
3. **Builds are deep.** Stats, race, class, skills, spells and gear combine into builds as varied as the books'.
4. **Fights mix dice and words.** Regular combat is turn-based with dice. Out of combat, choices resolve as stat checks. Bosses are run live by Claude.
5. **Death costs something, but runs build on each other.** Hybrid model: the crawler dies, the account remembers.

### Decisions locked

| Topic | Decision |
| --- | --- |
| Protagonist | Original crawler, random backstory, stats match the backstory |
| Canon fidelity | Inspired by, room to invent |
| Run model | Hybrid: permadeath crawler, persistent account unlocks |
| Combat | Turn-based dice combat + narrative stat checks |
| Build depth | As deep as the books: races, classes, skills, spells, gear |
| Audience / fame | Deferred |
| Tone | Profanity and weirdness allowed |
| Platform | TypeScript web app (Vite + React, small Node server) |
| AI | Claude API runs boss battles only (plus optional flavor later) |
| Seeds | No seeded runs; `Math.random` behind one RNG module |
| Content format | JSON |
| First milestone | Floors 1-3, race and class choice on Floor 3, one big Floor 3 quest |

## Tech stack and architecture

The game is one TypeScript monorepo: a pure game engine with no UI or network code, a React client that renders it as a terminal-style text UI, and a small Node server whose only job is to proxy Claude API calls so the key never reaches the browser.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict) everywhere | One language, shared types between engine, client and server |
| Client | Vite + React | Fastest dev loop; text UI is just components |
| Styling | Plain CSS modules, monospace terminal look | No design work needed |
| Server | Node + Hono (or Express) | One `/api/boss` route; \~100 lines |
| AI | `@anthropic-ai/sdk`, key in `.env` | Boss battles |
| Validation | Zod | Validates every JSON content file at load and every AI response |
| Persistence | `localStorage` (save + account) | Single player, no database |
| Tests | Vitest | Engine is pure functions, easy to test |

### Folder layout

```
crawler/
  packages/
    engine/        # pure game logic, no DOM, no fetch
      src/
        rng.ts           # all randomness goes through here
        state.ts         # GameState type + reducers
        rules/           # checks, combat, leveling, death
        gen/             # generators: backstory, item, enemy, floor, quest, achievement, lootbox
        content/         # JSON loaders + Zod schemas
        narrate/         # template engine for System AI lines
      test/
    content/       # the JSON tables (items, affixes, enemies, races, classes, ...)
    client/        # Vite + React UI
    server/        # Hono server, /api/boss
  DECISIONS.md
```

### State model

- The engine is a **reducer**: `step(state, action) -> { state, events }`. Actions are player commands (`move`, `attack`, `cast`, `use`, `choose`, `talk`). Events are things the UI prints (narration, rolls, loot, achievements).
- `GameState` holds the current crawler, the current floor map, the floor timer, inventory, active quest, and pending loot boxes.
- `AccountState` is separate and survives death: unlocks, best floor reached, achievement codex, legacy points.
- Save = serialize both to `localStorage` after every action. One active run per account.
- Boss fights are the only async step: the client calls the server, the server calls Claude, the result is validated and fed back into the reducer as a normal action result.

### Input

The UI shows a text log plus a command line. Commands are typed (`attack goblin`, `go north`, `open box`) with a simple parser, and every valid command for the current state is also shown as clickable buttons. Narrative choices are always numbered buttons.

### Screen layout

The first UI is a multi-panel text dashboard: separate areas for the event log, battle log, active effects, equipment and character sheet, laid out with CSS grid. Each panel is its own React component in a named layout region, so a later art or illustration layer can sit behind or around the text without rewriting the panels.

```
+--------------------------------------------+-------------------------+
| FLOOR 2  District: Food Court   Timer 3d 4h | HP 84/120  MP 30/45     |
+--------------------------------------------+ XP ████████░░ L9         |
|                                            +-------------------------+
|  EVENT LOG (narration, rooms, loot,        | CHARACTER               |
|  System AI lines)                          | STR 14 DEX 11 CON 13 ...|
|                                            +-------------------------+
|  -- or, in combat --                       | EQUIPMENT               |
|                                            | Main: Spiteful Hammer   |
|  BATTLE LOG (rounds, rolls, damage,        | Chest: Greasy Apron ... |
|  boss dialogue)                            +-------------------------+
|                                            | ACTIVE EFFECTS          |
+--------------------------------------------+ Poisoned (2) Hasted (3) |
| ACHIEVEMENT / SYSTEM AI TICKER             +-------------------------+
+--------------------------------------------+ MINI-MAP                |
| > command input        [action buttons]    |                         |
+--------------------------------------------+-------------------------+
```

| Panel | Shows | Fed by event types |
| --- | --- | --- |
| Status bar | Floor, district, collapse timer, HP/MP/XP bars | stateChanged, timeTick |
| Event log | Room descriptions, exploration, loot, NPC talk, System AI lines | narration, roomEntered, lootGained |
| Battle log | Initiative order, each roll with its math, damage, enemy and boss dialogue | combat.\* (replaces or splits the event log during a fight) |
| Character | Stats, level, race, class, skills, spells with cooldowns | stateChanged, levelUp, skillRankUp |
| Equipment | One line per slot; click for item details | itemEquipped, itemUnequipped |
| Active effects | Buffs, debuffs and statuses with rounds or rooms remaining | statusApplied, statusTick, statusExpired |
| Ticker | Achievements and timer warnings as they fire | achievement, timerWarning |
| Mini-map | ASCII map of explored rooms | roomEntered |
| Input | Command line plus context buttons | always |

Rules:

- The engine already emits typed events; a small router sends each event type to its panel(s). Panels never read raw engine internals.
- In combat, the battle log takes the main area and the event log shrinks to its last 3 lines (toggle to side-by-side on wide screens).
- Panels can be collapsed; on narrow screens the side panels become tabs under the main log.
- Inventory opens as an overlay panel over the main area (`i` or a button).

## Core rules

Every uncertain outcome is one roll: d20 + the relevant stat (+ skill and gear bonuses) against a difficulty number. Stats grow without a cap, so difficulty grows with the floor.

### Stats

Five primary stats. A new crawler has 3-12 in each, set by backstory. Each level grants 3 free points; race, class, gear and loot can add more.

| Stat | Governs |
| --- | --- |
| STR (Strength) | Melee hit and damage, carry weight, forcing doors |
| DEX (Dexterity) | Ranged and finesse hit, defense, initiative, stealth, fleeing |
| CON (Constitution) | Max HP, resisting poison, disease and fear, HP regen |
| INT (Intelligence) | Max MP, spell power, identifying items, traps, puzzles |
| CHA (Charisma) | Talking to NPCs, shop prices, pet and summon power, how much the System AI likes you |

### Derived values

```
maxHP      = 10 + 3*CON + 2*level + race.hpBonus + class.hpBonus
maxMP      = 5 + 2*INT + class.mpBonus
defense    = 10 + floor(DEX/2) + armor.total + shield + buffs
initiative = d20 + DEX
hpRegen    = floor(CON/5) per room moved (out of combat only)
mpRegen    = floor(INT/5) per room moved (out of combat only)
carryLimit = 20 + 4*STR  (weight units)
```

### Checks

`roll = d20 + stat + skillRank + bonuses` vs `DC`.

- Natural 20 always succeeds, natural 1 always fails.
- Beat DC by 10+ = critical success (extra reward). Miss by 10+ = critical failure (extra consequence).
- `DC = tier + 2 * (floor - 1)` with tiers: trivial 10, easy 15, medium 20, hard 25, brutal 30, absurd 35.
- Opposed checks (sneak vs perception, persuade vs will) roll both sides; higher wins, ties go to the defender.

### Combat

Combat is turn-based in rounds. Everyone rolls initiative at the start; order stays fixed for the fight.

On their turn a combatant gets **one action** and **one minor action**:

- Actions: attack, cast a spell, use an active skill, use an item on someone else, try to flee, talk (if the enemy can be talked to).
- Minor actions: drink a potion, swap a weapon, take one step between range bands, command a pet.

Resolution:

```
attackRoll = d20 + (weapon.stat == STR ? STR : DEX) + weaponSkillRank + weapon.hitBonus
hit        if attackRoll >= target.defense
damage     = roll(weapon.dice) + floor(stat/2) + bonuses - target.damageReduction (min 1)
crit       on natural 20 (or weapon.critRange): roll damage dice twice
spellRoll  = d20 + INT + spellSkillRank vs target.defense (or a save DC, see Spells)
flee       = DEX check vs highest enemy (d20 + DEX); fail = enemies get a free attack
```

Range is three bands: **close**, **near**, **far**. Melee needs close, thrown and most spells reach near, bows reach far. Moving one band is a minor action.

Status effects are data (`statusEffects.json`): each has a duration in rounds, a tick effect and stacking rules. Starter set: bleeding, burning, poisoned, stunned, blinded, slowed, hasted, feared, charmed, shielded, regenerating (plus confused, invisible and braced).

### Grid mode (Milestone 4b)

Fights can also play on a small tactical board. Which mode an account uses is a setting (`set combat grid|bands`); grid is the default. Both modes share every roll above. Bands remain the abstract layer content is written in.

- **Arena.** A board shaped like the room (corridor 9×4, small 6×6, chamber 8×8) with a door on each edge that has an exit.
  - Single-tile obstacles, terrain and hazards come from `arenaFeatures.json`, picked by the floor theme.
  - The crawler starts inside the door they came through; enemies start across the room, or close if they won initiative.
- **Distance.** It's 8-way (Chebyshev), and bands come from it: close ≤ 1 tile, near 2-3, far 4+. Anything beyond close range needs line of sight; pillars, crates and smoke block it, units don't.
- **Turn.** The minor action becomes movement: the crawler moves 4 tiles, enemies move their family's `speed`, slowed caps movement at 1 and hasted adds 2. Moving never ends the turn; an action does. Attacking something out of reach walks you into reach first.
- **Maneuvers** anyone can use:
  - **Shove:** STR contest. The target is pushed a tile into whatever is there, or slams into an obstacle for 1d4.
  - **Throw junk:** up to 3 tiles away. Splash hits the 3×3 around where it lands, and hazards like caltrops, glue, fire and smoke stay on the board.
  - **Dash:** double movement; ends the turn.
  - **Defend:** braced, +4 defense and can't be shoved.
  - **Pick up and wield:** junk lying on the board, for a tile of movement each.
- **The pack bonus is the one positional rule.** A melee enemy gets +1 to hit for each other enemy next to you, up to +2.
- **Flee.** Reach a door and roll DEX against enemies within 3 tiles that can see you; with none, you're out automatically. The door you came in by leads back; any other door leads onward.

### Death and the hybrid run model

The crawler dies at 0 HP (unless a skill or item says otherwise) or when the floor collapses while they're off the stairs. Death is permanent for that crawler.

The **account** keeps:

- **Legacy points**, earned from floor reached, achievements and bosses killed. Spent on unlocks.
- **Unlocks**: new backstory pools, extra starting-kit choices, one reroll of backstory, an extra race or class option at selection.
- **The codex**: every enemy, item and achievement ever discovered, with System AI commentary.
- **A bequest**: on death, the player picks one non-legendary item; the next crawler can find it in a Floor 1 safe room.

Legacy points per run: `10 * deepestFloor + 2 * achievements + 5 * bossKills`. Unlock costs are in `unlocks.json`.

## Character creation

A new crawler is generated from four random backstory parts. Each part pushes stats in a direction, so a former plumber and a former debate coach start with visibly different numbers. The player sees the result, can accept it, or spend one account reroll.

### The four parts

| Part | Example entries | What it gives |
| --- | --- | --- |
| **Occupation** | Line cook, night-shift nurse, roofer, accountant, high-school wrestling coach, tattoo artist, failed influencer, retired magician | Stat weights, one starting skill at rank 1 |
| **Formative event** | Survived a house fire, won a state spelling bee, three years in a touring band, raised by a doomsday-prepper uncle | +2 to one stat, -1 to another |
| **Quirk** | Can't swim, talks to inanimate objects, compulsive liar, freakishly good at darts, allergic to almost everything | A small passive perk or flaw |
| **Where you were when the world ended** | On the toilet, mid-wedding vows, in a hospital gown, at a 24-hour gym, sleeping in a car | Starting clothing and one starting item |

Starter tables should have at least 30 occupations, 20 events, 25 quirks and 15 locations, all in `content/backstory/*.json`.

### Stat generation

```
for each stat: base = 5
pool = 12 points
spend pool one point at a time, picking a stat by occupation.weights (e.g. roofer: STR 3, DEX 3, CON 3, INT 1, CHA 1)
apply formativeEvent modifiers
apply quirk modifiers (if any)
clamp every stat to 3..12
```

Starting kit: occupation item (e.g. roofer gets a framing hammer) + location item + location clothing. HP and MP are computed from the derived formulas.

### Presentation

The System AI introduces the crawler with a 3-5 sentence roast built from the parts (template-driven, see Narration). Example of the tone, not canon text:

> Crawler, welcome. You were a 41-year-old line cook from Tucson, you once won a regional spelling bee, you cannot swim, and when the planet was harvested you were sitting on a toilet at a gas station. Truly, a champion is born. Please collect your complimentary bathrobe.

### Companion (unlock)

An account unlock adds a 20% chance the crawler starts with a pet. Pets have their own small stat block, act on the minor action, and level with the crawler. A pet's sentience and class are a later expansion.

## Leveling, skills and spells

Three things grow independently: character level (from XP), skills (from use and tomes), and spells (from casting and duplicate tomes). Using something is the main way to get better at it.

### Character level

```
xpToNext(level) = round(100 * level^1.5)
xpFromKill      = enemy.level * 10 * tierMultiplier   (mob 1, elite 2, neighborhood boss 5, borough boss 10)
xpFromQuest     = quest.xp (set by the quest generator)
on level up: +3 free stat points, full heal, +1 skill point, System AI comment
```

No level cap. Expected level at the end of Floor 3 is roughly 12-18.

### Skills

Skills have ranks 1-15. Each rank adds +1 to related rolls, and some ranks (5, 10, 15) unlock a perk listed in the skill's data.

| Category | Examples | How it's gained |
| --- | --- | --- |
| Weapon | Blades, blunt, polearms, bows, thrown, unarmed, improvised | Hitting things with that weapon type |
| Defense | Light armor, heavy armor, shields, dodge | Being hit or missed while using it |
| Utility | Stealth, perception, lockpicking, trap engineering, first aid, cooking, explosives handling | Successful checks |
| Social | Persuasion, intimidation, deception, bartering | Successful checks |
| Class / race | Granted only by a class or race, e.g. a rage skill | Use, plus guaranteed ranks on level up |

```
skillXpToNext(rank) = 10 * rank^2
skillXpPerUse       = 1, or 3 on a critical success, or 0 if DC was trivial
skill points (1 per level) can be spent for an instant rank in any skill the crawler already has
skill tomes (loot) grant a new skill at rank 1, or +1 rank if already known
```

### Spells

Spells come from spell tomes (consumed on reading), from class grants, or from race. Each spell has its own level 1-15.

```
spell.level up:     every 10 * level casts, or reading a duplicate tome (+1 instantly)
spell.mpCost        = base + perLevel * (level - 1)
spell.damage        = dice scaled by level + floor(INT / 2)
save DC (if any)    = 10 + floor(INT / 2) + spell.level, target rolls d20 + relevant stat
```

Schools: fire, frost, lightning, necrotic, light, illusion, protection, summoning, transmutation, utility. Spells are hand-written in `spells.json` (start with \~40), not generated, because they're the core of build identity. Tomes are generated items that point at a spell id.

## Races and classes

On Floor 3 the crawler picks a race, then a class. The menus are generated from what the crawler has done so far, so a stealthy run gets offered different classes than a brawler run, and some classes stay hidden unless odd conditions are met.

### When and where

- The first safe room on Floor 3 contains a **Selection Booth**. Entering it opens race selection, then class selection.
- The crawler can leave and return, but the stairwell to Floor 4 won't open, and the Floor 3 quest boss won't spawn, until both are chosen.
- Choices are permanent for that crawler.

### Races

A race gives stat modifiers, an HP bonus, 1-3 traits (passive abilities), a size (small, medium, large) and restrictions (e.g. can't wear helmets).

| Race | Flavor | Stat mods | Example trait |
| --- | --- | --- | --- |
| Human | Default, adaptable | +1 to all | Extra skill point every 5 levels |
| Dwarf | Short, dense, stubborn | +3 CON, +2 STR, -2 DEX | Poison resistance |
| Elf | Pretty, fragile, smug | +3 DEX, +2 INT, -2 CON | Sees in darkness |
| Half-Orc | Big and loud | +4 STR, +1 CON, -2 INT | Rage once per fight |
| Gristleback | Hunched cartilage brute | +5 CON, -1 CHA | Regenerates 1 HP per round |
| Murkling | Small amphibian | +3 DEX, +1 CON, -2 STR | Breathes water, slippery (+2 flee) |
| Burrowkin | Mole folk | +2 STR, +2 CON, -1 DEX | Dig through soft walls |
| Ashborn | Fire-blooded | +3 INT, +1 CHA | Fire resistance, fire spells +1 level |
| Hollowed | Recently undead | +2 CON, +2 INT, -3 CHA | Immune to poison, healing hurts |
| Pollinoid | Bee person | +2 DEX, +2 CHA | Short flight, sting attack |

### Race offer algorithm

```
offer = all races with rarity "common" (Human, Dwarf, Elf, Half-Orc)
      + 3 races drawn from "uncommon", weighted by statAffinity . crawler.stats
      + 1 race from "absurd" if crawler has any achievement tagged "weird" (e.g. a sentient-houseplant race)
      + any race unlocked on the account
```

### Classes

A class gives HP/MP bonuses, starting skills and spells, a level-up table (what it grants at class levels 1, 5, 10, 15, 20) and requirements.

Starter set of 16: Brawler, Berserker, Duelist, Ranger, Trapper, Bomb Tech, Hedge Mage, Pyromancer, Necromancer, Street Medic, Con Artist, Beast Tamer (requires a pet), Monk, Shieldbearer, Hype Man (buffs allies and pets with insults), Junk Engineer (crafts gadgets).

Hidden classes have strange conditions. They should feel like the system noticed something the player did. Examples:

| Hidden class | Condition |
| --- | --- |
| Plunger Paladin | Killed 25 enemies with improvised weapons + has a light-based spell |
| Plague Chef | Cooking rank 5 + has been poisoned 10 times |
| Grief Counselor | Talked 5 enemies out of fighting |
| Demolitions Sommelier | Explosives handling rank 5 + destroyed 3 walls |
| Rat King (lowercase) | Killed 100 rats, or befriended 3 |

### Class offer algorithm

```
eligible = classes where requirements met AND race not in class.forbiddenRaces
fit(class) = sum(class.statWeights[s] * crawler.stats[s])
           + 5 * matching skills (crawler skill in class.affinitySkills)
           + 10 * matching achievement tags
offer = top 6 by fit + 2 random eligible + every hidden class whose condition is met
```

The System AI comments on each option as it's shown (one line each, template-driven, with a sarcasm level that depends on fit).

## Item generation

Every weapon, armor piece and trinket is built as **base + material + rarity + affixes**, then named and described. Consumables come from fixed tables with scaled potency. A small hand-written set of "oddities" breaks the rules on purpose.

Milestone 4b pulled a slice of this forward for junk and crafting: room contents from loot tables (`lootTables.json`), `take`/`drop`/`equip`/`unequip`, the carry limit as a hard cap, consumable stacking, and an item's `onHit` status and `crafted` upgrade list. The generator itself (materials, rarity, affixes) stays in Milestone 5. When it lands, crafted upgrade prefixes become an affix group.

### Junk and crafting

Rooms are littered with junk (tape, glue, rope, tacks, nails, barbed wire, pipes, bats, rags, bottles) for the crawler to combine at a **workbench**. Every safe room has one, plus 1-2 workshop rooms per floor.

- **Discovery, not a menu.** `combine bat tacks tape`. If some recipe in `recipes.json` uses exactly those things, it's made and added to the recipe book; if not, the System AI mocks you and five minutes pass. The book shows hints for unknown recipes whose parts you're carrying.
- **Recipes are tag-based:** any blunt weapon + anything sharp + anything that binds.
  - **Outputs.** A recipe either upgrades an item in place (Nail-Studded, Barbed, Live-Wired: damage, on-hit statuses, damage type) or makes something new (pipe spear, caltrop pouch, molotov, magazine armor).
  - **Limits.** Each upgrade applies once per item, and an item takes at most two.
  - **Checks.** Some recipes roll one (Tinkering, Trap Engineering, Explosives Handling); failing ruins a part, but you learn the recipe anyway.

### Equipment slots

Head, eyes, chest, legs, feet, hands, neck, ring x2, back, belt, main hand, off hand. Two-handed weapons fill both hands. Eyes holds goggles, glasses, masks and patches, so they stack with a hat or helmet. Full-face gear (welding or racing helmets, mascot heads) stays in head.

### Rarity

| Rarity | Affixes | Stat budget multiplier | Drop weight (Floor 1) | Drop weight (Floor 3) |
| --- | --- | --- | --- | --- |
| Common | 0 | 1.0 | 60 | 45 |
| Uncommon | 1 | 1.2 | 28 | 32 |
| Rare | 2 | 1.5 | 10 | 16 |
| Epic | 3 | 1.9 | 2 | 6 |
| Legendary | 3 + 1 unique power | 2.5 | 0 (boxes only) | 1 |

Weights for later floors are in `rarityWeights.json`, keyed by floor.

### The generator

```
generateItem(itemLevel, slot?, rarityOverride?):
  rarity   = rarityOverride ?? weightedPick(rarityWeights[floor])
  base     = pick(bases where slot matches)            # e.g. "framing hammer": blunt, 1d8, STR, 6 wt
  material = pick(materials where minLevel <= itemLevel) # e.g. rusty, iron, bonesteel, dungeon-glass
  stats    = base.stats scaled by material.mult * rarity.mult * (1 + 0.1 * itemLevel)
  affixes  = pick N distinct from affixPool[slot] (prefix/suffix, no duplicate groups)
  if legendary: add one power from legendaryPowers.json
  name     = [prefix] + [material] + base.name + ["of " + suffix]
  flavor   = narrate("item.flavor", item)  # System AI one-liner
  value    = round(base.value * rarity.mult^2 * (1 + itemLevel/5))
```

`itemLevel = floor * 5 + random(-2, 2)`, minimum 1.

### Affixes

Affixes are data: `{ id, kind: prefix|suffix, group, slots, minLevel, effect, magnitude: [min,max] scaled by itemLevel }`. Examples:

| Affix | Kind | Effect |
| --- | --- | --- |
| Spiteful | prefix | +X damage vs enemies that hit you last round |
| Greasy | prefix | +X flee, -2 to keep hold when disarmed |
| Screaming | prefix | Weapon shrieks on crit; enemies roll vs fear |
| of the Ox | suffix | +X STR |
| of Poor Decisions | suffix | +X damage, -X defense |
| of Leeching | suffix | Heal X% of damage dealt |

Start with at least 60 affixes and 50 bases across all slots.

### Consumables

| Type | Notes |
| --- | --- |
| Potions | Healing, mana, cure, buff (STR/DEX/etc.), plus weird ones; potency scales with floor |
| Scrolls | One-shot spell casts from `spells.json` at a fixed level |
| Tomes | Teach a spell or skill (see Leveling) |
| Food | Out-of-combat buffs lasting N rooms; cooked food is better |
| Explosives | Thrown, area damage, can open walls; risk of fumble |

### Oddities

`oddities.json` holds 20+ hand-written items with unique rules. They only drop from gold boxes or better, or as quest rewards. Examples: a pair of socks that make the wearer immune to traps but unable to whisper; a used lottery ticket that rerolls one die per floor; a mood ring that tells you the boss's current HP percentage as a color.

## Loot boxes and achievements

Achievements fire the moment they're earned and always come with a System AI insult. Their rewards are loot boxes, which can only be opened inside a safe room, so the crawler is always carrying unopened promises.

### Box tiers

| Tier | Contents (rolls) | Min item rarity | Extra |
| --- | --- | --- | --- |
| Bronze | 1-2 | Common | Gold, consumables |
| Silver | 2-3 | Uncommon | Chance of a tome |
| Gold | 3 | Rare | Chance of an oddity |
| Platinum | 3-4 | Epic | Guaranteed tome or oddity |
| Legendary | 4 | Epic, one Legendary | Rare and story-relevant |
| Celestial | Special | Legendary | Reserved for later floors, not in the first build |

Box **types** change the loot table: Adventurer (general), Boss (weighted to the boss's theme), Weapon, Armor, Spell, Consumable, and Benefactor (deferred with the fame system).

```
openBox(box):
  require crawler.location is safe room
  n = random in box.tier.rolls
  for i in 1..n:
    roll type table for box.type -> item | gold | tome | oddity
    items use generateItem(itemLevel = box.floor * 5 + 2, rarityOverride >= box.tier.minRarity)
  narrate("box.open", box, contents)
```

### Achievements

An achievement is data: a trigger, a reward, tags, and text. Triggers are written in a small JSON rule format so new ones need no code.

```json
{
  "id": "overkill_rat",
  "name": "Unnecessary Roughness",
  "tags": ["combat", "weird"],
  "trigger": { "event": "kill", "where": { "target.family": "rat", "overkill": { "gte": 30 } } },
  "reward": { "box": "silver", "boxType": "weapon" },
  "repeatable": false,
  "text": "You did {overkill} more damage than that rat had HP. It had a family. Well, it had a family of rats, which you will also kill."
}
```

Trigger kinds:

- **Event match**: `{ event, where }` on any engine event (kill, damageTaken, checkPassed, itemUsed, roomEntered, talked, died...).
- **Counter**: `{ counter: "kills.rat", gte: 50 }`. The engine keeps counters for kills by family, deaths avoided, items used by type, checks by skill, and so on.
- **Combo**: `{ all: [...] }` or `{ any: [...] }` of the above.
- **State**: `{ state: "hp", lte: 1 }` checked after every event (e.g. survive a fight on 1 HP).

Starter list: 80+ achievements across these groups: first-time (first kill, first spell, first safe room), combat feats, near-death, exploration, social, humiliation (failing something trivial), stupidity (hitting yourself with your own bomb), and secret.

Achievement tags feed the class offer algorithm and the absurd-race offer, so the way someone plays shapes who they become.

## Floor generation

Each floor is a grid of connected rooms with a theme, several stairwells, scattered safe rooms, and a collapse timer. Reach a stairwell before the timer runs out or die with the floor.

### Floors in the first build

| Floor | Theme | Rooms | Districts | Timer (game time) | Purpose |
| --- | --- | --- | --- | --- | --- |
| 1 | The Undercroft: stone tunnels, maintenance shafts, dripping pipes | 60 | 1 | 5 days | Tutorial, basic combat, first boxes |
| 2 | The Drowned Mall: flooded shopping center, food courts, kiosks | 90 | 3 | 4 days | Elites, first district bosses, shops |
| 3 | The Rot Carnival: an abandoned traveling carnival sprawl | 120 | 4 | 6 days | Race and class selection, the big quest |

Themes live in `floors.json`: room name parts, description fragments (sights, smells, sounds), enemy families, trap types, feature types, and boss pool.

### Map algorithm

```
generateFloor(floorDef):
  grid = W x H (e.g. 14x10 for 120 rooms)
  carve rooms by random walk from the start cell until roomCount reached
  connect neighbors that the walk touched (N/S/E/W exits)
  add loops: connect 10-15% extra adjacent pairs so it isn't a tree
  districts = split rooms into floorDef.districts groups (seeded flood fill from spread-out cells)
  stairwells = pick 3-5 rooms far from start and from each other (BFS distance)
  safeRooms  = about 1 per 15 rooms, spread by BFS distance, never adjacent to a stairwell
  each district gets 1 boss lair room at its deepest point (Floors 2-3)
  every other room gets a type by weight (see below), then contents
  verify: every stairwell reachable from start; else regenerate
```

| Room type | Weight | Contents |
| --- | --- | --- |
| Corridor | 30 | Small chance of a wandering mob |
| Chamber | 25 | Encounter or loot or feature |
| Lair | 10 | Elite encounter + loot |
| Trap room | 8 | One or more traps (perception check to spot, DEX or INT to avoid or disarm) |
| Treasure | 5 | Containers, often locked or trapped |
| Puzzle | 4 | Riddle, lever sequence or switch logic, INT checks as hints |
| Event | 8 | Narrative choice with stat checks (see Narration) |
| NPC | 5 | Friendly, hostile or weird talking non-crawler |
| Empty | 5 | Just description |

### Safe rooms

Safe rooms are no-combat zones. They contain: a bed (sleep 8 hours, full heal), a toilet and shower (yes, really; small buffs), a shop run by an NPC with a randomized personality, a workbench for crafting, and the place to open loot boxes. Floor 3's first safe room also holds the Selection Booth. Floor 1's first safe room always has the parts for a first craft (a pipe, tacks, tape).

Every room type also rolls junk from the floor theme's loot settings (`floors.json` → `loot`). Treasure rooms and lairs hold the most and corridors the least. Some of it lies in plain sight and some only turns up with `search`.

### Time and the collapse timer

| Action | Game time |
| --- | --- |
| Move between rooms | 10 min |
| One combat round | 1 min |
| Search a room | 15 min |
| Short rest | 1 hour |
| Sleep (safe room only) | 8 hours |

The System AI announces remaining time at 24 hours, 6 hours, 1 hour and 10 minutes. When the timer hits zero, every crawler not in a stairwell dies. Entering a stairwell lets the crawler descend whenever they choose; once they descend, the floor is gone.

### Exploration UI

- `look` prints the room description: theme fragments + contents (what's on the floor, a workbench) + exits.
- `map` prints an ASCII grid of explored rooms: `@` you, `S` safe room, `>` stairwell, `!` boss lair, `?` seen but unvisited.
- Room descriptions are generated once and cached so revisiting reads the same.

## Enemies and bosses

Regular enemies are generated from families and run on simple rule-based AI. Bosses are generated the same way, but in the fight Claude plays the boss: it picks moves, talks trash, and rules on anything creative the player tries. The engine still rolls every die and owns every number.

### Enemy generation

```
generateEnemy(family, tier, floor, district):
  level    = floor * 4 + district.index + random(-1, 2)
  stats    = family.statProfile scaled by level
  maxHP    = family.hpBase * (1 + 0.25 * level) * tier.hpMult
  defense  = 10 + floor(DEX/2) + family.armor
  attacks  = family.attacks (dice scale with level)
  mods     = pick tier.modCount from enemyMods (rabid, armored, explosive, cowardly, regenerating, venomous, enormous, tiny, chatty...)
  name     = mods + family.name (e.g. "Rabid Explosive Carnie")
  loot     = family.lootTable + chance of a box by tier
```

| Tier | HP mult | Mods | Notes |
| --- | --- | --- | --- |
| Minion | 0.6 | 0 | Two levels below a mob, 60% XP. Ordinary encounters are packs of 2-4 minions (2-3 in corridors), from up to two families (`floors.json` → `encounters`) |
| Mob | 1 | 0-1 | A standard foe. Floor 1 fields only minion packs and elites; Floor 2 (Milestone 9) sets its own mix |
| Elite | 2.5 | 1-2 | Alone or with 1-2 minion escorts; drops a bronze or silver box |
| District boss | 6 | 2 | One per district on Floors 2-3; Claude-run; gold box |
| Quest boss | 10 | 3 | Floor 3 quest finale; Claude-run; platinum box |

Floor families (examples, all original): Floor 1: tunnel rats, mold zombies, scrap goblins, pipe snakes. Floor 2: mall goblins, mannequin stalkers, food-court slimes, kiosk mimics. Floor 3: animatronic carnies, cotton-candy oozes, ring-toss imps, sideshow freaks, feral clowns.

**Regular enemy AI** is a priority list per family: e.g. `[fleeIfHpBelow 20%, healAllyIfHurt, useSpecialIfReady, attackLowestHp]`. Some families are talkable (CHA checks can end the fight or change sides).

### Boss generation

A boss is an enemy plus a personality and a fight plan:

```
generateBoss(floor, district, tier):
  base        = generateEnemy(bossFamily, tier, floor, district)
  title       = pick(bossTitles) e.g. "Ringmaster of Sorrows", "Assistant Manager"
  personality = pick 2 from traits (vain, paranoid, bored, theatrical, needy, cruel, polite, deranged)
  abilities   = 4-6 from bossAbilities matching the family
  phases      = 2-3, each triggered at an HP threshold, each enabling new abilities or arena events
  weakness    = one damage type or condition, hinted in the lair description
  arena       = 3-5 interactable features from the floor theme (a fryer, a pillar, a tilt-a-whirl)
```

### Claude-run boss fights

Each boss round is one call to the server's `/api/boss` route. The engine stays authoritative.

1. **Intro (one call at fight start).** Send the boss sheet and arena. Claude returns a monologue and an arena description.
2. **Player turn.** The player either picks a normal action (the engine resolves it) or types a **freeform action** (e.g. "I kick the fryer over so the oil spills toward it").
3. **Ruling (freeform only).** Claude returns a ruling: which stat and skill, a DC tier, and the effect on success and on failure, chosen from a bounded effect menu. The engine rolls and applies.
4. **Boss turn.** Claude receives the round log and returns the boss's action, picked from its allowed ability list, plus taunt text and narration. The engine rolls and applies it.
5. **Phase change.** When the engine detects an HP threshold, it tells Claude, which narrates the shift.
6. **End.** On boss death or crawler death, one call for the boss's last words or a victory gloat.

Response shape (validated with Zod; any invalid response is retried once, then falls back to the rule-based AI):

```json
{
  "bossAction": { "abilityId": "grease_fire", "target": "crawler" },
  "ruling": null,
  "dialogue": "You smell like a corn dog and failure.",
  "narration": "The Assistant Manager hurls a basket of burning oil...",
  "arenaChange": null
}
```

Bounded effect menu for rulings: damage (dice up to `2d10 + floor*2`), apply a status from `statusEffects.json` (max 3 rounds), move range band (in grid mode: push or pull up to 3 tiles), change or destroy an arena feature (in grid mode: a tile of the board), grant advantage (+5) on the next roll, or nothing. In grid mode the boss prompt includes the ASCII board that `look` prints. Claude can't invent stats, heal the boss beyond its abilities, or end the fight outright.

### Server details

- Model is configurable in `.env` (default `claude-sonnet-5-5`); one API key in `.env`, never sent to the client.
- The system prompt (rules, tone, effect menu, JSON schema) is fixed and cached with prompt caching; only the round state changes.
- 15-second timeout per call; on failure the boss uses its priority-list AI and the narration uses templates, so the game never stalls.
- Log every request and response to `server/logs/` for debugging and tuning.

## Floor 3 quest

Floor 3's big quest has a fixed skeleton with randomized fillings: a hook, three objectives spread across three districts, a mid-quest twist, and a Claude-run quest boss. It's the climax of the first build and should take most of the floor's six days.

### Skeleton

1. **Hook.** After race and class selection, an NPC in the safe room offers the quest. NPC, motive and pitch come from tables.
2. **Three objectives**, one per district (the fourth district holds the finale). Each is drawn from the objective table without repeats.
3. **Twist**, revealed after the second objective, drawn from the twist table. It changes the third objective or the finale.
4. **Finale.** The quest boss (Quest boss tier) in a special arena built from the three objectives' results.
5. **Rewards.** XP, a platinum box (boss type), quest-specific legendary item, and an achievement.

### Example filling

The Rot Carnival's absent owner left the gates locked. A nervous fortune-teller NPC says the only exit-adjacent stairwell is inside the big top, and the big top opens only with three golden tickets: one from the haunted funhouse, one from a rigged ring-toss tournament, one from the dunk tank's occupant. The twist: the fortune-teller is the boss's assistant and has been setting the crawler up.

### Tables

| Table | Examples | Size |
| --- | --- | --- |
| Quest giver | Fortune-teller, a talking prize goldfish, a stilt-walker stuck on his stilts, a lost child that is clearly not a child | 8+ |
| Objective type | Retrieve an item, rescue an NPC, win a rigged game (CHA/DEX checks), kill an elite, solve a puzzle, escort, sabotage, survive waves | 10+ |
| Twist | Giver is a traitor, the item is cursed, a rival crawler NPC steals the prize, the rescued NPC is the real boss, the timer jumps forward 24 hours | 8+ |
| Finale arena | Big top, hall of mirrors, roller-coaster track, prize warehouse | 4+ |

### Choice and consequence

- Each objective has at least two approaches (fight, sneak, talk, cheat). Approach chosen is stored as a quest flag.
- Flags change the finale: e.g. if the crawler spared the ring-toss champion, he shows up as an ally in the boss fight; if they cheated, the boss starts with a buff.
- Flags and the twist are sent to Claude in the boss fight so dialogue references what happened.
- Betraying the quest giver after the twist is always an option, leading to an alternate finale boss (the giver).

### Quest data shape

The quest is stored as a small state machine: `stages[]`, each with `objectives[]`, `flags`, `onComplete` effects, and `next` (which can branch on flags). Quests for later floors reuse the same engine with new tables.

## Narration and the System AI

Outside boss fights, all text comes from templates in JSON, so it's free, instant and easy to extend. The System AI is the voice of everything that isn't room description: achievements, loot, level-ups, deaths, timer warnings, selection menus.

### Voice guide

- Bored game-show host who has seen a million crawlers die and is contractually obliged to sound excited.
- Cruel, crude, petty, occasionally almost kind and then immediately takes it back.
- Profanity is fine. Weirdness is encouraged. Punch at the crawler, the dungeon and the AI's own employers.
- Short. Most lines are 1-3 sentences; achievement text is 1-2.
- Never quote or paraphrase the books. All lines are original.

### Template format

```json
{
  "key": "levelUp",
  "variants": [
    { "text": "Level {crawler.level}. {pick:Truly inspiring|Statistically inevitable|My condolences to the monsters}." },
    { "when": { "crawler.hpPct": { "lte": 10 } }, "text": "You leveled up while nearly dead. Full heal. You're welcome. Don't waste it." }
  ]
}
```

- `{path}` inserts a value from the event context. `{pick:a|b|c}` picks one at random.
- Variants with a matching `when` are preferred over unconditional ones.
- The narrator remembers the last 20 lines used and avoids repeating them.
- Every engine event type has a template key. Missing keys fail the content test, not the game.

### AI mood

The System AI has a hidden mood from -10 (contempt) to +10 (grudging respect). Achievements, CHA, stylish kills and doing stupid things move it. Templates can condition on mood, and in later builds it can affect box quality slightly.

### Event rooms

Event rooms are short narrative scenes with numbered choices. Each choice has a check (stat, skill, DC tier) and success/failure outcomes from a fixed effect list (loot, damage, status, XP, quest flag, spawn enemy, mood change). Start with 40 event templates spread across the three floor themes.

### Room descriptions

Room text is assembled from the floor theme: `[opening] [sight] [sound or smell] [contents] [exits]`. Descriptions are plain narrator voice, not the System AI, with occasional AI interjections (10% of rooms).

## Data schemas

All content lives in `packages/content/*.json` and is validated by Zod schemas at load; the TypeScript types below are the source for those schemas. A failing file stops the dev server with a readable error.

| File | Holds | Starter size |
| --- | --- | --- |
| `backstory/occupations.json`, `events.json`, `quirks.json`, `locations.json` | Backstory parts | 30 / 20 / 25 / 15 |
| `races.json` | Races | 10 |
| `classes.json` | Classes incl. hidden | 16 + 5 |
| `skills.json` | Skills | 30 |
| `spells.json` | Spells | 40 |
| `items/bases.json`, `materials.json`, `affixes.json`, `legendaryPowers.json`, `oddities.json`, `consumables.json` | Item parts | 50 / 10 / 60 / 15 / 20 / 30 |
| `rarityWeights.json`, `boxes.json` | Loot tuning | per floor / 6 tiers |
| `enemies/families.json`, `mods.json`, `bossTitles.json`, `bossAbilities.json` | Enemies | 13 / 15 / 30 / 40 |
| `floors.json` | Floor themes | 3 |
| `achievements.json` | Achievements | 80 |
| `quests/floor3.json` | Quest tables | see Floor 3 quest |
| `events.json` | Event room templates | 40 |
| `narration.json` | System AI templates | every event key |
| `statusEffects.json`, `unlocks.json` | Rules data | 11 / 15 |
| `arenaFeatures.json` | Grid-combat obstacles, terrain and hazards | 20+ |
| `lootTables.json` | Weighted item tables (room junk now; drops and boxes later) | 5+ |
| `recipes.json` | Crafting recipes | 19+ |

### Core types

```ts
type Stat = "STR" | "DEX" | "CON" | "INT" | "CHA";
type StatBlock = Record<Stat, number>;
type Dice = string; // "2d6+1"
type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
type DcTier = "trivial" | "easy" | "medium" | "hard" | "brutal" | "absurd";

interface Effect {             // shared by items, spells, events, rulings
  kind: "damage" | "heal" | "status" | "stat" | "xp" | "loot" | "flag" | "mood" | "move" | "spawn";
  value?: Dice | number;
  statusId?: string; stat?: Stat; flag?: string; duration?: number; damageType?: string;
}

interface Occupation { id: string; name: string; weights: StatBlock; skill: string; item: string; }

interface ItemBase {
  id: string; name: string; slot: Slot; twoHanded?: boolean;
  weaponType?: string; damage?: Dice; stat?: "STR" | "DEX";
  armor?: number; weight: number; value: number; tags: string[];
}

interface Affix {
  id: string; name: string; kind: "prefix" | "suffix"; group: string;
  slots: Slot[]; minLevel: number; effect: Effect; magnitude: [number, number];
}

interface Race {
  id: string; name: string; rarity: "common" | "uncommon" | "absurd";
  statMods: Partial<StatBlock>; hpBonus: number; size: "small" | "medium" | "large";
  traits: { id: string; text: string; effect: Effect | string }[];
  restrictions: string[]; statAffinity: Partial<StatBlock>; flavor: string;
}

interface CharClass {
  id: string; name: string; hidden: boolean;
  requirements: Condition[];      // same rule format as achievement triggers
  forbiddenRaces: string[]; statWeights: Partial<StatBlock>;
  affinitySkills: string[]; affinityTags: string[];
  hpBonus: number; mpBonus: number;
  grants: { classLevel: number; skills?: string[]; spells?: string[]; stats?: Partial<StatBlock>; perk?: string }[];
}

interface Spell {
  id: string; name: string; school: string; target: "self" | "single" | "area" | "ally";
  range: "close" | "near" | "far"; mpBase: number; mpPerLevel: number; cooldown: number;
  effects: Effect[]; save?: Stat; scaling: string;   // e.g. "damage +1d6 per 3 levels"
}

interface EnemyFamily {
  id: string; name: string; floors: number[]; statProfile: StatBlock; hpBase: number; armor: number;
  attacks: { id: string; name: string; damage: Dice; range: string; effects?: Effect[] }[];
  ai: string[]; talkable: boolean; groupSize: [number, number]; lootTable: string; tags: string[];
  speed: number;   // grid tiles per turn (the crawler moves 4)
  glyph?: string;  // drawn when there's no sprite
}

interface Achievement {
  id: string; name: string; tags: string[]; trigger: Condition;
  reward: { box: string; boxType: string } | { xp: number }; repeatable: boolean; text: string;
}

type Condition =
  | { event: string; where?: Record<string, unknown> }
  | { counter: string; gte: number }
  | { state: string; lte?: number; gte?: number }
  | { all: Condition[] } | { any: Condition[] };
```

Remaining types (floors, events, quests, narration, boxes, unlocks) follow the same style and are defined by Claude Code from the sections above.

## Build order

Build in 13 milestones, each ending in something playable or testable. Don't start a milestone until the previous one's acceptance checks pass. Content files can start small (5-10 entries each) and grow in Milestone 13.

| # | Milestone | Done when |
| --- | --- | --- |
| 0 | Scaffold: monorepo, Vite client, Hono server, Vitest, Zod content loader | `npm run dev` shows a blank terminal UI; a bad JSON file fails loudly |
| 1 | Engine core: RNG module, dice parser, check resolver, `step()` reducer, event log | Unit tests for dice ranges, nat 1/20, DC formula, crit/fail margins |
| 2 | Character creation + UI shell: backstory generator, stat gen, starting kit, command parser, buttons, save/load | New crawler appears with roast; refresh keeps the save |
| 3 | Floor 1: map generator, room types, descriptions, `look`/`map`/`go`, game clock, collapse timer, stairwells | 100 generated floors all pass reachability test; timer kills you off-stairs |
| 4 | Combat: initiative, actions, range bands, status effects, enemy families, priority AI, flee | Scripted fight tests; a Floor 1 run is winnable and losable |
| 4b | Grid combat (account toggle, grid default), mob packs and minions, junk seeding with a minimal inventory (take/drop/equip, weight), crafting at workbenches | Scripted grid fights and arena property tests pass; recipes craft from seeded junk; the sim runs both combat modes with zero stuck runs |
| 5 | Items: generator, rarity, affixes, equip slots, inventory, weight, consumables | 1,000 generated items all valid; equipping changes derived stats |
| 6 | Progression: XP and levels, stat points, skills with use-XP, spells and tomes, MP | Skills rank up from use; a spell levels after N casts |
| 7 | Rewards: achievements engine, counters, loot boxes, safe rooms, shops, narration templates, AI mood | 20 achievements fire correctly in tests; boxes only open in safe rooms |
| 8 | Death and account: permadeath, legacy points, unlocks, codex, bequest | Die, start a new crawler, see unlocks and the bequest on Floor 1 |
| 9 | Floor 2: districts, elites, district bosses (rule-based AI for now) | Full Floors 1-2 run is playable |
| 10 | Claude bosses: `/api/boss`, intro, freeform rulings, boss turns, phases, fallback | Boss fight works with key present and with the server offline |
| 11 | Floor 3 selection: Selection Booth, race and class offers, hidden classes, class level grants | Different playstyles produce different class menus (test with fixture crawlers) |
| 12 | Floor 3 quest: quest state machine, tables, twist, flags, finale arena, quest boss | Quest completes along at least two different flag paths |
| 13 | Content and balance: fill all tables to starter sizes, auto-play simulation script, tune numbers | Simulated crawlers reach Floor 3 30-60% of the time; median end level 12-18 |

### Notes for Claude Code

- Keep the engine free of React, DOM and `fetch`. The boss call is injected as an async dependency.
- Put every random call through `rng.ts` so tests can stub it.
- Write a headless auto-play script (`npm run sim`) in Milestone 4 and keep extending it; it's the balance tool.
- Log assumptions in `DECISIONS.md` instead of asking.
- When in doubt about tone, write it meaner and weirder.

## Deferred

These are out of scope for the first build. The engine should leave room for them (event hooks, unused fields) but not implement them.

- **Fame and audience**: viewers, followers, sponsors, fan boxes, benefactor boxes, AI mood tied to ratings.
- **Floors 4+**: new themes, celestial boxes, bigger boss tiers, more complex quests.
- **Pet sentience and pet classes.**
- **Advanced crafting**: basic junk crafting landed in Milestone 4b. The Junk Engineer class gets crafting perks (bench-free crafting, Tinkering ranks, gadget recipes) in Milestone 11.
- **Other crawlers**: rival and party NPC crawlers who share the floor.
- **Claude flavor beyond bosses**: optional live narration for event rooms, NPC conversations and shop haggling.
