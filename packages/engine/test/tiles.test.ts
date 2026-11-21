import { afterEach, describe, expect, it } from "vitest";
import { PEERING_BITS, TilesetSchema, type PeeringBit, type Tileset } from "../src/content/schemas";
import { buildArena } from "../src/grid/arena";
import { floorTiles } from "../src/grid/view";
import { generateEnemy } from "../src/gen/enemy";
import { cosmeticStream, resetRng, setRandomSource } from "../src/rng";
import { readTres, tilesetFromTres, tresTextures, TresError } from "../src/tiles/godot";
import { groundLayout } from "../src/tiles/ground";
import {
  BIT_VECTOR, MODE_BITS, TRANSFORM_SETS, choiceArt, compileTileset, composeFlips, invertFlip, misfit,
  paintGround, turn, turnPeering, wantedAt, type GroundGrid, type Peering, type TerrainMode, type TileChoice,
} from "../src/tiles/tileset";
import type { Room } from "../src/state";
import { content } from "./helpers";

afterEach(() => resetRng());

// ---------------------------------------------------------------- helpers

type Spec = { terrain: "a" | "b"; peering: Peering; probability?: number; transforms?: string; alternatives?: unknown[] };

function makeSet(mode: TerrainMode, tiles: Spec[]): Tileset {
  return TilesetSchema.parse({
    id: "test",
    name: "Test",
    terrainSets: [{ mode, terrains: [{ name: "a", color: "#111111" }, { name: "b", color: "#222222" }] }],
    sources: [{ id: 0, kind: "images", tiles: tiles.map((t, i) => ({ image: `t${i}`, ...t })) }],
  });
}

const full = (t: string): Peering => Object.fromEntries(PEERING_BITS.map((b) => [b, t]));

/** Every bit pattern a "b" square can need in this mode, given "a" underneath. */
function patterns(mode: TerrainMode): Peering[] {
  const bits = MODE_BITS[mode];
  const out: Peering[] = [];
  for (let m = 0; m < 1 << bits.length; m++) {
    const p: Peering = {};
    bits.forEach((b, i) => (p[b] = (m >> i) & 1 ? "b" : "a"));
    if (mode === "cornersAndSides") {
      // A corner can only be "b" if both sides next to it are.
      const ok = bits.every((b) => {
        const [dx, dy] = BIT_VECTOR[b];
        if (!dx || !dy || p[b] !== "b") return true;
        return p[dx > 0 ? "right_side" : "left_side"] === "b" && p[dy > 0 ? "bottom_side" : "top_side"] === "b";
      });
      if (!ok) continue;
    }
    out.push(p);
  }
  return out;
}

const keyOf = (p: Peering, mode: TerrainMode) => MODE_BITS[mode].map((b) => p[b] ?? "-").join("");

/** One pattern per symmetry class: the art you'd draw if the tiler flips and turns it for you. */
function representatives(mode: TerrainMode): Peering[] {
  const seen = new Set<string>();
  const out: Peering[] = [];
  for (const p of patterns(mode)) {
    const orbit = TRANSFORM_SETS.all.map((f) => keyOf(turnPeering(p, f), mode));
    if (orbit.some((k) => seen.has(k))) continue;
    orbit.forEach((k) => seen.add(k));
    out.push(p);
  }
  return out;
}

function noiseGrid(seed: number, w = 12, h = 9, density = 0.5): GroundGrid {
  const s = cosmeticStream(seed);
  return { w, h, terrain: Array.from({ length: w * h }, () => (s.random() < density ? "b" : "a")) };
}

function blobGrid(seed: number): GroundGrid {
  const w = 12;
  const h = 9;
  return { w, h, terrain: groundLayout({ terrainSet: 0, base: "a", areas: [{ terrain: "b", shape: "blob", count: [1, 3], size: [4, 16] }] }, w, h, seed) };
}

function worstFit(ts: Tileset, grid: GroundGrid, seed = 1): number {
  const set = compileTileset(ts)[0]!;
  const picks = paintGround(ts, 0, grid, seed);
  let worst = 0;
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const c = picks[y * grid.w + x]!;
      worst = Math.max(worst, misfit(c, wantedAt(grid, set.order, x, y), set.mode));
    }
  }
  return worst;
}

