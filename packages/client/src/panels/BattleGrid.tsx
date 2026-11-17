/**
 * The grid-combat board. Everything here comes from view.combat.grid: the engine
 * decides which tiles you can walk to, what you can hit, and what each tap does.
 * Tapping submits command text, exactly like typing it.
 */
import type { CommandOption, GridTileView, GridUnitView, ViewModel } from "@crawler/engine";
import { Sprite } from "./Sprite";
import s from "./battlegrid.module.css";

interface Props {
  view: ViewModel;
  submit: (text: string) => void;
  /** A command waiting for a tile (throw, shove...), or null. */
  armed: CommandOption | null;
  onArmedDone: () => void;
  className?: string;
}

/** Small, low-contrast debris hazards get a dark outline so they read on stone. */
const OUTLINED_HAZARDS = new Set(["caltrops", "tacks", "broken_glass", "marbles", "barbed_wire", "rust_spikes", "trip_wire"]);

/** A highlight: the ui/ sprite if it exists, otherwise a CSS tint. */
function Highlight({ kind, faint }: { kind: "move" | "attack" | "target"; faint?: boolean }) {
  const css = kind === "move" ? s.hlMove : kind === "attack" ? s.hlAttack : s.hlTarget;
  return (
    <Sprite
      paths={[`combat/ui/${kind}`]}
      glyph=""
      className={`${s.overlay} ${kind === "move" ? s.overlayMove : kind === "target" ? s.overlayTarget : ""} ${faint ? s.faint : ""}`}
      fallback={<span className={`${s.hl} ${css} ${faint ? s.faint : ""}`} />}
    />
  );
}

function featureFolder(kind: string): string {
  return kind === "obstacle" ? "obstacle" : kind === "terrain" ? "terrain" : "hazard";
}

function tileTitle(t: GridTileView, unit?: GridUnitView, item?: string): string {
  const parts = [t.coord];
  if (unit) parts.push(`${unit.label} ${unit.hp.current}/${unit.hp.max}${unit.statuses.length ? ` (${unit.statuses.join(", ")})` : ""}`);
  if (t.feature) parts.push(t.feature.name);
  if (t.hazard) parts.push(`${t.hazard.name}${t.hazard.rounds !== undefined ? ` (${t.hazard.rounds})` : ""}`);
  if (item) parts.push(item);
  if (t.exit) parts.push(t.exit.entry ? "door (the way you came)" : `door (${t.exit.dir})`);
  if (t.move && !unit) parts.push(t.moveAp ? `${t.moveAp} AP to walk here` : "already paid for");
  return parts.join(" · ");
}

