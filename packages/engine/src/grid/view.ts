/**
 * What the client needs to draw the arena, and the ASCII board `look` prints.
 * The engine decides every flag here (where you can move, what you can hit,
 * what tapping a tile does) so the client never re-implements a rule.
 */
import type { Content } from "../content/load";
import type { ArenaState, CombatState, Crawler, Enemy } from "../state";
import { derive } from "../rules/derived";
import { hasFlag } from "../rules/effects";
import {
  allTiles, columnLabels, coord, dist, exitAt, featureAt, hazardAt, index, occupied, pathField, reaches, same,
} from "./geometry";
import { speedOf } from "./units";
import { AP_COST, apNow } from "../rules/ap";
import type { FloorTheme, RangeBand } from "../content/schemas";
import { choiceArt, paintGround } from "../tiles/tileset";

export interface GridTileView {
  x: number;
  y: number;
  coord: string;
  /** The floor tile drawn under everything else on this square. */
  floor: FloorTileView;
  feature?: { id: string; name: string; kind: string; glyph: string };
  hazard?: { id: string; name: string; glyph: string; rounds?: number };
  exit?: { dir: string; entry: boolean };
  /** You can walk here with the AP you have left. */
  move?: true;
  /** AP walking here would spend (0 = already paid for). */
  moveAp?: number;
  /** Something you can hit from where you stand is on this tile. */
  attack?: true;
  /** The command a tap on this tile submits, if any. */
  tap?: string;
}

/** One square of floor art, picked by the tileset's autotiler. */
export interface FloorTileView {
  /** The PNG under public/, without ".png". Missing when the tileset has no tile for this terrain. */
  image?: string;
  /** Atlas tiles: the tile's pixel rectangle [x, y, w, h] in the sheet, and the sheet's size. */
  region?: [number, number, number, number];
  sheet?: [number, number];
  /** Godot's flips: transpose first (swap x and y), then flip_h / flip_v. */
  flipH?: true;
  flipV?: true;
  transpose?: true;
  /** The terrain shown, and its color: drawn under the art, and on its own until the art exists. */
  terrain?: string;
  color?: string;
}

export interface GridUnitView {
  id: string;
  kind: "crawler" | "enemy";
  x: number;
  y: number;
  /** Sprite name under combat/unit/. */
  sprite: string;
  glyph: string;
  label: string;
  mark?: string;
  hp: { current: number; max: number };
  tier?: string;
  /** Status names, for tooltips. */
  statuses: string[];
  /** Status ids, for icons (combat/status/<id>.png). */
  statusIds: string[];
}

export interface GridView {
  w: number;
  h: number;
  cols: string[];
  rows: string[];
  theme: string;
  /** Tiles already paid for this turn. */
  moveLeft: number;
  /** Tiles per AP. */
  speed: number;
  ap: number;
  apMax: number;
  tiles: GridTileView[];
  units: GridUnitView[];
  items: { x: number; y: number; coord: string; name: string; sprite: string }[];
}

/**
 * The floor art for every square (row-major): the arena's ground terrains,
 * autotiled with the floor theme's tileset. Squares with no ground on record
 * (older saves, test boards) are the theme's base terrain.
 */
export function floorTiles(a: ArenaState, theme: FloorTheme | undefined, content: Content): FloorTileView[] {
  const ts = theme?.arena.tileset ? content.tilesets.byId[theme.arena.tileset] : undefined;
  if (!ts) return new Array<FloorTileView>(a.w * a.h).fill({});
  const setIndex = theme?.arena.ground?.terrainSet ?? 0;
  const set = ts.terrainSets[setIndex]!;
  const base = theme?.arena.ground?.base ?? set.terrains[0]!.name;
  const terrain = a.ground && a.ground.length === a.w * a.h ? a.ground : new Array<string>(a.w * a.h).fill(base);
  const colors = new Map(set.terrains.map((t) => [t.name, t.color]));
  return paintGround(ts, setIndex, { w: a.w, h: a.h, terrain }, a.lookSeed ?? 0).map((c, i) => {
    const color = colors.get(terrain[i]!);
    if (!c) return { terrain: terrain[i]!, ...(color ? { color } : {}) };
    return {
      ...choiceArt(c),
      ...(c.flip.flipH ? { flipH: true as const } : {}),
      ...(c.flip.flipV ? { flipV: true as const } : {}),
      ...(c.flip.transpose ? { transpose: true as const } : {}),
      terrain: c.terrain,
      ...(colors.get(c.terrain) ? { color: colors.get(c.terrain)! } : {}),
    };
  });
}

function enemyGlyph(content: Content, e: Enemy): string {
  const g = content.enemies.byId[e.familyId]?.glyph ?? content.bosses.byId[e.familyId]?.family?.glyph ?? e.name[0] ?? "?";
  return e.tier === "elite" || e.tier === "boss" ? g.toUpperCase() : g.toLowerCase();
}

