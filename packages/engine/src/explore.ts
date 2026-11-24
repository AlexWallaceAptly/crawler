/**
 * Exploration runtime: room descriptions, the game clock, the collapse timer,
 * and the ASCII map. All time-consuming actions go through advanceTime() —
 * it is the single choke point where warnings fire and the floor collapses.
 */
import type { FloorTheme } from "./content/schemas";
import { chance, pick } from "./rng";
import { dcFor, describeCheck, resolveCheck, type DcTier } from "./rules/checks";
import { rollDice } from "./rules/dice";
import { collectModifiers, derive, modTotal } from "./rules/derived";
import { applyStatus, decrementStatuses, hasFlag, tickStatuses } from "./rules/effects";
import { killCrawler, type StepContext } from "./step";
import { skillRank, trainSkill } from "./progression";
import { generateFloor, MINUTES_PER_DAY } from "./gen/floor";
import { seedFloorLoot, workbenchLine } from "./gen/loot";
import { seedRoomState } from "./gen/roomstate";
import { guideAdd } from "./guide";
import { runEvents, scheduleEvents } from "./showEvents";
import { wanderRoll } from "./roomwork";
import { echoOnNewFloor, maybeRoomShard, maybeUrge, pendingShard, recordRun, shardVoice, wholenessOn } from "./echo";
import { modulesOnEnter, neutralizePoison, trapAutoSpotted } from "./modules";
import { bossGateOf, bossNearby, bossOfFloor } from "./boss";
import type { Dir, FloorState, HazardState, Room, RoomType } from "./state";
import { DIRS } from "./state";
import { sleepStage } from "./rules/sleep";
import { onSleepStageChange } from "./hooks";

/** Time costs, in game minutes: data in pacing.json so the sim can sweep them. */
export const timeCosts = (ctx: StepContext) => ctx.content.pacing.costs;

/** Warning thresholds in minutes left, with their narration keys. */
const WARNINGS: [number, string][] = [
  [24 * 60, "timer.warn24h"],
  [6 * 60, "timer.warn6h"],
  [60, "timer.warn1h"],
  [10, "timer.warn10m"],
];

const WARNING_LABELS: Record<string, string> = {
  "timer.warn24h": "24 HOURS LEFT", "timer.warn6h": "6 HOURS LEFT",
  "timer.warn1h": "1 HOUR LEFT", "timer.warn10m": "TEN MINUTES",
};

// ---------------------------------------------------------------- descriptions

/** Build a room's description once; it's cached on the room so revisits read the same. */
export function describeRoom(theme: FloorTheme, room: Room): string[] {
  const lines = [
    pick(theme.fragments.openings[room.shape]),
    pick(theme.fragments.sights),
    chance(0.5) ? pick(theme.fragments.sounds) : pick(theme.fragments.smells),
  ];
  const typeLines = (theme.typeLines as Partial<Record<string, string[]>>)[room.type];
  if (typeLines && typeLines.length > 0) lines.push(pick(typeLines));
  const bench = room.type === "safe" ? undefined : workbenchLine(theme, room);
  if (bench) lines.push(bench);
  return lines;
}

/** "Roll of Duct Tape", "Box of Thumbtacks ×3" */
export function itemLabels(room: Room): string[] {
  return (room.items ?? []).map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name));
}

export function exitList(floor: FloorState, room: Room): Dir[] {
  return DIRS.filter((d) => room.exits[d] !== undefined);
}

/** Badge shown beside the room name; only types the player should recognize on sight. */
export function roomBadge(room: Room): string | undefined {
  if (room.type === "safe") return "SAFE ROOM";
  if (room.type === "stairwell" && !room.concealed) return "STAIRWELL";
  return undefined;
}

/** A stairwell you can actually take: found, and not held by a living boss. */
export function openStairwell(floor: FloorState, room: Room): boolean {
  return room.type === "stairwell" && !room.concealed && !(room.boss && !floor.bossDefeated);
}

