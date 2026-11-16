/**
 * Grid-combat geometry (Milestone 4b). Kept deliberately small:
 * - 8-way movement; distance is Chebyshev (a diagonal step costs 1). A diagonal
 *   is only blocked when BOTH orthogonal neighbours are obstacles.
 * - Range bands come from distance (close <= 1, near 2-3, far 4+), so every
 *   `range` field written for bands mode keeps meaning the same thing.
 * - Line of sight is Bresenham between tile centres, blocked only by features
 *   that block sight (units never do), and symmetric.
 * - Paths are Dijkstra over at most 81 tiles with a fixed neighbour order.
 */
import type { Content } from "../content/load";
import type { ArenaFeature, RangeBand } from "../content/schemas";
import type { ArenaExit, ArenaHazard, ArenaState, CombatState, Enemy, Pos } from "../state";

/** How far each band reaches, in tiles. */
export const REACH: Record<RangeBand, number> = { close: 1, near: 3, far: 99 };

export function bandOf(d: number): RangeBand {
  return d <= 1 ? "close" : d <= 3 ? "near" : "far";
}

export function dist(a: Pos, b: Pos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function same(a: Pos, b: Pos): boolean {
  return a.x === b.x && a.y === b.y;
}

export const DIR8 = {
  n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1],
} as const;
export type Dir8 = keyof typeof DIR8;

/** Orthogonals first, then diagonals: deterministic, and paths prefer straight lines. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1],
];

export function inBounds(a: ArenaState, p: Pos): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < a.w && p.y < a.h;
}

export function index(a: ArenaState, p: Pos): number {
  return p.y * a.w + p.x;
}

export function posOf(a: ArenaState, i: number): Pos {
  return { x: i % a.w, y: Math.floor(i / a.w) };
}

// ---------------------------------------------------------------- features

export function featureAt(a: ArenaState, content: Content, p: Pos): ArenaFeature | undefined {
  const id = a.tiles[index(a, p)];
  return id ? content.arenaFeatures.byId[id] : undefined;
}

export function hazardAt(a: ArenaState, p: Pos): ArenaHazard | undefined {
  return a.hazards.find((h) => same(h, p));
}

export function exitAt(a: ArenaState, p: Pos): ArenaExit | undefined {
  return a.exits.find((x) => same(x, p));
}

export function blocksMove(a: ArenaState, content: Content, p: Pos): boolean {
  return featureAt(a, content, p)?.blocksMove ?? false;
}

export function blocksSight(a: ArenaState, content: Content, p: Pos): boolean {
  if (featureAt(a, content, p)?.blocksSight) return true;
  const h = hazardAt(a, p);
  return h ? content.arenaFeatures.byId[h.id]?.blocksSight ?? false : false;
}

/** Movement points to step onto this tile (terrain and hazards can make it dearer). */
export function stepCost(a: ArenaState, content: Content, p: Pos): number {
  const h = hazardAt(a, p);
  return Math.max(featureAt(a, content, p)?.moveCost ?? 1, h ? content.arenaFeatures.byId[h.id]?.moveCost ?? 1 : 1);
}

// ---------------------------------------------------------------- units

/** Whoever stands on the tile: "crawler", a living enemy, or nothing. */
export function unitAt(combat: CombatState, p: Pos): "crawler" | Enemy | undefined {
  const a = combat.arena;
  if (!a) return undefined;
  if (same(a.crawler, p)) return "crawler";
  return combat.enemies.find((e) => e.hp > 0 && e.pos && same(e.pos, p));
}

export function occupied(combat: CombatState, p: Pos, except?: Enemy | "crawler"): boolean {
  const u = unitAt(combat, p);
  return u !== undefined && u !== except;
}

// ---------------------------------------------------------------- sight

function bresenhamClear(a: ArenaState, content: Content, from: Pos, to: Pos): boolean {
  let x0 = from.x;
  let y0 = from.y;
  const dx = Math.abs(to.x - x0);
  const dy = -Math.abs(to.y - y0);
  const sx = x0 < to.x ? 1 : -1;
  const sy = y0 < to.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x0 === to.x && y0 === to.y) return true;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
    if (x0 === to.x && y0 === to.y) return true;
    if (blocksSight(a, content, { x: x0, y: y0 })) return false;
  }
}