const MODES: TerrainMode[] = ["cornersAndSides", "corners", "sides"];

// ---------------------------------------------------------------- flips

describe("Godot flips", () => {
  const rot90: typeof TRANSFORM_SETS.all[number] = { transpose: true, flipH: true, flipV: false };

  it("transpose happens before the flips, so transpose + flip_h is a clockwise quarter turn", () => {
    expect(turn([0, -1], rot90)).toEqual([1, 0]); // top -> right
    expect(turn([1, 0], rot90)).toEqual([0, 1]); // right -> bottom
    expect(composeFlips(rot90, rot90)).toEqual({ transpose: false, flipH: true, flipV: true });
    expect(composeFlips(rot90, invertFlip(rot90))).toEqual({ transpose: false, flipH: false, flipV: false });
  });

  it("all eight flips are different, and each one moves the bits around without losing any", () => {
    const distinct: Peering = Object.fromEntries(PEERING_BITS.map((b) => [b, b])) as Peering;
    const results = new Set<string>();
    for (const f of TRANSFORM_SETS.all) {
      const p = turnPeering(distinct, f);
      expect(new Set(Object.values(p)).size).toBe(8);
      results.add(JSON.stringify(PEERING_BITS.map((b) => p[b])));
    }
    expect(results.size).toBe(8);
  });

  it("generated transforms split the tile's probability; alternatives default to the base's bits, flipped", () => {
    const ts = makeSet("sides", [
      { terrain: "a", peering: full("a"), probability: 8, transforms: "all" },
      { terrain: "b", peering: { right_side: "b", bottom_side: "a", left_side: "a", top_side: "a" }, alternatives: [{ flipH: true }] },
    ]);
    const choices = compileTileset(ts)[0]!.choices;
    expect(choices.filter((c) => c.tile.image === "t0").map((c) => c.probability)).toEqual(new Array(8).fill(1));
    const [base, alt] = choices.filter((c) => c.tile.image === "t1");
    expect(base!.peering.right_side).toBe("b");
    expect(alt!.flip).toEqual({ flipH: true, flipV: false, transpose: false });
    expect(alt!.peering.left_side).toBe("b");
    expect(alt!.peering.right_side).toBe("a");
  });
});

// ---------------------------------------------------------------- matching

