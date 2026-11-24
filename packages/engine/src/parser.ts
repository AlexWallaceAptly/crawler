import type { Action } from "./actions";
import type { Content } from "./content/load";
import { AP_COST, apNow } from "./rules/ap";
import { isAllowed, rerollsLeft } from "./step";
import { COMBAT_MODES, type CombatMode, type Dir, type World } from "./state";
import { allTiles, coord, DIR8, dist, index, occupied, parseCoord, pathField, type Dir8 } from "./grid/geometry";
import { isThrowable, throwTargets } from "./maneuvers";
import { autoAssign } from "./craft";
import { speedOf } from "./grid/units";
import { breakableWalls, effectsNow, knownModuleVerb, moduleViews } from "./modules";
import { counterItems } from "./boss";
import { pendingShard } from "./echo";
import { openStairwell } from "./explore";
import { scrollsIn, spellNumbers, spellTargetTiles } from "./spells";
import { derive } from "./rules/derived";

export type ParseResult = { ok: true; action: Action } | { ok: false; reason: "empty" | "unknown"; input: string };

/** Verb aliases → canonical verb. */
const VERBS: Record<string, string> = {
  help: "help", h: "help", "?": "help", commands: "help",
  look: "look", l: "look",
  accept: "accept", yes: "accept", y: "accept", ok: "accept",
  reroll: "reroll", no: "reroll",
  abandon: "abandon", quit: "abandon", suicide: "abandon",
  new: "new", next: "new", restart: "new",
  go: "go", move: "go", walk: "go",
  north: "north", n: "north", east: "east", e: "east",
  south: "south", s: "south", west: "west", w: "west",
  ne: "diag", nw: "diag", se: "diag", sw: "diag",
  northeast: "diag", northwest: "diag", southeast: "diag", southwest: "diag",
  map: "map", m: "map",
  search: "search", loot: "search",
  rest: "rest", sleep: "sleep", nap: "sleep",
  descend: "descend", down: "descend", stairs: "descend",
  attack: "attack", a: "attack", hit: "attack", kill: "attack", fight: "attack",
  flee: "flee", run: "flee", escape: "flee",
  advance: "advance", approach: "advance", closer: "advance",
  retreat: "retreat", back: "retreat",
  talk: "talk", parley: "talk", negotiate: "talk",
  use: "use", drink: "use", eat: "use", quaff: "use", read: "use", study: "use",
  cast: "cast", c: "cast", conjure: "cast", spell: "cast",
  wait: "wait", pass: "wait", end: "wait",
  take: "take", get: "take", grab: "take", pick: "take", pocket: "take",
  shove: "shove", push: "shove", barge: "shove", kick: "shove",
  throw: "throw", toss: "throw", chuck: "throw", lob: "throw", hurl: "throw",
  dash: "dash", sprint: "dash", charge: "dash",
  defend: "defend", brace: "defend", block: "defend", guard: "defend",
  combine: "combine", tape: "combine", attach: "combine", mix: "combine", jury: "combine",
  craft: "craft", make: "craft", build: "craft",
  recipes: "recipes", recipe: "recipes", book: "recipes",
  raise: "raise", increase: "raise", boost: "raise", spend: "raise", level: "raise",
  drop: "drop", discard: "drop", ditch: "drop",
  equip: "equip", wield: "equip", wear: "equip", hold: "equip", ready: "equip",
  unequip: "unequip", remove: "unequip", doff: "unequip", unwield: "unequip",
  set: "set", setting: "set", settings: "set",
  decline: "decline",
  let: "let", allow: "allowEcho",
  hush: "refuseEcho", shush: "refuseEcho", deny: "refuseEcho", refuse: "refuseEcho",
  feed: "feed",
  codex: "codex", lore: "codex", journal: "codex",
  echo: "echo", stray: "echo",
  return: "use", give: "use", hand: "use", show: "use",
};

const DIR_WORDS: Record<string, Dir> = {
  north: "north", n: "north", east: "east", e: "east",
  south: "south", s: "south", west: "west", w: "west",
};

/** Grid directions, long or short. */
const DIR8_WORDS: Record<string, Dir8> = {
  n: "n", north: "n", ne: "ne", northeast: "ne", e: "e", east: "e", se: "se", southeast: "se",
  s: "s", south: "s", sw: "sw", southwest: "sw", w: "w", west: "w", nw: "nw", northwest: "nw",
};

