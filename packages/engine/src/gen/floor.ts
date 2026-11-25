/**
 * Floor generation (spec: Floor generation / Map algorithm).
 * Carve a branching random walk on a grid, add loops, place stairwells at the
 * far points and safe rooms spread between, then weight the rest.
 * Connectivity holds by construction (every room is carved off an existing one),
 * and the property test re-proves it with BFS anyway.
 */
import type { BOSS_GATES, FloorTheme, Pacing, RoomShape } from "../content/schemas";
import { chance, int, pick, shuffle, weightedKey } from "../rng";
import { DIRS, newRoomState, type Dir, type FloorState, type Room, type RoomType } from "../state";
import { placeChampionLairs, safeRoomPerDistrict, splitDistricts } from "./district";

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

/** BFS hop distance like bfsDistances, but never walking through `avoid`. */
export function bfsAvoiding(rooms: Room[], from: number, avoid: number): number[] {
  const dist = rooms.map(() => -1);
  dist[from] = 0;
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of Object.values(rooms[id]!.exits)) {
      if (next === avoid || dist[next] !== -1) continue;
      dist[next] = dist[id]! + 1;
      queue.push(next);
    }
  }
  return dist;
}

/** Rooms on a shortest path from `from` to `to`, both ends included. */
export function pathBetween(rooms: Room[], from: number, to: number): number[] {
  const prev = new Map<number, number>([[from, from]]);
  const queue = [from];
  while (queue.length && !prev.has(to)) {
    const id = queue.shift()!;
    for (const next of Object.values(rooms[id]!.exits)) {
      if (!prev.has(next)) { prev.set(next, id); queue.push(next); }
    }
  }
  const path = [to];
  while (path[0] !== from && prev.has(path[0]!)) path.unshift(prev.get(path[0]!)!);
  return path;
}

export interface FloorOptions {
  /** Safe-room placement rules (pacing.json → safeRooms). */
  safe: Pacing["safeRooms"];
  /** How the floor's boss sits (thread.json floors → bossGate). */
  bossGate?: (typeof BOSS_GATES)[number];
  /** The boss's id; no boss is placed without one. */
  boss?: string;
}

/**
 * Generate a floor. On gate floors a layout where no hidden stairwell can be reached
 * without walking through the boss is thrown away and carved again.
 */
export function generateFloor(theme: FloorTheme, opts: FloorOptions): FloorState {
  for (let tries = 0; tries < 50; tries++) {
    const floor = carveFloor(theme, opts);
    if (floor) return floor;
  }
  // Practically unreachable (each try fails about 1 time in 10); fall back to an ungated floor in one district.
  for (let tries = 0; tries < 50; tries++) {
    const floor = carveFloor({ ...theme, districts: [] }, { ...opts, bossGate: "none" });
    if (floor) return floor;
  }
  throw new Error(`generateFloor: could not carve "${theme.id}"`);
}

