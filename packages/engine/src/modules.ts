/**
 * Echo's modules (docs/DESIGN.md, "Modules"). A module is unlocked for the run by a
 * shard, built from named parts at a workbench (`craft glow`), and does whatever its
 * current variant's effect bag says. Temper picks the variant at the moment of use:
 * Fed at +3 and up, Calm at -3 and down, base between (see echo.ts sideOf).
 *
 * The engine only reads the flags in ModuleEffectSchema; this file is where each one
 * hooks into exploration and combat.
 */
import type { Content } from "./content/load";
import type { EchoModule, ModuleEffect } from "./content/schemas";
import { chance } from "./rng";
import { rollDice } from "./rules/dice";
import { applyStatus, hasFlag } from "./rules/effects";
import { AP_COST } from "./rules/ap";
import { bfsDistances } from "./gen/floor";
import { addToPile } from "./inventory";
import { timePassed } from "./explore";
import { atWorkbench } from "./craft";
import { pushTemper, recordRecipe, sideOf, type Side } from "./echo";
import {
  afterAction, aliveEnemies, beginTurn, canAfford, damageEnemy, findEnemy, inReach, isGrid, spendAp,
} from "./combat";
import { blocksMove, DIR8, dist, inBounds, occupied } from "./grid/geometry";
import { syncBands } from "./grid/units";
import { DIRS, type Dir, type Enemy, type GameState, type ItemInstance, type Room } from "./state";
import type { StepContext } from "./step";

/** Modules built this run. */
export function installed(game: GameState, content: Content): EchoModule[] {
  return (game.echo?.modules ?? []).map((id) => content.modules.byId[id]).filter((m): m is EchoModule => !!m);
}

export function variantOf(m: EchoModule, side: Side): ModuleEffect {
  return m.effects?.[side] ?? {};
}

/** Everything Echo's modules do right now, merged (numbers take the larger, flags OR). */
export function effectsNow(game: GameState, content: Content): ModuleEffect {
  const side = sideOf(content, game.echo?.temper ?? 0);
  const out: Record<string, unknown> = {};
  for (const m of installed(game, content)) {
    for (const [k, v] of Object.entries(variantOf(m, side))) {
      const prev = out[k];
      if (typeof v === "number") out[k] = typeof prev === "number" ? Math.max(prev, v) : v;
      else if (typeof v === "boolean") out[k] = Boolean(prev) || v;
      else if (prev === undefined) out[k] = v;
    }
  }
  return out as ModuleEffect;
}

export function isUnlocked(game: GameState, m: EchoModule): boolean {
  return !!game.echo?.shards.includes(m.unlockedBy);
}

function partCount(inv: ItemInstance[], id: string): number {
  return inv.filter((i) => i.baseId === id).reduce((n, i) => n + i.qty, 0);
}

export interface ModuleView {
  id: string;
  name: string;
  installed: boolean;
  /** The parts, with what you're carrying. */
  parts: { name: string; have: number; need: number }[];
  ready: boolean;
  /** Not built in the engine yet (a later floor's module). */
  future: boolean;
  /** What it does at the current Temper. */
  now: string;
  side: Side;
}

/** Modules this run knows about: built, or unlocked by a shard you've found. */
export function moduleViews(game: GameState, content: Content): ModuleView[] {
  const c = game.crawler;
  const side = sideOf(content, game.echo?.temper ?? 0);
  return content.modules.all
    .filter((m) => game.echo?.modules.includes(m.id) || isUnlocked(game, m))
    .map((m) => {
      const parts = m.parts.map((p) => ({
        name: content.items.consumables.byId[p.item]?.name ?? content.items.bases.byId[p.item]?.name ?? p.item,
        have: c ? partCount(c.inventory, p.item) : 0,
        need: p.qty,
      }));
      return {
        id: m.id,
        name: m.name,
        installed: !!game.echo?.modules.includes(m.id),
        parts,
        ready: !!m.effects && parts.every((p) => p.have >= p.need),
        future: !m.effects,
        now: side === "fed" ? m.fed : side === "calm" ? m.calm : m.base,
        side,
      };
    });
}

