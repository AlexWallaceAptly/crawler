/**
 * Read a Godot 4 TileSet resource (.tres, text format 3) and turn it into a
 * Crawler tileset (tilesets.json). Pure: the import script does the file work
 * (finding textures, measuring them, copying them into public/).
 *
 * What carries over: terrain sets (mode, terrain names and colors), atlas
 * sources (texture, region size, margins, separation), and every tile or
 * alternative tile that has a terrain, with its flip_h / flip_v / transpose,
 * probability and peering bits. What doesn't: physics, navigation, occlusion,
 * custom data, scene sources, multi-square tiles and animation (frame 0 is
 * used). Each skip is reported as a warning.
 */
import { PEERING_BITS, type PeeringBit } from "../content/schemas";

// ---------------------------------------------------------------- the .tres text format

export type TresValue =
  | number | boolean | string | null
  | TresValue[]
  | { ctor: string; args: TresValue[] }
  | { dict: [TresValue, TresValue][] };

export interface TresSection {
  tag: string;
  attrs: Record<string, TresValue>;
  props: Map<string, TresValue>;
}

export class TresError extends Error {}

/** Parse the sections of a Godot text resource: `[tag attr=value]` headers, each followed by `key = value` lines. */
export function readTres(text: string): TresSection[] {
  let i = 0;
  const sections: TresSection[] = [];
  const fail = (msg: string): never => {
    const line = text.slice(0, i).split("\n").length;
    throw new TresError(`line ${line}: ${msg}`);
  };
  const space = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };
  const skipBlank = () => {
    for (;;) {
      space();
      if (text[i] === ";") while (i < text.length && text[i] !== "\n") i++;
      else return;
    }
  };
  const ident = () => {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
    if (!m) fail("expected a name");
    i += m![0].length;
    return m![0];
  };
  const str = (): string => {
    i++; // opening quote
    let out = "";
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") {
        const n = text[i + 1];
        out += n === "n" ? "\n" : n === "t" ? "\t" : (n ?? "");
        i += 2;
      } else out += text[i++];
    }
    if (text[i] !== '"') fail("unterminated string");
    i++;
    return out;
  };
  const list = (close: string): TresValue[] => {
    const out: TresValue[] = [];
    space();
    while (text[i] !== close) {
      out.push(value());
      space();
      if (text[i] === ",") i++;
      else if (text[i] !== close) fail(`expected "," or "${close}"`);
      space();
    }
    i++;
    return out;
  };
  function value(): TresValue {
    space();
    const ch = text[i];
    if (ch === '"') return str();
    if ((ch === "&" || ch === "^") && text[i + 1] === '"') {
      i++;
      return str();
    }
    if (ch === "[") {
      i++;
      return list("]");
    }
    if (ch === "{") {
      i++;
      const dict: [TresValue, TresValue][] = [];
      space();
      while (text[i] !== "}") {
        const k = value();
        space();
        if (text[i] !== ":") fail('expected ":" in a dictionary');
        i++;
        dict.push([k, value()]);
        space();
        if (text[i] === ",") i++;
        space();
      }
      i++;
      return { dict };
    }
    if (text.startsWith("-inf", i)) {
      i += 4;
      return -Infinity;
    }
    const num = /^-?(\d+\.?\d*(e[+-]?\d+)?|\.\d+)/i.exec(text.slice(i));
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    const name = ident();
    if (name === "true") return true;
    if (name === "false") return false;
    if (name === "null") return null;
    if (name === "inf") return Infinity;
    if (name === "nan") return NaN;
    // Typed containers: Array[int]([...]), Dictionary[String, int]({...})
    if (text[i] === "[") {
      let depth = 0;
      do {
        if (text[i] === "[") depth++;
        else if (text[i] === "]") depth--;
        i++;
      } while (depth > 0 && i < text.length);
    }
    space();
    if (text[i] !== "(") fail(`expected "(" after ${name}`);
    i++;
    return { ctor: name, args: list(")") };
  }

  for (;;) {
    skipBlank();
    if (i >= text.length) break;
    if (text[i] === "[") {
      i++;
      space();
      const tag = ident();
      const attrs: Record<string, TresValue> = {};
      space();
      while (text[i] !== "]") {
        const k = ident();
        space();
        if (text[i] !== "=") fail(`expected "=" after ${k}`);
        i++;
        attrs[k] = value();
        space();
      }
      i++;
      sections.push({ tag, attrs, props: new Map() });
      continue;
    }
    const m = /^([^\s=]+)\s*=/.exec(text.slice(i));
    if (!m) fail("expected `key = value`");
    i += m![0].length;
    const section = sections[sections.length - 1];
    if (!section) fail("a property before any section");
    section!.props.set(m![1]!, value());
  }
  return sections;
}

