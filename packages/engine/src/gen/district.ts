/**
 * Districts (Milestone 9): regions of a floor, carved by flood fill from spread-out seeds.
 *
 * - The first seed is the start room; each next seed is the room farthest (by hops) from the
 *   seeds so far.
 * - The fill takes turns, and the smallest district with somewhere to grow goes next, so every
 *   district is connected and the sizes come out close. Then every seed but the start's moves to
 *   the middle of its district and the fill runs again (a few rounds), which stops a seed stuck
 *   at the end of a branch from leaving its district boxed in.
 * - A split with a district under half or over 1.8× an even share is thrown away, and so is one
 *   where the entrance's district isn't the nearest; the floor is carved again.
 * - District 0 always holds the start. The rest are numbered by how far their rooms are from the
 *   start on average, so the last district is the deep end (the floor's `districts` list is in
 *   that order).
 *
 * Each district also gets a safe room, and the ones with a champion get a lair at their far end.
 * Nothing here rolls dice: the layout decides.
 */
import type { District } from "../content/schemas";
import type { Room } from "../state";
import { bfsDistances } from "./floor";

/** A split is thrown away (and the floor carved again) if a district is outside these shares of an even one. */
export const MIN_DISTRICT_SHARE = 0.5;
export const MAX_DISTRICT_SHARE = 1.8;

/**
 * Give every room a district index (0..n-1). Returns null when the split is too lopsided
 * for a fair floor (a district boxed in to under half an even share, or one swallowing the floor).
 */
export function splitDistricts(rooms: Room[], start: number, n: number): number[] | null {
  if (n <= 1) return rooms.map(() => 0);
  // --- seeds: the start, then the room farthest from every seed so far ---
  const seeds = [start];
  const nearest = bfsDistances(rooms, start).slice();
  while (seeds.length < n) {
    let best = -1;
    for (const r of rooms) if (!seeds.includes(r.id) && (best < 0 || nearest[r.id]! > nearest[best]!)) best = r.id;
    if (best < 0) return null;
    seeds.push(best);
    const d = bfsDistances(rooms, best);
    for (let i = 0; i < rooms.length; i++) nearest[i] = Math.min(nearest[i]!, d[i]!);
  }

  // --- fill, then pull each seed (but the start's) to the middle of its district and fill again ---
  let filled = fill(rooms, seeds);
  for (let round = 0; round < MEDOID_ROUNDS && filled; round++) {
    const moved = seeds.map((s, d) => (d === 0 ? s : medoid(rooms, filled!.owner, d)));
    if (moved.every((s, d) => s === seeds[d])) break;
    seeds.splice(0, seeds.length, ...moved);
    filled = fill(rooms, seeds);
  }
  if (!filled) return null;
  const { owner, size } = filled;

  const even = rooms.length / n;
  if (size.some((s) => s < even * MIN_DISTRICT_SHARE || s > even * MAX_DISTRICT_SHARE)) return null;

  // --- number them: the start's district first, then by average distance from the start ---
  const fromStart = bfsDistances(rooms, start);
  const meanDist = seeds.map((_, d) => {
    const mine = rooms.filter((r) => owner[r.id] === d);
    return mine.reduce((sum, r) => sum + fromStart[r.id]!, 0) / mine.length;
  });
  const order = seeds.map((_, d) => d).filter((d) => d !== 0).sort((a, b) => meanDist[a]! - meanDist[b]!);
  // The entrance's district must also be the nearest one, or "deeper is harder" breaks.
  if (meanDist[0]! > meanDist[order[0]!]!) return null;
  const rank = new Map<number, number>([[0, 0], ...order.map((d, i) => [d, i + 1] as [number, number])]);
  return owner.map((d) => rank.get(d)!);
}

/** How many times the seeds are pulled to their district's middle before the split is kept. */
const MEDOID_ROUNDS = 3;