export function gridView(combat: CombatState, crawler: Crawler, themeId: string, content: Content, weaponReach: RangeBand): GridView | undefined {
  const a = combat.arena;
  if (!a) return undefined;
  const theme = content.floors.byId[themeId];
  const floors = floorTiles(a, theme, content);
  const field = pathField(a, content, a.crawler, { blocked: (p) => occupied(combat, p, "crawler") });
  // Before your first command of the round, the whole turn's AP is still ahead of you.
  const speed = speedOf(crawler, content);
  const { ap, max: apMax } = apNow(combat, crawler, content);
  const moveLeft = combat.turnBegun ? a.moveLeft : 0;
  const reach = moveLeft + ap * AP_COST.move * speed;
  const live = combat.enemies.filter((e) => e.hp > 0 && e.pos);
  const tiles: GridTileView[] = allTiles(a).map((p) => {
    const t: GridTileView = { x: p.x, y: p.y, coord: coord(p), floor: floors[index(a, p)]! };
    const f = featureAt(a, content, p);
    if (f) t.feature = { id: f.id, name: f.name, kind: f.kind, glyph: f.glyph };
    const hz = hazardAt(a, p);
    const hd = hz ? content.arenaFeatures.byId[hz.id] : undefined;
    if (hz && hd) t.hazard = { id: hd.id, name: hd.name, glyph: hd.glyph, ...(hz.rounds !== undefined ? { rounds: hz.rounds } : {}) };
    const x = exitAt(a, p);
    if (x) t.exit = { dir: x.dir, entry: x.entry };
    const cost = field.cost[index(a, p)]!;
    if (cost > 0 && cost <= reach) {
      t.move = true;
      t.moveAp = Math.max(0, Math.ceil((cost - moveLeft) / speed)) * AP_COST.move;
    }
    const foe = live.find((e) => same(e.pos!, p));
    if (foe) {
      if (reaches(a, content, a.crawler, p, weaponReach) && !hasFlag(foe.statuses, content, "untargetable")) t.attack = true;
      t.tap = `attack ${t.coord}`;
    } else if (same(p, a.crawler) && x) {
      t.tap = "flee";
    } else if (a.items.some((it) => same(it, p)) && dist(p, a.crawler) <= 1 && reach > 0) {
      t.tap = `take ${a.items.find((it) => same(it, p))!.item.name.toLowerCase()}`;
    } else if (same(p, a.crawler)) {
      // standing still: nothing to tap
    } else if (t.move) {
      t.tap = `move ${t.coord}`;
    }
    return t;
  });
  const d = derive(crawler, content);
  const units: GridUnitView[] = [{
    id: "crawler", kind: "crawler", x: a.crawler.x, y: a.crawler.y, sprite: "crawler", glyph: "@",
    label: crawler.name, hp: { current: crawler.hp, max: d.maxHP },
    statuses: crawler.statuses.map((s) => content.statusEffects.byId[s.id]?.name ?? s.id),
    statusIds: crawler.statuses.map((s) => s.id),
  }];
  for (const e of live) {
    units.push({
      id: e.uid, kind: "enemy", x: e.pos!.x, y: e.pos!.y, sprite: e.familyId, glyph: enemyGlyph(content, e),
      label: e.name, ...(e.mark ? { mark: e.mark } : {}), hp: { current: e.hp, max: e.maxHP }, tier: e.tier,
      statuses: e.statuses.map((s) => content.statusEffects.byId[s.id]?.name ?? s.id),
      statusIds: e.statuses.map((s) => s.id),
    });
  }
  return {
    w: a.w,
    h: a.h,
    cols: columnLabels(a.w),
    rows: Array.from({ length: a.h }, (_, i) => String(i + 1)),
    theme: themeId,
    moveLeft,
    speed,
    ap,
    apMax,
    tiles,
    units,
    items: a.items.map((it) => ({ x: it.x, y: it.y, coord: coord(it), name: it.item.name, sprite: it.item.baseId })),
  };
}

/**
 * The board as text: `@` you, enemy glyphs (capitals are elites), feature and
 * hazard glyphs, `+` doors, `$` loose items, `.` floor. Also the fixture format
 * for tests and a compact view to hand the Milestone 10 boss.
 */
export function renderArena(combat: CombatState, content: Content): string[] {
  const a = combat.arena;
  if (!a) return [];
  const lines = [`   ${columnLabels(a.w).join(" ")}`];
  for (let y = 0; y < a.h; y++) {
    const row: string[] = [];
    for (let x = 0; x < a.w; x++) {
      const p = { x, y };
      const foe = combat.enemies.find((e) => e.hp > 0 && e.pos && same(e.pos, p));
      const h = hazardAt(a, p);
      const f = featureAt(a, content, p);
      row.push(
        same(a.crawler, p) ? "@"
          : foe ? enemyGlyph(content, foe)
          : f ? f.glyph
          : h ? content.arenaFeatures.byId[h.id]?.glyph ?? "?"
          : a.items.some((it) => same(it, p)) ? "$"
          : exitAt(a, p) ? "+"
          : ".",
      );
    }
    lines.push(`${String(y + 1).padStart(2)} ${row.join(" ")}`);
  }
  return lines;
}
