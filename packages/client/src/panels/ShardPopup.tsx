import { useEffect, useRef, useState } from "react";
import type { GameEvent, Phase } from "@crawler/engine";
import s from "./shard.module.css";

type ShardEvent = Extract<GameEvent, { type: "shardVoice" | "shardFound" }>;

const isShard = (e: GameEvent): e is ShardEvent => e.type === "shardVoice" || e.type === "shardFound";

/**
 * A shard turning up interrupts you: first the faint voice (search to find it), then the
 * thing that speaks, its words and Echo's reaction. Only events that arrive while the
 * page is open pop up; a reload doesn't replay old ones.
 */
export function ShardPopup({ log, phase, submit }: { log: readonly GameEvent[]; phase: Phase; submit: (t: string) => void }) {
  const seen = useRef<number>(log.length ? log[log.length - 1]!.id : 0);
  const [queue, setQueue] = useState<ShardEvent[]>([]);

  useEffect(() => {
    const fresh = log.filter((e) => e.id > seen.current);
    if (log.length) seen.current = Math.max(seen.current, log[log.length - 1]!.id);
    const shards = fresh.filter(isShard);
    if (shards.length) setQueue((q) => [...q, ...shards]);
  }, [log]);

  const e = queue[0];
  const close = () => setQueue((q) => q.slice(1));

  useEffect(() => {
    if (!e) return;
    const onKey = (k: KeyboardEvent) => {
      if (k.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [e]);

  if (!e) return null;

  if (e.type === "shardVoice") {
    const canSearch = phase === "exploring";
    return (
      <div className={s.backdrop} onClick={close}>
        <div className={s.card} role="dialog" aria-modal="true" aria-labelledby="shard-title" onClick={(ev) => ev.stopPropagation()}>
          <div id="shard-title" className={s.title}>◇ A faint voice</div>
          <p className={s.body}>{e.text}</p>
          <p className={s.hint}>{canSearch ? "Search the room to find what's talking." : "Once it's quiet, search the room to find what's talking."}</p>
          <div className={s.actions}>
            <button className={s.secondary} onClick={close}>Not now</button>
            {canSearch && (
              <button className={s.primary} autoFocus onClick={() => { close(); submit("search"); }}>Search (15 min)</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const boss = e.delivery === "boss";
  return (
    <div className={s.backdrop} onClick={close}>
      <div className={s.card} role="dialog" aria-modal="true" aria-labelledby="shard-title" onClick={(ev) => ev.stopPropagation()}>
        <div id="shard-title" className={s.title}>◆ {boss ? "Echo heard that" : "It speaks to you"}</div>
        <p className={s.body}>{boss ? `${e.speaker ?? "The boss"} says something Echo recognizes.` : e.intro}</p>
        <blockquote className={s.clue}>{e.clue}</blockquote>
        <div className={s.echo}>
          <span className={s.echoLabel}>ECHO ▸</span> {e.reaction}
        </div>
        <div className={s.meta}>Shard · {e.strand}{e.first ? " · new in the Codex" : ""}</div>
        <div className={s.actions}>
          <button className={s.primary} autoFocus onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}
