/**
 * Floor generation (spec: Floor generation / Map algorithm).
 * Carve a branching random walk on a grid, add loops, place stairwells at the
 * far points and safe rooms spread between, then weight the rest.
 * Connectivity holds by construction (every room is carved off an existing one),
 * and the property test re-proves it with BFS anyway.
 */
import type { FloorTheme, RoomShape } from "../content/schemas";
import { chance, int, pick, shuffle, weightedKey } from "../rng";
import { DIRS, type Dir, type FloorState, type Room, type RoomType } from "../state";

export const MINUTES_PER_DAY = 24 * 60;

/** Spec weights for the rooms left after stairwells and safe rooms are placed. */
const TYPE_WEIGHTS: Partial<Record<RoomType, number>> = {
  corridor: 30, chamber: 25, lair: 10, trap: 8, treasure: 5, puzzle: 4, event: 8, npc: 5, empty: 5,
};

/** Physical shape by room type: drives which name nouns and opening lines apply. */
function shapeFor(type: RoomType): RoomShape {
  switch (type) {
    case "corridor": return "corridor";
    case "chamber": case "lair": case "event": return "chamber";
    case "stairwell": return chance(0.5) ? "small" : "chamber";
    case "safe": return "small";
    default: return weightedKey<RoomShape>({ small: 5, chamber: 3, corridor: 2 });
  }
}

const DELTA: Record<Dir, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const OPPOSITE: Record<Dir, Dir> = { north: "south", south: "north", east: "west", west: "east" };

/** BFS hop distance from `from` to every room (-1 = unreachable). */
export function bfsDistances(rooms: Room[], from: number): number[] {
  const dist = rooms.map(() => -1);
  dist[from] = 0;
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of Object.values(rooms[id]!.exits)) {
      if (dist[next] === -1) {
        dist[next] = dist[id]! + 1;
        queue.push(next);
      }
    }
  }
  return dist;
}

function connect(rooms: Room[], a: Room, b: Room): void {
  for (const d of DIRS) {
    const [dx, dy] = DELTA[d];
    if (a.x + dx === b.x && a.y + dy === b.y) {
      a.exits[d] = b.id;
      b.exits[OPPOSITE[d]] = a.id;
      return;
    }
  }
  throw new Error("connect: rooms are not adjacent");
}

export function generateFloor(theme: FloorTheme): FloorState {
  const { width, height } = theme;
  const at = new Map<string, Room>(); // "x,y" -> room
  const key = (x: number, y: number) => `${x},${y}`;
  const rooms: Room[] = [];

  const carve = (x: number, y: number, from: Room | null): Room => {
    const room: Room = {
      id: rooms.length, x, y, type: "empty", shape: "small", name: "",
      exits: {}, visited: false, seen: false, searched: false, desc: null,
    };
    rooms.push(room);
    at.set(key(x, y), room);
    if (from) connect(rooms, from, room);
    return room;
  };

  // --- branching random walk ---
  const start = carve(int(0, width - 1), int(0, height - 1), null);
  let cursor = start;
  while (rooms.length < theme.rooms) {
    const open = DIRS.map((d) => {
      const [dx, dy] = DELTA[d];
      return { x: cursor.x + dx, y: cursor.y + dy };
    }).filter((p) => p.x >= 0 && p.x < width && p.y >= 0 && p.y < height && !at.has(key(p.x, p.y)));
    if (open.length === 0 || chance(0.22)) {
      cursor = pick(rooms); // jump to a random carved room: this is what makes branches
      continue;
    }
    const next = pick(open);
    cursor = carve(next.x, next.y, cursor);
  }

  // --- loops: connect 10-15% extra adjacent pairs so the map isn't a tree ---
  const unlinked: [Room, Room][] = [];
  for (const room of rooms) {
    for (const d of ["east", "south"] as const) {
      const [dx, dy] = DELTA[d];
      const other = at.get(key(room.x + dx, room.y + dy));
      if (other && room.exits[d] === undefined) unlinked.push([room, other]);
    }
  }
  const wanted = Math.round(rooms.length * (10 + int(0, 5)) / 100);
  for (const [a, b] of shuffle(unlinked).slice(0, wanted)) connect(rooms, a, b);

  // --- stairwells: 3-5 rooms far from start and from each other ---
  const distFromStart = bfsDistances(rooms, start.id);
  const stairCount = int(3, 5);
  const stairs: Room[] = [];
  for (let i = 0; i < stairCount; i++) {
    const score = (r: Room) =>
      Math.min(distFromStart[r.id]!, ...stairs.map((s) => Math.abs(s.x - r.x) + Math.abs(s.y - r.y)));
    const candidates = rooms.filter((r) => r !== start && !stairs.includes(r));
    let best = candidates[0]!;
    for (const r of candidates) if (score(r) > score(best)) best = r;
    best.type = "stairwell";
    stairs.push(best);
  }

  // --- safe rooms: ~1 per 15, spread out, never adjacent to a stairwell ---
  const nextToStair = (r: Room) => Object.values(r.exits).some((id) => rooms[id]!.type === "stairwell");
  const safeCount = Math.max(1, Math.round(theme.rooms / 15));
  const safes: Room[] = [];
  // The first one is the tutorial safe room, 4-8 steps from the start.
  const tutorialPool = rooms.filter((r) =>
    r.type === "empty" && !nextToStair(r) && distFromStart[r.id]! >= 4 && distFromStart[r.id]! <= 8);
  const firstSafe = tutorialPool.length > 0
    ? pick(tutorialPool)
    : rooms.filter((r) => r.type === "empty" && !nextToStair(r) && r !== start)
        .sort((a, b) => Math.abs(distFromStart[a.id]! - 6) - Math.abs(distFromStart[b.id]! - 6))[0]!;
  firstSafe.type = "safe";
  safes.push(firstSafe);
  for (let i = 1; i < safeCount; i++) {
    const candidates = rooms.filter((r) => r.type === "empty" && r !== start && !nextToStair(r));
    if (candidates.length === 0) break;
    const spread = (r: Room) => Math.min(...safes.map((s) => Math.abs(s.x - r.x) + Math.abs(s.y - r.y)));
    let best = candidates[0]!;
    for (const r of candidates) if (spread(r) > spread(best)) best = r;
    best.type = "safe";
    safes.push(best);
  }

  // --- everything else by spec weight; the start room stays harmless ---
  for (const room of rooms) {
    if (room.type !== "empty") continue;
    room.type = room === start ? pick(["corridor", "empty"] as const) : weightedKey(TYPE_WEIGHTS);
  }
  for (const room of rooms) room.shape = shapeFor(room.type);
  for (const room of rooms) {
    if (room.type === "trap" && theme.trapTypes.length > 0) room.trap = pick(theme.trapTypes).id;
  }

  // --- names: adjective + shape noun, dodging duplicates where the pools allow ---
  const used = new Set<string>();
  for (const room of rooms) {
    let name = "";
    for (let tries = 0; tries < 8; tries++) {
      name = `${pick(theme.roomNames.adjectives)} ${pick(theme.roomNames.nouns[room.shape])}`;
      if (!used.has(name)) break;
    }
    used.add(name);
    room.name = name;
  }

  start.visited = true;
  return {
    floor: theme.floor,
    theme: theme.id,
    width,
    height,
    rooms,
    startRoom: start.id,
    currentRoom: start.id,
    timeLeft: Math.round(theme.days * MINUTES_PER_DAY),
    warned: [],
  };
}