describe("terrain matching", () => {
  it("a bit takes the lowest terrain of the squares that share it; the board edge repeats the square beside it", () => {
    const order = new Map([["a", 0], ["b", 1]]);
    // 4x4, with a 2x2 block of b in the middle
    const grid: GroundGrid = { w: 4, h: 4, terrain: ["a", "a", "a", "a", "a", "b", "b", "a", "a", "b", "b", "a", "a", "a", "a", "a"] };
    const w = wantedAt(grid, order, 1, 1);
    expect(w.center).toBe("b");
    expect(w.peering).toMatchObject({ right_side: "b", bottom_side: "b", bottom_right_corner: "b", left_side: "a", top_side: "a", top_right_corner: "a", bottom_left_corner: "a" });
    expect(wantedAt(grid, order, 0, 1).peering.right_side).toBe("a"); // the "a" square's side of the same seam
    const lone: GroundGrid = { w: 1, h: 1, terrain: ["b"] };
    expect(Object.values(wantedAt(lone, order, 0, 0).peering)).toEqual(new Array(8).fill("b"));
  });

  it.each(MODES)("a complete %s set fits every square exactly, and the bits agree across every seam", (mode) => {
    const ts = makeSet(mode, [{ terrain: "a", peering: full("a") }, ...patterns(mode).map((p) => ({ terrain: "b" as const, peering: p }))]);
    for (let seed = 1; seed <= 20; seed++) {
      for (const grid of [noiseGrid(seed), blobGrid(seed)]) {
        expect(worstFit(ts, grid)).toBe(0);
        const picks = paintGround(ts, 0, grid, seed) as TileChoice[];
        const at = (x: number, y: number) => picks[y * grid.w + x]!.peering;
        for (let y = 0; y < grid.h - 1; y++) {
          for (let x = 0; x < grid.w - 1; x++) {
            if (mode !== "corners") {
              expect(at(x, y).right_side).toBe(at(x + 1, y).left_side);
              expect(at(x, y).bottom_side).toBe(at(x, y + 1).top_side);
            }
            if (mode !== "sides") {
              const shared = [at(x, y).bottom_right_corner, at(x + 1, y).bottom_left_corner, at(x, y + 1).top_right_corner, at(x + 1, y + 1).top_left_corner];
              expect(new Set(shared).size).toBe(1);
            }
          }
        }
      }
    }
  });

  it.each(MODES)("in %s mode, one drawing per symmetry class plus transforms covers everything", (mode) => {
    const reps = representatives(mode);
    const ts = makeSet(mode, [{ terrain: "a", peering: full("a") }, ...reps.map((p) => ({ terrain: "b" as const, peering: p, transforms: "all" }))]);
    for (let seed = 1; seed <= 20; seed++) expect(worstFit(ts, noiseGrid(seed))).toBe(0);
    // The art an artist actually has to draw for one terrain pair:
    expect(reps.length).toBe({ cornersAndSides: 14, corners: 6, sides: 6 }[mode]);
  });

  it("empty bits (Godot's -1) fit any terrain but the tile's own, so one-terrain sets with blank edges work", () => {
    const blank = (p: Peering): Peering => Object.fromEntries(Object.entries(p).filter(([, t]) => t === "b"));
    const ts = makeSet("corners", [{ terrain: "a", peering: full("a") }, ...patterns("corners").map((p) => ({ terrain: "b" as const, peering: blank(p) }))]);
    for (let seed = 1; seed <= 10; seed++) expect(worstFit(ts, noiseGrid(seed))).toBe(0);
  });

  it("a set missing tiles still draws every square, with the closest fit", () => {
    const ts = makeSet("cornersAndSides", [{ terrain: "a", peering: full("a") }, { terrain: "b", peering: full("b") }]);
    const grid = blobGrid(3);
    const picks = paintGround(ts, 0, grid, 1);
    expect(picks.every((c) => c !== undefined)).toBe(true);
    expect(worstFit(ts, grid)).toBeGreaterThan(0);
  });

  it("equally good tiles share squares by probability, the same way every time for a seed", () => {
    const ts = makeSet("cornersAndSides", [10, 1, 3, 1].map((probability) => ({ terrain: "a" as const, peering: full("a"), probability })));
    const grid: GroundGrid = { w: 40, h: 40, terrain: new Array(1600).fill("a") };
    const picks = paintGround(ts, 0, grid, 99);
    const share = [0, 1, 2, 3].map((i) => picks.filter((c) => c!.tile.image === `t${i}`).length / 1600);
    expect(share[0]).toBeGreaterThan(0.55);
    expect(share[2]).toBeGreaterThan(share[1]!);
    expect(share.every((n) => n > 0)).toBe(true);
    expect(paintGround(ts, 0, grid, 99)).toEqual(picks);
    expect(paintGround(ts, 0, grid, 100)).not.toEqual(picks);
  });

  it("atlas tiles find their rectangle through margins and separation", () => {
    const ts = TilesetSchema.parse({
      id: "sheet", name: "Sheet", terrainSets: [{ terrains: [{ name: "a", color: "#000000" }] }],
      sources: [{ id: 0, kind: "atlas", texture: "sheet", textureSize: [53, 19], regionSize: [16, 16], margins: [2, 2], separation: [1, 1],
        tiles: [{ atlas: [2, 0], terrain: "a", peering: full("a") }] }],
    });
    expect(choiceArt(compileTileset(ts)[0]!.choices[0]!)).toEqual({ image: "combat/floor/sheet", region: [36, 2, 16, 16], sheet: [53, 19] });
  });
});

// ---------------------------------------------------------------- Godot import

