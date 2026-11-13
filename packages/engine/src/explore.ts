/**
 * Exploration runtime: room descriptions, the game clock, the collapse timer,
 * and the ASCII map. All time-consuming actions go through advanceTime() —
 * it is the single choke point where warnings fire and the floor collapses.
 */
import type { FloorTheme } from "./content/schemas";
import { chance, pick } from "./rng";
import { killCrawler, type StepContext } from "./step";
import { MINUTES_PER_DAY } from "./gen/floor";
import type { Dir, FloorState, Room } from "./state";
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
  return lines;
}

export function exitList(floor: FloorState, room: Room): Dir[] {
  return DIRS.filter((d) => room.exits[d] !== undefined);
}

/** Badge shown beside the room name; only types the player should recognize on sight. */
export function roomBadge(room: Room): string | undefined {
  if (room.type === "safe") return "SAFE ROOM";
  if (room.type === "stairwell") return "STAIRWELL";
  return undefined;
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
    if (room.type === "stairwell") {
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

/** Descending (or surviving a collapse on the stairs) ends the run as a win, not a death. */
export function clearFloor(ctx: StepContext): void {
  const floor = ctx.game.floor!;
  ctx.account.bestFloor = Math.max(ctx.account.bestFloor, floor.floor + 1);
  ctx.emit({ type: "floorCleared", floor: floor.floor });
  ctx.say("floor.cleared");
  ctx.game.floor = null;
  ctx.setPhase("dead"); // run over until Floor 2 exists; "new" starts the next crawler
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

  if (!room.desc) room.desc = describeRoom(theme, room);
  const first = kind === "first";
  ctx.emit({
    type: "roomEntered",
    name: room.name,
    badge: roomBadge(room),
    lines: kind === "revisit" ? [] : room.desc,
    exits: exitList(floor, room),
    first,
  });
  if (kind === "revisit" && chance(0.3)) ctx.say("explore.revisit");
  if (first && chance(0.1)) ctx.say("explore.interjection");
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
    if (!r.visited) return "?";
    if (r.type === "safe") return "S";
    if (r.type === "stairwell") return ">";
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
  const lines = cell.map((row) => row.join("").replace(/\s+$/, ""));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  while (lines.length && lines[0] === "") lines.shift();
  return lines;
}
