/**
 * The thread (docs/DESIGN.md, "The thread"): Echo, its Temper, shard delivery and the
 * account's Codex. Modules are in modules.ts and floor bosses in boss.ts.
 *
 * Everything here is data-driven: chances, caps and texts come from thread.json,
 * temper.json, shards.json and codex.json. All randomness goes through rng.ts.
 */
import { recordKill } from "./combat";
import type { Content } from "./content/load";
import type { CodexEntry, Shard, TemperRules } from "./content/schemas";
import { chance, pick } from "./rng";
import { rollDice } from "./rules/dice";
import { bfsDistances } from "./gen/floor";
import { addToPile } from "./inventory";
import type { StepContext } from "./step";
import { HISTORY_LIMIT, type AccountState, type EchoState, type GameState, type Room, type RunRecord } from "./state";

export type Side = "calm" | "base" | "fed";
export type TemperSource = keyof TemperRules["sources"];

// ---------------------------------------------------------------- Echo

export function newEcho(content: Content): EchoState {
  return { vessel: pick(content.thread.vessels).id, temper: 0, modules: [], shards: [], pushes: {}, floorUsed: [] };
}

export function arcRow(content: Content, floor: number) {
  return content.thread.floors.find((f) => f.floor === floor);
}

/** Percent. 0 on Floor 1, then the "Wholeness after" of the floor just cleared. */
export function wholenessOn(content: Content, floor: number): number {
  return floor <= 1 ? 0 : arcRow(content, floor - 1)?.wholenessAfter ?? 0;
}

/** 1-3 are the acts, 4 the finale. Echo's stage follows the act, not the Wholeness number. */
export function actOn(content: Content, floor: number): number {
  return arcRow(content, floor)?.act ?? 1;
}

export function stageOn(content: Content, floor: number) {
  const act = actOn(content, floor);
  return content.temper.stages.find((s) => s.act === act) ?? content.temper.stages[0]!;
}

/** Which module variant Temper picks: Fed at +3 and up, Calm at -3 and down, base between. */
export function sideOf(content: Content, temper: number): Side {
  if (temper >= content.temper.fedAt) return "fed";
  if (temper <= content.temper.calmAt) return "calm";
  return "base";
}

export function vesselOf(content: Content, echo: EchoState) {
  return content.thread.vessels.find((v) => v.id === echo.vessel) ?? content.thread.vessels[0]!;
}

/** What Echo narration templates can see: `{echo.act}`, `{echo.side}`, `{echo.vessel}`. */
export function echoNarration(game: GameState, content: Content): Record<string, unknown> | undefined {
  const e = game.echo;
  if (!e) return undefined;
  const floor = game.floor?.floor ?? 1;
  return {
    act: actOn(content, floor),
    side: sideOf(content, e.temper),
    temper: e.temper,
    vessel: vesselOf(content, e).name,
    wholeness: wholenessOn(content, floor),
  };
}

/** Echo wakes at the start of a run. */
export function wakeEcho(ctx: StepContext): void {
  ctx.game.echo = newEcho(ctx.content);
  ctx.describe(vesselOf(ctx.content, ctx.game.echo).wake);
  ctx.echoSay("echo.hello");
}

// ---------------------------------------------------------------- Temper

/**
 * Push Temper from a named source, respecting its per-floor cap (temper.json → sources).
 * Returns how far it actually moved.
 */
export function pushTemper(ctx: StepContext, source: TemperSource): number {
  const e = ctx.game.echo;
  if (!e) return 0;
  const rule = ctx.content.temper.sources[source];
  const used = e.pushes[source] ?? 0;
  if (rule.perFloor !== undefined && used >= rule.perFloor) return 0;
  e.pushes[source] = used + 1;
  return shiftTemper(ctx, rule.delta);
}

/** Move Temper, clamped. Crossing into a new variant band gets a line from Echo. */
export function shiftTemper(ctx: StepContext, delta: number): number {
  const e = ctx.game.echo;
  if (!e || delta === 0) return 0;
  const { min, max } = ctx.content.temper;
  const before = e.temper;
  e.temper = Math.max(min, Math.min(max, before + delta));
  const moved = e.temper - before;
  if (moved === 0) return 0;
  const side = sideOf(ctx.content, e.temper);
  ctx.emit({ type: "temperChanged", temper: e.temper, delta: moved, side });
  if (side !== sideOf(ctx.content, before)) ctx.echoSay(`echo.side.${side}`);
  return moved;
}