// ---------------------------------------------------------------- TileSet -> tileset JSON

const MODES = ["cornersAndSides", "corners", "sides"] as const;

const isCtor = (v: TresValue | undefined, name: string): v is { ctor: string; args: TresValue[] } =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "ctor" in v && v.ctor === name;

function pair(v: TresValue | undefined, fallback: [number, number]): [number, number] {
  return isCtor(v, "Vector2i") || isCtor(v, "Vector2") ? [Number(v.args[0]), Number(v.args[1])] : fallback;
}

function refId(v: TresValue | undefined, kind: "ExtResource" | "SubResource"): string | undefined {
  return isCtor(v, kind) ? String(v.args[0]) : undefined;
}

function hexColor(v: TresValue | undefined): string {
  if (!isCtor(v, "Color")) return "#808080";
  const ch = v.args.slice(0, 3).map((n) => Math.round(Math.min(1, Math.max(0, Number(n))) * 255).toString(16).padStart(2, "0"));
  const a = v.args[3] === undefined ? 1 : Number(v.args[3]);
  return `#${ch.join("")}${a < 1 ? Math.round(a * 255).toString(16).padStart(2, "0") : ""}`;
}

/** Godot terrain names are free text; ours are snake_case ids. */
export function terrainId(name: string, index: number): string {
  const s = name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return s || `terrain_${index}`;
}

function sectionOf(sections: TresSection[], tag: string, id?: string): TresSection | undefined {
  return sections.find((s) => s.tag === tag && (id === undefined || s.attrs.id === id));
}

/** The atlas sources' textures, so the import script can find and measure them. */
export function tresTextures(sections: TresSection[]): { sourceId: number; extId: string; path: string }[] {
  const res = sectionOf(sections, "resource");
  const out: { sourceId: number; extId: string; path: string }[] = [];
  for (const [key, v] of res?.props ?? []) {
    const m = /^sources\/(\d+)$/.exec(key);
    const sub = m ? sectionOf(sections, "sub_resource", refId(v, "SubResource")) : undefined;
    if (!sub || sub.attrs.type !== "TileSetAtlasSource") continue;
    const extId = refId(sub.props.get("texture"), "ExtResource");
    const ext = extId ? sectionOf(sections, "ext_resource", extId) : undefined;
    if (extId && typeof ext?.attrs.path === "string") out.push({ sourceId: Number(m![1]), extId, path: ext.attrs.path });
  }
  return out;
}

export interface TresImportOptions {
  id: string;
  name: string;
  /** Per source id: the texture's name under public/combat/floor/ and its size in pixels. */
  textures: Map<number, { texture: string; size: [number, number] }>;
}

type Json = Record<string, unknown>;

