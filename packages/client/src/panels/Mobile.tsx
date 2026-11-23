/**
 * Phone-sized shell: one full-screen view at a time, switched from a corner menu.
 * "Map" is the home view while exploring — minimap center stage, a readable
 * narration feed, and thumb-sized controls. Combat takes over automatically.
 */
import { useEffect, useRef, useState } from "react";
import type { CommandOption, GameEvent, ViewModel } from "@crawler/engine";
import { EnemyStrip, LogView } from "./LogView";
import { CharacterSheet, CodexSheet, EchoPanel, EffectsList, EquipmentList, InventoryList, RecipeBook } from "./Sheets";
import { InputBar } from "./InputBar";
import { MiniMapGrid } from "./MiniMapGrid";
import { BattleGrid } from "./BattleGrid";
import { readPref, writePref } from "../storage";
import type { LayoutControl } from "../layout";
import s from "./mobile.module.css";

type Screen = "map" | "log" | "battle" | "character" | "equipment" | "effects" | "inventory" | "recipes" | "echo";

const MENU: { id: Screen; label: string }[] = [
  { id: "map", label: "Map" },
  { id: "log", label: "Event log" },
  { id: "character", label: "Character" },
  { id: "equipment", label: "Equipment" },
  { id: "effects", label: "Effects" },
  { id: "inventory", label: "Inventory" },
  { id: "recipes", label: "Crafting" },
  { id: "echo", label: "Echo & Codex" },
];

const DIRS = ["north", "west", "east", "south"] as const;

/** A show/hide switch that remembers itself on this device. */
export function useShown(key: string): [boolean, () => void] {
  const [shown, setShown] = useState<boolean>(() => readPref(key, true));
  const toggle = () => setShown((v) => { writePref(key, !v); return !v; });
  return [shown, toggle];
}

export function Toggle({ label, shown, onClick }: { label: string; shown: boolean; onClick: () => void }) {
  return (
    <button className={`${s.toggle} ${shown ? s.toggleOn : ""}`} aria-pressed={shown} onClick={onClick}>
      {shown ? "▾" : "▸"}{label ? ` ${label}` : ""}
    </button>
  );
}

export interface ShellProps {
  view: ViewModel;
  log: GameEvent[];
  battle: GameEvent[];
  commands: CommandOption[];
  submit: (text: string) => void;
  onLocal: (text: string) => boolean;
  armed: CommandOption | null;
  setArmed: (c: CommandOption | null) => void;
  layout: LayoutControl;
}