export function BattleGrid({ view, submit, armed, onArmedDone, className }: Props) {
  const g = view.combat?.grid;
  if (!g) return null;
  const units = new Map(g.units.map((u) => [`${u.x},${u.y}`, u]));
  const items = new Map(g.items.map((it) => [`${it.x},${it.y}`, it]));
  const armedTargets = new Set(armed?.targets ?? []);

  const tap = (t: GridTileView) => {
    if (armed) {
      if (armedTargets.has(t.coord)) submit(`${armed.input} ${t.coord}`);
      onArmedDone();
      return;
    }
    if (t.tap) submit(t.tap);
  };

  return (
    <div className={`${s.wrap} ${className ?? ""}`}>
      <div
        className={s.board}
        style={{
          gridTemplateColumns: `var(--label) repeat(${g.w}, var(--cell))`,
          gridTemplateRows: `var(--label) repeat(${g.h}, var(--cell))`,
          ["--cols" as string]: g.w,
          ["--rows" as string]: g.h,
        }}
        role="grid"
        aria-label="Battle board"
      >
        <span />
        {g.cols.map((c) => <span key={c} className={s.label}>{c}</span>)}
        {g.rows.map((r, y) => [
          <span key={`r${r}`} className={s.label}>{r}</span>,
          ...g.tiles.filter((t) => t.y === y).map((t) => {
            const u = units.get(`${t.x},${t.y}`);
            const it = items.get(`${t.x},${t.y}`);
            const target = armed ? armedTargets.has(t.coord) : false;
            const cls = [
              s.cell,
              armed && !target ? s.dimmed : "",
              t.tap || target ? s.tappable : "",
            ].join(" ");
            return (
              <button
                key={t.coord}
                className={cls}
                title={tileTitle(t, u, it?.name)}
                onClick={() => tap(t)}
                aria-label={tileTitle(t, u, it?.name)}
              >
                <Sprite paths={[`combat/floor/${t.floor}`, `combat/floor/${g.theme}_1`]} glyph="" className={s.floor} />
                {t.exit && <Sprite paths={["combat/floor/door"]} glyph="+" className={s.layer} glyphClassName={`${s.glyph} ${s.door}`} />}
                {t.feature && (
                  <Sprite paths={[`combat/${featureFolder(t.feature.kind)}/${t.feature.id}`]} glyph={t.feature.glyph}
                    className={s.layer} glyphClassName={`${s.glyph} ${s.feature}`} />
                )}
                {t.hazard && (
                  <Sprite paths={[`combat/hazard/${t.hazard.id}`]} glyph={t.hazard.glyph}
                    className={`${s.layer} ${OUTLINED_HAZARDS.has(t.hazard.id) ? s.outlined : ""}`}
                    glyphClassName={`${s.glyph} ${s.hazard}`} />
                )}
                {it && !u && (
                  <Sprite paths={[`combat/item/${it.sprite}`, "combat/item/junk_pile"]} glyph="$"
                    className={`${s.layer} ${s.item}`} glyphClassName={`${s.glyph} ${s.itemGlyph}`} />
                )}
                {u && <Unit u={u} />}
                {!armed && t.move && <Highlight kind="move" faint={(t.moveAp ?? 0) > 1} />}
                {!armed && t.attack && <Highlight kind="attack" />}
                {target && <Highlight kind="target" />}
              </button>
            );
          }),
        ])}
      </div>
      <div className={s.hint}>
        {armed
          ? <>Pick a highlighted tile for <b>{armed.label}</b> — or tap anywhere else to cancel.</>
          : <>AP {g.ap}/{g.apMax} · 1 AP walks {g.speed} tiles{g.moveLeft > 0 ? ` (${g.moveLeft} already paid for)` : ""} · tap a tile to walk, an enemy to attack ({view.combat?.attackCost ?? 2} AP), your door to flee.</>}
      </div>
    </div>
  );
}

function Unit({ u }: { u: GridUnitView }) {
  const pct = Math.max(0, Math.min(1, u.hp.current / u.hp.max));
  return (
    <span className={`${s.unit} ${u.kind === "crawler" ? s.you : s.foe} ${u.tier === "elite" ? s.elite : ""}`}>
      <Sprite
        paths={[`combat/unit/${u.sprite}`]}
        glyph={u.glyph}
        className={s.unitImg}
        glyphClassName={`${s.glyph} ${s.unitGlyph}`}
      />
      {u.kind === "crawler" && <span className={s.ring} />}
      {u.mark && <span className={s.mark}>{u.mark}</span>}
      {u.statusIds.length > 0 && (
        <span className={s.statusIcons}>
          {u.statusIds.slice(0, 2).map((id, i) => (
            <Sprite
              key={id}
              paths={[`combat/status/${id}`]}
              glyph={(u.statuses[i] ?? id).charAt(0).toUpperCase()}
              className={s.statusIcon}
              glyphClassName={s.statusGlyph}
            />
          ))}
          {u.statusIds.length > 2 && <span className={s.statusMore}>+{u.statusIds.length - 2}</span>}
        </span>
      )}
      <span className={s.hp}><span style={{ width: `${pct * 100}%` }} className={pct < 0.35 ? s.hpLow : s.hpOk} /></span>
    </span>
  );
}
