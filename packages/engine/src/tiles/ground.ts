/**
 * Where an arena's ground terrains go: the floor's base terrain everywhere, with
 * blobs (puddles, drifts) and strips (runners, aisles) of other terrains painted
 * over it. Looks only: no rule reads the ground, so it can't change a fight.
 *
 * The layout comes from a cosmetic stream seeded by the arena's own (already
 * random) layout, so it never draws on the game's dice.
 */
import type { Ground } from "../content/schemas";
import { cosmeticStream, hashString, type CosmeticStream } from "../rng";

/** A seed for an arena's looks, from what's already random about it. */
export function lookSeed(layout: unknown): number {
  return hashString(JSON.stringify(layout));
}

/** The terrain of every square, row-major. */
export function groundLayout(g: Ground, w: number, h: number, seed: number): string[] {
  const s = cosmeticStream(seed);
  const cells = new Array<string>(w * h).fill(g.base);
  for (const area of g.areas) {
    for (let n = s.int(area.count[0], area.count[1]); n > 0; n--) {
      const size = s.int(area.size[0], area.size[1]);
      if (area.shape === "strip") strip(cells, w, h, s, area.terrain, size);
      else blob(cells, w, h, s, area.terrain, size);
    }
  }
  return cells;
}

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Grow a puddle from a random square, then fill the notches so its edge reads as a shape, not noise. */
function blob(cells: string[], w: number, h: number, s: CosmeticStream, terrain: string, size: number): void {
  const start = s.int(0, w * h - 1);
  const region = new Set<number>([start]);
  const frontier: number[] = [];
  const grow = (i: number) => {
    const x = i % w;
    const y = Math.floor(i / w);
    for (const [dx, dy] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!region.has(j)) frontier.push(j);
    }
  };
  grow(start);
  while (region.size < size && frontier.length > 0) {
    const k = s.int(0, frontier.length - 1);
    const j = frontier[k]!;
    frontier.splice(k, 1);
    if (region.has(j)) continue;
    region.add(j);
    grow(j);
  }
  for (let i = 0; i < w * h; i++) {
    if (region.has(i)) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    const around = STEPS.filter(([dx, dy]) => region.has((y + dy) * w + (x + dx)) && x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h).length;
    if (around >= 3) region.add(i);
  }
  for (const i of region) cells[i] = terrain;
}

/** A runner `width` squares wide along the board's long side, at a random offset. */
function strip(cells: string[], w: number, h: number, s: CosmeticStream, terrain: string, width: number): void {
  const across = w >= h ? h : w;
  const band = Math.max(1, Math.min(width, across));
  const at = s.int(0, across - band);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = w >= h ? y : x;
      if (k >= at && k < at + band) cells[y * w + x] = terrain;
    }
  }
}