/**
 * Spend time and report whether the run carries on in the same place: false if the
 * crawler died or the collapse pushed them down onto a new floor meanwhile.
 */
export function timePassed(ctx: StepContext, minutes: number, reason = "other"): boolean {
  const floor = ctx.game.floor;
  advanceTime(ctx, minutes, reason);
  return !ctx.dead() && ctx.game.floor === floor;
}

// ---------------------------------------------------------------- time

export function formatTimer(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const d = Math.floor(m / MINUTES_PER_DAY);
  const h = Math.floor((m % MINUTES_PER_DAY) / 60);
  const min = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${min}m`;
  return `${min}m`;
}

/** Tell the log (and the Echo hook) when the sleep state changes. */
export function noteSleepStage(ctx: StepContext, beforeId: string | undefined): void {
  const c = ctx.game.crawler;
  if (!c || !beforeId) return;
  const now = sleepStage(c, ctx.content);
  if (now.id === beforeId) return;
  const order = ctx.content.pacing.sleepStages.map((st) => st.id);
  const worse = order.indexOf(now.id) > order.indexOf(beforeId);
  ctx.emit({ type: "sleepStageChanged", from: beforeId, to: now.id, name: now.name, worse });
  onSleepStageChange(ctx, beforeId, now.id, worse);
}

/**
 * THE clock: every action that costs time comes through here (with a reason, for telemetry).
 * Spend game time. Fires collapse warnings as thresholds are crossed; at zero,
 * anyone off a stairwell dies with the floor, anyone on one is pushed down it.
 */
export function advanceTime(ctx: StepContext, minutes: number, reason = "other"): void {
  ctx.game.clock += minutes;
  const spent = (ctx.game.timeSpent ??= {});
  spent[reason] = (spent[reason] ?? 0) + minutes;
  // Sleep deprivation runs off this one clock; sleeping itself is handled by the sleep action.
  const before = ctx.game.crawler ? sleepStage(ctx.game.crawler, ctx.content) : null;
  if (reason !== "sleep" && ctx.game.crawler) ctx.game.crawler.awakeMin = (ctx.game.crawler.awakeMin ?? 0) + minutes;
  noteSleepStage(ctx, before?.id);
  const floor = ctx.game.floor;
  if (!floor || ctx.game.phase === "dead") return;
  floor.timeLeft = Math.max(0, floor.timeLeft - minutes);
  runEvents(ctx);
  wanderRoll(ctx, minutes, reason);

  if (floor.timeLeft <= 0) {
    const room = floor.rooms[floor.currentRoom]!;
    if (room.type === "stairwell" && !room.concealed) {
      ctx.describe("The floor gives way behind you, and the stairwell does the only thing it knows how to do.");
      clearFloor(ctx);
    } else {
      killCrawler(ctx, "floor collapse", "died.collapse");
    }
    return;
  }
  for (const [threshold, key] of WARNINGS) {
    if (floor.timeLeft <= threshold && !floor.warned.includes(threshold)) {
      floor.warned.push(threshold);
      ctx.say(key);
      ctx.emit({ type: "timerWarning", label: WARNING_LABELS[key]!, minutesLeft: floor.timeLeft });
    }
  }
}

/**
 * Descending (or surviving a collapse on the stairs): on to the next floor if one is
 * built, otherwise the run ends as a win, not a death.
 */
export function clearFloor(ctx: StepContext): void {
  const floor = ctx.game.floor!;
  ctx.account.bestFloor = Math.max(ctx.account.bestFloor, floor.floor + 1);
  ctx.emit({ type: "floorCleared", floor: floor.floor });
  ctx.say("floor.cleared", { floor: floor.floor });
  ctx.game.combat = null;
  const next = ctx.content.floors.all.find((t) => t.floor === floor.floor + 1);
  if (!next) {
    recordRun(ctx, `descended past Floor ${floor.floor}`);
    ctx.game.floor = null;
    ctx.setPhase("dead"); // the deepest built floor is done; "new" starts the next crawler
    return;
  }
  echoOnNewFloor(ctx);
  enterFloor(ctx, next);
  ctx.echoSay("echo.newFloor", { floor: next.floor, wholeness: wholenessOn(ctx.content, next.floor) });
}

/** Generate a floor (with its boss), stock it, and walk in at the start. */
export function enterFloor(ctx: StepContext, theme: FloorTheme): void {
  const boss = bossOfFloor(ctx.content, theme.floor);
  ctx.game.floor = generateFloor(theme, { safe: ctx.content.pacing.safeRooms, bossGate: bossGateOf(ctx.content, theme.floor), ...(boss ? { boss: boss.id } : {}) });
  seedFloorLoot(ctx.game.floor, theme, ctx.content);
  ctx.game.floor.startClock = ctx.game.clock;
  seedRoomState(ctx.game.floor, theme, ctx.content);
  scheduleEvents(ctx.game.floor, theme, ctx.content);
  ctx.setPhase("exploring");
  ctx.emit({ type: "floorEntered", floor: theme.floor, name: theme.name });
  if (theme.floor > 1) ctx.say("floor.entered", { floor: theme.floor, name: theme.name });
  enterRoom(ctx, ctx.game.floor.startRoom, "first");
}

// ---------------------------------------------------------------- movement

/** Move into / look at a room, emitting the roomEntered block the log renders. */
export function enterRoom(ctx: StepContext, roomId: number, kind: "first" | "revisit" | "look"): void {
  const floor = ctx.game.floor!;
  const theme = ctx.content.floors.get(floor.theme);
  const room = floor.rooms[roomId]!;
  floor.currentRoom = roomId;
  room.visited = true;
  room.seen = true;
  for (const id of Object.values(room.exits)) floor.rooms[id]!.seen = true;

  const first = kind === "first";
  if (kind !== "look") {
    escalateHazards(ctx, room);
    room.rs.lastVisit = ctx.game.clock;
  }
  if (!room.desc) {
    room.desc = describeRoom(theme, room);
    // Loot is hidden, but the room may say so.
    if (room.rs.hiddenTotal > 0 && chance(0.5)) room.desc.push(pick(ctx.content.pacing.search.hints));
    if (first) maybeRoomShard(ctx, room);
  }
  // The main screen gets a couple of lines; the rest lives in the Guide.
  const keep = ctx.content.pacing.guide.roomLines;
  const shown = kind === "look" || room.desc.length <= keep ? room.desc : [...room.desc.slice(0, keep), "(The rest of the room is in the Guide, or `look`.)"];
  if (room.desc.length > keep) guideAdd(ctx.game, `room.${floor.floor}.${room.id}`, "rooms", room.name, room.desc.join("\n"));
  const items = itemLabels(room);
  ctx.emit({
    type: "roomEntered",
    name: room.name,
    badge: roomBadge(room),
    lines: kind === "revisit" ? [] : shown,
    exits: exitList(floor, room),
    first,
    ...(items.length ? { items } : {}),
    ...(room.workbench ? { workbench: true } : {}),
  });
  // A waiting shard: the faint voice (a popup on the first visit, a reminder after).
  if (pendingShard(ctx.game, ctx.content, room)) shardVoice(ctx, room, first);
  if (kind !== "look") modulesOnEnter(ctx, room, first);
  if (first) bossNearby(ctx, room);
  if (kind === "revisit" && chance(0.3)) ctx.say("explore.revisit");
  if (first && chance(0.1)) ctx.say("explore.interjection");
  if (first && room.id !== floor.startRoom) maybeUrge(ctx, "explore");
}

/**
 * Out of combat, statuses run their course per room moved: tick once, count down once.
 * (In combat the round loop owns this.) Walking while bleeding is a plan, not a cure.
 */
export function tickTravelStatuses(ctx: StepContext): void {
  const c = ctx.crawler;
  if (c.statuses.length === 0) return;
  neutralizePoison(ctx, false);
  for (const t of tickStatuses(c.statuses, ctx.content)) {
    const max = derive(c, ctx.content).maxHP;
    c.hp = Math.min(max, c.hp - t.amount);
    if (t.amount > 0) ctx.describe(`${t.status} costs you ${t.amount} HP on the way.`);
  }
  if (c.hp <= 0) {
    killCrawler(ctx, "their own wounds");
    return;
  }
  for (const name of decrementStatuses(c.statuses, ctx.content)) {
    ctx.describe(`You are no longer ${name.toLowerCase()}.`);
  }
}

// ---------------------------------------------------------------- traps

/** Late in the floor, escalation and wandering both speed up. */
export function floorDay(ctx: StepContext): number {
  const floor = ctx.game.floor!;
  return Math.floor((ctx.game.clock - floor.startClock) / MINUTES_PER_DAY) + 1;
}
export function lateMult(ctx: StepContext): number {
  const w = ctx.content.pacing.wander;
  return floorDay(ctx) >= w.lateFromDay ? w.lateMult : 1;
}

/** A hazard left alone grows: intensity climbs with the days since you were last here, up to a cap. */
export function escalateHazards(ctx: StepContext, room: Room): void {
  const cfg = ctx.content.pacing.hazards;
  const now = ctx.game.clock;
  for (const h of room.rs.hazards) {
    if (!h.active) continue;
    const away = Math.max(0, now - Math.max(h.sourceTime, room.rs.lastVisit < 0 ? h.sourceTime : room.rs.lastVisit)) / MINUTES_PER_DAY;
    h.intensity = Math.min(cfg.maxIntensity, Math.round((h.intensity + cfg.growthPerDay * away * lateMult(ctx)) * 100) / 100);
    h.sourceTime = now;
  }
}

/** The active hazards in a room, which bite on every entry and every search pass until disarmed or burnt out. */
export function activeHazards(room: Room): HazardState[] {
  return room.rs.hazards.filter((h) => h.active);
}

/**
 * Each active hazard gets its chance: spot it (INT + Perception), else avoid it (dodge),
 * else it hurts, scaled by how much it has grown. Hazards persist; they burn out after enough bites.
 */
export function tickHazards(ctx: StepContext, room: Room, why: "enter" | "search"): void {
  const theme = ctx.content.floors.get(ctx.game.floor!.theme);
  for (const h of activeHazards(room)) {
    if (ctx.dead()) return;
    const trap = theme.trapTypes.find((t) => t.id === h.id);
    if (!trap) { h.active = false; continue; }
    const c = ctx.crawler;
    const d = derive(c, ctx.content);
    const mods = collectModifiers(c, ctx.content);
    const floorNo = ctx.game.floor!.floor;
    if (h.intensity > 1.2) ctx.describe(`The ${trap.name.toLowerCase()} is worse than you remember (x${h.intensity.toFixed(1)}).`);

    if (trapAutoSpotted(ctx)) {
      ctx.echoSay("echo.glowTrap");
      ctx.describe(trap.spotted);
      continue;
    }
    // Bad Feeling (a utility spell): the hair on your neck spots it for you.
    if (hasFlag(c.statuses, ctx.content, "spotTraps")) {
      ctx.describe(`Your bad feeling stops you a step short. ${trap.spotted}`);
      continue;
    }
    const spot = resolveCheck({
      label: `Spot the ${trap.name}`,
      modifier: d.stats.INT + skillRank(c, "perception", mods),
      dc: dcFor(trap.spotTier as DcTier, floorNo),
    });
    ctx.emit({ type: "check", result: spot, text: describeCheck(spot) });
    if (spot.success) {
      ctx.describe(trap.spotted);
      if (trap.spotTier !== "trivial") trainSkill(ctx, "perception", 1);
      continue;
    }
    const avoid = resolveCheck({
      label: `Avoid the ${trap.name}`,
      modifier: d.stats[trap.avoidStat] + skillRank(c, "dodge", mods),
      dc: dcFor(trap.avoidTier as DcTier, floorNo),
    });
    ctx.emit({ type: "check", result: avoid, text: describeCheck(avoid) });
    if (avoid.success) {
      ctx.describe(trap.avoided);
      if (trap.avoidTier !== "trivial") trainSkill(ctx, "dodge", 1);
      continue;
    }
    hurtByHazard(ctx, room, h, avoid.outcome === "critFailure");
  }
}

function hurtByHazard(ctx: StepContext, room: Room, h: HazardState, crit: boolean): void {
  const theme = ctx.content.floors.get(ctx.game.floor!.theme);
  const trap = theme.trapTypes.find((t) => t.id === h.id)!;
  const c = ctx.crawler;
  const mods = collectModifiers(c, ctx.content);
  let dmg = Math.round(rollDice(trap.dice).total * h.intensity);
  if (crit) dmg *= 2;
  dmg = Math.max(1, dmg - modTotal(mods, "damageReduction", `resist:${trap.damageType}`));
  c.hp -= dmg;
  room.trapSprung = true;
  h.ticks += 1;
  ctx.describe(trap.triggered);
  ctx.describe(`${dmg} ${trap.damageType} damage${crit ? " (critical failure — doubled)" : ""}.`);
  if (trap.status && c.hp > 0 && chance(trap.status.chance)) {
    const def = ctx.content.statusEffects.get(trap.status.id);
    applyStatus(c.statuses, def, trap.status.duration);
    ctx.describe(`You are ${def.name.toLowerCase()}.`);
  }
  if (h.ticks >= ctx.content.pacing.hazards.burnoutTicks) {
    h.active = false;
    ctx.describe(`The ${trap.name.toLowerCase()} has finally spent itself. It clicks, once, like it's embarrassed.`);
  }
  if (c.hp <= 0) killCrawler(ctx, `a ${trap.name.toLowerCase()}`);
}

