/**
 * Arena generation (Milestone 4b). Each grid fight gets a fresh little board
 * shaped like the room it happens in:
 *
 *   corridor  9x4 (4x9 when entered from north/south: the long axis follows you in)
 *   small     6x6
 *   chamber   8x8
 *
 * One door tile sits in the middle of each edge that has a room exit; the one you
 * came through is the entry. Obstacles are single-tile props (no walls, no
 * auto-tiling: the board edge is the wall). Then a little terrain, maybe a hazard,
 * then the spawns: you just inside the entry, the enemies in the far half — or,
 * if they won initiative, close enough to hurt. Every enemy and every door must be
 * reachable from you; otherwise it rerolls, and finally gives up on obstacles.
 */
import type { Content } from "../content/load";
import type { FloorTheme, RoomShape } from "../content/schemas";
import { int, pick, shuffle, weightedPick } from "../rng";
import { DIRS, type ArenaExit, type ArenaState, type Dir, type Enemy, type ItemInstance, type Pos, type Room } from "../state";
import { allTiles, blocksMove, dist, index, inBounds, pathField, same } from "./geometry";

const SIZES: Record<RoomShape, [number, number]> = { corridor: [9, 4], small: [6, 6], chamber: [8, 8] };
const OBSTACLES: Record<RoomShape, [number, number]> = { corridor: [1, 2], small: [1, 3], chamber: [3, 6] };
const MAX_TRIES = 20;

export function arenaSize(shape: RoomShape, entry: Dir | undefined): [number, number] {
  const [w, h] = SIZES[shape];
  return shape === "corridor" && (entry === "north" || entry === "south") ? [h, w] : [w, h];
}

function doorTile(w: number, h: number, dir: Dir): Pos {
  const mx = Math.floor((w - 1) / 2);
  const my = Math.floor((h - 1) / 2);
  switch (dir) {
    case "north": return { x: mx, y: 0 };
    case "south": return { x: mx, y: h - 1 };
    case "west": return { x: 0, y: my };
    case "east": return { x: w - 1, y: my };
  }
}

/** The tile one step in from a door. */
export function insideOf(w: number, h: number, door: Pos): Pos {
  return {
    x: door.x === 0 ? 1 : door.x === w - 1 ? w - 2 : door.x,
    y: door.y === 0 ? 1 : door.y === h - 1 ? h - 2 : door.y,
  };
}

export interface ArenaPlan {
  room: Room;
  theme: FloorTheme;
  /** The side of the room the crawler came in from; undefined = no entry door. */
  entry: Dir | undefined;
  enemies: Enemy[];
  /** Enemies that won initiative spawn close. */
  ambushers: Set<string>;
  /** Loose junk to scatter on the floor (the room's items, plus scrap). */
  items?: ItemInstance[];
}

export function buildArena(plan: ArenaPlan, content: Content): ArenaState {
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const a = layout(plan, content, true);
    if (a && valid(a, plan.enemies, content)) return a;
  }
  // Unlucky rolls: an empty room still works.
  return layout(plan, content, false)!;
}

