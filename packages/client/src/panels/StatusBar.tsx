import type { Bar, ViewModel } from "@crawler/engine";
import s from "./chrome.module.css";

function Meter({ label, bar, color, width = 10 }: { label: string; bar: Bar | null; color: string; width?: number }) {
  if (!bar) return null;
  const pct = bar.max > 0 ? Math.max(0, Math.min(1, bar.current / bar.max)) : 0;
  const filled = Math.round(pct * width);
  return (
    <span className={s.meter} title={`${label} ${bar.current}/${bar.max}`}>
      <span className={s.meterLabel}>{label}</span>
      <span style={{ color }} aria-hidden>
        {"█".repeat(filled)}
        <span className={s.meterEmpty}>{"░".repeat(width - filled)}</span>
      </span>
      <span>
        {bar.current}/{bar.max}
      </span>
    </span>
  );
}

export function StatusBar({ view }: { view: ViewModel }) {
  const st = view.status;
  return (
    <header className={s.status} style={{ gridArea: "status" }}>
      <div className={s.statusLeft}>
        <span className={s.floor}>{st.floor ? `FLOOR ${st.floor}` : "PRE-SHOW"}</span>
        {st.room && <span>{st.room}</span>}
        {st.district && <span>District: {st.district}</span>}
        <span>Collapse: {st.timer ?? "—"}</span>
      </div>
      <div className={s.statusRight}>
        <Meter label="HP" bar={st.hp} color="var(--danger)" />
        <Meter label="MP" bar={st.mp} color="var(--mp)" />
        <Meter label={st.level ? `L${st.level}` : "XP"} bar={st.xp} color="var(--xp)" width={8} />
      </div>
    </header>
  );
}