function inGridFight(world: World): boolean {
  return world.game.phase === "combat" && world.game.combat?.mode === "grid" && world.game.combat.arena !== undefined;
}

/** "c4", "3 2" (x y, 1-based), "ne", "ne 2", "north 3". */
function parseTileRef(arg: string): Extract<Action, { type: "move" }>["to"] | null {
  const words = arg.split(" ").filter(Boolean);
  if (words.length === 1) {
    const tile = parseCoord(words[0]!);
    if (tile) return tile;
  }
  if (words.length === 2 && /^\d+$/.test(words[0]!) && /^\d+$/.test(words[1]!)) {
    return { x: Number(words[0]) - 1, y: Number(words[1]) - 1 };
  }
  const dir = DIR8_WORDS[words[0] ?? ""];
  if (dir && words.length <= 2) {
    const steps = words[1] === undefined ? 1 : Number(words[1]);
    if (Number.isInteger(steps) && steps >= 1 && steps <= 9) return { dir, steps };
  }
  return null;
}

export function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

const STAT_WORDS: Record<string, string> = {
  str: "STR", strength: "STR", dex: "DEX", dexterity: "DEX", con: "CON", constitution: "CON",
  int: "INT", intelligence: "INT", cha: "CHA", charisma: "CHA",
};

export function parseCommand(input: string, world: World): ParseResult {
  const text = normalize(input);
  if (text === "") return { ok: false, reason: "empty", input };
  // "no thanks" / "no, thank you" is declining, not rerolling.
  if (/^no,? thank(s| you)\b/.test(text)) return { ok: true, action: { type: "decline" } };
  const [rawVerb = "", ...rest] = text.split(" ");
  const verb = VERBS[rawVerb];
  const arg = rest.join(" ");
  const moduleVerb = knownModuleVerb(rawVerb);
  if (moduleVerb) {
    const target = arg.replace(/^(the|at|on) /, "");
    return { ok: true, action: target ? { type: "module", verb: moduleVerb, arg: target } : { type: "module", verb: moduleVerb } };
  }
  if (inGridFight(world)) {
    // On the board, movement words walk tiles instead of rooms.
    if (verb === "go") {
      const to = parseTileRef(arg);
      return to ? { ok: true, action: { type: "move", to } } : { ok: false, reason: "unknown", input: text };
    }
    if (verb === "north" || verb === "east" || verb === "south" || verb === "west" || verb === "diag") {
      const to = parseTileRef(text);
      if (to) return { ok: true, action: { type: "move", to } };
    }
  }
  switch (verb) {
    case "help":
      return { ok: true, action: { type: "help" } };
    case "look":
      return { ok: true, action: { type: "look" } };
    case "go": {
      const dir = DIR_WORDS[arg];
      if (!dir) return { ok: false, reason: "unknown", input: text };
      return { ok: true, action: { type: "go", dir } };
    }
    case "north": case "east": case "south": case "west":
      return { ok: true, action: { type: "go", dir: verb as Dir } };
    case "map":
      return { ok: true, action: { type: "map" } };
    case "search":
      return { ok: true, action: { type: "search" } };
    case "rest":
      return { ok: true, action: { type: "rest" } };
    case "sleep":
      return { ok: true, action: { type: "sleep" } };
    case "descend":
      return { ok: true, action: { type: "descend" } };
    case "attack":
      return { ok: true, action: arg ? { type: "attack", target: arg } : { type: "attack" } };
    case "flee":
      return { ok: true, action: { type: "flee" } };
    case "advance":
      return { ok: true, action: { type: "advance" } };
    case "retreat":
      return { ok: true, action: { type: "retreat" } };
    case "talk":
      return { ok: true, action: { type: "talk" } };
    case "use": {
      if (!arg) return { ok: false, reason: "unknown", input: text };
      // "read scroll of grease fire at d4": a scroll can be aimed.
      const at = / at (.+)$/.exec(arg);
      return { ok: true, action: at ? { type: "use", item: arg.slice(0, at.index), at: at[1]! } : { type: "use", item: arg } };
    }
    case "cast": {
      const at = / (?:at|on) (.+)$/.exec(arg);
      const spell = (at ? arg.slice(0, at.index) : arg).trim();
      if (!spell) return { ok: false, reason: "unknown", input: text };
      return { ok: true, action: at ? { type: "cast", spell, at: at[1]! } : { type: "cast", spell } };
    }
    case "accept":
      return { ok: true, action: { type: "accept" } };
    case "reroll":
      return { ok: true, action: { type: "reroll" } };
    case "abandon":
      return { ok: true, action: { type: "abandon", confirm: arg === "confirm" || arg === "yes" } };
    case "new":
      return { ok: true, action: { type: "newCrawler" } };
    case "wait":
      return { ok: true, action: { type: "wait" } };
    case "shove":
      return { ok: true, action: arg ? { type: "shove", target: arg } : { type: "shove" } };
    case "throw": {
      const at = / at (.+)$/.exec(arg);
      const item = at ? arg.slice(0, at.index) : arg;
      if (!item) return { ok: false, reason: "unknown", input: text };
      return { ok: true, action: at ? { type: "throw", item, at: at[1]! } : { type: "throw", item } };
    }
    case "dash": {
      const to = parseTileRef(arg);
      return to ? { ok: true, action: { type: "dash", to } } : { ok: false, reason: "unknown", input: text };
    }
    case "defend":
      return { ok: true, action: { type: "defend" } };
    case "combine": {
      // "tape the bat" style: the verb itself can be a part ("tape bat tacks")
      const items = rawVerb === "tape" ? `tape ${arg}` : arg.replace(/^rig /, "");
      if (!items.trim()) return { ok: false, reason: "unknown", input: text };
      return { ok: true, action: { type: "combine", items } };
    }
    case "craft":
      if (!arg) return { ok: true, action: { type: "recipes" } };
      return { ok: true, action: { type: "craft", recipe: arg } };
    case "recipes":
      return { ok: true, action: { type: "recipes" } };
    case "raise": {
      // "raise str", "raise strength 2", "level up dex", "spend 2 on con"
      const words = arg.replace(/^(up|points?|a point|on|into|in) /g, "").split(" ").filter((w) => !["on", "into", "in", "point", "points"].includes(w));
      const stat = words.map((w) => STAT_WORDS[w]).find(Boolean);
      const n = Number(words.find((w) => /^\d+$/.test(w)) ?? 1);
      if (!stat) return { ok: false, reason: "unknown", input: text };
      return { ok: true, action: { type: "raise", stat, times: Math.max(1, n) } };
    }
    case "take": {
      const what = arg.replace(/^up /, "").replace(/^the /, "");
      if (!what) return { ok: false, reason: "unknown", input: text };
      return { ok: true, action: { type: "take", item: what } };
    }
    case "drop": case "equip": case "unequip":
      if (!arg) return { ok: false, reason: "unknown", input: text };
      return { ok: true, action: { type: verb, item: arg.replace(/^the /, "") } };
    case "decline":
      return { ok: true, action: { type: "decline" } };
    case "let":
      if (arg !== "echo" && arg !== "it" && arg !== "stray") return { ok: false, reason: "unknown", input: text };
      return { ok: true, action: { type: "allowEcho" } };
    case "allowEcho":
      return { ok: true, action: { type: "allowEcho" } };
    case "refuseEcho":
      return { ok: true, action: { type: "refuseEcho" } };
    case "feed":
      return { ok: true, action: { type: "feed", item: arg.replace(/^(echo|it|stray)( the)? ?/, "") } };
    case "codex":
      return { ok: true, action: { type: "codex" } };
    case "echo":
      return { ok: true, action: { type: "echo" } };
    case "set": {
      // "set combat grid" / "set combat bands" (also "set grid")
      const words = arg.split(" ").filter((w) => w !== "combat" && w !== "mode" && w !== "to");
      const value = words[0] === "band" ? "bands" : words[0];
      if (words.length !== 1 || !COMBAT_MODES.includes(value as CombatMode)) {
        return { ok: false, reason: "unknown", input: text };
      }
      return { ok: true, action: { type: "set", key: "combat", value: value as CombatMode } };
    }
    default:
      return { ok: false, reason: "unknown", input: text };
  }
}