/** The module a name means, among the run's unlocked and built ones (exact, then partial). */
export function findModule(game: GameState, content: Content, name: string): EchoModule | undefined {
  const q = name.toLowerCase().trim();
  const known = content.modules.all.filter((m) => game.echo?.modules.includes(m.id) || isUnlocked(game, m));
  return known.find((m) => m.name.toLowerCase() === q) ?? known.find((m) => m.name.toLowerCase().includes(q));
}

/**
 * `craft <module>`. Returns false if the name isn't one of this run's modules, so the
 * ordinary recipe book can have a go.
 */
export function craftModule(ctx: StepContext, name: string): boolean {
  const m = findModule(ctx.game, ctx.content, name);
  if (!m) return false;
  const e = ctx.game.echo!;
  if (e.modules.includes(m.id)) {
    ctx.echoSay("echo.alreadyHave", { module: m.name });
    return true;
  }
  if (!m.effects) {
    ctx.error(`Echo knows how ${m.name} goes, but it can't run it this early in the dungeon. Later floors.`);
    return true;
  }
  const floor = ctx.game.floor;
  if (!atWorkbench(floor ? floor.rooms[floor.currentRoom] : undefined)) {
    ctx.say("craft.noBench");
    return true;
  }
  const c = ctx.crawler;
  const missing = m.parts.filter((p) => partCount(c.inventory, p.item) < p.qty);
  if (missing.length) {
    ctx.error(`You're missing parts for ${m.name}: ${m.partsText.toLowerCase()}.`);
    return true;
  }
  if (!timePassed(ctx, m.minutes)) return true;
  for (const p of m.parts) {
    let need = p.qty;
    for (const it of c.inventory.filter((i) => i.baseId === p.item)) {
      const n = Math.min(need, it.qty);
      it.qty -= n;
      need -= n;
      if (it.qty <= 0) {
        for (const [slot, uid] of Object.entries(c.equipment)) if (uid === it.uid) delete c.equipment[slot as keyof typeof c.equipment];
        c.inventory.splice(c.inventory.indexOf(it), 1);
      }
      if (need <= 0) break;
    }
  }
  e.modules.push(m.id);
  ctx.emit({ type: "moduleBuilt", name: m.name });
  ctx.echoSay("echo.moduleBuilt", { module: m.name });
  recordRecipe(ctx, m.id);
  onModulesChanged(ctx);
  return true;
}

// ---------------------------------------------------------------- exploration hooks

/** Room ids within `steps` rooms of here. */
function within(ctx: StepContext, from: number, steps: number): Room[] {
  const floor = ctx.game.floor!;
  const d = bfsDistances(floor.rooms, from);
  return floor.rooms.filter((r) => d[r.id]! >= 0 && d[r.id]! <= steps);
}

/** Things that happen when you walk into a room (Glow on first visits; Fault Sense on every entry). */
export function modulesOnEnter(ctx: StepContext, room: Room, first: boolean): void {
  const fx = effectsNow(ctx.game, ctx.content);
  if (first && fx.revealHidden && chance(fx.revealHidden) && ((room.hidden?.length ?? 0) > 0 || room.concealed)) {
    const found = room.hidden ?? [];
    room.items ??= [];
    for (const it of found) addToPile(room.items, it);
    delete room.hidden;
    const stairs = room.concealed;
    room.concealed = false;
    ctx.echoSay("echo.glow");
    const bits = [...found.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)), ...(stairs ? ["a stairwell behind a false wall"] : [])];
    ctx.describe(`Glow turns up: ${bits.join(", ")}.`);
  }
  senseAround(ctx, room.id, fx);
}

function senseAround(ctx: StepContext, from: number, fx: ModuleEffect): void {
  const floor = ctx.game.floor!;
  const found: string[] = [];
  if (fx.senseStairs) {
    for (const r of within(ctx, from, fx.senseStairs)) {
      if (r.type !== "stairwell" || !r.concealed) continue;
      r.concealed = false;
      r.seen = true;
      r.marked = true;
      found.push("a hidden stairwell");
    }
  }
  if (fx.senseLair && floor.bossRoom !== undefined && !floor.bossDefeated) {
    const lair = floor.rooms[floor.bossRoom]!;
    if (!lair.marked && within(ctx, from, fx.senseLair).includes(lair)) {
      lair.marked = true;
      lair.seen = true;
      found.push("something big, waiting");
    }
  }
  if (fx.markSafe) {
    const unmarked = floor.rooms.filter((r) => r.type === "safe" && !r.marked && !r.visited);
    for (const r of unmarked) {
      r.marked = true;
      r.seen = true;
    }
    if (unmarked.length) found.push(`${unmarked.length} safe room${unmarked.length === 1 ? "" : "s"}`);
  }
  if (found.length) {
    ctx.echoSay("echo.faultSense");
    ctx.describe(`Fault Sense marks your map: ${found.join(", ")}.`);
  }
}