function carveFloor(theme: FloorTheme, opts: FloorOptions): FloorState | null {
  const { width, height } = theme;
  const at = new Map<string, Room>(); // "x,y" -> room
  const key = (x: number, y: number) => `${x},${y}`;
  const rooms: Room[] = [];

  const carve = (x: number, y: number, from: Room | null): Room => {
    const room: Room = {
      id: rooms.length, x, y, type: "empty", shape: "small", name: "",
      exits: {}, visited: false, seen: false, searched: false, desc: null, rs: newRoomState(),
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

  // --- districts (Milestone 9): regions by flood fill, entrance first ---
  const districtCount = Math.max(1, theme.districts.length);
  if (districtCount > 1) {
    const owner = splitDistricts(rooms, start.id, districtCount);
    if (!owner) return null;
    for (const r of rooms) r.district = owner[r.id]!;
  }

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

  // --- safe rooms (pacing.json → safeRooms) ---
  const cfg = opts.safe;
  const nextTo = (r: Room, type: RoomType) => Object.values(r.exits).some((id) => rooms[id]!.type === type);
  const eligible = (r: Room) => r.type === "empty" && r !== start && !nextTo(r, "stairwell") && !nextTo(r, "safe");
  const safes: Room[] = [];
  const spread = (r: Room) => Math.min(...safes.map((s) => Math.abs(s.x - r.x) + Math.abs(s.y - r.y)));
  const farthest = (pool: Room[]) => pool.reduce((best, r) => (spread(r) > spread(best) ? r : best), pool[0]!);
  const place = (r: Room) => { r.type = "safe"; safes.push(r); };

  // The first is close to the entry: the tutorial's workbench is a couple of steps away.
  const near = rooms.filter((r) => eligible(r) && distFromStart[r.id]! <= cfg.firstWithinHops);
  if (near.length === 0) return null;
  const firstSafe = pick(near);
  place(firstSafe);
  // The second is well away from the first, so there's a bed on the far side of the floor.
  const firstDist = bfsDistances(rooms, firstSafe.id);
  const far = rooms.filter((r) => eligible(r) && firstDist[r.id]! >= cfg.secondMinHops);
  if (far.length === 0) return null;
  place(farthest(far));
  const safeCount = Math.max(cfg.minPerFloor, Math.round(theme.rooms / cfg.perRooms));
  while (safes.length < safeCount) {
    const pool = rooms.filter(eligible);
    if (pool.length === 0) break;
    place(farthest(pool));
  }
  // Hard rule: no stairs route runs more than maxGapRooms from a safe room, in either direction.
  const nearestSafe = () => {
    const per = safes.map((s) => bfsDistances(rooms, s.id));
    return rooms.map((r) => Math.min(...per.map((d) => d[r.id]!)));
  };
  for (let guard = 0; guard < 40; guard++) {
    const gap = nearestSafe();
    const bad = stairs.flatMap((st) => pathBetween(rooms, start.id, st.id)).find((id) => gap[id]! > cfg.maxGapRooms);
    if (bad === undefined) break;
    // Fix it with the eligible room nearest the bad stretch, preferring ones on the way.
    const toBad = bfsDistances(rooms, bad);
    const fix = rooms.filter(eligible).sort((a, b) => toBad[a.id]! - toBad[b.id]!)[0];
    if (!fix || toBad[fix.id]! > cfg.maxGapRooms) return null;
    place(fix);
  }
  // Every district has a bed somewhere in it.
  if (!safeRoomPerDistrict(rooms, districtCount, eligible, place)) return null;

  // --- everything else by spec weight; the start room stays harmless ---
  for (const room of rooms) {
    if (room.type !== "empty") continue;
    room.type = room === start ? pick(["corridor", "empty"] as const) : weightedKey(TYPE_WEIGHTS);
  }

  // --- the floor boss ---
  let bossRoom: number | undefined;
  if (opts.boss && (opts.bossGate ?? "none") === "none") {
    // Mini-boss: its own lair, well away from the start, preferably a dead end, never next to stairs or a safe room.
    const special = (r: Room) => r.type === "stairwell" || r.type === "safe";
    const far = Math.max(...distFromStart);
    const pool = rooms.filter((r) => r !== start && !special(r) && distFromStart[r.id]! >= Math.max(4, Math.round(far * 0.4)) &&
      !Object.values(r.exits).some((id) => special(rooms[id]!)));
    // It must never cut the stairs off: a dead end can't, anything else is checked.
    const bypassable = (r: Room) => { const d = bfsAvoiding(rooms, start.id, r.id); return stairs.every((s) => d[s.id]! >= 0); };
    const deadEnds = pool.filter((r) => Object.keys(r.exits).length === 1);
    const others = deadEnds.length ? [] : pool.filter(bypassable);
    if (!deadEnds.length && !others.length) return null;
    const lair = pick(deadEnds.length ? deadEnds : others);
    lair.type = "lair";
    lair.boss = opts.boss;
    bossRoom = lair.id;
  } else if (opts.boss && opts.bossGate === "obviousStairs") {
    // Gate boss: on the stairwell nearest the start. The rest are hidden, and one must be reachable around it.
    const order = stairs.slice().sort((a, b) => distFromStart[a.id]! - distFromStart[b.id]!);
    const gate = order[0]!;
    const around = bfsAvoiding(rooms, start.id, gate.id);
    if (!order.some((s) => s !== gate && around[s.id]! >= 0)) return null;
    gate.boss = opts.boss;
    bossRoom = gate.id;
    for (const s of stairs) if (s !== gate) s.concealed = true;
  }

  // --- district champions: a lair at each district's far end ---
  if (!placeChampionLairs(rooms, start.id, theme.districts, bossRoom)) return null;

  for (const room of rooms) room.shape = shapeFor(room.type);
  for (const room of rooms) {
    if (room.type === "trap" && theme.trapTypes.length > 0) room.trap = pick(theme.trapTypes).id;
  }

  // --- names: adjective + shape noun, dodging duplicates where the pools allow ---
  const used = new Set<string>();
  for (const room of rooms) {
    let name = "";
    const local = theme.districts[room.district ?? 0]?.adjectives ?? [];
    for (let tries = 0; tries < 8; tries++) {
      const adjective = local.length && chance(0.5) ? pick(local) : pick(theme.roomNames.adjectives);
      name = `${adjective} ${pick(theme.roomNames.nouns[room.shape])}`;
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
    fights: 0,
    startClock: 0,
    events: [],
    ...(bossRoom !== undefined ? { bossRoom, bossDefeated: false } : {}),
    ...(districtCount > 1 ? { districts: theme.districts.map((d) => d.id), districtsSeen: [] } : {}),
  };
}