/** Convert a parsed Godot TileSet into tilesets.json shape. Throws TresError if it isn't one we can use. */
export function tilesetFromTres(sections: TresSection[], opts: TresImportOptions): { tileset: Json; warnings: string[] } {
  const warnings: string[] = [];
  const head = sections[0];
  if (head?.tag !== "gd_resource" || head.attrs.type !== "TileSet") throw new TresError("not a TileSet resource (expected [gd_resource type=\"TileSet\" ...])");
  if (head.attrs.format !== 3) throw new TresError(`format ${String(head.attrs.format)} isn't supported; save the TileSet from Godot 4 (format 3)`);
  const res = sectionOf(sections, "resource");
  if (!res) throw new TresError("no [resource] section");
  const shape = Number(res.props.get("tile_shape") ?? 0);
  if (shape !== 0) throw new TresError("only square tile shapes are supported (tile_shape 0)");
  const tileSize = pair(res.props.get("tile_size"), [16, 16]);
  if (tileSize[0] !== tileSize[1]) warnings.push(`tile_size ${tileSize.join("x")} isn't square; the board draws every tile square`);

  // Terrain sets.
  const setCount = 1 + Math.max(-1, ...[...res.props.keys()].map((k) => Number(/^terrain_set_(\d+)\//.exec(k)?.[1] ?? -1)));
  const terrainNames: string[][] = [];
  const terrainSets = Array.from({ length: setCount }, (_, si) => {
    const count = 1 + Math.max(-1, ...[...res.props.keys()].map((k) => Number(new RegExp(`^terrain_set_${si}/terrain_(\\d+)/`).exec(k)?.[1] ?? -1)));
    const seen = new Set<string>();
    const terrains = Array.from({ length: count }, (_, ti) => {
      let name = terrainId(String(res.props.get(`terrain_set_${si}/terrain_${ti}/name`) ?? ""), ti);
      while (seen.has(name)) name = `${name}_${ti}`;
      seen.add(name);
      return { name, color: hexColor(res.props.get(`terrain_set_${si}/terrain_${ti}/color`)) };
    });
    terrainNames[si] = terrains.map((t) => t.name);
    const mode = MODES[Number(res.props.get(`terrain_set_${si}/mode`) ?? 0)] ?? "cornersAndSides";
    return { mode, terrains };
  });
  if (setCount === 0) throw new TresError("the TileSet has no terrain sets, so there is nothing to autotile");

  // Sources.
  const sources: Json[] = [];
  let skippedNoTerrain = 0;
  for (const [key, v] of res.props) {
    const m = /^sources\/(\d+)$/.exec(key);
    if (!m) continue;
    const sourceId = Number(m[1]);
    const sub = sectionOf(sections, "sub_resource", refId(v, "SubResource"));
    if (!sub) {
      warnings.push(`source ${sourceId}: its sub_resource is missing`);
      continue;
    }
    if (sub.attrs.type !== "TileSetAtlasSource") {
      warnings.push(`source ${sourceId}: ${String(sub.attrs.type)} isn't supported (only atlas sources), skipped`);
      continue;
    }
    const tex = opts.textures.get(sourceId);
    if (!tex) {
      warnings.push(`source ${sourceId}: its texture wasn't found, skipped`);
      continue;
    }
    // Group "x:y/..." keys by tile.
    const tiles = new Map<string, Map<string, TresValue>>();
    for (const [k, val] of sub.props) {
      const t = /^(\d+):(\d+)\/(.+)$/.exec(k);
      if (!t) continue;
      const at = `${t[1]}:${t[2]}`;
      if (!tiles.has(at)) tiles.set(at, new Map());
      tiles.get(at)!.set(t[3]!, val);
    }
    const out: Json[] = [];
    let animated = 0;
    for (const [at, props] of tiles) {
      const [x, y] = at.split(":").map(Number) as [number, number];
      const size = pair(props.get("size_in_atlas"), [1, 1]);
      if (size[0] !== 1 || size[1] !== 1) {
        warnings.push(`tile ${at}: tiles bigger than one square (size_in_atlas ${size.join("x")}) aren't supported, skipped`);
        continue;
      }
      if (Number(props.get("animation_frames_count") ?? 1) > 1) animated++;
      const alts = [...props.keys()].filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
      for (const alt of alts) {
        const get = (name: string) => props.get(`${alt}/${name}`);
        const terrainSet = Number(get("terrain_set") ?? -1);
        const terrain = Number(get("terrain") ?? -1);
        const names = terrainNames[terrainSet];
        if (terrainSet < 0 || terrain < 0 || !names?.[terrain]) {
          skippedNoTerrain++;
          continue;
        }
        const peering: Partial<Record<PeeringBit, string>> = {};
        for (const bit of PEERING_BITS) {
          const n = Number(get(`terrains_peering_bit/${bit}`) ?? -1);
          if (n >= 0 && names[n]) peering[bit] = names[n];
        }
        const tile: Json = { atlas: [x, y] };
        if (get("flip_h") === true) tile.flipH = true;
        if (get("flip_v") === true) tile.flipV = true;
        if (get("transpose") === true) tile.transpose = true;
        if (terrainSet !== 0) tile.terrainSet = terrainSet;
        tile.terrain = names[terrain];
        tile.peering = peering;
        const probability = get("probability");
        if (probability !== undefined && Number(probability) !== 1) tile.probability = Number(probability);
        out.push(tile);
      }
    }
    if (animated) warnings.push(`source ${sourceId}: ${animated} animated tile(s) use their first frame only`);
    if (out.length === 0) {
      warnings.push(`source ${sourceId}: no tiles with a terrain, skipped`);
      continue;
    }
    const regionSize = pair(sub.props.get("texture_region_size"), tileSize);
    const margins = pair(sub.props.get("margins"), [0, 0]);
    const separation = pair(sub.props.get("separation"), [0, 0]);
    sources.push({
      id: sourceId,
      kind: "atlas",
      texture: tex.texture,
      textureSize: tex.size,
      regionSize,
      ...(margins[0] || margins[1] ? { margins } : {}),
      ...(separation[0] || separation[1] ? { separation } : {}),
      tiles: out,
    });
  }
  if (skippedNoTerrain) warnings.push(`${skippedNoTerrain} tile(s) have no terrain set and were left out (the board only draws terrain tiles)`);
  if (sources.length === 0) throw new TresError("no atlas source has tiles with a terrain");
  return { tileset: { id: opts.id, name: opts.name, tileSize: tileSize[0], terrainSets, sources }, warnings };
}
