import type { MapCell, ViewModel } from "@crawler/engine";
import { Sprite } from "./Sprite";
import s from "./minimapgrid.module.css";

/** ASCII glyph per tile, used until (or if) the PNG is missing. */
const GLYPH: Record<string, string> = {
  corridor: "·", chamber: "□", empty: "·", lair: "☠", trap: "^", treasure: "$", puzzle: "#",
  event: "!", npc: "☺", safe: "S", stairwell: ">", unknown: "?", workshop: "⚒",
};

function Tile({ name, fallback, className }: { name: string; fallback?: string; className?: string }) {
  const glyph = name === "player" ? "@" : (GLYPH[fallback ?? name] ?? "·");
  const paths = [`tiles/${name}`, ...(fallback && fallback !== name ? [`tiles/${fallback}`] : [])];
  return <Sprite paths={paths} glyph={glyph} className={`${s.img} ${className ?? ""}`} glyphClassName={`${s.glyph} ${className ?? ""}`} />;
}

function Cell({ c }: { c: MapCell }) {
  const tile = c.kind === "trap" && c.trapSprung ? "trap-sprung" : c.kind;
  return (
    <div className={`${s.cell} ${c.visited ? "" : s.fogged}`} style={{ gridColumn: c.x + 1, gridRow: c.y + 1 }} title={c.kind}>
      {c.exits.north && <i className={`${s.link} ${s.n}`} />}
      {c.exits.east && <i className={`${s.link} ${s.e}`} />}
      {c.exits.south && <i className={`${s.link} ${s.sx}`} />}
      {c.exits.west && <i className={`${s.link} ${s.w}`} />}
      <Tile name={tile} fallback={c.kind} />
      {c.current && <Tile name="player" className={s.player} />}
    </div>
  );
}

export function MiniMapGrid({ view, className }: { view: ViewModel; className?: string }) {
  const g = view.mapGrid;
  if (!g) return null;
  return (
    <div
      className={`${s.grid} ${className ?? ""}`}
      style={{ gridTemplateColumns: `repeat(${g.width}, var(--tile))`, gridTemplateRows: `repeat(${g.height}, var(--tile))` }}
      role="img"
      aria-label="Map"
    >
      {g.cells.map((c) => (
        <Cell key={`${c.x},${c.y}`} c={c} />
      ))}
    </div>
  );
}
