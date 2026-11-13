import { useEffect, useRef } from "react";
import type { GameEvent } from "@crawler/engine";
import s from "./panels.module.css";

function Line({ e }: { e: GameEvent }) {
  switch (e.type) {
    case "command":
      return <div className={`${s.line} ${s.cmd}`}>{e.text}</div>;
    case "narration":
      return <div className={`${s.line} ${e.voice === "system" ? s.system : s.narrator}`}>{e.text}</div>;
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
    case "died":
      return <div className={`${s.line} ${s.death}`}>── DEAD ({e.cause}) ──</div>;
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