/** The flood fill: the smallest district with an open frontier claims its next room. */
function fill(rooms: Room[], seeds: number[]): { owner: number[]; size: number[] } | null {
  const owner: number[] = rooms.map(() => -1);
  const size = seeds.map(() => 1);
  const frontier: number[][] = seeds.map(() => []);
  const claim = (id: number, d: number) => {
    owner[id] = d;
    for (const next of Object.values(rooms[id]!.exits)) if (owner[next] === -1) frontier[d]!.push(next);
  };
  seeds.forEach((s, d) => claim(s, d));
  let left = rooms.length - seeds.length;
  while (left > 0) {
    let pickD = -1;
    for (let d = 0; d < seeds.length; d++) {
      while (frontier[d]!.length && owner[frontier[d]![0]!] !== -1) frontier[d]!.shift();
      if (frontier[d]!.length && (pickD < 0 || size[d]! < size[pickD]!)) pickD = d;
    }
    if (pickD < 0) return null; // can't happen on a connected floor
    claim(frontier[pickD]!.shift()!, pickD);
    size[pickD]! += 1;
    left -= 1;
  }
  return { owner, size };
}

/** The room of district `d` with the least total walking to the rest of it. */
function medoid(rooms: Room[], owner: number[], d: number): number {
  const ids = rooms.filter((r) => owner[r.id] === d).map((r) => r.id);
  let best = ids[0]!;
  let bestCost = Infinity;
  for (const id of ids) {
    const dist = bfsDistances(rooms, id);
    const cost = ids.reduce((sum, other) => sum + dist[other]!, 0);
    if (cost < bestCost) { best = id; bestCost = cost; }
  }
  return best;
}

/** Room ids per district index. */
export function roomsByDistrict(rooms: Room[], n: number): number[][] {
  const out: number[][] = Array.from({ length: Math.max(1, n) }, () => []);
  for (const r of rooms) out[r.district ?? 0]?.push(r.id);
  return out;
}

/**
 * Every district gets a safe room: a district without one gets one in its most central eligible
 * room (the least total walking to the rest of the district). False if a district has no room
 * that can take one.
 */
export function safeRoomPerDistrict(rooms: Room[], n: number, eligible: (r: Room) => boolean, place: (r: Room) => void): boolean {
  if (n <= 1) return true;
  for (const ids of roomsByDistrict(rooms, n)) {
    if (ids.some((id) => rooms[id]!.type === "safe")) continue;
    const pool = ids.map((id) => rooms[id]!).filter(eligible);
    if (pool.length === 0) return false;
    let best = pool[0]!;
    let bestCost = Infinity;
    for (const r of pool) {
      const d = bfsDistances(rooms, r.id);
      const cost = ids.reduce((sum, id) => sum + d[id]!, 0);
      if (cost < bestCost) { best = r; bestCost = cost; }
    }
    place(best);
  }
  return true;
}

/**
 * A lair at the far end of each district that has a champion: the ordinary room farthest from the
 * start, preferring a dead end among the farthest few. Never the start, a stairwell, a safe room or
 * the boss's room, and never next to a stairwell, a safe room or the boss. The lair's group is the
 * champion's (seedRoomState leaves it alone). False if a district has nowhere to put one.
 */
export function placeChampionLairs(rooms: Room[], start: number, districts: District[], bossRoom?: number): boolean {
  if (districts.length === 0) return true;
  const fromStart = bfsDistances(rooms, start);
  const special = (r: Room) => r.type === "stairwell" || r.type === "safe" || r.id === bossRoom;
  const byDistrict = roomsByDistrict(rooms, districts.length);
  for (let d = 0; d < districts.length; d++) {
    const def = districts[d]!;
    if (!def.champion) continue;
    const pool = byDistrict[d]!.map((id) => rooms[id]!).filter((r) =>
      r.id !== start && !special(r) && !Object.values(r.exits).some((id) => special(rooms[id]!)));
    if (pool.length === 0) return false;
    const far = Math.max(...pool.map((r) => fromStart[r.id]!));
    const ends = pool.filter((r) => fromStart[r.id]! >= far - 2);
    const deadEnd = ends.filter((r) => Object.keys(r.exits).length === 1);
    const lair = (deadEnd.length ? deadEnd : ends).sort((a, b) => fromStart[b.id]! - fromStart[a.id]!)[0]!;
    lair.type = "lair";
    delete lair.trap;
    lair.rs.groups = [{ kind: "elite", champion: def.id }];
  }
  return true;
}