/** Items that nudge Temper every floor change (Rue's Braid Tie). */
function carriedTemperPerFloor(ctx: StepContext): number {
  return ctx.crawler.inventory.reduce((sum, it) => sum + (ctx.content.oddities.byId[it.baseId]?.temperPerFloor ?? 0), 0);
}

/** A new floor: per-floor caps and once-a-floor modules reset; carried items nudge Temper. */
export function echoOnNewFloor(ctx: StepContext): void {
  const e = ctx.game.echo;
  if (!e) return;
  e.pushes = {};
  e.floorUsed = [];
  delete e.urge;
  const nudge = carriedTemperPerFloor(ctx);
  if (nudge) shiftTemper(ctx, nudge);
}

// ---------------------------------------------------------------- shards

export function unfoundShards(ctx: StepContext, floor: number, delivery: Shard["delivery"]): Shard[] {
  const found = new Set(ctx.game.echo?.shards ?? []);
  // A shard already waiting in another room of this floor isn't up for grabs either.
  for (const r of ctx.game.floor?.rooms ?? []) if (r.shard) found.add(r.shard);
  return ctx.content.shards.all.filter((s) => s.floor === floor && s.delivery === delivery && !found.has(s.id));
}

/**
 * First visit to a room: maybe one of the floor's unfound room shards is in it. The room
 * gets a faint voice; `search` finds what's talking (revealRoomShard). Call after the
 * description is built.
 */
export function maybeRoomShard(ctx: StepContext, room: Room): Shard | null {
  const floor = ctx.game.floor;
  if (!ctx.game.echo || !floor || room.shard || room.id === floor.startRoom) return null;
  if (!chance(ctx.content.thread.delivery.roomChance)) return null;
  const pool = unfoundShards(ctx, floor.floor, "room");
  if (pool.length === 0) return null;
  const s = pick(pool);
  room.shard = s.id;
  return s;
}

/** The shard in this room that a search hasn't found yet, if any. */
export function pendingShard(game: GameState, content: Content, room: Room): Shard | null {
  if (!room.shard || !game.echo || game.echo.shards.includes(room.shard)) return null;
  return content.shards.byId[room.shard] ?? null;
}

/** On entering a room with a shard waiting: the faint voice (a popup the first time). */
export function shardVoice(ctx: StepContext, room: Room, first: boolean): void {
  if (first) {
    const text = ctx.describeKey("shard.voice");
    ctx.emit({ type: "shardVoice", room: room.name, text });
  } else ctx.describeKey("shard.voiceAgain");
}

/** A search found what's talking: you walk up to it, it says its piece, Echo reacts. */
export function revealRoomShard(ctx: StepContext, room: Room, s: Shard): void {
  const intro = ctx.describeKey("shard.reveal", { source: s.source ?? "it" });
  ctx.describe(s.clue);
  room.desc = [...(room.desc ?? []), s.clue];
  shardFound(ctx, s, { intro });
}

/** A boss fight starting: maybe its throwaway shard is the opening line. */
export function maybeBossShard(ctx: StepContext, floor: number): Shard | null {
  if (!ctx.game.echo || !chance(ctx.content.thread.delivery.bossChance)) return null;
  return unfoundShards(ctx, floor, "boss")[0] ?? null;
}

/** Echo's reaction: the workbook's line for the act, or (Floor 13) Calm at 0 or below, Fed above. */
export function reactionTo(content: Content, s: Shard, temper: number): string {
  return s.reaction ?? (temper > 0 ? s.reactionFed! : s.reactionCalm!);
}