export function MobileShell({ view, log, battle, commands, submit, onLocal, armed, setArmed, layout }: ShellProps) {
  const [screen, setScreen] = useState<Screen>("map");
  const [menuOpen, setMenuOpen] = useState(false);
  const inCombat = view.phase === "combat";
  const exploring = view.phase === "exploring" && view.minimap;
  const wasCombat = useRef(false);

  // Combat seizes the screen; when it ends, land back on the map (or the log if the run is over).
  useEffect(() => {
    if (inCombat && !wasCombat.current) setScreen("battle");
    if (!inCombat && wasCombat.current) setScreen(view.phase === "exploring" ? "map" : "log");
    wasCombat.current = inCombat;
  }, [inCombat, view.phase]);

  // Creation and death talk to you in text; stepping into the dungeon opens the map.
  const prevPhase = useRef(view.phase);
  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = view.phase;
    if (view.phase === "creation" || view.phase === "dead") setScreen("log");
    else if (view.phase === "exploring" && prev === "creation") setScreen("map");
  }, [view.phase]);

  const pick = (id: Screen) => {
    setScreen(id);
    setMenuOpen(false);
  };

  const effective: Screen = screen === "battle" && !inCombat ? "map" : screen;
  const current =
    effective === "map" && !exploring && !inCombat ? "log" : effective;

  return (
    <div className={s.shell}>
      <StatusStrip view={view} />
      <button className={s.menuBtn} aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
        ☰
      </button>
      {menuOpen && <div className={s.menuBackdrop} onClick={() => setMenuOpen(false)} />}
      {menuOpen && (
        <nav className={s.menu}>
          {inCombat && (
            <button className={`${s.menuItem} ${current === "battle" ? s.menuOn : ""}`} onClick={() => pick("battle")}>
              ⚔ Battle
            </button>
          )}
          {MENU.map((m) => (
            <button key={m.id} className={`${s.menuItem} ${current === m.id ? s.menuOn : ""}`} onClick={() => pick(m.id)}>
              {m.label}
              {m.id === "character" && (view.character?.unspentStatPoints ?? 0) > 0 && (
                <span className={s.stripPts}> +{view.character!.unspentStatPoints} pts</span>
              )}
            </button>
          ))}
          <button
            className={s.menuItem}
            onClick={() => {
              submit(`set combat ${view.settings.combatMode === "grid" ? "bands" : "grid"}`);
              setMenuOpen(false);
            }}
          >
            Combat: {view.settings.combatMode === "grid" ? "Grid" : "Bands"} ⇄
          </button>
          <button className={s.menuItem} onClick={layout.cycle}>{layout.label} ⇄</button>
        </nav>
      )}

      {current === "map" && <NavView view={view} log={log} commands={commands} submit={submit} openBench={() => pick("recipes")} />}
      {current === "battle" && (
        <BattleView view={view} battle={battle} commands={commands} submit={submit} armed={armed} setArmed={setArmed} />
      )}
      {current === "log" && (
        <div className={s.logScreen}>
          <div className={s.logScroll}>
            <LogView events={log} />
          </div>
          <InputBar commands={commands} onSubmit={submit} onLocal={onLocal} />
        </div>
      )}
      {current === "character" && <Sheet><CharacterSheet view={view} submit={submit} /></Sheet>}
      {current === "equipment" && <Sheet><EquipmentList view={view} submit={submit} /></Sheet>}
      {current === "effects" && <Sheet><EffectsList view={view} /></Sheet>}
      {current === "inventory" && <Sheet><InventoryList view={view} submit={submit} /></Sheet>}
      {current === "echo" && <Sheet><EchoPanel view={view} /><div className={s.sheetSub}>Codex</div><CodexSheet view={view} /></Sheet>}
      {current === "recipes" && (
        <div className={s.logScreen}>
          <Sheet><RecipeBook view={view} submit={submit} /></Sheet>
          {/* what the last attempt did, without leaving the bench */}
          <div className={s.benchFeed}>
            <LogView events={log} tail={4} />
          </div>
        </div>
      )}
    </div>
  );
}

function Sheet({ children }: { children: React.ReactNode }) {
  return <div className={s.sheet}>{children}</div>;
}

export function StatusStrip({ view }: { view: ViewModel }) {
  const st = view.status;
  const hp = st.hp;
  return (
    <header className={s.strip}>
      <span className={s.stripFloor}>{st.floor ? `F${st.floor}` : "PRE-SHOW"}</span>
      {st.room && <span className={s.stripRoom}>{st.room}</span>}
      {st.timer && <span className={s.stripTimer}>⌛ {st.timer}</span>}
      {hp && (
        <span className={s.stripHp} style={{ color: hp.current / hp.max < 0.35 ? "var(--danger)" : undefined }}>
          HP {hp.current}/{hp.max}
        </span>
      )}
      {st.level !== null && st.xp && (
        <span className={s.stripLv} title={`${st.xp.current}/${st.xp.max} XP to level ${st.level + 1}`}>
          Lv{st.level}
          {(view.character?.unspentStatPoints ?? 0) > 0 && <span className={s.stripPts}> +{view.character!.unspentStatPoints}</span>}
        </span>
      )}
      {st.xp && (
        <span className={s.stripXp} aria-hidden>
          <span style={{ width: `${Math.max(0, Math.min(100, (st.xp.current / Math.max(1, st.xp.max)) * 100))}%` }} />
        </span>
      )}
    </header>
  );
}