const TRES = `[gd_resource type="TileSet" load_steps=3 format=3 uid="uid://btest"]

[ext_resource type="Texture2D" uid="uid://ctex" path="res://tiles/water.png" id="1_tex"]

[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_a"]
texture = ExtResource("1_tex")
margins = Vector2i(2, 2)
separation = Vector2i(1, 1)
texture_region_size = Vector2i(16, 16)
0:0/0 = 0
0:0/0/terrain_set = 0
0:0/0/terrain = 0
0:0/0/terrains_peering_bit/bottom_right_corner = 0
0:0/0/terrains_peering_bit/bottom_left_corner = 0
0:0/0/terrains_peering_bit/top_left_corner = 0
0:0/0/terrains_peering_bit/top_right_corner = 0
0:0/0/probability = 4.0
1:0/0 = 0
1:0/0/terrain_set = 0
1:0/0/terrain = 1
1:0/0/terrains_peering_bit/bottom_right_corner = 0
1:0/0/terrains_peering_bit/bottom_left_corner = 0
1:0/0/terrains_peering_bit/top_left_corner = 1
1:0/0/terrains_peering_bit/top_right_corner = 0
1:0/0/custom_data_0 = {
"note": "multi-line values parse",
"list": [1, 2.5, -3]
}
1:0/1 = 1
1:0/1/flip_h = true
1:0/1/terrain_set = 0
1:0/1/terrain = 1
1:0/1/terrains_peering_bit/top_right_corner = 1
2:0/0 = 0
2:0/0/physics_layer_0/polygon_0/points = PackedVector2Array(-8, -8, 8, -8, 8, 8, -8, 8)
0:1/size_in_atlas = Vector2i(2, 2)
0:1/0 = 0
0:1/0/terrain_set = 0
0:1/0/terrain = 0

[resource]
tile_size = Vector2i(16, 16)
physics_layer_0/collision_layer = 1
terrain_set_0/mode = 1
terrain_set_0/terrain_0/name = "Wet Concrete"
terrain_set_0/terrain_0/color = Color(0.5, 0.5, 0.5, 1)
terrain_set_0/terrain_1/name = "Water"
terrain_set_0/terrain_1/color = Color(0, 0.25, 0.5, 1)
custom_data_layer_0/name = "note"
custom_data_layer_0/type = 27
sources/0 = SubResource("TileSetAtlasSource_a")
`;

describe("Godot TileSet import", () => {
  const textures = new Map([[0, { texture: "water", size: [53, 36] as [number, number] }]]);

  it("finds the atlas textures to copy", () => {
    expect(tresTextures(readTres(TRES))).toEqual([{ sourceId: 0, extId: "1_tex", path: "res://tiles/water.png" }]);
  });

  it("carries over terrain sets, atlas layout, flips, probability and peering bits, and skips the rest", () => {
    const { tileset, warnings } = tilesetFromTres(readTres(TRES), { id: "water", name: "Water", textures });
    const ts = TilesetSchema.parse(tileset);
    expect(ts.terrainSets).toEqual([{ mode: "corners", terrains: [{ name: "wet_concrete", color: "#808080" }, { name: "water", color: "#004080" }] }]);
    const src = ts.sources[0]!;
    expect(src).toMatchObject({ id: 0, kind: "atlas", texture: "water", textureSize: [53, 36], regionSize: [16, 16], margins: [2, 2], separation: [1, 1] });
    expect(src.tiles.map((t) => [t.atlas, t.terrain, t.flipH, t.probability])).toEqual([
      [[0, 0], "wet_concrete", false, 4],
      [[1, 0], "water", false, 1],
      [[1, 0], "water", true, 1],
    ]);
    expect(src.tiles[1]!.peering).toEqual({ bottom_right_corner: "wet_concrete", bottom_left_corner: "wet_concrete", top_left_corner: "water", top_right_corner: "wet_concrete" });
    expect(src.tiles[2]!.peering).toEqual({ top_right_corner: "water" });
    expect(warnings.join("\n")).toMatch(/bigger than one square/);
    expect(warnings.join("\n")).toMatch(/1 tile\(s\) have no terrain/);
  });

  it("refuses what it can't use", () => {
    expect(() => tilesetFromTres(readTres(TRES.replace("format=3", "format=2")), { id: "x", name: "x", textures })).toThrow(TresError);
    expect(() => tilesetFromTres(readTres(TRES.replace("[resource]\n", "[resource]\ntile_shape = 1\n")), { id: "x", name: "x", textures })).toThrow(/square/);
    expect(() => readTres('[gd_resource type="TileSet"]\nbroken')).toThrow(TresError);
  });
});