export interface CommandOption {
  /** Button text. */
  label: string;
  /** Command text submitted when clicked (same path as typing). */
  input: string;
  /** Visual emphasis for the primary choice. */
  primary?: boolean;
  /**
   * Grid fights: this command needs a tile. Clicking the button arms it, and
   * tapping one of these coordinates submits `${input} ${coord}`.
   */
  targets?: string[];
  /** Combat: what this costs in action points. */
  ap?: number;
  /** Combat: you can't pay for it this turn (or `why` says what else is stopping it). */
  disabled?: boolean;
  /** Why it's greyed out, when it isn't the AP ("out of MP", "nothing in reach"). */
  why?: string;
  /** Rarely wanted: touch layouts tuck these behind a "More" menu. */
  niche?: true;
}

/** Every valid command for the current state, shown as clickable buttons. */
export function availableCommands(world: World, content: Content): CommandOption[] {
  const out: CommandOption[] = [];
  const phase = world.game.phase;
  if (phase === "creation") {
    out.push({ label: "Accept crawler", input: "accept", primary: true });
    const left = rerollsLeft(world);
    if (left > 0) out.push({ label: `Reroll (${left} left)`, input: "reroll" });
  }
  if (phase === "dead") out.push({ label: "Next crawler", input: "new", primary: true });
  if ((phase === "exploring" || phase === "combat") && world.game.echo?.urge) {
    out.push({ label: `Let Echo ${world.game.echo.urge.kind}`, input: "let echo", primary: true });
    out.push({ label: "Hush", input: "hush" });
  }
  if (phase === "combat" && world.game.combat && world.game.crawler) {
    const combat = world.game.combat;
    const crawler = world.game.crawler;
    const foes = combat.enemies.filter((e) => e.hp > 0);
    const grid = combat.mode === "grid" && combat.arena;
    const { ap } = apNow(combat, crawler, content);
    /** Every combat button carries its AP price; ones you can't pay for are greyed out. */
    const add = (o: CommandOption, cost: number) => out.push({ ...o, ap: cost, ...(cost > ap ? { disabled: true } : {}) });
    const held = crawler.inventory.find((i) => i.uid === crawler.equipment.mainHand);
    const swing = held?.power ? held.apCost ?? AP_COST.attack : 1;
    for (const e of foes.slice(0, 4)) {
      add({ label: `Attack ${e.name}`, input: `attack ${e.name.toLowerCase()}`, primary: foes.indexOf(e) === 0 }, swing);
    }
    if (grid) {
      const paid = combat.turnBegun && combat.arena!.moveLeft > 0;
      add({ label: "Advance", input: "advance" }, paid ? 0 : AP_COST.move);
      add({ label: "Retreat", input: "retreat" }, paid ? 0 : AP_COST.move);
    } else {
      if (foes.some((e) => e.range !== "close")) add({ label: "Advance", input: "advance" }, AP_COST.move);
      if (foes.some((e) => e.range !== "far")) add({ label: "Retreat", input: "retreat" }, AP_COST.move);
    }
    if (foes.some((e) => e.talkable)) add({ niche: true, label: "Talk", input: "talk" }, AP_COST.talk);
    const potion = crawler.inventory.find((i) => i.kind === "consumable" && i.tags.includes("healing") &&
      content.items.consumables.byId[i.baseId]?.usableInCombat !== false);
    if (potion) add({ label: `Use ${potion.name}`, input: `use ${potion.name.toLowerCase()}` }, AP_COST.item);
    const throwables = crawler.inventory.filter((i) => {
      const def = i.kind === "consumable" ? content.items.consumables.byId[i.baseId] : undefined;
      return def && isThrowable(def) && (def.usableInCombat || def.hazard);
    });
    if (grid) {
      const a = combat.arena!;
      const live = foes.filter((e) => e.pos);
      add({ niche: true, label: "Shove", input: "shove", targets: live.map((e) => coord(e.pos!)) }, AP_COST.shove);
      const throwAt = throwTargets(a, content).map(coord);
      for (const t of throwables.slice(0, 2)) {
        add({ niche: true, label: `Throw ${t.name}`, input: `throw ${t.name.toLowerCase()} at`, targets: throwAt }, AP_COST.throw);
      }
      const budget = (combat.turnBegun ? a.moveLeft : 0) + 2 * speedOf(crawler, content);
      const field = pathField(a, content, a.crawler, { blocked: (p) => occupied(combat, p, "crawler") });
      const dashTo = allTiles(a).filter((p) => {
        const c = field.cost[index(a, p)]!;
        return c > 0 && c <= budget;
      }).map(coord);
      if (dashTo.length) add({ niche: true, label: "Dash", input: "dash", targets: dashTo }, AP_COST.dash);
      for (const it of a.items.filter((n) => dist(n, a.crawler) <= 1).slice(0, 2)) {
        add({ label: `Take ${it.item.name}`, input: `take ${it.item.name.toLowerCase()}` }, combat.turnBegun && a.moveLeft > 0 ? 0 : AP_COST.move);
      }
    } else {
      const first = foes[0];
      if (first && first.range === "close") add({ niche: true, label: `Shove ${first.name}`, input: `shove ${first.name.toLowerCase()}` }, AP_COST.shove);
      for (const t of throwables.slice(0, 2)) add({ niche: true, label: `Throw ${t.name}`, input: `throw ${t.name.toLowerCase()}` }, AP_COST.throw);
    }
    // Spells you know (MP, cooldown and AP on the button), then scrolls.
    for (const b of spellButtons(world, content, "fight")) add(b.option, b.ap);
    for (const sc of scrollsIn(crawler).slice(0, 2)) {
      const spell = content.spells.byId[sc.spellId!];
      if (!spell) continue;
      const n = spellNumbers(crawler, content, spell, sc.spellLevel ?? 1);
      const targets = grid && spell.target !== "self" ? spellTargetTiles(world.game, content, spell, n).map(coord) : undefined;
      if (targets && targets.length === 0) {
        add({ niche: true, label: `Read ${sc.name} (out of reach)`, input: `use ${sc.name.toLowerCase()}`, disabled: true, why: `Nothing ${spell.range === "close" ? "next to you" : "in reach"} for it to hit` }, n.ap);
        continue;
      }
      const input = `use ${sc.name.toLowerCase()}${targets ? " at" : ""}`;
      add({ niche: true, label: `Read ${sc.name}`, input, ...(targets ? { targets } : {}) }, n.ap);
    }
    const bossId = combat.boss?.id;
    const boss = bossId ? content.bosses.byId[bossId] : undefined;
    if (boss?.weakness.trigger?.kind === "decline") add({ label: "Decline politely", input: "decline" }, AP_COST.item);
    for (const it of counterItems({ game: world.game, content }).slice(0, 1)) {
      add({ label: `Return ${it.name}`, input: `use ${it.name.toLowerCase()}` }, AP_COST.item);
    }
    const fx = effectsNow(world.game, content);
    if ((fx.tether || fx.yank) && !combat.used?.includes("bind")) add({ label: fx.yank ? "Yank (Rope Bind)" : "Bind (Rope Bind)", input: "bind" }, AP_COST.shove);
    if (fx.shout && !combat.used?.includes("shout")) add({ label: "Shout (Nervous Ping)", input: "shout" }, AP_COST.shove);
    add({ label: "Defend", input: "defend" }, AP_COST.defend);
    out.push({ label: "End turn", input: "wait" });
    // On the board, flee runs for a door with whatever AP you have; the 2 AP is for getting through it.
    if (grid) out.push({ niche: true, label: "Flee", input: "flee", ap: AP_COST.flee });
    else add({ niche: true, label: "Flee", input: "flee" }, AP_COST.flee);
  }
  const floor = world.game.floor;
  if (phase === "exploring" && floor) {
    const room = floor.rooms[floor.currentRoom]!;
    for (const dir of ["north", "west", "east", "south"] as const) {
      if (room.exits[dir] !== undefined) out.push({ label: dir[0]!.toUpperCase() + dir.slice(1), input: dir });
    }
    const items = room.items ?? [];
    for (const it of items.slice(0, 3)) out.push({ label: `Take ${it.name}`, input: `take ${it.name.toLowerCase()}` });
    if (items.length > 1) out.push({ label: "Take all", input: "take all" });
    if (openStairwell(floor, room)) out.push({ label: "Descend", input: "descend", primary: true });
    if (room.type === "safe") out.push({ label: "Sleep", input: "sleep" });
    if (room.type === "safe" || room.workbench) {
      const c = world.game.crawler!;
      for (const m of moduleViews(world.game, content).filter((v) => !v.installed && v.ready)) {
        out.push({ label: `Build ${m.name}`, input: `craft ${m.name.toLowerCase()}`, primary: true });
      }
      for (const r of content.recipes.all.filter((r) => (c.recipes ?? []).includes(r.id) && autoAssign(c, r)).slice(0, 3)) {
        out.push({ label: `Craft ${r.name}`, input: `craft ${r.name.toLowerCase()}` });
      }
      out.push({ niche: true, label: "Recipes", input: "recipes" });
    }
    for (const b of spellButtons(world, content, "explore")) out.push(b.option);
    const c = world.game.crawler!;
    for (const tome of c.inventory.filter((i) => i.spellId && i.spellLevel === undefined).slice(0, 2)) {
      out.push({ label: `Read ${tome.name}`, input: `use ${tome.name.toLowerCase()}`, primary: !c.spells[tome.spellId!] });
    }
    if (pendingShard(world.game, content, room)) out.push({ label: "Search for the voice", input: "search", primary: true });
    else if (!room.searched) out.push({ label: "Search", input: "search" });
    out.push({ label: "Rest", input: "rest" });
    out.push({ niche: true, label: "Map", input: "map" });
    if (world.game.echo) {
      const fx = effectsNow(world.game, content);
      if (fx.breakWalls) for (const w of breakableWalls(world.game)) out.push({ niche: true, label: `Break ${w.dir}`, input: `break ${w.dir}` });
      if (fx.coat && !world.game.echo.floorUsed.includes("coat") && world.game.crawler?.equipment.mainHand) out.push({ niche: true, label: "Coat weapon (Salt Reader)", input: "coat" });
      out.push({ niche: true, label: "Echo", input: "echo" });
    }
  }
  if (world.game.crawler) out.push({ niche: true, label: "Codex", input: "codex" });
  if (isAllowed(world, "look")) out.push({ niche: true, label: "Look", input: "look" });
  out.push({ niche: true, label: "Help", input: "help" });
  return out;
}

