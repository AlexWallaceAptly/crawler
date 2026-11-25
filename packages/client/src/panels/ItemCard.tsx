import { useEffect } from "react";
import type { ViewModel } from "@crawler/engine";
import s from "./itemcard.module.css";

type Item = ViewModel["inventory"][number];

const pct = (p: number) => `${Math.round(p * 100)}%`;
const MARK: Record<number, string> = { 1: "▲", 0: "·", [-1]: "▼" };

/**
 * An item, laid out: what it is, what it does in your hands, what it would change, and what you
 * can do with it. Opens over whatever list it was picked from; Esc, the ✕ or a click outside
 * closes it, and so does acting on it.
 */
export function ItemCard({ item, submit, onClose }: { item: Item; submit?: (t: string) => void; onClose: () => void }) {
  // Esc closes the card, not the inventory it's sitting on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const c = item.card;
  const w = c.weapon;
  const name = item.name.toLowerCase();
  const act = (cmd: string) => {
    submit?.(cmd);
    onClose();
  };

  return (
    <div className={s.backdrop} onClick={onClose} role="presentation">
      <div className={s.card} role="dialog" aria-label={item.name} onClick={(e) => e.stopPropagation()}
        style={{ borderColor: `var(--rarity-${item.rarity}, var(--border-hi))` }}>
        <div className={s.head}>
          <div>
            <div className={s.name} style={{ color: `var(--rarity-${item.rarity}, var(--text))` }}>
              {item.name}{item.qty > 1 ? ` ×${item.qty}` : ""}
            </div>
            <div className={s.kind}>{c.kind}</div>
          </div>
          <button className={s.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {w && (
          <section className={s.section}>
            <div className={s.chips}>
              <span className={`${s.chip} ${s.chipStat}`}>{w.stat}</span>
              <span className={s.chip}>{w.ap}</span>
              <span className={s.chip}>{w.reach} reach</span>
              {w.twoHanded && <span className={s.chip}>two-handed</span>}
              {w.damageType && <span className={s.chip}>{w.damageType}</span>}
              <span className={s.chipQuiet}>{w.type}</span>
            </div>
            <div className={s.tiles}>
              <Tile label="damage" value={w.damage} />
              <Tile label="avg hit" value={String(w.average)} />
              <Tile label="a turn" value={String(w.perTurn)} sub="3 AP" />
              <Tile label="roll" value={w.roll} />
            </div>
            <div className={s.odds} aria-label={`weak ${pct(w.odds[0])}, solid ${pct(w.odds[1])}, great ${pct(w.odds[2])}`}>
              <span className={s.oddsWeak} style={{ flexGrow: w.odds[0] }} />
              <span className={s.oddsSolid} style={{ flexGrow: w.odds[1] }} />
              <span className={s.oddsGreat} style={{ flexGrow: w.odds[2] }} />
            </div>
            <div className={s.oddsKey}>
              {(["weak", "solid", "great"] as const).map((tier, i) => (
                <span key={tier}>{tier} {w.damage.split("/")[i]} · {pct(w.odds[i]!)}</span>
              ))}
              {w.critAt !== undefined && <span>crits on {w.critAt}+</span>}
            </div>
            {w.skill && <div className={s.skill}>{w.skill}</div>}
          </section>
        )}

        {c.armor !== undefined && (
          <section className={s.section}>
            <div className={s.tiles}>
              <Tile label="armor" value={String(c.armor)} sub="off every hit you take" />
            </div>
          </section>
        )}

        {c.spell && (
          <section className={s.section}>
            <div className={s.label}>{c.spell.name} · {c.spell.school}</div>
            <div>{c.spell.description}</div>
            <div className={s.dim}>{c.spell.effect}</div>
            <div className={s.dim}>{c.spell.note}</div>
          </section>
        )}

        {c.traits.length > 0 && (
          <section className={s.section}>
            <ul className={s.traits}>
              {c.traits.map((t, i) => (
                <li key={i}>
                  <span className={t.legendary ? s.legendary : s.traitName}>{t.legendary ? "★ " : ""}{t.name}</span>
                  <span className={s.dim}> {t.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {c.equipped && <div className={s.equipped}>{c.equipped}</div>}
        {c.changes && (
          <section className={s.section}>
            <div className={s.label}>If you equip it</div>
            {c.changes.length === 0 ? <div className={s.dim}>Nothing you'd notice.</div> : (
              <table className={s.changes}>
                <tbody>
                  {c.changes.map((ch) => (
                    <tr key={ch.label} className={ch.better > 0 ? s.up : ch.better < 0 ? s.down : ""}>
                      <td>{ch.label}</td>
                      <td className={s.num}>{ch.from}</td>
                      <td className={s.arrow}>→</td>
                      <td className={s.num}>{ch.to}</td>
                      <td className={s.mark}>{MARK[ch.better]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {c.replaces && <div className={s.dim}>Replaces {c.replaces.join(" and ")}.</div>}
          </section>
        )}

        {(c.notes.length > 0 || c.parts) && (
          <section className={s.section}>
            {c.parts && <div className={s.dim}>Crafting: {c.parts.join(", ")}</div>}
            {c.notes.map((n, i) => <div key={i} className={s.dim}>{n}</div>)}
          </section>
        )}
        {c.flavor && <p className={s.flavor}>{c.flavor}</p>}

        <div className={s.foot}>
          <span className={s.weight}>weight {c.weight}</span>
          {submit && (
            <div className={s.actions}>
              {item.kind === "gear" && (item.equippedIn
                ? <button className={s.btn} onClick={() => act(`unequip ${name}`)}>Take off</button>
                : <button className={`${s.btn} ${item.verdict === "better" ? s.btnGood : ""}`} onClick={() => act(`equip ${name}`)}>Equip</button>)}
              {item.kind === "consumable" && <button className={s.btn} onClick={() => act(`use ${name}`)}>Use</button>}
              {!item.equippedIn && <button className={s.btnQuiet} onClick={() => act(`drop ${name}`)}>Drop</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={s.tile}>
      <div className={s.tileValue}>{value}</div>
      <div className={s.tileLabel}>{label}</div>
      {sub && <div className={s.tileSub}>{sub}</div>}
    </div>
  );
}
