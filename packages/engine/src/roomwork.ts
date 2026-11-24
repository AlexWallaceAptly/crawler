/**
 * What you do about a room (Milestone 6c): scout it (listen, assess), search it in passes,
 * and what the clock does to you on the way (wandering groups). Room memory lives in
 * `room.rs` (see state.ts); this file reads and writes it.
 */
import { generateGroup } from "./gen/enemy";
import { chance, int, pick } from "./rng";
import { derive } from "./rules/derived";
import { collectModifiers } from "./rules/derived";
import { actionMinutes, sleepStage } from "./rules/sleep";
import { skillRank, trainSkill } from "./progression";
import { guideAdd } from "./guide";
import { addToPile } from "./inventory";
import { activeHazards, floorDay, lateMult, tickHazards, timePassed } from "./explore";
import { startCombat } from "./combat";
import { pushOutOfClosedRoom } from "./showEvents";
import { pendingShard, revealRoomShard } from "./echo";
import type { DangerBand, Dir, Enemy, GroupPlan, Room } from "./state";
import type { StepContext } from "./step";

const BANDS: DangerBand[] = ["calm", "uneasy", "dangerous"];

/** How dangerous a room is, honestly. */
export function dangerOf(room: Room, bossAlive = false): DangerBand {
  const n = room.rs.groups.length;
  if (bossAlive || room.rs.dense || n >= 2 || room.rs.groups.some((g) => g.kind === "elite")) return "dangerous";
  return n === 1 ? "uneasy" : "calm";
}

/** The enemies in a waiting group, rolled the first time anyone asks and kept after that. */
export function groupEnemies(ctx: StepContext, plan: GroupPlan): Enemy[] {
  if (plan.enemies) return plan.enemies;
  const floor = ctx.game.floor!;
  const theme = ctx.content.floors.byId[floor.theme];
  const easy = (floor.fights ?? 0) < (theme?.encounters.easyFights ?? 0);
  // The floor's first fights are small packs, even from a lair.
  plan.enemies = generateGroup(floor.floor, easy && plan.kind === "elite" ? "pack" : plan.kind, ctx.content, { easy });
  return plan.enemies;
}

const countNames = (enemies: Enemy[]): string => {
  const by = new Map<string, number>();
  for (const e of enemies) by.set(e.name.replace(/ [A-Z]$/, ""), (by.get(e.name.replace(/ [A-Z]$/, "")) ?? 0) + 1);
  return [...by].map(([n, k]) => (k > 1 ? `${n} x${k}` : n)).join(", ");
};

function scoutMinutes(ctx: StepContext, base: number, min: number): number {
  const cfg = ctx.content.pacing.scout;
  const c = ctx.crawler;
  const rank = skillRank(c, "perception", collectModifiers(c, ctx.content));
  const cut = Math.max(min, base - cfg.minutesOffPerPerceptionRank * rank);
  return actionMinutes(c, ctx.content, cut);
}

function record(ctx: StepContext, room: Room, tier: 1 | 2, lines: string[], danger?: DangerBand): void {
  const rs = room.rs;
  if (tier > rs.scoutTier) rs.scoutTier = tier;
  if (danger) rs.danger = danger;
  rs.scoutNote = lines;
  const floor = ctx.game.floor!;
  guideAdd(ctx.game, `scout.${floor.floor}.${room.id}`, "scouting", `${room.name} (${tier === 2 ? "assessed" : "listened"})`, lines.join("\n"));
}

/** Tier 1: an action on an adjacent room. A danger band and whether a hazard is there. */
export function listen(ctx: StepContext, dir: Dir): void {
  const floor = ctx.game.floor!;
  const here = floor.rooms[floor.currentRoom]!;
  const id = here.exits[dir];
  if (id === undefined) { ctx.say("explore.blocked", { dir }); return; }
  const target = floor.rooms[id]!;
  if (target.closed) { ctx.describe("That way is sealed. There's nothing to listen to but the seal."); return; }
  const cfg = ctx.content.pacing.scout;
  if (!timePassed(ctx, scoutMinutes(ctx, cfg.listenMinutes, cfg.minListen), "scout")) return;
  const c = ctx.crawler;
  let band = dangerOf(target, !!target.boss && !floor.bossDefeated);
  // Delirium makes the walls lie.
  if (sleepStage(c, ctx.content).scoutErrors && chance(cfg.deliriousErrorChance)) {
    const i = BANDS.indexOf(band) + (chance(0.5) ? 1 : -1);
    band = BANDS[Math.min(2, Math.max(0, i))]!;
  }
  const hazard = activeHazards(target).length > 0;
  const lines = [`Listening ${dir}: ${band}.`, hazard ? "Something in there is set to go off." : "No sign of a hazard."];
  const rank = skillRank(c, "perception", collectModifiers(c, ctx.content));
  if (rank >= cfg.extraDetailRank) lines.push((target.hidden?.length ?? 0) > 0 ? "Something in there is worth searching for." : "Nothing in there is hiding.");
  record(ctx, target, 1, lines, band);
  for (const l of lines) ctx.describe(l);
  trainSkill(ctx, "perception", 1);
}

