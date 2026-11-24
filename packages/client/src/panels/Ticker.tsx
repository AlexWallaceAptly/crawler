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
    case "recipeLearned":
      return `⚒ NEW RECIPE — ${e.name}`;
    case "shardVoice":
      return `◇ A FAINT VOICE — ${e.room}`;
    case "shardFound":
      return `◆ SHARD — ${e.strand}${e.first ? " (new)" : ""}`;
    case "codexUpdated":
      return `❖ CODEX — ${e.entry}`;
    case "moduleBuilt":
      return `ECHO MODULE — ${e.name}`;
    case "floorEntered":
      return `FLOOR ${e.floor} — ${e.name}`;
    case "achievementEarned":
      return `🏆 ${e.name} — ${e.text}`;
    case "boxEarned":
      return `▣ ${e.tier.toUpperCase()} BOX — opens in a safe room`;
    case "boxOpened":
      return `▣ ${e.tier.toUpperCase()} BOX OPENED — ${e.contents.length} thing${e.contents.length === 1 ? "" : "s"}`;
    case "levelUp":
      return `★ LEVEL ${e.level} — ${e.unspent} stat points to spend`;
    case "skillUp":
      return `▲ ${e.name} ${e.rank}${e.perkName ? ` — ${e.perkName}` : ""}`;
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