// ---------------------------------------------------------------- ground layout

describe("ground layout (looks only)", () => {
  const room = (shape: Room["shape"]): Room => ({
    id: 0, x: 0, y: 0, type: "chamber", shape, name: "Test", visited: true, seen: true, searched: false, desc: null,
    exits: { west: 1, east: 2 },
  });

  it("strips run the board's long side; blobs are at least the size asked for; same seed, same ground", () => {
    const strip = groundLayout({ terrainSet: 0, base: "a", areas: [{ terrain: "b", shape: "strip", count: [1, 1], size: [3, 3] }] }, 8, 8, 5);
    const rows = Array.from({ length: 8 }, (_, y) => strip.slice(y * 8, y * 8 + 8));
    expect(rows.filter((r) => r.every((t) => t === "b"))).toHaveLength(3);
    expect(rows.filter((r) => r.every((t) => t === "a"))).toHaveLength(5);
    const g = { terrainSet: 0, base: "a", areas: [{ terrain: "b", shape: "blob" as const, count: [1, 1] as [number, number], size: [6, 6] as [number, number] }] };
    for (let seed = 0; seed < 50; seed++) {
      expect(groundLayout(g, 9, 4, seed).filter((t) => t === "b").length).toBeGreaterThanOrEqual(6);
      expect(groundLayout(g, 9, 4, seed)).toEqual(groundLayout(g, 9, 4, seed));
    }
  });

  it("never touches the game's dice", () => {
    setRandomSource(() => {
      throw new Error("a cosmetic roll used the game's dice");
    });
    const garage = content.floors.get("flooded_parking_garage");
    const terrain = groundLayout(garage.arena.ground!, 8, 8, 1234);
    const a = { w: 8, h: 8, tiles: new Array(64).fill(""), hazards: [], items: [], exits: [], crawler: { x: 0, y: 0 }, moveLeft: 0, ground: terrain, lookSeed: 1234 };
    expect(floorTiles(a, garage, content)).toHaveLength(64);
  });

  it("an arena's layout and dice are the same with or without a ground layout", () => {
    const garage = content.floors.get("flooded_parking_garage");
    const bare = { ...garage, arena: { ...garage.arena, ground: undefined } };
    let water = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const build = (theme: typeof garage) => {
        const s = cosmeticStream(seed);
        let calls = 0;
        setRandomSource(() => (calls++, s.random()));
        const enemies = [0, 1].map(() => generateEnemy(content.enemies.get("brake_eel"), "minion", 3, content));
        const a = buildArena({ room: room("chamber"), theme, entry: "west", enemies, ambushers: new Set() }, content);
        return { a, calls, spawns: enemies.map((e) => e.pos) };
      };
      const withGround = build(garage);
      const without = build(bare);
      expect(withGround.calls).toBe(without.calls);
      expect(withGround.spawns).toEqual(without.spawns);
      expect({ ...withGround.a, ground: undefined }).toEqual({ ...without.a, ground: undefined });
      expect(withGround.a.ground).toHaveLength(64);
      if (withGround.a.ground!.includes("water")) water++;
      const tiles = floorTiles(withGround.a, garage, content);
      for (const [i, t] of withGround.a.ground!.entries()) {
        if (t === "water" && tiles[i]!.image === "combat/floor/garage_water") expect(tiles[i]!.region).toHaveLength(4);
      }
    }
    expect(water).toBeGreaterThan(20);
  });

  it("every floor's ground terrains exist in its tileset, and every square of every floor draws", () => {
    for (const theme of content.floors.all) {
      expect(theme.arena.tileset).toBeDefined();
      const terrain = groundLayout(theme.arena.ground!, 9, 4, 77);
      const a = { w: 9, h: 4, tiles: new Array(36).fill(""), hazards: [], items: [], exits: [], crawler: { x: 0, y: 0 }, moveLeft: 0, ground: terrain, lookSeed: 77 };
      expect(floorTiles(a, theme, content).every((t) => t.image && t.color)).toBe(true);
    }
  });
});

// Type-only use, so the import of PeeringBit stays honest.
const _bits: PeeringBit[] = [...PEERING_BITS];
void _bits;
