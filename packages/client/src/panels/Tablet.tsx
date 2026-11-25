/**
 * Tablet shell (iPad sized touch screens): the map or battle board on the left
 * with the action bar under it, the log and the character tabs on the right.
 * Walking is arrows on the map; everything else is a button, with the rarely
 * used commands behind "More".
 */
import { useEffect, useRef, useState } from "react";
import type { CommandOption } from "@crawler/engine";
import { EnemyStrip, LogView } from "./LogView";
import { CharacterSheet, CodexSheet, GuideSheet, EchoPanel, EffectsList, EquipmentList, InventoryList, RecipeBook } from "./Sheets";
import { InputBar } from "./InputBar";
import { MiniMapGrid } from "./MiniMapGrid";
import { BattleGrid } from "./BattleGrid";
import { StatusStrip, Toggle, useShown, type ShellProps } from "./Mobile";
import { readPref, writePref } from "../storage";
import s from "./tablet.module.css";

type Tab = "character" | "equipment" | "inventory" | "crafting" | "effects" | "echo" | "guide";
const TABS: { id: Tab; label: string }[] = [
  { id: "character", label: "Character" },
  { id: "equipment", label: "Gear" },
  { id: "inventory", label: "Pack" },
  { id: "crafting", label: "Crafting" },
  { id: "effects", label: "Effects" },
  { id: "echo", label: "Echo" },
  { id: "guide", label: "Guide" },
];
const DIRS = ["north", "east", "south", "west"] as const;

