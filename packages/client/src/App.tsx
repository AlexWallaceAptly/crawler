import { useCallback, useEffect, useMemo, useState } from "react";
import type { Engine, ViewModel } from "@crawler/engine";
import { useGame } from "./useGame";
import { eventsFor } from "./router";
import { readPref, writePref } from "./storage";
import { Panel } from "./panels/Panel";
import { EnemyStrip, LogView } from "./panels/LogView";
import { MobileShell } from "./panels/Mobile";
import { CharacterSheet, EffectsList, EquipmentList, InventoryList, MiniMap } from "./panels/Sheets";
import { StatusBar } from "./panels/StatusBar";
import { Ticker } from "./panels/Ticker";
import { InputBar } from "./panels/InputBar";
import s from "./App.module.css";

function useNarrow(query = "(max-width: 899px)") {
  const get = () => typeof window !== "undefined" && window.matchMedia(query).matches;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

export function App({ engine }: { engine: Engine }) {
  const { world, view, commands, submit, resetEverything } = useGame(engine);
  const narrow = useNarrow();
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [split, setSplit] = useState<boolean>(() => readPref("combatSplit", false));

  const log = useMemo(() => eventsFor("log", world.game.log), [world.game.log]);
  const battle = useMemo(() => eventsFor("battle", world.game.log), [world.game.log]);
  const ticker = useMemo(() => eventsFor("ticker", world.game.log), [world.game.log]);
  const inCombat = view.phase === "combat";

  // Commands handled by the UI itself rather than the engine.
  const onLocal = useCallback(
    (text: string) => {
      const t = text.trim().toLowerCase();
      if (t === "i" || t === "inv" || t === "inventory") {
        setInventoryOpen((o) => !o);
        return true;
      }
      if (t === "wipe save") {
        if (window.confirm("Delete this crawler AND the account (unlocks, codex)? This can't be undone.")) resetEverything();
        return true;
      }
      return false;
    },
    [resetEverything],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInventoryOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Phones get the full-screen map-first shell instead of the panel dashboard.
  if (narrow) {
    return (
      <MobileShell
        view={view}
        log={log}
        battle={battle}
        commands={commands}
        submit={submit}
        onLocal={onLocal}
      />
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
            <EnemyStrip view={view} />
            <LogView events={battle} />
          </Panel>
          <Panel id="log-mini" title="Event log" collapsible={false} className={split && !narrow ? s.grow : s.mini}>
            <LogView events={log} tail={split && !narrow ? undefined : 3} />
          </Panel>
        </>
      ) : (
        <Panel id="log" title="Event log" collapsible={false} className={s.grow}>
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
            <InventoryList view={view} />
          </Panel>
        </div>
      )}
    </div>
  );

  const side = (
    <aside className={s.side} style={{ gridArea: "side" }}>
      <Panel id="character" title="Character">
        <CharacterSheet view={view} />
      </Panel>
      <Panel id="equipment" title="Equipment">
        <EquipmentList view={view} />
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
        commands={commands}
        onSubmit={submit}
        onLocal={onLocal}
        extraButtons={view.character ? [{ label: inventoryOpen ? "Close inventory" : "Inventory", input: "inventory" }] : []}
      />
    </div>
  );
}