/** Compatibility entry for one hazard check (tests and callers that only have `room.trap`). */
export function springTrap(ctx: StepContext, room: Room): void {
  if (room.trap && room.rs.hazards.length === 0 && !room.trapSprung) {
    room.rs.hazards.push({ id: room.trap, active: true, intensity: 1, sourceTime: ctx.game.clock, ticks: 0 });
  }
  tickHazards(ctx, room, "enter");
}

/** `disarm`: take the time to switch a room's hazards off. A skill check; a slip sets one off. */
export function disarmHazards(ctx: StepContext, room: Room): void {
  const hazards = activeHazards(room);
  if (hazards.length === 0) {
    ctx.error("Nothing here needs disarming.");
    return;
  }
  const cfg = ctx.content.pacing;
  if (!timePassed(ctx, cfg.hazards.disarmMinutes, "disarm")) return;
  const c = ctx.crawler;
  const d = derive(c, ctx.content);
  const mods = collectModifiers(c, ctx.content);
  const check = resolveCheck({
    label: "Disarm",
    modifier: Math.max(d.stats.INT, d.stats.DEX) + skillRank(c, "perception", mods),
    dc: dcFor(cfg.hazards.disarmTier as DcTier, ctx.game.floor!.floor),
  });
  ctx.emit({ type: "check", result: check, text: describeCheck(check) });
  if (check.success) {
    for (const h of hazards) h.active = false;
    ctx.describe("Click. Whatever it was waiting for, it isn't any more.");
    trainSkill(ctx, "perception", 1);
    return;
  }
  ctx.describe("Your hands slip. The thing notices.");
  hurtByHazard(ctx, room, hazards[0]!, check.outcome === "critFailure");
}