/** Tier 2: stand in (or look hard at) a room. Hazards, who's waiting, and how much is hidden. */
export function assess(ctx: StepContext, dir?: Dir): void {
  const floor = ctx.game.floor!;
  const here = floor.rooms[floor.currentRoom]!;
  let target = here;
  if (dir) {
    const id = here.exits[dir];
    if (id === undefined) { ctx.say("explore.blocked", { dir }); return; }
    target = floor.rooms[id]!;
    if (target.closed) { ctx.describe("That way is sealed."); return; }
  }
  const cfg = ctx.content.pacing.scout;
  if (!timePassed(ctx, scoutMinutes(ctx, cfg.assessMinutes, cfg.minAssess), "scout")) return;
  const rs = target.rs;
  const lines = [`Assessing ${dir ? `the room ${dir}` : "this room"}: ${target.name}.`];
  if (target.boss && !floor.bossDefeated) lines.push("Something huge lives here. You can tell from the floor.");
  if (rs.groups.length === 0) lines.push("Nobody waiting.");
  for (const g of rs.groups) lines.push(`Waiting: ${countNames(groupEnemies(ctx, g))}.`);
  if (rs.dense) lines.push("A crowded room. More of everything, including the good stuff.");
  const theme = ctx.content.floors.get(floor.theme);
  const hazards = activeHazards(target);
  if (hazards.length === 0) lines.push("No hazards.");
  for (const h of hazards) lines.push(`Hazard: ${theme.trapTypes.find((t) => t.id === h.id)?.name ?? h.id} (x${h.intensity.toFixed(1)}).`);
  const left = (target.hidden ?? []).reduce((n, it) => n + it.qty, 0);
  lines.push(left > 0 ? `Hidden: ${left} thing${left === 1 ? "" : "s"} still to find (${rs.itemsFound} found already).` : "Nothing left hidden.");
  record(ctx, target, 2, lines, dangerOf(target, !!target.boss && !floor.bossDefeated));
  for (const l of lines) ctx.describe(l);
  trainSkill(ctx, "perception", 1);
}

/**
 * One search pass. Finds every hidden item at or under your search value: INT + Perception
 * + a little luck + a bonus for each pass already made here. Hazards in the room bite each pass.
 */
export function searchPass(ctx: StepContext, room: Room): void {
  const cfg = ctx.content.pacing;
  if (!timePassed(ctx, actionMinutes(ctx.crawler, ctx.content, cfg.costs.search), "search")) return;
  const c = ctx.crawler;
  const rs = room.rs;
  const value = derive(c, ctx.content).stats.INT + skillRank(c, "perception", collectModifiers(c, ctx.content)) +
    int(0, cfg.search.randomBonus) + cfg.search.passBonus * rs.searchPasses;
  rs.searchPasses += 1;
  room.searched = true;
  // A hazard in the room doesn't stop biting because you're being thorough.
  if (activeHazards(room).length > 0) tickHazards(ctx, room, "search");
  if (ctx.dead()) return;
  const shard = pendingShard(ctx.game, ctx.content, room);
  let stairs = false;
  if (room.concealed) {
    room.concealed = false;
    stairs = true;
    ctx.describe("Behind a panel that doesn't quite match the wall, a stairwell goes down into the dark. It was here all along. Of course it was.");
  }
  const found = (room.hidden ?? []).filter((it) => (it.searchDc ?? cfg.search.dcMin) <= value);
  if (found.length > 0) {
    room.items ??= [];
    for (const it of found) { addToPile(room.items, it); rs.itemsFound += it.qty; }
    room.hidden = (room.hidden ?? []).filter((it) => !found.includes(it));
    if (room.hidden.length === 0) delete room.hidden;
    ctx.describe(`You turn up: ${found.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(", ")}.`);
    ctx.say("explore.searchFound");
  } else if (!stairs && !shard) ctx.say("explore.searchNothing");
  if (shard) revealRoomShard(ctx, room, shard);
  if (found.length || stairs || shard) trainSkill(ctx, "perception", 1);
}

// ---------------------------------------------------------------- wandering

/** Called from the clock: did a group find the crawler while time passed? Sets `wanderDue` for the step to resolve. */
export function wanderRoll(ctx: StepContext, minutes: number, reason: string): void {
  const floor = ctx.game.floor;
  if (!floor || reason === "combat" || ctx.game.phase !== "exploring") return;
  const room = floor.rooms[floor.currentRoom]!;
  if (room.type === "safe") return; // a safe room is safe
  const w = ctx.content.pacing.wander;
  const days = (ctx.game.clock - floor.startClock) / 1440;
  let perHour = Math.min(w.cap, (w.basePerHour + w.perDay * days) * lateMult(ctx) * (floor.surge ? w.surgeMult : 1));
  if (reason === "sleep") perHour = Math.min(1, perHour * (1 + ctx.content.pacing.sleep.outsideSafeWanderBonus));
  const p = 1 - Math.pow(1 - Math.min(1, perHour), minutes / 60);
  if (chance(p)) floor.wanderDue = true;
}

/** After every action: resolve a wandering group, or a section that closed under your feet. */
export function afterAction(ctx: StepContext): void {
  const floor = ctx.game.floor;
  if (!floor || ctx.game.phase !== "exploring") return;
  if (pushOutOfClosedRoom(ctx) && ctx.game.phase !== "exploring") return;
  if (!floor.wanderDue) return;
  floor.wanderDue = false;
  const room = floor.rooms[floor.currentRoom]!;
  if (room.type === "safe") return;
  const kind = pick(ctx.content.pacing.wander.kinds);
  const theme = ctx.content.floors.byId[floor.theme];
  const easy = (floor.fights ?? 0) < (theme?.encounters.easyFights ?? 0);
  const enemies = generateGroup(floor.floor, kind, ctx.content, { easy });
  if (enemies.length === 0) return;
  ctx.describe(`Day ${floorDay(ctx)}: something has been following the noise you make. It found you.`);
  startCombat(ctx, enemies, { fromRoom: floor.currentRoom, wander: true });
}
