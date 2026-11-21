/**
 * Godot-style terrain autotiling for the battle board's floor.
 *
 * This mirrors Godot 4's TileSet terrains. Each tile has a center terrain and up
 * to eight peering bits, and its terrain set's mode says which bits count
 * (corners and sides, corners only, sides only). Given the terrain of every
 * square, the tiler works out what each bit should be, scores every tile by how
 * many bits disagree, and picks among the best fits by probability, as Godot's
 * painter does. Alternative tiles (flip_h, flip_v, transpose) are candidates of
 * their own, with their own bits.
 *
 * Where two terrains meet, the bit between them takes the terrain listed first in
 * the set (the one underneath). The later terrain's squares draw the edge, and the
 * bits on both sides of every seam agree, so a complete set always joins up.
 *
 * Pure and deterministic: the same ground and seed give the same tiles.
 */
import {
  PEERING_BITS, type PeeringBit, type Tileset, type TilesetSource, type TilesetTile,
} from "../content/schemas";
import { hashUnit } from "../rng";

export type TerrainMode = Tileset["terrainSets"][number]["mode"];
/** Terrain name per bit; null (or missing) is Godot's -1, "no terrain". */
export type Peering = Partial<Record<PeeringBit, string | null>>;

type Vec = readonly [number, number];

/** Screen direction of each bit (x right, y down). */
export const BIT_VECTOR: Record<PeeringBit, Vec> = {
  right_side: [1, 0], bottom_right_corner: [1, 1], bottom_side: [0, 1], bottom_left_corner: [-1, 1],
  left_side: [-1, 0], top_left_corner: [-1, -1], top_side: [0, -1], top_right_corner: [1, -1],
};
const BIT_AT = new Map<string, PeeringBit>(PEERING_BITS.map((b) => [BIT_VECTOR[b].join(","), b]));

const SIDES: readonly PeeringBit[] = ["right_side", "bottom_side", "left_side", "top_side"];
const CORNERS: readonly PeeringBit[] = ["bottom_right_corner", "bottom_left_corner", "top_left_corner", "top_right_corner"];

/** The bits each Godot terrain mode matches on. */
export const MODE_BITS: Record<TerrainMode, readonly PeeringBit[]> = {
  cornersAndSides: PEERING_BITS,
  corners: CORNERS,
  sides: SIDES,
};

// ---------------------------------------------------------------- flips

/** Godot's flip_h, flip_v and transpose. Transpose swaps x and y, and happens before the flips. */
export interface Flip {
  flipH: boolean;
  flipV: boolean;
  transpose: boolean;
}

export const NO_FLIP: Flip = { flipH: false, flipV: false, transpose: false };

type Matrix = readonly [number, number, number, number]; // (x, y) -> (a x + b y, c x + d y)

function toMatrix(f: Flip): Matrix {
  let [a, b, c, d] = f.transpose ? [0, 1, 1, 0] : [1, 0, 0, 1];
  if (f.flipH) [a, b] = [-a, -b];
  if (f.flipV) [c, d] = [-c, -d];
  return [a, b, c, d];
}

function fromMatrix([a, b, c, d]: Matrix): Flip {
  const transpose = a === 0;
  return { transpose, flipH: (transpose ? b : a) < 0, flipV: (transpose ? c : d) < 0 };
}

/** Apply `first`, then `then`. */
export function composeFlips(first: Flip, then: Flip): Flip {
  const [a1, b1, c1, d1] = toMatrix(first);
  const [a2, b2, c2, d2] = toMatrix(then);
  return fromMatrix([a2 * a1 + b2 * c1, a2 * b1 + b2 * d1, c2 * a1 + d2 * c1, c2 * b1 + d2 * d1]);
}

/** Undo a flip (the flips and the transpose each undo themselves, in reverse order). */
export function invertFlip(f: Flip): Flip {
  const [a, b, c, d] = toMatrix(f);
  // Every flip matrix is orthogonal, so its inverse is its transpose.
  return fromMatrix([a, c, b, d]);
}

