/**
 * Phone-sized shell: one full-screen view at a time, switched from a corner menu.
 * "Map" is the home view while exploring — minimap center stage, a readable
 * narration feed, and thumb-sized controls. Combat takes over automatically.
 */
import { useEffect, useRef, useState } from "react";
import type { CommandOption, GameEvent, ViewModel } from "@crawler/engine";
import { EnemyStrip, LogView } from "./LogView";
import { CharacterSheet, EffectsList, EquipmentList, InventoryList } from "./Sheets";
import { InputBar } from "./InputBar";
import { MiniMapGrid } from "./MiniMapGrid";
import s from "./mobile.module.css";

type Screen = "map" | "log" | "battle" | "character" | "equipment" | "effects" | "inventory";

const MENU: { id: Screen; label: string }[] = [
  { id: "map", label: "Map" },
  { id: "log", label: "Event log" },
  { id: "character", label: "Character" },
  { id: "equipment", label: "Equipment" },
  { id: "effects", label: "Effects" },
  { id: "inventory", label: "Inventory" },
];

const DIRS = ["north", "west", "east", "south"] as const;

interface ShellProps {
  view: ViewModel;
  log: GameEvent[];
  battle: GameEvent[];
  commands: CommandOption[];
  submit: (text: string) => void;
  onLocal: (text: string) => boolean;
}

export function MobileShell({ view, log, battle, commands, submit, onLocal }: ShellProps) {
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
            </button>
          ))}
        </nav>
      )}

      {current === "map" && <NavView view={view} log={log} commands={commands} submit={submit} />}
      {current === "battle" && <BattleView view={view} battle={battle} commands={commands} submit={submit} />}
      {current === "log" && (
        <div className={s.logScreen}>
          <div className={s.logScroll}>
            <LogView events={log} />
          </div>
          <InputBar commands={commands} onSubmit={submit} onLocal={onLocal} />
        </div>
      )}
      {current === "character" && <Sheet><CharacterSheet view={view} /></Sheet>}
      {current === "equipment" && <Sheet><EquipmentList view={view} /></Sheet>}
      {current === "effects" && <Sheet><EffectsList view={view} /></Sheet>}
      {current === "inventory" && <Sheet><InventoryList view={view} /></Sheet>}
    </div>
  );
}

function Sheet({ children }: { children: React.ReactNode }) {
  return <div className={s.sheet}>{children}</div>;
}

function StatusStrip({ view }: { view: ViewModel }) {
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
    </header>
  );
}

/** The home view: big map, readable feed, d-pad + context actions. */
function NavView({ view, log, commands, submit }: { view: ViewModel; log: GameEvent[]; commands: CommandOption[]; submit: (t: string) => void }) {
  const byInput = new Map(commands.map((c) => [c.input, c]));
  const dir = (d: (typeof DIRS)[number]) => byInput.get(d);
  const context = commands.filter(
    (c) => !DIRS.includes(c.input as never) && !["help", "map", "new"].includes(c.input),
  );

  return (
    <div className={s.nav}>
      <div className={s.mapStage}>
        {view.mapGrid ? <MiniMapGrid view={view} /> : view.minimap ? <pre className={s.map}>{view.minimap.join("\n")}</pre> : <div className={s.noMap}>No floor yet.</div>}
      </div>
      <div className={s.feed}>
        <LogView events={log} tail={30} />
      </div>
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
          {context.map((c) => (
            <button key={c.label} className={`${s.ctxBtn} ${c.primary ? s.ctxPrimary : ""}`} onClick={() => submit(c.input)}>
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

/** Combat on a phone: enemies up top, the blow-by-blow, and big thumb buttons. */
function BattleView({ view, battle, commands, submit }: { view: ViewModel; battle: GameEvent[]; commands: CommandOption[]; submit: (t: string) => void }) {
  return (
    <div className={s.battle}>
      <EnemyStrip view={view} />
      <div className={s.feedGrow}>
        <LogView events={battle} tail={60} />
      </div>
      <div className={s.battleButtons}>
        {commands
          .filter((c) => !["help", "map", "look"].includes(c.input))
          .map((c) => (
            <button key={c.label} className={`${s.ctxBtn} ${c.primary ? s.ctxPrimary : ""}`} onClick={() => submit(c.input)}>
              {c.label}
            </button>
          ))}
      </div>
    </div>
  );
}