function layout(plan: ArenaPlan, content: Content, furnish: boolean): ArenaState | null {
  const { room, theme, entry, enemies, ambushers } = plan;
  const [w, h] = arenaSize(room.shape, entry);
  const exits: ArenaExit[] = DIRS.filter((d) => room.exits[d] !== undefined)
    .map((dir) => ({ ...doorTile(w, h, dir), dir, entry: dir === entry }));
  const entryExit = exits.find((x) => x.entry);
  const crawler = entryExit ? insideOf(w, h, entryExit) : { x: 1, y: Math.floor((h - 1) / 2) };

  const a: ArenaState = {
    w, h, tiles: new Array<string>(w * h).fill(""), hazards: [], items: [], exits, crawler, moveLeft: 0,
  };
  const reserved = new Set<number>([index(a, crawler)]);
  for (const x of exits) {
    reserved.add(index(a, x));
    reserved.add(index(a, insideOf(w, h, x)));
  }
  const free = () => allTiles(a).filter((p) => !reserved.has(index(a, p)) && a.tiles[index(a, p)] === "");

  if (furnish) {
    // obstacles
    const [lo, hi] = OBSTACLES[room.shape];
    if (theme.arena.obstacles.length > 0) {
      for (const p of shuffle(free()).slice(0, int(lo, hi))) {
        a.tiles[index(a, p)] = weightedPick(theme.arena.obstacles, (o) => o.weight).id;
      }
    }
    // terrain patches: 0-2 blobs of 1-3 tiles
    if (theme.arena.terrain.length > 0) {
      for (let i = int(0, 2); i > 0; i--) {
        const id = weightedPick(theme.arena.terrain, (t) => t.weight).id;
        const seed = free();
        if (seed.length === 0) break;
        let at = pick(seed);
        for (let n = int(1, 3); n > 0; n--) {
          a.tiles[index(a, at)] = id;
          const next = free().filter((p) => dist(p, at) === 1);
          if (next.length === 0) break;
          at = pick(next);
        }
      }
    }
    // a standing hazard or two
    const hazards = int(0, 1);
    for (let i = 0; i < hazards && theme.arena.hazards.length > 0; i++) {
      const spot = free().filter((p) => !a.hazards.some((hz) => same(hz, p)));
      if (spot.length) a.hazards.push({ ...pick(spot), id: weightedPick(theme.arena.hazards, (z) => z.weight).id });
    }
    // trap rooms bring their trap to the fight
    const trap = room.trap ? theme.trapTypes.find((t) => t.id === room.trap) : undefined;
    if (trap?.arenaHazard) {
      const spot = free().filter((p) => !a.hazards.some((hz) => same(hz, p)));
      if (spot.length) {
        const f = content.arenaFeatures.get(trap.arenaHazard);
        const p = pick(spot);
        if (f.kind === "hazard") a.hazards.push({ ...p, id: f.id });
        else a.tiles[index(a, p)] = f.id;
      }
    }
  }

  // spawns
  const taken = new Set<number>([index(a, crawler)]);
  const open = () => allTiles(a).filter((p) =>
    !taken.has(index(a, p)) && !blocksMove(a, content, p) && !a.hazards.some((hz) => same(hz, p)) &&
    !exits.some((x) => same(x, p)));
  const maxD = Math.max(...open().map((p) => dist(p, crawler)), 1);
  const far = Math.min(4, maxD - 1);
  let last: Pos | null = null;
  for (const e of enemies) {
    const options = open();
    if (options.length === 0) return null;
    let pool: Pos[];
    if (ambushers.has(e.uid)) {
      pool = options.filter((p) => dist(p, crawler) >= 2 && dist(p, crawler) <= 3);
    } else if (e.tier === "elite") {
      const best = Math.max(...options.map((p) => dist(p, crawler)));
      const cx = (w - 1) / 2;
      const cy = (h - 1) / 2;
      const farthest = options.filter((p) => dist(p, crawler) === best);
      const centre = Math.min(...farthest.map((p) => Math.abs(p.x - cx) + Math.abs(p.y - cy)));
      pool = farthest.filter((p) => Math.abs(p.x - cx) + Math.abs(p.y - cy) === centre);
    } else {
      const distant = options.filter((p) => dist(p, crawler) >= far);
      const near = last ? distant.filter((p) => dist(p, last!) <= 2) : [];
      pool = near.length ? near : distant;
      if (e.preferRange !== "close" && pool.length) {
        const best = Math.max(...pool.map((p) => dist(p, crawler)));
        pool = pool.filter((p) => dist(p, crawler) >= best - 1);
      }
    }
    if (pool.length === 0) pool = options;
    const p = pick(pool);
    e.pos = { ...p };
    taken.add(index(a, p));
    if (!ambushers.has(e.uid)) last = p;
  }
  // loose junk: each stack on its own free tile
  for (const item of plan.items ?? []) {
    const spots = open().filter((p) => !a.items.some((it) => same(it, p)));
    if (spots.length === 0) break;
    const p = pick(spots);
    a.items.push({ x: p.x, y: p.y, item });
  }
  return a;
}

/** Everything that matters is reachable from the crawler (ignoring units). */
function valid(a: ArenaState, enemies: Enemy[], content: Content): boolean {
  const field = pathField(a, content, a.crawler);
  const reach = (p: Pos) => inBounds(a, p) && field.cost[index(a, p)]! < Infinity;
  return enemies.every((e) => e.pos && reach(e.pos)) && a.exits.every((x) => reach(x));
}

/** Which side of `room` the crawler walked in from (undefined if they didn't). */
export function entrySide(room: Room, fromRoom: number): Dir | undefined {
  return DIRS.find((d) => room.exits[d] === fromRoom);
}