export function TabletShell({ view, log, battle, commands, submit: submitRaw, onLocal, armed, setArmed, layout }: ShellProps) {
  const inCombat = view.phase === "combat";
  const board = inCombat && !!view.combat?.grid;
  const exploring = view.phase === "exploring" && !!view.mapGrid;
  const [tab, setTabState] = useState<Tab>(() => readPref<Tab>("tabletTab", "character"));
  const [logShown, toggleLog] = useShown("tabletLog");
  const [tabsShown, toggleTabs] = useShown("tabletTabs");
  const [moreOpen, setMoreOpen] = useState(false);
  const [typing, setTyping] = useState(false);

  const setTab = (t: Tab) => { setTabState(t); writePref("tabletTab", t); };
  const openBench = () => { setTab("crafting"); if (!tabsShown) toggleTabs(); };
  // The Guide is a tab here, not a block of text in the log.
  const submit = (t: string) => {
    if (/^(guide|g)$/i.test(t.trim())) { setTab("guide"); if (!tabsShown) toggleTabs(); }
    else submitRaw(t);
  };

  // The menu never outlives the state it was opened in.
  useEffect(() => setMoreOpen(false), [view.phase]);

  const byInput = new Map(commands.map((c) => [c.input, c]));
  const moves = exploring
    ? Object.fromEntries(DIRS.filter((d) => byInput.has(d)).map((d) => [d, () => submit(d)]))
    : undefined;
  const shown = commands.filter((c) => !(exploring && DIRS.includes(c.input as never)));
  const main = shown.filter((c) => !c.niche);
  const niche = shown.filter((c) => c.niche);

  const press = (c: CommandOption) => {
    setMoreOpen(false);
    if (c.targets) setArmed(armed?.label === c.label ? null : c);
    else submit(c.input);
  };
  const button = (c: CommandOption, cls: string) => (
    <button
      key={`${c.label}|${c.input}`}
      className={`${cls} ${(c.primary && !c.disabled) || armed?.label === c.label ? s.on : ""}`}
      disabled={c.disabled}
      title={c.why}
      onClick={() => press(c)}
    >
      {c.label}{c.targets ? " ⌖" : ""}
      {c.ap !== undefined && <span className={s.apCost}>{c.ap}</span>}
    </button>
  );

  // Without a map or a board (creation, death) the story takes the stage.
  const stageIsText = !board && !exploring;
  const sideLog = board ? battle : log;

  return (
    <div className={s.shell}>
      <div className={s.status}><StatusStrip view={view} district /></div>

      <main className={s.stage}>
        {board && (
          <>
            <BattleGrid view={view} submit={submit} armed={armed} onArmedDone={() => setArmed(null)} className={s.board} />
            <EnemyStrip view={view} />
            {armed && <div className={s.hint}>Tap a highlighted tile for {armed.label}. Tap the button again to cancel.</div>}
          </>
        )}
        {!board && exploring && (
          <div className={s.mapWrap}>
            <MiniMapGrid
              view={view}
              moves={moves}
              tile={`clamp(34px, min(calc(var(--map-w) / ${view.mapGrid!.width}), calc(var(--map-h) / ${view.mapGrid!.height})), 80px)`}
            />
          </div>
        )}
        {stageIsText && (
          <>
            {inCombat && <EnemyStrip view={view} />}
            <div className={s.story}>
              <LogView events={inCombat ? battle : log} />
            </div>
          </>
        )}
      </main>

      <aside className={s.side}>
        {!stageIsText || inCombat ? (
          <section className={`${s.card} ${logShown ? s.cardGrow : ""}`}>
            <header className={s.cardHead}>
              <Toggle label={board ? "Battle log" : "Event log"} shown={logShown} onClick={toggleLog} />
            </header>
            {logShown && (
              <div className={s.cardBody}>
                <LogView events={inCombat && !board ? log : sideLog} />
              </div>
            )}
          </section>
        ) : null}
        <section className={`${s.card} ${tabsShown ? s.cardGrow : ""}`}>
          <header className={s.cardHead}>
            <Toggle label={tabsShown ? "" : "Sheets"} shown={tabsShown} onClick={toggleTabs} />
            {tabsShown && (
              <div className={s.tabBar} role="tablist">
                {TABS.map((t) => (
                  <button key={t.id} role="tab" aria-selected={tab === t.id} className={`${s.tab} ${tab === t.id ? s.tabOn : ""}`} onClick={() => setTab(t.id)}>
                    {t.label}
                    {t.id === "character" && (view.character?.unspentStatPoints ?? 0) > 0 && (
                      <span style={{ color: "var(--system)" }}> +{view.character!.unspentStatPoints}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </header>
          {tabsShown && (
            <div className={s.cardBody}>
              {tab === "character" && <CharacterSheet view={view} submit={submit} />}
              {tab === "equipment" && <EquipmentList view={view} submit={submit} />}
              {tab === "inventory" && <InventoryList view={view} submit={submit} />}
              {tab === "crafting" && <RecipeBook view={view} submit={submit} />}
              {tab === "effects" && <EffectsList view={view} />}
              {tab === "guide" && <GuideSheet view={view} submit={submit} />}
              {tab === "echo" && (
                <>
                  <EchoPanel view={view} />
                  <div className={s.tabSub}>Codex</div>
                  <CodexSheet view={view} />
                </>
              )}
            </div>
          )}
        </section>
      </aside>

      <footer className={s.actions}>
        <div className={s.actionRow}>
          {exploring && view.room?.workbench && (
            <button className={`${s.act} ${s.on}`} onClick={openBench}>⚒ Workbench</button>
          )}
          {main.map((c) => button(c, s.act!))}
          <div className={s.moreWrap}>
            <button className={s.act} aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
              More {moreOpen ? "▴" : "▾"}
            </button>
            {moreOpen && (
              <>
                <div className={s.backdrop} onClick={() => setMoreOpen(false)} />
                <div className={s.more} role="menu">
                  {niche.map((c) => button(c, s.moreItem!))}
                  {view.character && (
                    <button
                      className={s.moreItem}
                      onClick={() => { setMoreOpen(false); submit(`set combat ${view.settings.combatMode === "grid" ? "bands" : "grid"}`); }}
                    >
                      Combat: {view.settings.combatMode === "grid" ? "Grid" : "Bands"} ⇄
                    </button>
                  )}
                  <button className={s.moreItem} onClick={() => { setMoreOpen(false); setTyping((t) => !t); }}>
                    {typing ? "Hide the command line" : "Type a command"}
                  </button>
                  <button className={s.moreItem} onClick={layout.cycle}>{layout.label} ⇄</button>
                </div>
              </>
            )}
          </div>
        </div>
        {typing && (
          <div className={s.typeBar}>
            <InputBar commands={[]} onSubmit={submit} onLocal={onLocal} />
          </div>
        )}
      </footer>
    </div>
  );
}
