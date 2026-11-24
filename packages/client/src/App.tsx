import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommandOption, Engine } from "@crawler/engine";
import { useGame } from "./useGame";
import { eventsFor } from "./router";
import { readPref, writePref } from "./storage";
import { Panel } from "./panels/Panel";
import { EnemyStrip, LogView } from "./panels/LogView";
import { MobileShell } from "./panels/Mobile";
import { TabletShell } from "./panels/Tablet";
import { useLayout } from "./layout";
import { CharacterSheet, CodexSheet, GuideSheet, EchoPanel, EffectsList, EquipmentList, InventoryList, MiniMap, RecipeBook } from "./panels/Sheets";
import { StatusBar } from "./panels/StatusBar";
import { Ticker } from "./panels/Ticker";
import { InputBar } from "./panels/InputBar";
import { BattleGrid } from "./panels/BattleGrid";
import { ShardPopup } from "./panels/ShardPopup";
import { LevelUpPopup } from "./panels/LevelUpPopup";
import s from "./App.module.css";

export function App({ engine }: { engine: Engine }) {
  const { world, view, commands, submit, resetEverything } = useGame(engine);
  const layoutControl = useLayout();
  const narrow = false; // the dashboard below is only drawn at desktop size
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [codexOpen, setCodexOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [split, setSplit] = useState<boolean>(() => readPref("combatSplit", false));
  /** A grid command waiting for the player to pick a tile. */
  const [armed, setArmed] = useState<CommandOption | null>(null);
  useEffect(() => setArmed(null), [view.phase, world.game.turn]);
  const otherMode = view.settings.combatMode === "grid" ? "bands" : "grid";

  const log = useMemo(() => eventsFor("log", world.game.log), [world.game.log]);
  const battle = useMemo(() => eventsFor("battle", world.game.log), [world.game.log]);
  const ticker = useMemo(() => eventsFor("ticker", world.game.log), [world.game.log]);
  const inCombat = view.phase === "combat";
  const shardPopup = (
    <>
      <ShardPopup log={world.game.log} phase={view.phase} submit={submit} />
      <LevelUpPopup log={world.game.log} view={view} submit={submit} />
    </>
  );

  // Commands handled by the UI itself rather than the engine.
  const onLocal = useCallback(
    (text: string) => {
      const t = text.trim().toLowerCase();
      if (t === "i" || t === "inv" || t === "inventory") {
        setInventoryOpen((o) => !o);
        setCodexOpen(false);
        return true;
      }
      if (layoutControl.layout === "desktop" && (t === "guide sheet" || t === "guide" || t === "g")) {
        setGuideOpen((o) => !o);
        setInventoryOpen(false);
        setCodexOpen(false);
        return true;
      }
      if (t === "codex sheet") {
        setCodexOpen((o) => !o);
        setInventoryOpen(false);
        return true;
      }
      if (t === "wipe save") {
        if (window.confirm("Delete this crawler AND the account (unlocks, codex)? This can't be undone.")) resetEverything();
        return true;
      }
      return false;
    },
    [resetEverything, layoutControl.layout],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setInventoryOpen(false);
        setCodexOpen(false);
        setGuideOpen(false);
        setArmed(null);
      }
      // One key from any main screen.
      if (e.key === "F1") {
        e.preventDefault();
        setGuideOpen((o) => !o);
        setInventoryOpen(false);
        setCodexOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Phones get the full-screen map-first shell instead of the panel dashboard.
  if (layoutControl.layout !== "desktop") {
    const Shell = layoutControl.layout === "phone" ? MobileShell : TabletShell;
    return (
      <>
        <Shell
          view={view}
          log={log}
          battle={battle}
          commands={commands}
          submit={submit}
          onLocal={onLocal}
          armed={armed}
          setArmed={setArmed}
          layout={layoutControl}
        />
        {shardPopup}
      </>
    );
  }

  const main = (
    <div className={`${s.main} ${inCombat && split && !narrow ? s.split : ""}`} style={{ gridArea: "main" }}>
      {inCombat ? (
        <>
          <Panel
            id="battle"
            title="Battle log"
            collapsible={false}
            className={s.grow}
            extra={!narrow && (
              <button className={s.linkBtn} onClick={() => { setSplit(!split); writePref("combatSplit", !split); }}>
                {split ? "stack" : "side-by-side"}
              </button>
            )}
          >
            {view.combat?.grid && (
              <BattleGrid view={view} submit={submit} armed={armed} onArmedDone={() => setArmed(null)} />
            )}
            <EnemyStrip view={view} />
            <LogView events={battle} />
          </Panel>
          <Panel id="log-mini" title="Event log" collapsible={false} className={split && !narrow ? s.grow : s.mini}>
            <LogView events={log} tail={split && !narrow ? undefined : 3} />
          </Panel>
        </>
      ) : (
        <Panel
          id="log"
          title="Event log"
          collapsible={false}
          className={s.grow}
          extra={(
            <span className={s.headLinks}>
              {view.character && (
                <button className={s.linkBtn} title="How the next fight plays" onClick={() => submit(`set combat ${otherMode}`)}>
                  combat: {view.settings.combatMode} ⇄
                </button>
              )}
              <button className={s.linkBtn} title="Switch between the desktop, tablet and phone layouts" onClick={layoutControl.cycle}>
                {layoutControl.label.toLowerCase()} ⇄
              </button>
            </span>
          )}
        >
          <LogView events={log} />
        </Panel>
      )}
      {inventoryOpen && (
        <div className={s.overlay} role="dialog" aria-label="Inventory">
          <Panel
            id="inventory"
            title="Inventory"
            collapsible={false}
            className={s.grow}
            extra={<button className={s.linkBtn} onClick={() => setInventoryOpen(false)}>close [esc]</button>}
          >
            <InventoryList view={view} submit={submit} />
            <div className={s.subhead}>Recipe book</div>
            <RecipeBook view={view} submit={submit} />
          </Panel>
        </div>
      )}
      {guideOpen && (
        <div className={s.overlay} role="dialog" aria-label="Game Guide">
          <Panel
            id="guide"
            title="Game Guide"
            collapsible={false}
            className={s.grow}
            extra={<button className={s.linkBtn} onClick={() => setGuideOpen(false)}>close [esc / F1]</button>}
          >
            <GuideSheet view={view} submit={submit} />
          </Panel>
        </div>
      )}
      {codexOpen && (
        <div className={s.overlay} role="dialog" aria-label="Codex">
          <Panel
            id="codex"
            title="Codex"
            collapsible={false}
            className={s.grow}
            extra={<button className={s.linkBtn} onClick={() => setCodexOpen(false)}>close [esc]</button>}
          >
            <CodexSheet view={view} />
          </Panel>
        </div>
      )}
    </div>
  );

  const side = (
    <aside className={s.side} style={{ gridArea: "side" }}>
      <Panel id="character" title="Character">
        <CharacterSheet view={view} submit={submit} />
      </Panel>
      {view.echo && (
        <Panel id="echo" title="Echo">
          <EchoPanel view={view} />
        </Panel>
      )}
      <Panel id="equipment" title="Equipment">
        <EquipmentList view={view} submit={submit} />
      </Panel>
      <Panel id="effects" title="Active effects">
        <EffectsList view={view} />
      </Panel>
      <Panel id="minimap" title="Mini-map">
        <MiniMap view={view} />
      </Panel>
    </aside>
  );

  return (
    <div className={s.app}>
      <StatusBar view={view} />
      {main}
      {side}
      <Ticker events={ticker} />
      <InputBar
        // the desktop opens the Codex as an overlay instead of printing it
        commands={commands.filter((c) => c.input !== "codex" && c.input !== "guide")}
        onSubmit={submit}
        onLocal={onLocal}
        onArm={setArmed}
        armed={armed}
        extraButtons={view.character
          ? [
              { label: inventoryOpen ? "Close inventory" : "Inventory", input: "inventory" },
              { label: codexOpen ? "Close codex" : "Codex", input: "codex sheet" },
              { label: guideOpen ? "Close guide" : `Guide${view.guide.unseen ? ` (${view.guide.unseen} new)` : ""}`, input: "guide sheet" },
            ]
          : []}
      />
      {shardPopup}
    </div>
  );
}