/** Where a direction drawn in the art lands on screen once the art is flipped. */
export function turn(v: Vec, f: Flip): Vec {
  const [a, b, c, d] = toMatrix(f);
  return [a * v[0] + b * v[1] + 0, c * v[0] + d * v[1] + 0]; // + 0 turns -0 into 0
}

/** The bits as they read once the art is flipped. */
export function turnPeering(p: Peering, f: Flip): Peering {
  const out: Peering = {};
  for (const bit of PEERING_BITS) {
    if (p[bit] === undefined) continue;
    out[BIT_AT.get(turn(BIT_VECTOR[bit], f).join(","))!] = p[bit];
  }
  return out;
}

/** The flips each `transforms` value adds, identity first. */
export const TRANSFORM_SETS: Record<TilesetTile["transforms"], Flip[]> = {
  none: [NO_FLIP],
  flips: [NO_FLIP, { ...NO_FLIP, flipH: true }, { ...NO_FLIP, flipV: true }, { ...NO_FLIP, flipH: true, flipV: true }],
  // Clockwise quarter turns on screen: 90 = transpose + flip_h, 180 = both flips, 270 = transpose + flip_v.
  rotations: [NO_FLIP, { flipH: true, flipV: false, transpose: true }, { flipH: true, flipV: true, transpose: false }, { flipH: false, flipV: true, transpose: true }],
  all: [false, true].flatMap((transpose) => [false, true].flatMap((flipH) => [false, true].map((flipV) => ({ flipH, flipV, transpose })))),
};

// ---------------------------------------------------------------- compiling a tileset

/** One way to draw a square: a tile's art with a flip, and the terrain it shows. */
export interface TileChoice {
  source: TilesetSource;
  tile: TilesetTile;
  flip: Flip;
  terrain: string;
  /** Bits as they read on screen. */
  peering: Peering;
  probability: number;
}

export interface CompiledSet {
  mode: TerrainMode;
  /** Terrain name -> stacking order (0 is underneath everything). */
  order: Map<string, number>;
  colors: Map<string, string>;
  choices: TileChoice[];
  /** Best choices per wanted pattern; filled as patterns come up. */
  memo: Map<string, TileChoice[]>;
}

const compiled = new WeakMap<Tileset, CompiledSet[]>();

/** Expand alternatives and transforms into the candidate list for each terrain set. Cached per tileset. */
export function compileTileset(ts: Tileset): CompiledSet[] {
  const hit = compiled.get(ts);
  if (hit) return hit;
  const sets: CompiledSet[] = ts.terrainSets.map((s) => ({
    mode: s.mode,
    order: new Map(s.terrains.map((t, i) => [t.name, i])),
    colors: new Map(s.terrains.map((t) => [t.name, t.color])),
    choices: [],
    memo: new Map(),
  }));
  for (const source of ts.sources) {
    for (const tile of source.tiles) {
      const set = sets[tile.terrainSet];
      if (!set) continue; // validated at load
      const base: Flip = { flipH: tile.flipH, flipV: tile.flipV, transpose: tile.transpose };
      const turns = TRANSFORM_SETS[tile.transforms];
      for (const t of turns) {
        set.choices.push({
          source, tile, flip: composeFlips(base, t), terrain: tile.terrain,
          peering: turnPeering(tile.peering, t), probability: tile.probability / turns.length,
        });
      }
      // Alternatives are absolute, like Godot's: their own flip, and (by default) the base's bits turned to match.
      const drawn = turnPeering(tile.peering, invertFlip(base));
      for (const alt of tile.alternatives) {
        const flip: Flip = { flipH: alt.flipH, flipV: alt.flipV, transpose: alt.transpose };
        set.choices.push({
          source, tile, flip, terrain: alt.terrain ?? tile.terrain,
          peering: alt.peering ?? turnPeering(drawn, flip), probability: alt.probability,
        });
      }
    }
  }
  compiled.set(ts, sets);
  return sets;
}

// ---------------------------------------------------------------- painting

/** Which terrain every square is, row-major. */
export interface GroundGrid {
  w: number;
  h: number;
  terrain: readonly string[];
}

