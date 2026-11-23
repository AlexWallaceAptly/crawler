import { useEffect, useRef, useState } from "react";
import type { GameEvent, Stat, ViewModel } from "@crawler/engine";
import s from "./levelup.module.css";

type LevelEvent = Extract<GameEvent, { type: "levelUp" }>;
type MilestoneEvent = Extract<GameEvent, { type: "skillUp" }> & { perk: string };
type Card = LevelEvent | MilestoneEvent;

const isCard = (e: GameEvent): e is Card => e.type === "levelUp" || (e.type === "skillUp" && !!e.perk);

/** What a point in each stat buys, in one line. */
const STAT_TEXT: Record<Stat, string> = {
  STR: "melee rolls and damage, carry weight",
  DEX: "ranged and finesse rolls, initiative, fleeing",
  CON: "+3 max HP a point, HP back per room",
  INT: "MP, traps, crafting checks",
  CHA: "talking things down",
};

/**
 * Leveling up and skill milestones interrupt you: a level shows the stat points to spend
 * (each + sends `raise STR`), and every 5th rank of a skill shows the perk it unlocked.
 * Only events that arrive while the page is open pop up; a reload doesn't replay them.
 */
export function LevelUpPopup({ log, view, submit }: { log: readonly GameEvent[]; view: ViewModel; submit: (t: string) => void }) {
  const seen = useRef<number>(log.length ? log[log.length - 1]!.id : 0);
  const [queue, setQueue] = useState<Card[]>([]);

  useEffect(() => {
    const fresh = log.filter((e) => e.id > seen.current);
    if (log.length) seen.current = Math.max(seen.current, log[log.length - 1]!.id);
    const cards = fresh.filter(isCard);
    if (!cards.length) return;
    setQueue((q) => {
      // Two levels at once read as one card: the newest level, with all the points.
      const out = [...q];
      for (const c of cards) {
        const last = out[out.length - 1];
        if (c.type === "levelUp" && last?.type === "levelUp") out[out.length - 1] = c;
        else out.push(c);
      }
      return out;
    });
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

  if (e.type === "skillUp") {
    return (
      <div className={s.backdrop} onClick={close}>
        <div className={s.card} role="dialog" aria-modal="true" aria-labelledby="lvl-title" onClick={(ev) => ev.stopPropagation()}>
          <div id="lvl-title" className={s.title}>▲ {e.name} {e.rank}</div>
          <div className={s.perk}>{e.perkName}</div>
          <p className={s.body}>{e.perk}</p>
          {e.nextPerk && <p className={s.hint}>Next: rank {e.nextPerk.rank}, {e.nextPerk.name}. Keep using it.</p>}
          <div className={s.actions}>
            <button className={s.primary} autoFocus onClick={close}>Nice</button>
          </div>
        </div>
      </div>
    );
  }

  const ch = view.character;
  const points = ch?.unspentStatPoints ?? 0;
  const fighting = view.phase === "combat";
  return (
    <div className={s.backdrop} onClick={close}>
      <div className={s.card} role="dialog" aria-modal="true" aria-labelledby="lvl-title" onClick={(ev) => ev.stopPropagation()}>
        <div id="lvl-title" className={s.title}>★ Level {e.level}</div>
        <p className={s.body}>
          Full heal. {points > 0
            ? <>You have <b className={s.points}>{points} stat point{points === 1 ? "" : "s"}</b> to spend.</>
            : "All your points are spent."}
          <span className={s.hint}> {e.next} XP to level {e.level + 1}.</span>
        </p>
        {fighting && points > 0 && <p className={s.hint}>Finish the fight first, then spend them here or on your character sheet.</p>}
        {ch && (
          <ul className={s.stats}>
            {ch.stats.map((st) => (
              <li key={st.stat} className={s.stat}>
                <span className={s.statName}>{st.stat}</span>
                <span className={s.statValue}>{st.value}</span>
                <span className={s.statText}>{STAT_TEXT[st.stat]}</span>
                <button
                  className={s.plus}
                  disabled={points <= 0 || fighting}
                  aria-label={`Raise ${st.stat}`}
                  onClick={() => submit(`raise ${st.stat}`)}
                >
                  +
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className={s.actions}>
          {points > 0 && <button className={s.secondary} onClick={close}>Later</button>}
          <button className={s.primary} autoFocus={points <= 0} onClick={close}>{points > 0 ? "Close" : "Done"}</button>
        </div>
      </div>
    </div>
  );
}
