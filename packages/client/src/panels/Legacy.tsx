/**
 * Milestone 8: the end of a run (the legacy tally and the bequest pick) and the unlock shop.
 * Everything renders from `view.runEnd` and `view.account`; every button submits a command.
 */
import type { ViewModel } from "@crawler/engine";
import s from "./panels.module.css";

const rarityClass = (r: string) => s[r] ?? s.common;

const KIND_LABELS: [string, string][] = [["reroll", "Rerolls"], ["pool", "Backstory pools"], ["kit", "Starting kits"]];

/** Rerolls, backstory pools and starting kits, with buy buttons (between runs only) and the kit pick. */
export function UnlocksSheet({ view, submit }: { view: ViewModel; submit: (t: string) => void }) {
  const a = view.account;
  const between = view.phase === "dead" || view.phase === "creation";
  return (
    <div>
      <div className={s.sub}>
        {a.legacyPoints} legacy point{a.legacyPoints === 1 ? "" : "s"} to spend ({a.legacyEarned} earned in all).{" "}
        {between ? "Unlocks last for every crawler after this one." : "You can buy between runs: after a death, or while making a crawler."}
      </div>
      {KIND_LABELS.map(([kind, label]) => {
        const list = a.unlocks.filter((u) => u.kind === kind);
        if (!list.length) return null;
        return (
          <div key={kind}>
            <div className={s.sectionLabel}>{label}</div>
            <ul className={s.list}>
              {list.map((u) => {
                const taking = u.kind === "kit" && a.kit.current === u.name;
                return (
                  <li key={u.id} className={s.codexEntry}>
                    <span className={u.owned && !u.repeatable ? s.codexName : undefined}>{u.name}</span>
                    <span className={s.sub}>
                      {" · "}{u.owned && !u.repeatable ? "owned" : `${u.cost} pts`}
                      {u.kind === "reroll" ? ` · you have ${a.rerolls}` : ""}
                      {taking ? " · your next crawler takes this" : ""}
                    </span>{" "}
                    {(u.repeatable || !u.owned) && (
                      <button className={s.itemBtn} disabled={!between || !u.canBuy} onClick={() => submit(`unlock ${u.id}`)}>buy</button>
                    )}
                    {u.kind === "kit" && u.owned && !taking && between && (
                      <button className={s.itemBtn} onClick={() => submit(`kit ${u.name.toLowerCase()}`)}>take this kit</button>
                    )}
                    {u.kind === "kit" && taking && between && (
                      <button className={s.itemBtn} onClick={() => submit("kit none")}>no kit</button>
                    )}
                    <div className={s.codexText}>{u.text}</div>
                    {u.items.length > 0 && <div className={s.codexLine}>{u.items.join(" · ")}</div>}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {a.bequest && (
        <>
          <div className={s.sectionLabel}>Waiting on Floor 1</div>
          <div className={s.sub}>{a.bequest.from} left {a.bequest.name} for the next crawler.</div>
        </>
      )}
    </div>
  );
}

/** The end-of-run screen: what happened, what it paid, what to leave behind, and what to buy. */
export function RunEndSheet({ view, submit }: { view: ViewModel; submit: (t: string) => void }) {
  const r = view.runEnd;
  if (!r) return <div className={s.muted}>No run has ended.</div>;
  const headline = r.kind === "quit" ? "Quit" : r.kind === "descended" ? r.cause : `Died on Floor ${r.floor}: ${r.cause}`;
  return (
    <div>
      <div className={s.name}>{r.crawler}</div>
      <div className={s.sub}>{headline}.</div>
      <div className={s.sectionLabel}>Legacy points</div>
      <pre className={s.tally}>{r.lines.join("\n")}</pre>
      <div className={s.sectionLabel}>Leave something behind</div>
      <div className={s.sub}>
        {r.bequeathed
          ? `${r.bequeathed} goes to the next crawler, in a safe room on Floor 1. You can change your mind until you start them.`
          : "One item, not legendary. The next crawler finds it in a safe room on Floor 1."}
      </div>
      <ul className={s.list}>
        {r.candidates.map((it) => (
          <li key={it.input} className={s.codexEntry}>
            <span className={rarityClass(it.rarity)}>{it.name}</span>
            <span className={s.sub}> · {it.rarity}{it.value ? ` · worth ${it.value}g` : ""}</span>{" "}
            {it.name === r.bequeathed
              ? <span className={s.codexName}>leaving this</span>
              : <button className={s.itemBtn} onClick={() => submit(it.input)}>leave this</button>}
          </li>
        ))}
        {r.candidates.length === 0 && <li className={s.muted}>Nothing to leave. You died with empty pockets.</li>}
      </ul>
      {r.bequeathed && <button className={s.itemBtn} onClick={() => submit("bequeath nothing")}>leave nothing</button>}
      {r.legendary.length > 0 && <div className={s.muted}>Legendary, so it stays with the house: {r.legendary.join(", ")}.</div>}
      <div className={s.sectionLabel}>Unlocks</div>
      <UnlocksSheet view={view} submit={submit} />
      <div className={s.itemActions}>
        <button className={`${s.itemBtn} ${s.itemBtnGood}`} onClick={() => submit("new")}>Next crawler</button>
      </div>
    </div>
  );
}
