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

/** Sides of a cell that face a known room in another district (Milestone 9). */
type Edges = { north: boolean; east: boolean; south: boolean; west: boolean };

function Cell({ c, edges }: { c: MapCell; edges?: Edges }) {
  const tile = c.kind === "trap" && c.trapSprung ? "trap-sprung" : c.kind;
  return (
    <div className={`${s.cell} ${c.visited ? "" : s.fogged}`} style={{ gridColumn: c.x + 1, gridRow: c.y + 1 }} title={c.kind}>
      {edges?.north && <i className={`${s.edge} ${s.edgeN}`} />}
      {edges?.east && <i className={`${s.edge} ${s.edgeE}`} />}
      {edges?.south && <i className={`${s.edge} ${s.edgeS}`} />}
      {edges?.west && <i className={`${s.edge} ${s.edgeW}`} />}
      {c.exits.north && <i className={`${s.link} ${s.n}`} />}
      {c.exits.east && <i className={`${s.link} ${s.e}`} />}
      {c.exits.south && <i className={`${s.link} ${s.sx}`} />}
      {c.exits.west && <i className={`${s.link} ${s.w}`} />}
      <Tile name={tile} fallback={c.kind} />
      {c.boss && <span className={s.boss} aria-label="boss">!</span>}
      {c.current && <Tile name="player" className={s.player} />}
    </div>
  );
}

type MoveDir = "north" | "east" | "south" | "west";
const STEP: Record<MoveDir, { dx: number; dy: number; glyph: string; cls: string }> = {
  north: { dx: 0, dy: -1, glyph: "▲", cls: s.goN! },
  east: { dx: 1, dy: 0, glyph: "▶", cls: s.goE! },
  south: { dx: 0, dy: 1, glyph: "▼", cls: s.goS! },
  west: { dx: -1, dy: 0, glyph: "◀", cls: s.goW! },
};

interface Props {
  view: ViewModel;
  className?: string;
  /** Walkable directions from the current room: draws a tappable arrow on each neighbouring cell. */
  moves?: Partial<Record<MoveDir, () => void>>;
  /** CSS length for one tile, when the default is too small to tap. */
  tile?: string;
}

export function MiniMapGrid({ view, className, moves, tile }: Props) {
  const g = view.mapGrid;
  if (!g) return null;
  const here = g.cells.find((c) => c.current);
  const arrows = here && moves ? (Object.keys(STEP) as MoveDir[]).filter((d) => moves[d]) : [];
  // A dashed line where two known rooms side by side belong to different districts.
  const districtAt = new Map(g.cells.map((c) => [`${c.x},${c.y}`, c.district]));
  const differs = (c: MapCell, dx: number, dy: number) => {
    const other = districtAt.get(`${c.x + dx},${c.y + dy}`);
    return other !== undefined && other !== c.district;
  };
  const edgesOf = (c: MapCell): Edges => ({ north: differs(c, 0, -1), east: differs(c, 1, 0), south: differs(c, 0, 1), west: differs(c, -1, 0) });
  return (
    <div
      className={`${s.grid} ${className ?? ""}`}
      style={{
        gridTemplateColumns: `repeat(${g.width}, var(--tile))`,
        gridTemplateRows: `repeat(${g.height}, var(--tile))`,
        ...(tile ? { ["--tile" as string]: tile } : {}),
      }}
      role={moves ? "group" : "img"}
      aria-label="Map"
    >
      {g.cells.map((c) => (
        <Cell key={`${c.x},${c.y}`} c={c} edges={edgesOf(c)} />
      ))}
      {arrows.map((d) => {
        const st = STEP[d];
        return (
          <button
            key={d}
            className={`${s.go} ${st.cls}`}
            style={{ gridColumn: here!.x + st.dx + 1, gridRow: here!.y + st.dy + 1 }}
            aria-label={`Go ${d}`}
            onClick={moves![d]}
          >
            <span className={s.goArrow}>{st.glyph}</span>
          </button>
        );
      })}
    </div>
  );
}
