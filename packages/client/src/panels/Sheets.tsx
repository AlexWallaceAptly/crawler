import { useEffect, useRef, useState } from "react";
import type { ViewModel } from "@crawler/engine";
import s from "./panels.module.css";
import { MiniMapGrid } from "./MiniMapGrid";

const rarityClass = (r: string) => s[r] ?? s.common;

export function CharacterSheet({ view, submit }: { view: ViewModel; submit?: (t: string) => void }) {
  const c = view.character;
  if (!c) return <div className={s.muted}>No crawler. Type "new".</div>;
  const xp = view.status.xp;
  const spend = c.unspentStatPoints > 0 && view.phase === "exploring" && submit;
  return (
    <div>
      <div className={s.name}>{c.name}</div>
      <div className={s.sub}>{c.subtitle}</div>
      <dl className={s.kv}>
        <dt>Level</dt>
        <dd>
          {c.level}
          {xp && <span className={s.sub}> · {xp.current}/{xp.max} XP to {c.level + 1}</span>}
        </dd>
        <dt>Race</dt>
        <dd>{c.race}</dd>
        <dt>Class</dt>
        <dd>{c.charClass}</dd>
        <dt>Gold</dt>
        <dd>{c.gold}</dd>
      </dl>
      {xp && <Progress current={xp.current} max={xp.max} />}
      {c.unspentStatPoints > 0 && (
        <div className={s.pointsNote}>
          {c.unspentStatPoints} stat point{c.unspentStatPoints === 1 ? "" : "s"} to spend{spend ? ": tap + on a stat." : view.phase === "combat" ? " after the fight." : "."}
        </div>
      )}
      <div className={s.stats}>
        {c.stats.map((st) => (
          <div key={st.stat} className={s.stat} title={st.value !== st.base ? `base ${st.base}` : undefined}>
            <b>{st.value}</b>
            <span>{st.stat}</span>
            {spend && (
              <button className={s.statPlus} aria-label={`Raise ${st.stat}`} onClick={() => submit(`raise ${st.stat}`)}>+</button>
            )}
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
      <Fighting view={view} />
      <div className={s.sectionLabel}>Skills</div>
      <ul className={s.skillList}>
        {c.skills.map((sk) => (
          <li key={sk.id} className={s.skill}>
            <div className={s.skillHead}>
              <span>{sk.name}</span>
              <span className={s.skillRank}>
                {sk.rank ? `rank ${sk.rank}` : "untrained"}
                {sk.effective !== sk.rank && <span className={s.sub}> ({sk.effective} with gear)</span>}
              </span>
            </div>
            {sk.next > 0 && <Progress current={sk.xp} max={sk.next} />}
            <div className={s.skillMeta}>
              {sk.next > 0 ? `${sk.next - sk.xp} more to rank ${sk.rank + 1}` : "maxed"}
              {sk.nextPerk && ` · rank ${sk.nextPerk.rank}: ${sk.nextPerk.name}`}
            </div>
            {sk.perks.length > 0 && (
              <div className={s.skillPerks}>{sk.perks.map((p) => `★ ${p.name}`).join("  ")}</div>
            )}
          </li>
        ))}
      </ul>
      {c.skills.length === 0 && <div className={s.muted}>Nothing yet. Swing something.</div>}
      <div className={s.sectionLabel}>Spells</div>
      {c.spells.length > 0 ? (
        <ul className={s.skillList}>
          {c.spells.map((sp) => (
            <li key={sp.id} className={s.skill}>
              <div className={s.skillHead}>
                <span>{sp.name} <span className={s.sub}>{sp.skill}</span></span>
                <span className={s.skillRank}>level {sp.level}</span>
              </div>
              {sp.next > 0 && <Progress current={sp.casts} max={sp.next} />}
              <div className={s.skillMeta}>
                {sp.mp} MP · {sp.ap} AP{sp.cooldownMax ? ` · recharges ${sp.cooldownMax} rounds` : ""}
                {sp.when === "explore" ? " · out of fights" : sp.when === "any" ? " · any time" : ""}
                {sp.cooldown > 0 && ` · ready in ${sp.cooldown}`}
                {sp.next > 0 ? ` · ${sp.next - sp.casts} casts to level ${sp.level + 1}` : " · maxed"}
              </div>
              <div className={s.skillMeta}>{sp.effect}</div>
              <div className={s.sub}>{sp.description}</div>
            </li>
          ))}
        </ul>
      ) : (
        <div className={s.muted}>None. Tomes teach spells; scrolls cast one once.</div>
      )}
      <div className={s.sectionLabel}>Quirk</div>
      <div>
        {c.quirk.name} <span className={s.sub}>— {c.quirk.text}</span>
      </div>
    </div>
  );
}

/** A thin progress bar: XP to the next level, or a skill's XP to its next rank. */
function Progress({ current, max }: { current: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  return (
    <div className={s.progress} role="progressbar" aria-valuenow={current} aria-valuemin={0} aria-valuemax={max}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** How you fight right now: what your weapon and stats add up to, and which stat suits you. */
function Fighting({ view }: { view: ViewModel }) {
  const f = view.character?.fighting;
  if (!f) return null;
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  return (
    <>
      <div className={s.sectionLabel}>Fighting</div>
      <div className={s.fight}>
        <div><span className={s.fightKey}>Weapon</span> {f.weapon} <span className={s.sub}>({f.stat}, {f.apCost} AP)</span></div>
        {f.skill && <div><span className={s.fightKey}>Skill</span> <span className={s.fightSkill}>{f.skill}</span></div>}
        <div><span className={s.fightKey}>Roll</span> 2d10 {f.roll >= 0 ? "+" : ""}{f.roll} <span className={s.sub}>weak {pct(f.odds[0])} · solid {pct(f.odds[1])} · great {pct(f.odds[2])}</span></div>
        <div><span className={s.fightKey}>Damage</span> {f.damage} <span className={s.sub}>avg {f.average} a swing</span></div>
        <div><span className={s.fightKey}>Armor</span> {f.armor} <span className={s.sub}>off every hit{f.guard ? ` · guard ${f.guard > 0 ? "+" : ""}${f.guard}` : ""}</span></div>
        <div className={s.fightFit}>{f.fit}</div>
      </div>
    </>
  );
}

const VERDICT: Record<string, { mark: string; label: string }> = {
  better: { mark: "▲", label: "better than what you have on" },
  worse: { mark: "▼", label: "worse than what you have on" },
  mixed: { mark: "⇅", label: "a trade-off: open it to see" },
  same: { mark: "=", label: "about the same" },
};

function Verdict({ v }: { v?: string }) {
  if (!v) return null;
  const x = VERDICT[v]!;
  return <span className={`${s.verdict} ${s[`verdict_${v}`] ?? ""}`} title={x.label} aria-label={x.label}>{x.mark}</span>;
}

type Item = ViewModel["inventory"][number];

/** Equip / take off / use / drop, under an opened item. */
function ItemActions({ it, submit }: { it: Item; submit?: (t: string) => void }) {
  if (!submit) return null;
  const name = it.name.toLowerCase();
  return (
    <div className={s.itemActions}>
      {it.kind === "gear" && (it.equippedIn
        ? <button className={s.itemBtn} onClick={() => submit(`unequip ${name}`)}>take off</button>
        : <button className={`${s.itemBtn} ${it.verdict === "better" ? s.itemBtnGood : ""}`} onClick={() => submit(`equip ${name}`)}>equip</button>)}
      {it.kind === "consumable" && <button className={s.itemBtn} onClick={() => submit(`use ${name}`)}>use</button>}
      {!it.equippedIn && <button className={s.itemBtn} onClick={() => submit(`drop ${name}`)}>drop</button>}
    </div>
  );
}

export function EquipmentList({ view, submit }: { view: ViewModel; submit?: (t: string) => void }) {
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
            {row.item
              ? <span><span className={rarityClass(row.item.rarity)}>{row.item.name}</span>{row.item.summary && <span className={s.itemSummary}> {row.item.summary}</span>}</span>
              : <span className={s.muted}>—</span>}
          </button>
          {open === row.slot && row.item && (
            <div className={s.detail}>
              {row.item.detail.map((d, i) => (
                <div key={i}>{d}</div>
              ))}
              <ItemActions it={row.item} submit={submit} />
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

export function InventoryList({ view, submit }: { view: ViewModel; submit?: (t: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (view.inventory.length === 0) return <div className={s.muted}>Empty. Like your future.</div>;
  const hasVerdicts = view.inventory.some((it) => it.verdict);
  return (
    <>
      {hasVerdicts && <div className={s.legend}>▲ better than what you have on · ▼ worse · ⇅ a trade-off. Open one to see why.</div>}
      <ul className={s.list}>
        {view.inventory.map((it) => (
          <li key={it.uid}>
            <button className={s.slotRow} onClick={() => setOpen(open === it.uid ? null : it.uid)} aria-expanded={open === it.uid}>
              <span className={s.slotLabel}>{it.equippedIn ? "[E]" : it.qty > 1 ? `x${it.qty}` : ""}<Verdict v={it.verdict} /></span>
              <span>
                <span className={rarityClass(it.rarity)}>{it.name}</span>
                {it.summary && <span className={s.itemSummary}> {it.summary}</span>}
              </span>
            </button>
            {open === it.uid && (
              <div className={s.detail}>
                {it.detail.map((d, i) => (
                  <div key={i}>{d}</div>
                ))}
                <ItemActions it={it} submit={submit} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * The workbench: one chip per property you're carrying (Weapon, Sharp 3, Bind 5...).
 * Tap two or more and hit Combine; the game picks the actual items (your equipped
 * weapon for an upgrade, the cheapest junk for parts) and says what it used.
 */
function Workbench({ view, submit }: { view: ViewModel; submit: (t: string) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const chips = view.workbench ?? [];
  // a chip can vanish when its last item is used up
  const chosen = chips.filter((c) => picked.includes(c.pick));
  const toggle = (pick: string) => setPicked((p) => (p.includes(pick) ? p.filter((x) => x !== pick) : [...p, pick]));
  const go = () => {
    submit(`combine ${chosen.map((c) => c.pick).join(" | ")}`);
    setPicked([]);
  };
  return (
    <div className={s.workbench}>
      <div className={s.benchHead}>⚒ Workbench</div>
      <div className={s.benchIntro}>
        Tap two or more, then Combine. The game picks the junk: cheapest first, your weapon for upgrades.
        <span className={s.muted}> A wrong guess wastes 5 minutes.</span>
      </div>
      {chips.length === 0 ? (
        <div className={s.muted}>Nothing in your pack goes into anything. Go pick up some garbage.</div>
      ) : (
        <div className={s.chips}>
          {chips.map((c) => {
            const on = picked.includes(c.pick);
            return (
              <button
                key={c.pick}
                className={`${s.chip} ${c.kind === "gear" ? s.chipGear : ""} ${on ? s.chipOn : ""}`}
                aria-pressed={on}
                title={c.hint}
                onClick={() => toggle(c.pick)}
              >
                <span className={s.chipLabel}>{c.label}</span>
                {c.kind !== "gear" && <span className={s.chipCount}>{c.count}</span>}
                {c.detail && <span className={s.chipDetail}>{c.detail}</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className={s.benchBar}>
        <span className={s.benchPicked}>
          {chosen.length ? chosen.map((c) => c.label).join(" + ") : "Nothing picked yet."}
        </span>
        {chosen.length > 0 && <button className={s.recipeBtn} onClick={() => setPicked([])}>clear</button>}
        <button className={s.benchGo} disabled={chosen.length < 2} onClick={go}>
          Combine{chosen.length >= 2 ? ` (${chosen.length})` : ""}
        </button>
      </div>
    </div>
  );
}

/** "Blunt weapon 1/1 + Sharp 3/1 + Bind 0/1", short ones dimmed. */
function Parts({ parts }: { parts: { label: string; have: number; need: number; kept?: boolean; upgraded?: boolean }[] }) {
  return (
    <span className={s.recipeParts}>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && " + "}
          <span className={p.have >= p.need ? undefined : s.partShort}>
            {p.label}{p.upgraded ? " (upgraded)" : p.kept ? " (kept)" : ""} {p.have}/{p.need}
          </span>
        </span>
      ))}
    </span>
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
                {m.future
                  ? <span className={s.recipeParts}>Echo can't run this one yet (later floors)</span>
                  : <Parts parts={m.parts.map((p) => ({ label: p.name, have: p.have, need: p.need }))} />}
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
            <Parts parts={r.parts} />
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

/**
 * The run's Game Guide: rules, show events, scout reports and the rooms' long descriptions.
 * (The account's Codex is separate.) Entries new since the last visit carry a marker, which
 * stays for this visit and clears once the guide has been read.
 */
export function GuideSheet({ view, submit }: { view: ViewModel; submit?: (t: string) => void }) {
  const fresh = useRef(new Set(view.guide.sections.flatMap((sec) => sec.entries.filter((e) => e.isNew).map((e) => e.id))));
  for (const sec of view.guide.sections) for (const e of sec.entries) if (e.isNew) fresh.current.add(e.id);
  useEffect(() => {
    if (view.guide.unseen > 0) submit?.("guide read");
  }, [view.guide.unseen]);
  if (view.guide.sections.length === 0) return <div className={s.muted}>Nothing in the Guide yet.</div>;
  return (
    <div>
      {view.guide.sections.map((sec) => (
        <div key={sec.id}>
          <div className={s.sectionLabel}>{sec.name}</div>
          <ul className={s.list}>
            {sec.entries.map((e) => (
              <li key={e.id} className={s.codexEntry}>
                <span className={s.codexName}>{fresh.current.has(e.id) ? "● " : ""}{e.title}</span>
                {e.text.split("\n").map((l, i) => <div key={i} className={s.codexText} style={e.id === "map.floor" ? { whiteSpace: "pre", fontFamily: "monospace" } : undefined}>{l}</div>)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