/** Building a module can sense things straight away (Fault Sense where you stand). */
function onModulesChanged(ctx: StepContext): void {
  const floor = ctx.game.floor;
  if (floor) senseAround(ctx, floor.currentRoom, effectsNow(ctx.game, ctx.content));
}

/** Glow (Calm): traps are spotted for you. */
export function trapAutoSpotted(ctx: StepContext): boolean {
  return !!effectsNow(ctx.game, ctx.content).spotTraps;
}

/** Salt Reader (Calm): poison doesn't stick. Called at the start of your turn and per room moved. */
export function neutralizePoison(ctx: StepContext, inFight: boolean): void {
  if (!effectsNow(ctx.game, ctx.content).curePoison) return;
  const c = ctx.crawler;
  const i = c.statuses.findIndex((s) => s.id === "poisoned");
  if (i < 0) return;
  c.statuses.splice(i, 1);
  if (inFight) ctx.fight("Salt Reader neutralizes the poison.", "status");
  else ctx.describe("Salt Reader neutralizes the poison.");
  ctx.echoSay("echo.saltCure");
}

// ---------------------------------------------------------------- combat hooks

/**
 * Before the ambush check: Nervous Ping can call it out (you act first), and its Calm
 * variant adds initiative. Returns the crawler's adjusted initiative.
 */
export function pingInitiative(ctx: StepContext, playerInit: number, enemies: Enemy[]): number {
  const fx = effectsNow(ctx.game, ctx.content);
  let init = playerInit + (fx.initiative ?? 0);
  const ambushers = enemies.filter((e) => e.initiative > init);
  if (ambushers.length && fx.ambushGuard && chance(fx.ambushGuard)) {
    init = Math.max(...ambushers.map((e) => e.initiative)) + 1;
    ctx.echoSay("echo.ping");
    ctx.fight("Nervous Ping hears them coming. You act first.", "you");
  }
  return init;
}

/** Glow (Fed): a flare when the fight starts. Light-sensitive things are stunned, the rest blinded. */
export function glowFlare(ctx: StepContext): void {
  const rounds = effectsNow(ctx.game, ctx.content).blindOnStart;
  if (!rounds) return;
  const enemies = aliveEnemies(ctx);
  if (enemies.length === 0) return;
  const stun = ctx.content.statusEffects.get("stunned");
  const blind = ctx.content.statusEffects.get("blinded");
  for (const e of enemies) {
    const family = ctx.content.enemies.byId[e.familyId] ?? ctx.content.bosses.byId[e.familyId]?.family;
    const sensitive = family?.tags.includes("lightSensitive");
    applyStatus(e.statuses, sensitive ? stun : blind, rounds);
  }
  ctx.echoSay("echo.flare");
  ctx.fight("Glow flares, blinding white, and refuses to dim.", "you");
}

/** Salt Reader (Fed) coat, and poison on hit. Called from resolvePlayerHit on a hit that didn't kill. */
export function coatedHit(ctx: StepContext, target: Enemy): void {
  const c = ctx.crawler;
  if (!c.coat || target.hp <= 0) return;
  c.coat -= 1;
  const def = ctx.content.statusEffects.get("poisoned");
  if (applyStatus(target.statuses, def) !== "ignored") ctx.fight(`The salt-poison on your weapon gets into the ${target.name}.`, "status");
  if (c.coat <= 0) delete c.coat;
}

// ---------------------------------------------------------------- module commands

export type ModuleVerb = "shout" | "bind" | "coat" | "break";

function usedThisFight(ctx: StepContext, what: string): boolean {
  return !!ctx.game.combat?.used?.includes(what);
}
function markUsed(ctx: StepContext, what: string): void {
  const combat = ctx.game.combat!;
  combat.used = [...(combat.used ?? []), what];
}

