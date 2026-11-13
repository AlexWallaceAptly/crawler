import type { GameEvent } from "@crawler/engine";
import s from "./chrome.module.css";

function text(e: GameEvent): string {
  switch (e.type) {
    case "died":
      return `CRAWLER DOWN — ${e.cause}`;
    case "timerWarning":
      return `⚠ ${e.label} — floor collapse incoming`;
    case "floorCleared":
      return `FLOOR ${e.floor} CLEARED`;
    case "narration":
    case "info":
    case "error":
      return e.text;
    default:
      return e.type;
  }
}

/** Achievements and timer warnings as they fire. Shows the latest one. */
export function Ticker({ events }: { events: GameEvent[] }) {
  const last = events[events.length - 1];
  return (
    <div className={s.ticker} style={{ gridArea: "ticker" }} role="status">
      <span className={s.tickerLabel}>SYSTEM AI</span>
      {last ? <span className={s.tickerText}>{text(last)}</span> : <span className={s.tickerIdle}>is watching. Always watching.</span>}
    </div>
  );
}
