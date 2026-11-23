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
import { applyStatus, decrementStatuses, tickStatuses } from "./rules/effects";
import { killCrawler, type StepContext } from "./step";
import { generateFloor, MINUTES_PER_DAY } from "./gen/floor";
import { seedFloorLoot, workbenchLine } from "./gen/loot";
import { echoOnNewFloor, maybeRoomShard, maybeUrge, pendingShard, recordRun, shardVoice, wholenessOn } from "./echo";
import { modulesOnEnter, neutralizePoison, trapAutoSpotted } from "./modules";
import { bossGateOf, bossNearby, bossOfFloor } from "./boss";
import type { Dir, FloorState, Room, RoomType } from "./state";
import { DIRS } from "./state";

/** Spec time costs, in game minutes. */
export const TIME_COST = { move: 10, search: 15, rest: 60, sleep: 8 * 60, combatRound: 1 } as const;

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
export function timePassed(ctx: StepContext, minutes: number): boolean {
  const floor = ctx.game.floor;
  advanceTime(ctx, minutes);
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

/**
 * Spend game time. Fires collapse warnings as thresholds are crossed; at zero,
 * anyone off a stairwell dies with the floor, anyone on one is pushed down it.
 */
export function advanceTime(ctx: StepContext, minutes: number): void {
  ctx.game.clock += minutes;
  const floor = ctx.game.floor;
  if (!floor || ctx.game.phase === "dead") return;
  floor.timeLeft = Math.max(0, floor.timeLeft - minutes);

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
  ctx.game.floor = generateFloor(theme, { bossGate: bossGateOf(ctx.content, theme.floor), ...(boss ? { boss: boss.id } : {}) });
  seedFloorLoot(ctx.game.floor, theme, ctx.content);
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
  let placed = null;
  if (!room.desc) {
    room.desc = describeRoom(theme, room);
    if (first) placed = maybeRoomShard(ctx, room);
  }
  const items = itemLabels(room);
  ctx.emit({
    type: "roomEntered",
    name: room.name,
    badge: roomBadge(room),
    lines: kind === "revisit" ? [] : room.desc,
    exits: exitList(floor, room),
    first,
    ...(items.length ? { items } : {}),
    ...(room.workbench ? { workbench: true } : {}),
  });
  if (pendingShard(ctx.game, ctx.content, room)) shardVoice(ctx, room, !!placed);
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

/** First entry to a trap room: spot it (INT + Perception) or eat it (avoid halves nothing — it's dodge or damage). */
export function springTrap(ctx: StepContext, room: Room): void {
  if (!room.trap || room.trapSprung) return;
  room.trapSprung = true;
  const theme = ctx.content.floors.get(ctx.game.floor!.theme);
  const trap = theme.trapTypes.find((t) => t.id === room.trap);
  if (!trap) return;
  const c = ctx.crawler;
  const d = derive(c, ctx.content);
  const mods = collectModifiers(c, ctx.content);
  const floorNo = ctx.game.floor!.floor;

  if (trapAutoSpotted(ctx)) {
    ctx.echoSay("echo.glowTrap");
    ctx.describe(trap.spotted);
    return;
  }
  const spot = resolveCheck({
    label: `Spot the ${trap.name}`,
    modifier: d.stats.INT + (c.skills["perception"]?.rank ?? 0) + modTotal(mods, "skill:perception"),
    dc: dcFor(trap.spotTier as DcTier, floorNo),
  });
  ctx.emit({ type: "check", result: spot, text: describeCheck(spot) });
  if (spot.success) {
    ctx.describe(trap.spotted);
    return;
  }
  const avoid = resolveCheck({
    label: `Avoid the ${trap.name}`,
    modifier: d.stats[trap.avoidStat] + (c.skills["dodge"]?.rank ?? 0),
    dc: dcFor(trap.avoidTier as DcTier, floorNo),
  });
  ctx.emit({ type: "check", result: avoid, text: describeCheck(avoid) });
  if (avoid.success) {
    ctx.describe(trap.avoided);
    return;
  }
  let dmg = rollDice(trap.dice).total;
  if (avoid.outcome === "critFailure") dmg *= 2;
  dmg = Math.max(1, dmg - modTotal(mods, "damageReduction", `resist:${trap.damageType}`));
  c.hp -= dmg;
  ctx.describe(trap.triggered);
  ctx.describe(`${dmg} ${trap.damageType} damage${avoid.outcome === "critFailure" ? " (critical failure — doubled)" : ""}.`);
  if (trap.status && c.hp > 0 && chance(trap.status.chance)) {
    const def = ctx.content.statusEffects.get(trap.status.id);
    applyStatus(c.statuses, def, trap.status.duration);
    ctx.describe(`You are ${def.name.toLowerCase()}.`);
  }
  if (c.hp <= 0) killCrawler(ctx, `a ${trap.name.toLowerCase()}`);
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
    if (!r.visited && !r.marked) return "?";
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