/** Most spells worth a button: the ones a fight (or a quiet room) can use, up to six. */
const SPELL_BUTTONS = 6;

/**
 * Buttons for the spells you know that work right now. In a fight: MP and cooldown in the
 * label, greyed out when you can't pay, and grid spells arm a tile pick. Exploring: only
 * spells that would do something (a heal when you're hurt, a cure when you need one).
 */
function spellButtons(world: World, content: Content, mode: "fight" | "explore"): { option: CommandOption; ap: number }[] {
  const c = world.game.crawler;
  if (!c) return [];
  const d = derive(c, content);
  const grid = mode === "fight" && world.game.combat?.mode === "grid" && !!world.game.combat.arena;
  const out: { option: CommandOption; ap: number }[] = [];
  for (const [id, st] of Object.entries(c.spells)) {
    const spell = content.spells.byId[id];
    if (!spell || (spell.when !== "any" && spell.when !== mode)) continue;
    if (spell.target === "self" && spell.power && c.hp >= d.maxHP) continue;
    if (spell.cures && !c.statuses.some((s) => spell.cures!.includes(s.id))) continue;
    const n = spellNumbers(c, content, spell, st.level);
    const cooling = mode === "fight" && st.cooldown > 0;
    const short = c.mp < n.mp;
    const targets = grid && spell.target !== "self" ? spellTargetTiles(world.game, content, spell, n).map(coord) : undefined;
    // Out of reach on the board: greyed out, so you can see it's there (spells never walk you closer).
    const away = !!targets && targets.length === 0;
    const label = `Cast ${spell.name} (${cooling ? `ready in ${st.cooldown}` : away ? "out of reach" : `${n.mp} MP`})`;
    const input = `cast ${spell.name.toLowerCase()}${targets && !away ? " at" : ""}`;
    const why = cooling ? `Recharging: ready in ${st.cooldown} round${st.cooldown === 1 ? "" : "s"}`
      : away ? `Nothing ${spell.range === "close" ? "next to you" : "in reach"} for it to hit. Spells don't walk you closer`
      : short ? `Costs ${n.mp} MP; you have ${c.mp}` : undefined;
    out.push({
      option: { label, input, ...(targets && !away ? { targets } : {}), ...(why ? { disabled: true, why } : {}) },
      ap: n.ap,
    });
    if (out.length >= SPELL_BUTTONS) break;
  }
  return out;
}