// ---------------------------------------------------------------- map

/**
 * ASCII map of explored rooms: `@` you, `S` safe, `>` stairwell, `?` seen but
 * unvisited, `·` visited, with `─`/`│` for known connections.
 */
export function renderMap(floor: FloorState): string[] {
  const cell: string[][] = [];
  const grid: (Room | null)[][] = Array.from({ length: floor.height }, () => Array(floor.width).fill(null));
  for (const r of floor.rooms) grid[r.y]![r.x] = r;

  const symbol = (r: Room | null): string => {
    if (!r || (!r.visited && !r.seen)) return " ";
    if (r.id === floor.currentRoom) return "@";
    if (r.boss && !floor.bossDefeated && (r.visited || r.marked)) return "!";
    if (!r.visited && !r.marked) return "?"; // (a safe room you have scouted is `marked`, so it shows as S)
    if (r.type === "safe") return "S";
    if (r.type === "stairwell" && !r.concealed) return ">";
    return "·";
  };
  const known = (r: Room | null) => !!r && (r.visited || r.seen);

  for (let y = 0; y < floor.height; y++) {
    const row: string[] = [];
    const below: string[] = [];
    for (let x = 0; x < floor.width; x++) {
      const r: Room | null = grid[y]![x] ?? null;
      row.push(symbol(r));
      const east: Room | null = grid[y]![x + 1] ?? null;
      row.push(r && r.exits.east !== undefined && known(r) && known(east) ? "─" : " ");
      const south: Room | null = grid[y + 1]?.[x] ?? null;
      below.push(r && r.exits.south !== undefined && known(r) && known(south) ? "│" : " ", " ");
    }
    cell.push(row, below);
  }
  cell.pop(); // no connector row below the last rank
  // Full grid at full width, not trimmed to what's explored: the map keeps a stable frame as it fills in.
  return cell.map((row) => row.join(""));
}

