import { useState } from "react";
import type { ViewModel } from "@crawler/engine";
import s from "./panels.module.css";
import { MiniMapGrid } from "./MiniMapGrid";

const rarityClass = (r: string) => s[r] ?? s.common;

export function CharacterSheet({ view }: { view: ViewModel }) {
  const c = view.character;
  if (!c) return <div className={s.muted}>No crawler. Type "new".</div>;
  return (
    <div>
      <div className={s.name}>{c.name}</div>
      <div className={s.sub}>{c.subtitle}</div>
      <dl className={s.kv}>
        <dt>Level</dt>
        <dd>{c.level}{c.unspentStatPoints > 0 ? ` (+${c.unspentStatPoints} pts)` : ""}</dd>
        <dt>Race</dt>
        <dd>{c.race}</dd>
        <dt>Class</dt>
        <dd>{c.charClass}</dd>
        <dt>Gold</dt>
        <dd>{c.gold}</dd>
      </dl>
      <div className={s.stats}>
        {c.stats.map((st) => (
          <div key={st.stat} className={s.stat} title={st.value !== st.base ? `base ${st.base}` : undefined}>
            <b>{st.value}</b>
            <span>{st.stat}</span>
          </div>
        ))}
      </div>
      <dl className={s.kv}>
        {c.derived.map((d) => (
          <div key={d.label} style={{ display: "contents" }}>
            <dt>{d.label}</dt>
            <dd>{d.value}</dd>
          </div>
        ))}
      </dl>
      <div className={s.sectionLabel}>Skills</div>
      <ul className={s.list}>
        {c.skills.map((sk) => (
          <li key={sk.name}>
            {sk.name} <span className={s.sub}>r{sk.rank}</span>
          </li>
        ))}
      </ul>
      {c.spells.length > 0 && (
        <>
          <div className={s.sectionLabel}>Spells</div>
          <ul className={s.list}>
            {c.spells.map((sp) => (
              <li key={sp.name}>
                {sp.name} <span className={s.sub}>L{sp.level}{sp.cooldown ? ` cd ${sp.cooldown}` : ""}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className={s.sectionLabel}>Quirk</div>
      <div>
        {c.quirk.name} <span className={s.sub}>— {c.quirk.text}</span>
      </div>
    </div>
  );
}

export function EquipmentList({ view }: { view: ViewModel }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!view.character) return <div className={s.muted}>Nothing to wear. Nobody to wear it.</div>;
  return (
    <ul className={s.list}>
      {view.equipment.map((row) => (
        <li key={row.slot}>
          <button
            className={s.slotRow}
            disabled={!row.item}
            onClick={() => setOpen(open === row.slot ? null : row.slot)}
            aria-expanded={open === row.slot}
          >
            <span className={s.slotLabel}>{row.label}:</span>
            {row.item ? <span className={rarityClass(row.item.rarity)}>{row.item.name}</span> : <span className={s.muted}>—</span>}
          </button>
          {open === row.slot && row.item && (
            <div className={s.detail}>
              {row.item.detail.map((d, i) => (
                <div key={i}>{d}</div>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function EffectsList({ view }: { view: ViewModel }) {
  if (view.effects.length === 0) return <div className={s.muted}>None. Suspiciously healthy.</div>;
  return (
    <ul className={s.list}>
      {view.effects.map((e, i) => (
        <li key={i} className={s[e.kind]}>
          {e.name}
          {e.stacks > 1 ? ` x${e.stacks}` : ""} <span className={s.sub}>({e.remaining})</span>
        </li>
      ))}
    </ul>
  );
}

export function MiniMap({ view }: { view: ViewModel }) {
  if (!view.minimap) return <div className={s.muted}>No map. No floor. Just vibes.</div>;
  if (view.mapGrid) return <MiniMapGrid view={view} />;
  return <pre className={s.mapPre}>{view.minimap.join("\n")}</pre>;
}

export function InventoryList({ view }: { view: ViewModel }) {
  const [open, setOpen] = useState<string | null>(null);
  if (view.inventory.length === 0) return <div className={s.muted}>Empty. Like your future.</div>;
  return (
    <ul className={s.list}>
      {view.inventory.map((it) => (
        <li key={it.uid}>
          <button className={s.slotRow} onClick={() => setOpen(open === it.uid ? null : it.uid)} aria-expanded={open === it.uid}>
            <span className={s.slotLabel}>{it.equippedIn ? "[E]" : it.qty > 1 ? `x${it.qty}` : ""}</span>
            <span className={rarityClass(it.rarity)}>{it.name}</span>
          </button>
          {open === it.uid && (
            <div className={s.detail}>
              {it.detail.map((d, i) => (
                <div key={i}>{d}</div>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Recipes you've discovered (✓ = you're carrying the parts) and the System AI's hints. */
export function RecipeBook({ view, submit }: { view: ViewModel; submit?: (t: string) => void }) {
  const book = view.recipeBook;
  if (!book) return null;
  const bench = view.room?.workbench ?? false;
  return (
    <div>
      <div className={s.muted}>
        {bench ? "There's a workbench here. Combine anything: " : "Crafting needs a workbench (safe rooms, workshops). Try: "}
        <i>combine bat tacks tape</i>
      </div>
      {book.known.length === 0 && <div className={s.muted}>No recipes yet. Find out what goes together.</div>}
      <ul className={s.list}>
        {book.known.map((r) => (
          <li key={r.id} className={s.recipe}>
            <span className={r.ready ? s.recipeReady : s.recipeName}>{r.ready ? "✓ " : "· "}{r.name}</span>
            <span className={s.recipeParts}>{r.parts.join(" + ")}</span>
            {r.ready && bench && submit && (
              <button className={s.recipeBtn} onClick={() => submit(`craft ${r.name.toLowerCase()}`)}>make</button>
            )}
          </li>
        ))}
      </ul>
      {book.hints.length > 0 && (
        <div className={s.hints}>
          {book.hints.map((h, i) => <div key={i}>? {h}</div>)}
        </div>
      )}
    </div>
  );
}
