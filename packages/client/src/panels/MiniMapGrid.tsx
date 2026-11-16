import { useState } from "react";
import type { MapCell, ViewModel } from "@crawler/engine";
import s from "./minimapgrid.module.css";

/** ASCII glyph per tile, used until (or if) the PNG is missing. */
const GLYPH: Record<string, string> = {
  corridor: "·", chamber: "□", empty: "·", lair: "☠", trap: "^", treasure: "$", puzzle: "#",
  event: "!", npc: "☺", safe: "S", stairwell: ">", unknown: "?",
};

const src = (name: string) => `${import.meta.env.BASE_URL}tiles/${name}.png`;

function Tile({ name, className }: { name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className={`${s.glyph} ${className ?? ""}`}>{name === "player" ? "@" : (GLYPH[name] ?? "·")}</span>;
  }
  return <img className={`${s.img} ${className ?? ""}`} src={src(name)} alt="" draggable={false} onError={() => setFailed(true)} />;
}

function Cell({ c }: { c: MapCell }) {
  const tile = c.kind === "trap" && c.trapSprung ? "trap-sprung" : c.kind;
  return (
    <div className={`${s.cell} ${c.visited ? "" : s.fogged}`} style={{ gridColumn: c.x + 1, gridRow: c.y + 1 }} title={c.kind}>
      {c.exits.north && <i className={`${s.link} ${s.n}`} />}
      {c.exits.east && <i className={`${s.link} ${s.e}`} />}
      {c.exits.south && <i className={`${s.link} ${s.sx}`} />}
      {c.exits.west && <i className={`${s.link} ${s.w}`} />}
      <TileWithFallback name={tile} fallback={c.kind} />
      {c.current && <Tile name="player" className={s.player} />}
    </div>
  );
}

/** trap-sprung is optional art: fall back to the plain trap tile, then the glyph. */
function TileWithFallback({ name, fallback }: { name: string; fallback: string }) {
  const [useFallback, setUseFallback] = useState(false);
  if (name !== fallback && !useFallback) {
    return <img className={s.img} src={src(name)} alt="" draggable={false} onError={() => setUseFallback(true)} />;
  }
  return <Tile name={fallback} />;
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