/** A shard was found: it goes on the run and in the Codex, Echo reacts, and a module may unlock. */
export function shardFound(ctx: StepContext, s: Shard, how: { intro?: string; speaker?: string } = {}): void {
  const e = ctx.game.echo;
  if (!e || e.shards.includes(s.id)) return;
  e.shards.push(s.id);
  const thread = ctx.account.thread;
  const first = !thread.shards.includes(s.id);
  const before = new Set(thread.shards);
  if (first) thread.shards.push(s.id);
  const reaction = reactionTo(ctx.content, s, e.temper);
  ctx.echoLine(reaction);
  ctx.emit({
    type: "shardFound", id: s.id, strand: s.strand, floor: s.floor, first, delivery: s.delivery, clue: s.clue, reaction,
    ...(how.intro ? { intro: how.intro } : {}), ...(how.speaker ? { speaker: how.speaker } : {}),
  });
  if (first) {
    for (const entry of ctx.content.codex.all.filter((c) => c.type === "lore")) {
      const opens = entry.unlock.shards?.includes(s.id) && !entry.unlock.shards.some((x) => before.has(x));
      if (opens) ctx.emit({ type: "codexUpdated", entry: entry.name, kind: "unlocked" });
      else if (entry.lines.includes(s.id) && loreUnlocked(entry, thread.shards)) ctx.emit({ type: "codexUpdated", entry: entry.name, kind: "line" });
    }
  }
  for (const m of ctx.content.modules.all.filter((x) => x.unlockedBy === s.id)) {
    ctx.echoSay("echo.moduleIdea", { module: m.name, parts: m.partsText.toLowerCase() });
  }
}

// ---------------------------------------------------------------- the Codex

function loreUnlocked(entry: CodexEntry, shards: readonly string[]): boolean {
  return (entry.unlock.shards ?? []).some((s) => shards.includes(s));
}

function record(ctx: StepContext, list: string[], id: string, entry: CodexEntry | undefined, kind: "recipe" | "weakness" | "ending"): boolean {
  if (list.includes(id)) return false;
  list.push(id);
  if (entry) ctx.emit({ type: "codexUpdated", entry: entry.name, kind });
  return true;
}

export function recordWeakness(ctx: StepContext, bossId: string): boolean {
  const entry = ctx.content.codex.all.find((c) => c.type === "weakness" && c.unlock.boss === bossId);
  return record(ctx, ctx.account.thread.weaknesses, bossId, entry, "weakness");
}

export function recordRecipe(ctx: StepContext, moduleId: string): boolean {
  const entry = ctx.content.codex.all.find((c) => c.type === "recipe" && c.unlock.module === moduleId);
  return record(ctx, ctx.account.thread.recipes, moduleId, entry, "recipe");
}

export function recordEnding(ctx: StepContext, endingId: string): boolean {
  const entry = ctx.content.codex.all.find((c) => c.type === "ending" && c.unlock.ending === endingId);
  return record(ctx, ctx.account.thread.endings, endingId, entry, "ending");
}

/** Floor 13's rule: the ending whose Temper range holds this Temper. */
export function endingFor(content: Content, temper: number) {
  return content.thread.endings.find((e) => temper >= e.temper[0] && temper <= e.temper[1]) ?? content.thread.endings[1]!;
}

export interface CodexEntryView {
  id: string;
  type: CodexEntry["type"];
  /** Locked lore and endings hide their name. */
  name: string;
  unlocked: boolean;
  text: string | null;
  /** Lore: one line per found shard, in shard order. */
  lines: string[];
  /** Lore: lines still missing (or, while locked, fragments already recorded). */
  missing: number;
  recorded: number;
}

export interface CodexView {
  entries: CodexEntryView[];
  shards: { found: number; total: number };
  history: RunRecord[];
}

export function codexView(content: Content, account: AccountState): CodexView {
  const t = account.thread;
  const entries = content.codex.all.map((e): CodexEntryView => {
    let unlocked: boolean;
    if (e.type === "lore") unlocked = loreUnlocked(e, t.shards);
    else if (e.type === "recipe") unlocked = t.recipes.includes(e.unlock.module ?? "");
    else if (e.type === "weakness") unlocked = t.weaknesses.includes(e.unlock.boss ?? "");
    else unlocked = t.endings.includes(e.unlock.ending ?? "");
    const have = e.lines.filter((s) => t.shards.includes(s));
    const showName = unlocked || e.type === "weakness" || e.type === "recipe";
    return {
      id: e.id,
      type: e.type,
      name: showName ? e.name : "▒▒▒▒▒▒▒▒",
      unlocked,
      text: unlocked ? e.text : null,
      lines: unlocked ? have.map((s) => content.shards.get(s).clue) : [],
      missing: e.lines.length - have.length,
      recorded: have.length,
    };
  });
  return { entries, shards: { found: t.shards.length, total: content.shards.all.length }, history: t.history.slice(-10) };
}

