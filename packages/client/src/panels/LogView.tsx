import { useEffect, useRef } from "react";
import type { GameEvent, ViewModel } from "@crawler/engine";
import s from "./panels.module.css";

/** Action points as pips: filled ones are still yours to spend this turn. */
export function ApPips({ ap, max }: { ap: number; max: number }) {
  const total = Math.max(ap, max);
  return (
    <span className={s.ap} title={`${ap} of ${max} action points left this turn`} aria-label={`${ap} of ${max} action points`}>
      <span className={s.apLabel}>AP</span>
      {Array.from({ length: total }, (_, i) => <span key={i} className={i < ap ? s.apOn : s.apOff} />)}
      <span className={s.apCount}>{ap}/{max}</span>
    </span>
  );
}

/** Live enemy readout pinned above the battle log, led by your AP. */
export function EnemyStrip({ view }: { view: ViewModel }) {
  if (!view.combat || view.combat.enemies.length === 0) return null;
  return (
    <div className={s.enemyStrip}>
      <ApPips ap={view.combat.ap.current} max={view.combat.ap.max} />
      {view.combat.enemies.map((e) => (
        <span key={e.uid}>
          <span className={e.elite ? s.enemyElite : s.enemyName}>{e.name}</span>{" "}
          <span className={s.enemyMeta}>
            {e.hp.current}/{e.hp.max} · {e.at ? `${e.at} ${e.range}` : e.range}
            {e.statuses.length > 0 && ` · ${e.statuses.join(", ")}`}
          </span>
        </span>
      ))}
    </div>
  );
}

function Line({ e }: { e: GameEvent }) {
  switch (e.type) {
    case "command":
      return <div className={`${s.line} ${s.cmd}`}>{e.text}</div>;
    case "narration":
      return <div className={`${s.line} ${e.voice === "system" ? s.system : e.voice === "echo" ? s.echo : s.narrator}`}>{e.text}</div>;
    case "info":
      return (
        <div className={`${s.line} ${s.info}`}>
          {e.text}
          {e.lines && <pre>{e.lines.join("\n")}</pre>}
        </div>
      );
    case "error":
      return <div className={`${s.line} ${s.err}`}>{e.text}</div>;
    case "check":
      return <div className={`${s.line} ${s.check}`}>{e.text}</div>;
    case "crawlerCreated":
      return <div className={`${s.line} ${s.divider}`}>── NEW CRAWLER: {e.name} ──</div>;
    case "roomEntered":
      return (
        <div className={`${s.line} ${s.room}`}>
          <div className={s.roomName}>
            ▌{e.name.toUpperCase()}
            {e.badge && <span className={s.roomBadge}> [{e.badge}]</span>}
          </div>
          {e.lines.map((l, i) => (
            <div key={i} className={s.narrator}>{l}</div>
          ))}
          {e.items && e.items.length > 0 && <div className={s.loot}>On the floor: {e.items.join(", ")}.</div>}
          {e.workbench && <div className={s.bench}>⚒ There's a workbench here: open the workbench (Inventory on desktop, the ⚒ button on a phone), tap things, hit Combine. Or type <i>combine bat tacks tape</i>.</div>}
          <div className={s.exits}>Exits: {e.exits.length ? e.exits.join(", ") : "none"}.</div>
        </div>
      );
    case "floorCleared":
      return <div className={`${s.line} ${s.divider}`}>── FLOOR {e.floor} CLEARED ──</div>;
    case "combatStarted":
      return <div className={`${s.line} ${s.divider}`}>── COMBAT: {e.names.join(", ")} ──</div>;
    case "combatLine":
      return (
        <div className={`${s.line} ${e.actor === "you" ? s.fightYou : e.actor === "enemy" ? s.fightEnemy : s.fightStatus}`}>
          {e.text}
        </div>
      );
    case "combatEnded":
      return (
        <div className={`${s.line} ${s.divider}`}>
          ── {e.outcome === "victory" ? `VICTORY${e.xp ? ` (+${e.xp} XP)` : ""}` : e.outcome === "fled" ? "ESCAPED" : "TALKED DOWN"} ──
        </div>
      );
    case "died":
      return <div className={`${s.line} ${s.death}`}>── DEAD ({e.cause}) ──</div>;
    case "recipeLearned":
      return <div className={`${s.line} ${s.divider}`}>── NEW RECIPE: {e.name} ──</div>;
    case "shardFound":
      return <div className={`${s.line} ${s.shard}`}>◆ SHARD · {e.strand}{e.first ? " · new in the Codex" : ""}</div>;
    case "codexUpdated":
      return (
        <div className={`${s.line} ${s.codexNote}`}>
          ❖ Codex: {e.entry}{e.kind === "unlocked" ? " (new entry)" : e.kind === "line" ? " (another line)" : ""}
        </div>
      );
    case "temperChanged":
      return (
        <div className={`${s.line} ${s.temperNote}`}>
          Temper {e.delta > 0 ? `+${e.delta} (Fed)` : `${e.delta} (Calm)`} → {e.temper > 0 ? "+" : ""}{e.temper}
        </div>
      );
    case "moduleBuilt":
      return <div className={`${s.line} ${s.divider}`}>── ECHO MODULE: {e.name} ──</div>;
    case "floorEntered":
      return <div className={`${s.line} ${s.divider}`}>── FLOOR {e.floor}: {e.name.toUpperCase()} ──</div>;
    default:
      return null;
  }
}

/** Scrolling log; sticks to the bottom unless the reader has scrolled up. */
export function LogView({ events, tail }: { events: GameEvent[]; tail?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const shown = tail ? events.slice(-tail) : events;

  useEffect(() => {
    const el = ref.current?.parentElement;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown.length, shown[shown.length - 1]?.id]);

  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div ref={ref} className={s.log} role="log" aria-live="polite">
      {shown.map((e) => (
        <Line key={e.id} e={e} />
      ))}
    </div>
  );
}