/** `shout`, `bind <enemy>`, `coat`, `break <dir>`. */
export function moduleAction(ctx: StepContext, verb: ModuleVerb, arg?: string): void {
  const fx = effectsNow(ctx.game, ctx.content);
  const fighting = ctx.game.phase === "combat" && !!ctx.game.combat;
  if (verb === "shout") {
    if (!fx.shout) return void ctx.error("Echo can't shout. (Nervous Ping does that, once Echo is Fed enough to want to.)");
    if (!fighting) return void ctx.error("Nothing here to shout at.");
    if (usedThisFight(ctx, "shout")) return void ctx.error("Echo already shouted this fight. It's hoarse. It's thrilled about it.");
    if (!beginTurn(ctx) || !canAfford(ctx, AP_COST.shove, "Shouting")) return;
    spendAp(ctx, AP_COST.shove);
    markUsed(ctx, "shout");
    ctx.echoSay("echo.shout");
    const floorNo = ctx.game.floor?.floor ?? 1;
    for (const e of aliveEnemies(ctx).filter((x) => inReach(ctx, x, "near") || !isGrid(ctx) && x.range !== "far")) {
      damageEnemy(ctx, e, rollDice(fx.shout).total + floorNo, `Echo's shout hits the ${e.name}`);
    }
    pushTemper(ctx, "damagingModule");
    afterAction(ctx);
    return;
  }
  if (verb === "bind") {
    if (!fx.tether && !fx.yank) return void ctx.error("You'd need Rope Bind for that, and Echo would need to want to.");
    if (!fighting) return void ctx.error("Nothing here to tie up. Echo looks relieved.");
    if (usedThisFight(ctx, "bind")) return void ctx.error("The rope's already been thrown this fight.");
    const target = arg ? findEnemy(ctx, arg) : aliveEnemies(ctx).find((e) => inReach(ctx, e, "near"));
    if (!target) return void ctx.error(arg ? `Nothing here called "${arg}".` : "Nothing within near range to bind.");
    if (!inReach(ctx, target, "near")) return void ctx.error(`The ${target.name} is too far for the rope.`);
    if (!beginTurn(ctx) || !canAfford(ctx, AP_COST.shove, "Throwing the rope")) return;
    spendAp(ctx, AP_COST.shove);
    markUsed(ctx, "bind");
    if (fx.yank) {
      yankIn(ctx, target);
      ctx.echoSay("echo.yank");
      damageEnemy(ctx, target, fx.yank, `Rope Bind yanks the ${target.name} off its feet and into you`);
      pushTemper(ctx, "damagingModule");
    } else {
      applyStatus(target.statuses, ctx.content.statusEffects.get("tethered"), fx.tether);
      ctx.echoSay("echo.bind");
      ctx.fight(`Rope Bind lashes the ${target.name} in place for ${fx.tether} round${fx.tether === 1 ? "" : "s"}.`, "you");
    }
    afterAction(ctx);
    return;
  }
  if (verb === "coat") {
    if (!fx.coat) return void ctx.error("Echo can't do that. (Salt Reader, Fed, coats a weapon.)");
    const e = ctx.game.echo!;
    if (e.floorUsed.includes("coat")) return void ctx.error("You've already salted a blade this floor. Echo's out of the good salt.");
    if (!ctx.crawler.equipment.mainHand) return void ctx.error("Coat what? You're not holding a weapon.");
    if (fighting) {
      if (!beginTurn(ctx) || !canAfford(ctx, AP_COST.item, "Coating your weapon")) return;
      spendAp(ctx, AP_COST.item);
    }
    e.floorUsed.push("coat");
    ctx.crawler.coat = fx.coat;
    ctx.echoSay("echo.coat");
    (fighting ? (t: string) => ctx.fight(t, "you") : (t: string) => ctx.describe(t))(`Salt Reader coats your weapon. The next ${fx.coat} hits poison.`);
    pushTemper(ctx, "damagingModule");
    if (fighting) afterAction(ctx);
    return;
  }
  // break <dir>
  if (!fx.breakWalls) return void ctx.error("The wall disagrees. (Fault Sense, Fed, finds the weak ones.)");
  if (fighting) return void ctx.error("Not now. Things are trying to kill you.");
  const dir = DIRS.find((d) => d === arg || d[0] === arg);
  const wall = breakableWalls(ctx.game).find((w) => w.dir === dir);
  if (!dir || !wall) return void ctx.error(`There's no weak wall to the ${dir ?? arg ?? "anywhere"}. Weak walls: ${breakableWalls(ctx.game).map((w) => w.dir).join(", ") || "none"}.`);
  if (!timePassed(ctx, 30)) return;
  const floor = ctx.game.floor!;
  const here = floor.rooms[floor.currentRoom]!;
  here.exits[dir] = wall.to;
  floor.rooms[wall.to]!.exits[OPPOSITE[dir]] = here.id;
  floor.rooms[wall.to]!.seen = true;
  ctx.echoSay("echo.breakWall");
  ctx.describe(`You put your shoulder where Fault Sense says the seam is. The wall gives like old cake. There's a way ${dir} now.`);
}