/** `codex`: print it to the log. */
export function showCodex(ctx: StepContext): void {
  const v = codexView(ctx.content, ctx.account);
  const lines: string[] = [`Shards recorded: ${v.shards.found} of ${v.shards.total}.`, ""];
  const groups: [CodexEntry["type"], string][] = [["lore", "LORE"], ["weakness", "BOSS WEAKNESSES"], ["recipe", "RECIPES"], ["ending", "ENDINGS"]];
  for (const [type, label] of groups) {
    lines.push(label);
    for (const e of v.entries.filter((x) => x.type === type)) {
      if (!e.unlocked) {
        if (type === "lore" && e.recorded) lines.push(`  ${e.name}  (locked; ${e.recorded} fragment${e.recorded === 1 ? "" : "s"} recorded)`);
        else if (type !== "lore") lines.push(`  ${e.name}  (unknown)`);
        continue;
      }
      lines.push(`  ${e.name}: ${e.text}`);
      for (const l of e.lines) lines.push(`    · ${l}`);
      if (type === "lore" && e.missing) lines.push(`    · (${e.missing} more to find)`);
    }
    lines.push("");
  }
  ctx.info("The Codex:", lines);
}

/** `echo`: how it's doing. */
export function showEcho(ctx: StepContext): void {
  const e = ctx.game.echo;
  if (!e) {
    ctx.error("There's nothing in your pocket yet.");
    return;
  }
  const floor = ctx.game.floor?.floor ?? 1;
  const stage = stageOn(ctx.content, floor);
  const side = sideOf(ctx.content, e.temper);
  const mods = e.modules.map((id) => ctx.content.modules.byId[id]?.name ?? id);
  ctx.info(`Echo, in ${vesselOf(ctx.content, e).short}:`, [
    `Wholeness ${wholenessOn(ctx.content, floor)}%   Stage: ${stage.name}`,
    `Temper ${e.temper > 0 ? "+" : ""}${e.temper} (${side === "base" ? "steady" : side})   -5 Calm ... +5 Fed`,
    `Modules: ${mods.length ? mods.join(", ") : "none yet"}`,
    `Shards this run: ${e.shards.length}`,
    ...(e.urge ? ["", `Echo is asking to ${e.urge.kind}: \`let echo\` or \`hush\`.`] : []),
  ]);
}

// ---------------------------------------------------------------- urges

/** Maybe Echo asks to do something here. `context` picks the chance and the kinds. */
export function maybeUrge(ctx: StepContext, context: "explore" | "combat"): void {
  const e = ctx.game.echo;
  const floor = ctx.game.floor;
  if (!e || !floor || e.urge) return;
  const rule = ctx.content.temper.urges[context];
  if (!chance(rule.chance)) return;
  const room = floor.rooms[floor.currentRoom]!;
  const kinds = rule.kinds.filter((k) => {
    if (k === "rummage") return (room.hidden?.length ?? 0) > 0;
    if (k === "listen") return floor.rooms.some((r) => r.type === "stairwell" && (!r.seen || r.concealed));
    return context === "combat";
  });
  if (kinds.length === 0) return;
  const kind = pick(kinds);
  e.urge = { kind, where: context === "combat" ? "combat" : room.id };
  ctx.echoSay(`echo.urge.${kind}`);
}

/** Leaving the room (or the fight) lets an urge lapse. */
export function lapseUrge(ctx: StepContext): void {
  if (ctx.game.echo) delete ctx.game.echo.urge;
}