/** Can a unit at `from` see `to`? Adjacent tiles always can. Symmetric. */
export function lineOfSight(a: ArenaState, content: Content, from: Pos, to: Pos): boolean {
  if (dist(from, to) <= 1) return true;
  return bresenhamClear(a, content, from, to) || bresenhamClear(a, content, to, from);
}

/** In reach of a band from `from`: close range needs adjacency, the rest also need sight. */
export function reaches(a: ArenaState, content: Content, from: Pos, to: Pos, band: RangeBand): boolean {
  const d = dist(from, to);
  return d <= REACH[band] && (d <= 1 || lineOfSight(a, content, from, to));
}

// ---------------------------------------------------------------- paths

export interface PathField {
  /** Total cost to reach each tile (Infinity = unreachable). */
  cost: number[];
  prev: number[];
}

export interface PathOptions {
  /** Tiles the mover can't enter (units, usually). Obstacles are always blocked. */
  blocked?: (p: Pos) => boolean;
  /** Extra weight for tiles the mover would rather avoid (doesn't spend movement). */
  penalty?: (p: Pos) => number;
}

/** Cheapest route cost to every tile from `from`. */
export function pathField(a: ArenaState, content: Content, from: Pos, opts: PathOptions = {}): PathField {
  const n = a.w * a.h;
  const cost = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  cost[index(a, from)] = 0;
  for (;;) {
    let best = -1;
    for (let i = 0; i < n; i++) if (!done[i] && cost[i]! < Infinity && (best < 0 || cost[i]! < cost[best]!)) best = i;
    if (best < 0) break;
    done[best] = true;
    const p = posOf(a, best);
    for (const [dx, dy] of NEIGHBOURS) {
      const q = { x: p.x + dx, y: p.y + dy };
      if (!inBounds(a, q) || blocksMove(a, content, q) || opts.blocked?.(q)) continue;
      if (dx !== 0 && dy !== 0 &&
        blocksMove(a, content, { x: p.x + dx, y: p.y }) && blocksMove(a, content, { x: p.x, y: p.y + dy })) continue;
      const qi = index(a, q);
      const c = cost[best]! + stepCost(a, content, q) + (opts.penalty?.(q) ?? 0);
      if (c < cost[qi]!) {
        cost[qi] = c;
        prev[qi] = best;
      }
    }
  }
  return { cost, prev };
}

/** Steps from the field's origin to `to` (origin excluded); empty if unreachable. */
export function pathTo(a: ArenaState, field: PathField, to: Pos): Pos[] {
  let i = index(a, to);
  if (field.cost[i] === Infinity) return [];
  const out: Pos[] = [];
  while (field.prev[i] !== -1) {
    out.push(posOf(a, i));
    i = field.prev[i]!;
  }
  return out.reverse();
}

/** Movement points actually spent walking `path` (penalties aren't movement). */
export function walkCost(a: ArenaState, content: Content, path: Pos[]): number {
  return path.reduce((sum, p) => sum + stepCost(a, content, p), 0);
}

/** The longest prefix of `path` that `budget` movement points pay for. */
export function affordable(a: ArenaState, content: Content, path: Pos[], budget: number): Pos[] {
  const out: Pos[] = [];
  let spent = 0;
  for (const p of path) {
    spent += stepCost(a, content, p);
    if (spent > budget) break;
    out.push(p);
  }
  return out;
}

export function allTiles(a: ArenaState): Pos[] {
  const out: Pos[] = [];
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) out.push({ x, y });
  return out;
}

// ---------------------------------------------------------------- coordinates

const COLS = "abcdefghijklmnop";

/** Chess-style label: column letter, then row number from the top ("c4"). */
export function coord(p: Pos): string {
  return `${COLS[p.x]}${p.y + 1}`;
}

export function parseCoord(text: string): Pos | null {
  const m = /^([a-p])(\d{1,2})$/.exec(text.trim().toLowerCase());
  if (!m) return null;
  return { x: COLS.indexOf(m[1]!), y: Number(m[2]) - 1 };
}

export function isCoord(text: string): boolean {
  return /^[a-p]\d{1,2}$/.test(text.trim().toLowerCase());
}

export function columnLabels(w: number): string[] {
  return COLS.slice(0, w).split("");
}