const OPPOSITE: Record<Dir, Dir> = { north: "south", south: "north", east: "west", west: "east" };
const DELTA: Record<Dir, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/** Fault Sense (Fed): neighbouring carved rooms with no door between you. */
export function breakableWalls(game: GameState): { dir: Dir; to: number }[] {
  const floor = game.floor;
  if (!floor) return [];
  const here = floor.rooms[floor.currentRoom]!;
  const out: { dir: Dir; to: number }[] = [];
  for (const d of DIRS) {
    if (here.exits[d] !== undefined) continue;
    const [dx, dy] = DELTA[d];
    const other = floor.rooms.find((r) => r.x === here.x + dx && r.y === here.y + dy);
    if (other) out.push({ dir: d, to: other.id });
  }
  return out;
}

/** Pull an enemy next to you: the free tile beside you nearest to it (bands: to close range). */
function yankIn(ctx: StepContext, e: Enemy): void {
  const combat = ctx.game.combat!;
  const a = combat.arena;
  if (!a || !e.pos) {
    e.range = "close";
    return;
  }
  const options = Object.values(DIR8)
    .map(([dx, dy]) => ({ x: a.crawler.x + dx, y: a.crawler.y + dy }))
    .filter((p) => inBounds(a, p) && !blocksMove(a, ctx.content, p) && !occupied(combat, p, e));
  const spot = options.sort((p, q) => dist(p, e.pos!) - dist(q, e.pos!))[0];
  if (spot) {
    e.pos = spot;
    syncBands(ctx);
  }
}

/** Tethered things stay put. */
export function cantMove(ctx: StepContext, e: Enemy): boolean {
  return hasFlag(e.statuses, ctx.content, "noMove");
}

/** Item details the modules add (Lost Property Index appraises; Salt Reader identifies). */
export function moduleItemDetails(game: GameState, content: Content, item: ItemInstance): string[] {
  const fx = effectsNow(game, content);
  const out: string[] = [];
  if (fx.appraise) {
    out.push(`worth about ${item.value} gold`);
    if (item.tags.includes("cursed")) out.push("cursed (mildly)");
    if (item.tags.includes("lost_property")) out.push("lost property: someone, somewhere, is looking for this");
  }
  if (fx.identify && item.kind === "consumable") {
    const def = content.items.consumables.byId[item.baseId];
    const fxs = def?.effects.map((e) => `${e.kind}${e.value !== undefined ? ` ${e.value}` : ""}${e.statusId ? ` ${e.statusId}` : ""}${e.target && e.target !== "self" ? ` (${e.target.replace("_", " ")})` : ""}`) ?? [];
    if (fxs.length) out.push(`does: ${fxs.join(", ")}`);
    else if (def) out.push("does nothing on its own");
  }
  return out;
}

/** For tests and the parser: which single-item queries a module command would accept. */
export function knownModuleVerb(word: string): ModuleVerb | undefined {
  if (word === "shout" || word === "ping") return "shout";
  if (word === "bind" || word === "tether" || word === "rope" || word === "yank" || word === "lasso") return "bind";
  if (word === "coat" || word === "salt") return "coat";
  if (word === "break" || word === "smash") return "break";
  return undefined;
}