/** `let echo` or `hush`. */
export function answerUrge(ctx: StepContext, allow: boolean): void {
  const e = ctx.game.echo;
  if (!e?.urge) {
    ctx.echoSay("echo.noUrge");
    return;
  }
  const urge = e.urge;
  delete e.urge;
  if (!allow) {
    pushTemper(ctx, "refuse");
    ctx.echoSay("echo.refused");
    return;
  }
  pushTemper(ctx, "allow");
  const floor = ctx.game.floor!;
  const room = floor.rooms[floor.currentRoom]!;
  if (urge.kind === "rummage") {
    const found = room.hidden ?? [];
    room.items ??= [];
    for (const it of found) addToPile(room.items, it);
    delete room.hidden;
    room.searched = true;
    ctx.echoSay("echo.did.rummage");
    if (found.length) ctx.describe(`Echo turns up: ${found.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(", ")}.`);
  } else if (urge.kind === "listen") {
    const dist = bfsDistances(floor.rooms, room.id);
    const stairs = floor.rooms.filter((r) => r.type === "stairwell" && (!r.seen || r.concealed))
      .sort((a, b) => dist[a.id]! - dist[b.id]!)[0];
    ctx.echoSay("echo.did.listen");
    if (stairs) {
      stairs.seen = true;
      stairs.marked = true;
      stairs.concealed = false;
      ctx.describe(`Echo hums a note and the floor hums one back. A stairwell, ${dist[stairs.id]} rooms off. It's on your map now.`);
    }
  } else {
    zap(ctx);
  }
}

/** A combat urge: Echo zaps the weakest-looking enemy (no AP). */
function zap(ctx: StepContext): void {
  const foes = ctx.game.combat?.enemies.filter((x) => x.hp > 0) ?? [];
  const target = foes.sort((a, b) => a.hp - b.hp)[0];
  ctx.echoSay("echo.did.zap");
  if (!target) return;
  const dmg = rollDice(ctx.content.temper.urges.zap).total + (ctx.game.floor?.floor ?? 1);
  target.hp -= dmg;
  ctx.fight(`Echo zaps the ${target.name}: ${dmg} lightning damage${target.hp > 0 ? ` (${target.hp}/${target.maxHP})` : ""}.`, "you");
  if (target.hp <= 0) {
    ctx.fight(`The ${target.name} drops.`, "you");
    ctx.say("combat.kill", { target: target.name });
    recordKill(ctx, target, "echo");
  }
}

// ---------------------------------------------------------------- feeding

/** `feed <junk>`: Echo eats salvage. Fed 1, up to the per-floor cap. */
export function feedEcho(ctx: StepContext, query: string): void {
  const e = ctx.game.echo;
  if (!e) {
    ctx.error("There's nothing in your pocket to feed.");
    return;
  }
  const c = ctx.crawler;
  const q = query.toLowerCase().replace(/^echo\s+/, "").trim();
  const equipped = new Set(Object.values(c.equipment));
  const junk = c.inventory.filter((i) => i.kind === "consumable" && !equipped.has(i.uid) &&
    ctx.content.items.consumables.byId[i.baseId]?.type === "junk");
  const item = q ? junk.find((i) => i.name.toLowerCase() === q) ?? junk.find((i) => i.name.toLowerCase().includes(q)) : junk.sort((a, b) => a.value - b.value)[0];
  if (!item) {
    ctx.error(q ? `You don't have any junk called "${query}". Echo only eats salvage.` : "You don't have any salvage to feed it.");
    return;
  }
  const rule = ctx.content.temper.sources.feed;
  if (rule.perFloor !== undefined && (e.pushes.feed ?? 0) >= rule.perFloor) {
    ctx.echoSay("echo.full");
    return;
  }
  item.qty -= 1;
  if (item.qty <= 0) c.inventory.splice(c.inventory.indexOf(item), 1);
  ctx.describe(`You feed the ${item.name.toLowerCase()} to Echo. It doesn't so much eat it as remember it out of existence.`);
  pushTemper(ctx, "feed");
  ctx.echoSay("echo.fed");
}

// ---------------------------------------------------------------- run history

export function recordRun(ctx: StepContext, outcome: string): void {
  const g = ctx.game;
  if (!g.crawler) return;
  const deepest = Math.max(g.floor?.floor ?? 0, 1);
  const h = ctx.account.thread.history;
  h.push({
    run: ctx.account.runs,
    crawler: g.crawler.name,
    floor: deepest,
    outcome,
    shards: g.echo?.shards.length ?? 0,
    temper: g.echo?.temper ?? 0,
    vessel: g.echo ? vesselOf(ctx.content, g.echo).name : "none",
  });
  if (h.length > HISTORY_LIMIT) h.splice(0, h.length - HISTORY_LIMIT);
}