export type TileKind = RoomType | "workshop" | "unknown";

export interface MapCell {
  x: number;
  y: number;
  /** Real room type once visited (or marked by Echo); `unknown` for rooms only seen from next door (no spoilers). */
  kind: TileKind;
  current: boolean;
  visited: boolean;
  trapSprung: boolean;
  /** A living floor boss is known to be here. */
  boss: boolean;
  /** Connections to other *known* rooms. */
  exits: { north: boolean; east: boolean; south: boolean; west: boolean };
}

export interface MapGrid {
  width: number;
  height: number;
  /** Known rooms only; unexplored cells are absent. */
  cells: MapCell[];
}

/** Structured twin of `renderMap`, with the same visibility rules, for the graphical minimap. */
export function mapGrid(floor: FloorState): MapGrid {
  const at = (x: number, y: number): Room | undefined => floor.rooms.find((r) => r.x === x && r.y === y);
  const known = (r: Room | undefined): r is Room => !!r && (r.visited || r.seen);
  const cells: MapCell[] = [];
  for (const r of floor.rooms) {
    if (!known(r)) continue;
    const open = (dir: "north" | "east" | "south" | "west", dx: number, dy: number) =>
      r.exits[dir] !== undefined && known(at(r.x + dx, r.y + dy));
    const shown = r.visited || !!r.marked;
    const type: TileKind = r.concealed ? (r.shape === "corridor" ? "corridor" : "empty") : r.type;
    cells.push({
      x: r.x,
      y: r.y,
      kind: !shown ? "unknown" : r.visited && r.workbench && r.type !== "safe" ? "workshop" : type,
      current: r.id === floor.currentRoom,
      visited: r.visited,
      trapSprung: !!r.trapSprung,
      boss: !!r.boss && !floor.bossDefeated && shown,
      exits: { north: open("north", 0, -1), east: open("east", 1, 0), south: open("south", 0, 1), west: open("west", -1, 0) },
    });
  }
  return { width: floor.width, height: floor.height, cells };
}
