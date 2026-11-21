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

/** Pick things from the pack and try them together: the tap version of `combine a b c`. */
function Workbench({ view, submit }: { view: ViewModel; submit: (t: string) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  // things can vanish from the pack (used up, ruined) between tries
  const chosen = view.inventory.filter((it) => picked.includes(it.uid));
  const toggle = (uid: string) => setPicked((p) => (p.includes(uid) ? p.filter((u) => u !== uid) : [...p, uid]));
  const go = () => {
    submit(`combine ${chosen.map((it) => it.name.toLowerCase()).join(" | ")}`);
    setPicked([]);
  };
  return (
    <div className={s.bench}>
      <div className={s.benchHead}>⚒ Workbench</div>
      <ol className={s.benchSteps}>
        <li>Tap two or more things below.</li>
        <li>Hit Combine.</li>
        <li>If they go together you get something new, and the recipe is saved so you can remake it in one tap.</li>
      </ol>
      <div className={s.muted}>A wrong guess wastes 5 minutes. A fumbled build can ruin a part.</div>
      {view.inventory.length === 0 ? (
        <div className={s.muted}>Your pack is empty. Go pick up some garbage.</div>
      ) : (
        <div className={s.benchItems}>
          {view.inventory.map((it) => {
            const on = picked.includes(it.uid);
            return (
              <button key={it.uid} className={`${s.benchItem} ${on ? s.benchItemOn : ""}`} aria-pressed={on} onClick={() => toggle(it.uid)}>
                <span className={rarityClass(it.rarity)}>{on ? "✓ " : ""}{it.name}{it.qty > 1 ? ` x${it.qty}` : ""}</span>
                {it.parts && <span className={s.benchRole}>{it.parts.join(", ")}</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className={s.benchBar}>
        <span className={s.benchPicked}>
          {chosen.length ? chosen.map((it) => it.name).join(" + ") : "Nothing picked yet."}
        </span>
        {chosen.length > 0 && <button className={s.recipeBtn} onClick={() => setPicked([])}>clear</button>}
        <button className={s.benchGo} disabled={chosen.length < 2} onClick={go}>
          Combine{chosen.length >= 2 ? ` (${chosen.length})` : ""}
        </button>
      </div>
    </div>
  );
}

/** Recipes you've discovered (✓ = you're carrying the parts) and the System AI's hints. */
export function RecipeBook({ view, submit }: { view: ViewModel; submit?: (t: string) => void }) {
  const book = view.recipeBook;
  if (!book) return null;
  const bench = view.room?.workbench ?? false;
  return (
    <div>
      {bench && submit ? (
        <Workbench view={view} submit={submit} />
      ) : (
        <div className={s.muted}>
          No workbench here. Safe rooms have one, and so does the odd workshop. Bring your junk there to put it together.
        </div>
      )}
      {view.echo && view.echo.modules.some((m) => !m.installed) && (
        <>
          <div className={s.benchHead}>Echo's modules</div>
          <ul className={s.list}>
            {view.echo.modules.filter((m) => !m.installed).map((m) => (
              <li key={m.id} className={s.recipe}>
                <span className={m.ready ? s.recipeReady : s.recipeName}>{m.ready ? "✓ " : "· "}{m.name}</span>
                <span className={s.recipeParts}>{m.future ? "Echo can't run this one yet (later floors)" : m.parts.map((p) => `${p.name} ${p.have}/${p.need}`).join(" + ")}</span>
                {m.ready && bench && submit && (
                  <button className={s.recipeBtn} onClick={() => submit(`craft ${m.name.toLowerCase()}`)}>build</button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className={s.benchHead}>Recipe book</div>
      {book.known.length === 0 && <div className={s.muted}>Empty. Anything you put together at a bench gets written down here.</div>}
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

/** Echo: its vessel, Wholeness, the Temper track and its modules. */
export function EchoPanel({ view }: { view: ViewModel }) {
  const e = view.echo;
  if (!e) return <div className={s.muted}>Nothing in your pocket. Yet.</div>;
  const steps = Array.from({ length: e.temperMax - e.temperMin + 1 }, (_, i) => e.temperMin + i);
  const sideLabel = e.side === "base" ? "steady" : e.side;
  return (
    <div>
      <div className={s.sub}>in {e.vessel}</div>
      <dl className={s.kv}>
        <dt>Wholeness</dt>
        <dd>
          <span className={s.wholeBar} aria-hidden="true"><span style={{ width: `${e.wholeness}%` }} /></span> {e.wholeness}%
        </dd>
        <dt>Stage</dt>
        <dd>{e.stage}</dd>
        <dt>Shards</dt>
        <dd>{e.shards} this run</dd>
      </dl>
      <div className={s.sectionLabel}>Temper: {e.temper > 0 ? "+" : ""}{e.temper} ({sideLabel})</div>
      <div className={s.temper} role="img" aria-label={`Temper ${e.temper}, ${sideLabel}`}>
        <span className={s.temperEnd}>Calm</span>
        {steps.map((t) => (
          <span
            key={t}
            className={`${s.temperPip} ${t === e.temper ? s.temperNow : ""} ${t <= -3 ? s.temperCalm : t >= 3 ? s.temperFed : ""}`}
            title={String(t)}
          />
        ))}
        <span className={s.temperEnd}>Fed</span>
      </div>
      {e.urge && <div className={s.echoUrge}>{e.urge} (let echo / hush)</div>}
      <div className={s.sectionLabel}>Modules</div>
      {e.modules.length === 0 && <div className={s.muted}>None yet. Shards remind Echo how to build them.</div>}
      <ul className={s.list}>
        {e.modules.map((m) => (
          <li key={m.id} className={s.recipe}>
            <span className={m.installed ? s.recipeReady : s.recipeName}>{m.installed ? "● " : "○ "}{m.name}</span>
            <span className={s.recipeParts}>
              {m.installed ? `${m.side === "base" ? "" : `${m.side}: `}${m.now}` : m.future ? "later floors" : m.parts.map((p) => `${p.name} ${p.have}/${p.need}`).join(" + ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The account's Codex: lore that fills in a line per shard, recipes, boss weaknesses, endings, past runs. */
export function CodexSheet({ view }: { view: ViewModel }) {
  const c = view.codex;
  const groups: [string, string][] = [["lore", "Lore"], ["weakness", "Boss weaknesses"], ["recipe", "Recipes"], ["ending", "Endings"]];
  return (
    <div>
      <div className={s.sub}>Shards recorded: {c.shards.found} of {c.shards.total}. The Codex outlives every crawler.</div>
      {groups.map(([type, label]) => {
        const entries = c.entries.filter((e) => e.type === type);
        return (
          <div key={type}>
            <div className={s.sectionLabel}>{label}</div>
            <ul className={s.list}>
              {entries.map((e) => (
                <li key={e.id} className={s.codexEntry}>
                  <span className={e.unlocked ? s.codexName : s.muted}>{e.name}</span>
                  {e.unlocked ? (
                    <>
                      <div className={s.codexText}>{e.text}</div>
                      {e.lines.map((l, i) => <div key={i} className={s.codexLine}>· {l}</div>)}
                      {type === "lore" && e.missing > 0 && <div className={s.muted}>({e.missing} more to find)</div>}
                    </>
                  ) : (
                    <span className={s.muted}>
                      {type === "lore" ? (e.recorded ? ` locked; ${e.recorded} fragment${e.recorded === 1 ? "" : "s"} recorded` : " locked") : " unknown"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {c.history.length > 0 && (
        <>
          <div className={s.sectionLabel}>Past runs</div>
          <ul className={s.list}>
            {c.history.slice().reverse().map((r) => (
              <li key={r.run + r.crawler} className={s.sub}>
                #{r.run} {r.crawler}, Floor {r.floor}: {r.outcome}. {r.shards} shard{r.shards === 1 ? "" : "s"}, Temper {r.temper > 0 ? "+" : ""}{r.temper}.
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