/** The home view: big map, readable feed, d-pad + context actions. */
function NavView({ view, log, commands, submit, openBench }: { view: ViewModel; log: GameEvent[]; commands: CommandOption[]; submit: (t: string) => void; openBench: () => void }) {
  const byInput = new Map(commands.map((c) => [c.input, c]));
  const dir = (d: (typeof DIRS)[number]) => byInput.get(d);
  const context = commands.filter(
    (c) => !DIRS.includes(c.input as never) && !["help", "map", "new", "recipes"].includes(c.input),
  );

  const [mapShown, toggleMap] = useShown("mobileMap");
  const [logShown, toggleLog] = useShown("mobileLog");

  return (
    <div className={s.nav}>
      <div className={s.toggles}>
        <Toggle label="Map" shown={mapShown} onClick={toggleMap} />
        <Toggle label="Event log" shown={logShown} onClick={toggleLog} />
      </div>
      {mapShown && (
        <div className={`${s.mapStage} ${logShown ? "" : s.mapAlone}`}>
          {view.mapGrid ? <MiniMapGrid view={view} /> : view.minimap ? <pre className={s.map}>{view.minimap.join("\n")}</pre> : <div className={s.noMap}>No floor yet.</div>}
        </div>
      )}
      {logShown && (
        <div className={s.feed}>
          <LogView events={log} tail={mapShown ? 30 : 80} />
        </div>
      )}
      <div className={s.controls}>
        <div className={s.dpad}>
          <span />
          <DirBtn cmd={dir("north")} glyph="▲" name="North" submit={submit} />
          <span />
          <DirBtn cmd={dir("west")} glyph="◀" name="West" submit={submit} />
          <DirBtn cmd={dir("south")} glyph="▼" name="South" submit={submit} />
          <DirBtn cmd={dir("east")} glyph="▶" name="East" submit={submit} />
        </div>
        <div className={s.context}>
          {view.room?.workbench && (
            <button className={`${s.ctxBtn} ${s.ctxPrimary}`} onClick={openBench}>⚒ Workbench</button>
          )}
          {context.map((c) => (
            <button key={`${c.label}|${c.input}`} className={`${s.ctxBtn} ${c.primary ? s.ctxPrimary : ""}`} onClick={() => submit(c.input)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DirBtn({ cmd, glyph, name, submit }: { cmd?: CommandOption; glyph: string; name: string; submit: (t: string) => void }) {
  return (
    <button
      className={s.dirBtn}
      disabled={!cmd}
      aria-label={name}
      onClick={() => cmd && submit(cmd.input)}
    >
      {glyph}
    </button>
  );
}

interface BattleProps {
  view: ViewModel;
  battle: GameEvent[];
  commands: CommandOption[];
  submit: (t: string) => void;
  armed: CommandOption | null;
  setArmed: (c: CommandOption | null) => void;
}

/** Combat on a phone: the board (grid mode) or the enemy strip, the blow-by-blow, and big thumb buttons. */
function BattleView({ view, battle, commands, submit, armed, setArmed }: BattleProps) {
  const grid = !!view.combat?.grid;
  const [logShown, toggleLog] = useShown("mobileBattleLog");
  return (
    <div className={s.battle}>
      {grid && <BattleGrid view={view} submit={submit} armed={armed} onArmedDone={() => setArmed(null)} />}
      <EnemyStrip view={view} />
      <div className={s.toggles}>
        <Toggle label="Battle log" shown={logShown} onClick={toggleLog} />
      </div>
      {logShown && (
        <div className={s.feedGrow}>
          <LogView events={battle} tail={grid ? 20 : 60} />
        </div>
      )}
      <div className={s.battleButtons}>
        {commands
          .filter((c) => !["help", "map", "look"].includes(c.input))
          .map((c) => (
            <button
              key={`${c.label}|${c.input}`}
              className={`${s.ctxBtn} ${c.primary && !c.disabled || armed?.label === c.label ? s.ctxPrimary : ""}`}
              disabled={c.disabled}
              onClick={() => (c.targets ? setArmed(armed?.label === c.label ? null : c) : submit(c.input))}
            >
              {c.label}{c.targets ? " ⌖" : ""}
              {c.ap !== undefined && <span className={s.apCost}>{c.ap}</span>}
            </button>
          ))}
      </div>
    </div>
  );
}