export interface Wanted {
  center: string;
  peering: Record<PeeringBit, string>;
}

/**
 * What a square's tile should show. Each bit takes the lowest terrain among the
 * squares that share it: two squares for a side, four for a corner. The board
 * edge repeats the square next to it, so nothing frames the board.
 */
export function wantedAt(grid: GroundGrid, order: Map<string, number>, x: number, y: number): Wanted {
  const at = (dx: number, dy: number) => {
    const cx = Math.min(grid.w - 1, Math.max(0, x + dx));
    const cy = Math.min(grid.h - 1, Math.max(0, y + dy));
    return grid.terrain[cy * grid.w + cx]!;
  };
  const lowest = (names: string[]) =>
    names.reduce((lo, n) => ((order.get(n) ?? 0) < (order.get(lo) ?? 0) ? n : lo));
  const center = at(0, 0);
  const peering = {} as Record<PeeringBit, string>;
  for (const bit of PEERING_BITS) {
    const [dx, dy] = BIT_VECTOR[bit];
    peering[bit] = dx !== 0 && dy !== 0
      ? lowest([center, at(dx, 0), at(0, dy), at(dx, dy)])
      : lowest([center, at(dx, dy)]);
  }
  return { center, peering };
}

/**
 * How badly a tile fits (0 = perfectly). A wrong bit costs 2 and a wrong center 1,
 * because a wrong bit shows as a seam. An empty bit fits any terrain but the
 * tile's own, so a set painted with one terrain and blank edges still works.
 */
export function misfit(c: TileChoice, want: Wanted, mode: TerrainMode): number {
  let score = c.terrain === want.center ? 0 : 1;
  for (const bit of MODE_BITS[mode]) {
    const have = c.peering[bit] ?? null;
    const ok = have === null ? want.peering[bit] !== c.terrain : have === want.peering[bit];
    if (!ok) score += 2;
  }
  return score;
}

function bestChoices(set: CompiledSet, want: Wanted): TileChoice[] {
  const key = [want.center, ...MODE_BITS[set.mode].map((b) => want.peering[b])].join("|");
  const hit = set.memo.get(key);
  if (hit) return hit;
  let best = Infinity;
  let out: TileChoice[] = [];
  for (const c of set.choices) {
    const s = misfit(c, want, set.mode);
    if (s < best) [best, out] = [s, [c]];
    else if (s === best) out.push(c);
  }
  set.memo.set(key, out);
  return out;
}

/** Weighted by probability, on a stable coin for this square. */
function pickChoice(options: TileChoice[], roll: number): TileChoice | undefined {
  const total = options.reduce((n, c) => n + c.probability, 0);
  if (total <= 0) return options[0];
  let left = roll * total;
  for (const c of options) {
    left -= c.probability;
    if (left < 0) return c;
  }
  return options[options.length - 1];
}

/** The tile for every square of the grid (row-major), or undefined where the set has no tiles at all. */
export function paintGround(ts: Tileset, setIndex: number, grid: GroundGrid, seed: number): (TileChoice | undefined)[] {
  const set = compileTileset(ts)[setIndex];
  const out: (TileChoice | undefined)[] = [];
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      if (!set || set.choices.length === 0) {
        out.push(undefined);
        continue;
      }
      out.push(pickChoice(bestChoices(set, wantedAt(grid, set.order, x, y)), hashUnit(x, y, seed, setIndex)));
    }
  }
  return out;
}

/** Where a choice's art is: the PNG, and for atlas tiles the pixel rectangle in the sheet. */
export function choiceArt(c: TileChoice): { image: string; region?: [number, number, number, number]; sheet?: [number, number] } {
  const s = c.source;
  if (s.kind === "images") return { image: `combat/floor/${c.tile.image}` };
  const [col, row] = c.tile.atlas!;
  const [rw, rh] = s.regionSize!;
  return {
    image: `combat/floor/${s.texture}`,
    region: [s.margins[0] + col * (rw + s.separation[0]), s.margins[1] + row * (rh + s.separation[1]), rw, rh],
    sheet: s.textureSize!,
  };
}
