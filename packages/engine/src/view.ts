import { bfsDistances } from "./gen/floor";
import { safeServices, type SafeService } from "./hooks";
import { GUIDE_SECTIONS, unseenGuide } from "./guide";
import { sleepStage } from "./rules/sleep";
/**
 * UI-facing projection of the world. Panels render from this, never from raw state.
 */
import type { Content } from "./content/load";
import { STATS, type Stat } from "./content/schemas";
import { formatTimer, mapGrid, renderMap, roomBadge, type MapGrid } from "./explore";
import { collectModifiers, derive } from "./rules/derived";
import { nextPerk, perkName, skillLine, skillProgress, skillRank, xpToNext } from "./progression";
import { AP_COST, apNow } from "./rules/ap";
import { combatModeOf, EQUIP_SLOTS, type CombatMode, type EquipSlot, type Phase, type World } from "./state";
import { gridView, type GridView } from "./grid/view";
import { coord } from "./grid/geometry";
import { partsOf, recipeBook, workbenchChips, type RecipeBookView, type WorkbenchChip } from "./craft";
import type { RangeBand } from "./content/schemas";
import { codexView, sideOf, stageOn, vesselOf, wholenessOn, type CodexView, type Side } from "./echo";
import { moduleItemDetails, moduleViews, type ModuleView } from "./modules";
import { itemInfo } from "./itemInfo";
import { heldWeapon, profileOf, swingNumbers, weaponFit } from "./gear";
import { spellViews, type SpellView } from "./spells";
import { achievementList } from "./achievements";
import { accountCodexView, type AccountCodexView } from "./accountCodex";
import { kitFor, ownedKits, runEndView, unlockViews, type RunEndView, type UnlockView } from "./legacy";
import { boxName } from "./boxes";
import { moodWord } from "./mood";
import { shopView, type ShopView } from "./shop";

export interface Bar {
  current: number;
  max: number;
}

export interface ItemView {
  uid: string;
  name: string;
  rarity: string;
  detail: string[];
  /** Crafting properties this counts as ("Bind", "Sharp"), if any. */
  parts?: string[];
  equippedIn?: EquipSlot;
  qty: number;
  kind: "gear" | "consumable";
  /** Gear: one line for the list ("6/8/10 dmg · DEX · 2 AP", "armor 1"). */
  summary?: string;
  /** Gear you aren't using: would equipping it be better, worse, or a trade-off? */
  verdict?: "better" | "worse" | "mixed" | "same";
}

export interface GuideView {
  unseen: number;
  sections: { id: string; name: string; entries: { id: string; title: string; text: string; isNew: boolean }[] }[];
}

function guideView(game: World["game"]): GuideView {
  const sections: GuideView["sections"] = GUIDE_SECTIONS.map((sec) => ({
    id: sec.id,
    name: sec.name,
    entries: game.guide.filter((e) => e.section === sec.id).map((e) => ({ id: e.id, title: e.title, text: e.text, isNew: !e.seen })),
  })).filter((sec) => sec.entries.length > 0);
  const floor = game.floor;
  if (floor) {
    // The map is live, not a stored entry: the floor so far, and every safe room you know about.
    const dist = bfsDistances(floor.rooms, floor.currentRoom);
    const safe = floor.rooms.filter((r) => r.type === "safe" && (r.visited || r.marked));
    const where = (r: (typeof safe)[number]) => (r.id === floor.currentRoom ? "you are here" : `${dist[r.id]} rooms away`);
    sections.unshift({
      id: "map",
      name: "Map",
      entries: [
        { id: "map.floor", title: "The floor so far", text: trimMap(renderMap(floor)).join("\n"), isNew: false },
        {
          id: "map.safe", title: "Safe rooms found",
          text: safe.length ? safe.map((r) => `${r.name}: ${where(r)}`).join("\n") : "None yet. They are marked S on the map once you have seen one.",
          isNew: false,
        },
      ],
    });
  }
  return { unseen: unseenGuide(game), sections };
}

export interface RewardsView {
  boxes: { id: string; name: string; tier: string; boxType: string; source: string }[];
  achievements: { id: string; name: string; group: string; earned: boolean; times: number; text: string; reward: string; progress?: { have: number; need: number } }[];
  earned: number;
  total: number;
  mood: { value: number; word: string };
  /** Only in a safe room with a shop. */
  shop: ShopView | null;
  /** Boxes can be opened right now (a safe room, not mid-fight). */
  canOpen: boolean;
}

export interface ViewModel {
  phase: Phase;
  status: {
    floor: number | null;
    district: string | null;
    timer: string | null;
    /** Day and time on this run's clock ("Day 2, 14:30"). */
    clock: string | null;
    /** Sleep state ("Tired"), or null while rested. */
    sleep: string | null;
    /** Current room name, with its badge if the type is player-visible ("SAFE ROOM"). */
    room: string | null;
    hp: Bar | null;
    mp: Bar | null;
    xp: Bar | null;
    level: number | null;
  };
  character: null | {
    name: string;
    subtitle: string;
    race: string;
    charClass: string;
    level: number;
    stats: { stat: Stat; value: number; base: number }[];
    derived: { label: string; value: string }[];
    /** Each skill you've used: rank, progress to the next, and the next milestone perk. */
    skills: {
      id: string; name: string; rank: number;
      /** With gear bonuses (`skill:<id>`): what rolls use. */
      effective: number;
      xp: number; next: number;
      nextPerk?: { rank: number; name: string; text: string };
      /** Perks already unlocked. */
      perks: { rank: number; name: string; text: string }[];
    }[];
    /** Spells you know: level and progress, cost, cooldown, and what each does with your INT. */
    spells: SpellView[];
    quirk: { name: string; text: string };
    unspentStatPoints: number;
    gold: number;
    /** How you fight right now: the swing in your hand, armor, and which stat suits you. */
    fighting: {
      weapon: string;
      stat: "STR" | "DEX" | "INT";
      /** "Blades 2 · 4/10 to rank 3 · rank 5: Decapitation" */
      skill: string | null;
      roll: number;
      damage: string;
      odds: [number, number, number];
      average: number;
      apCost: number;
      armor: number;
      guard: number;
      /** "Your DEX (9) beats your STR (5): weapons marked DEX hit harder for you." */
      fit: string;
    };
  };
  equipment: { slot: EquipSlot; label: string; item: ItemView | null }[];
  inventory: ItemView[];
  effects: { name: string; kind: "buff" | "debuff"; remaining: number; stacks: number }[];
  combat: null | {
    round: number;
    mode: CombatMode;
    /** Action points left this turn, and what the turn started with. */
    ap: Bar;
    /** What a swing of the weapon in hand costs. */
    attackCost: number;
    /** Grid fights: the board, with every tap and highlight decided by the engine. */
    grid?: GridView;
    enemies: { uid: string; name: string; hp: Bar; range: string; statuses: string[]; elite: boolean; tier: string; mark?: string; at?: string }[];
  };
  /** Recipes you've discovered, and hints for ones your pack could make. */
  recipeBook: RecipeBookView | null;
  /** Your pack grouped by crafting property, for the workbench. */
  workbench: WorkbenchChip[] | null;
  /** The thing in your pocket. */
  echo: null | {
    vessel: string;
    wholeness: number;
    stage: string;
    act: number;
    /** -5 Calm .. +5 Fed. */
    temper: number;
    temperMin: number;
    temperMax: number;
    side: Side;
    /** Built and unlocked modules, with what they do at this Temper. */
    modules: ModuleView[];
    shards: number;
    /** What Echo is asking to do, if anything. */
    urge: string | null;
  };
  /** The run's Game Guide: reference text kept off the main screens. */
  guide: GuideView;
  /** What the account remembers across runs: the thread Codex, and (`records`) the enemies, items and achievements ever found. */
  codex: CodexView & { records: AccountCodexView };
  /** The end-of-run screen (Milestone 8): the legacy tally, the bequest pick. Null unless a run just ended. */
  runEnd: RunEndView | null;
  /** Rewards (Milestone 7): unopened boxes, achievements, the System AI's mood, and the shop in this room. */
  rewards: RewardsView;
  /** The room you're in: what's on the floor, and whether you can craft here. */
  room: null | { items: ItemView[]; workbench: boolean; /** Safe rooms: what they offer (slots for Milestone 7 are listed unavailable). */ services: SafeService[] };
  minimap: string[] | null;
  /** Structured map for the tile minimap; `minimap` stays as the text/fallback form. */
  mapGrid: MapGrid | null;
  account: {
    legacyPoints: number; legacyEarned: number; rerolls: number; runs: number; deaths: number; bestFloor: number;
    /** Everything legacy points buy, with what's owned and affordable. */
    unlocks: UnlockView[];
    /** The starting-kit unlock the next crawler takes, and the ones owned. */
    kit: { current: string | null; owned: { id: string; name: string }[] };
    /** A bequest waiting for the next crawler's Floor 1. */
    bequest: { name: string; from: string } | null;
  };
  settings: { combatMode: CombatMode };
}

const SLOT_LABELS: Record<EquipSlot, string> = {
  mainHand: "Main", offHand: "Off", head: "Head", eyes: "Eyes", chest: "Chest", hands: "Hands", legs: "Legs",
  feet: "Feet", back: "Back", belt: "Belt", neck: "Neck", ring1: "Ring", ring2: "Ring",
};

export function view(world: World, content: Content): ViewModel {
  const { game, account } = world;
  const c = game.crawler;
  const kit = kitFor(content, account);
  const accountView: ViewModel["account"] = {
    legacyPoints: account.legacyPoints, legacyEarned: account.legacyEarned ?? 0, rerolls: account.rerolls, runs: account.runs,
    deaths: account.deaths, bestFloor: account.bestFloor,
    unlocks: unlockViews(content, account),
    kit: { current: kit?.name ?? null, owned: ownedKits(content, account).map((k) => ({ id: k.id, name: k.name })) },
    bequest: account.bequest ? { name: account.bequest.item.name, from: account.bequest.from } : null,
  };
  const codex = { ...codexView(content, account), records: accountCodexView(content, account) };
  if (!c) {
    return {
      phase: game.phase,
      status: { floor: null, district: null, timer: null, clock: null, sleep: null, room: null, hp: null, mp: null, xp: null, level: null },
      character: null, equipment: [], inventory: [], effects: [], combat: null, recipeBook: null, workbench: null, room: null, minimap: null, mapGrid: null, account: accountView,
      settings: { combatMode: combatModeOf(account) },
      echo: null,
      codex,
      runEnd: null,
    guide: guideView(game),
      rewards: { boxes: [], achievements: [], earned: 0, total: content.achievements.all.length, mood: { value: 0, word: moodWord(0) }, shop: null, canOpen: false },
    };
  }
  const d = derive(c, content);
  const achievements = achievementList({ content, game, account });
  const slotOf = new Map(Object.entries(c.equipment).map(([slot, uid]) => [uid, slot as EquipSlot]));

  const itemView = (uid: string, from = c.inventory): ItemView | null => {
    const it = from.find((i) => i.uid === uid);
    if (!it) return null;
    const info = itemInfo(c, content, it);
    const detail = info.detail;
    const parts = partsOf(it, content);
    if (parts.length) detail.push(`crafting: ${parts.join(", ").toLowerCase()}`);
    if (it.tags.includes("module_part")) detail.push("one of Echo's module parts");
    detail.push(...moduleItemDetails(game, content, it));
    detail.push(`weight ${Math.round(it.weight * it.qty * 10) / 10}`);
    if (it.flavor) detail.push(it.flavor);
    const slot = slotOf.get(it.uid);
    return {
      uid: it.uid, name: it.name, rarity: it.rarity, detail, qty: it.qty, kind: it.kind,
      ...(parts.length ? { parts } : {}), ...(slot ? { equippedIn: slot } : {}),
      ...(info.summary ? { summary: info.summary } : {}), ...(info.verdict ? { verdict: info.verdict } : {}),
    };
  };

  const occ = content.backstory.occupations.byId[c.backstory.occupation];
  const quirk = content.backstory.quirks.byId[c.backstory.quirk];

  const floor = game.floor;
  const room = floor ? floor.rooms[floor.currentRoom]! : null;
  const badge = room ? roomBadge(room) : undefined;

  return {
    phase: game.phase,
    status: {
      floor: floor ? floor.floor : null,
      district: null, // one district per floor until Floor 2
      timer: floor ? formatTimer(floor.timeLeft) : null,
      clock: floor ? formatClock(game.clock) : null,
      sleep: sleepStage(c, content).id === "rested" ? null : sleepStage(c, content).name,
      room: room ? (badge ? `${room.name} [${badge}]` : room.name) : null,
      hp: { current: c.hp, max: d.maxHP },
      mp: { current: c.mp, max: d.maxMP },
      xp: { current: c.xp, max: xpToNext(c.level) },
      level: c.level,
    },
    character: {
      name: c.name,
      subtitle: `${c.age}, ${occ?.name ?? "unknown"}, ${c.hometown}`,
      race: c.race ? (c.race) : "Human (unchosen)",
      charClass: c.charClass ?? "None yet",
      level: c.level,
      stats: STATS.map((s) => ({ stat: s, value: d.stats[s], base: c.baseStats[s] })),
      derived: [
        { label: "Armor", value: String(d.armor) },
        { label: "Init", value: `+${d.initiativeBonus}` },
        { label: "Regen", value: `${d.hpRegen} HP / ${d.mpRegen} MP` },
        { label: "Carry", value: `${Math.round(d.carried * 10) / 10}/${d.carryLimit}` },
      ],
      skills: (() => {
        const mods = collectModifiers(c, content);
        return Object.keys(c.skills)
          .map((id) => {
            const p = skillProgress(c, content, id);
            const coming = nextPerk(content, id, p.rank);
            const perks = (content.skills.byId[id]?.perks ?? []).filter((x) => x.rank <= p.rank);
            return {
              id, name: p.name, rank: p.rank, effective: skillRank(c, id, mods), xp: p.xp, next: p.next,
              ...(coming ? { nextPerk: { rank: coming.rank, name: perkName(coming), text: coming.text } } : {}),
              perks: perks.map((x) => ({ rank: x.rank, name: perkName(x), text: x.text })),
            };
          })
          .sort((a, b) => b.rank - a.rank || b.xp - a.xp || a.name.localeCompare(b.name));
      })(),
      spells: spellViews(c, content),
      quirk: { name: quirk?.name ?? "", text: quirk?.text ?? "" },
      unspentStatPoints: c.unspentStatPoints,
      gold: c.gold,
      fighting: (() => {
        const w = profileOf(content, heldWeapon(c), c);
        const sw = swingNumbers(c, content, w, d);
        return {
          weapon: w.name, stat: w.stat, skill: w.skillId ? skillLine(c, content, w.skillId, "swings") : null, roll: sw.rollBonus,
          damage: sw.damage.join("/"), odds: sw.odds, average: sw.average, apCost: w.apCost,
          armor: d.armor, guard: d.guard, fit: weaponFit(c, content, d).text,
        };
      })(),
    },
    equipment: EQUIP_SLOTS.map((slot) => ({
      slot,
      label: SLOT_LABELS[slot],
      item: c.equipment[slot] ? itemView(c.equipment[slot]!) : null,
    })),
    inventory: c.inventory.map((it) => itemView(it.uid)!).filter(Boolean),
    effects: c.statuses.map((s) => ({
      name: content.statusEffects.byId[s.id]?.name ?? s.id,
      kind: content.statusEffects.byId[s.id]?.kind ?? "debuff",
      remaining: s.remaining,
      stacks: s.stacks,
    })),
    combat: game.combat
      ? {
          round: game.combat.round,
          mode: game.combat.mode,
          ap: (() => { const n = apNow(game.combat, c, content); return { current: n.ap, max: n.max }; })(),
          attackCost: weaponInHand(c)?.apCost ?? (weaponInHand(c) ? AP_COST.attack : 1),
          ...(game.combat.arena && floor
            ? { grid: gridView(game.combat, c, floor.theme, content, weaponReach(c)) }
            : {}),
          enemies: game.combat.enemies
            .filter((e) => e.hp > 0)
            .map((e) => ({
              uid: e.uid,
              name: e.name,
              hp: { current: e.hp, max: e.maxHP },
              range: e.range,
              statuses: e.statuses.map((s) => content.statusEffects.byId[s.id]?.name ?? s.id),
              elite: e.tier === "elite" || e.tier === "boss",
              tier: e.tier,
              ...(e.mark ? { mark: e.mark } : {}),
              ...(e.pos ? { at: coord(e.pos) } : {}),
            })),
        }
      : null,
    recipeBook: recipeBook(c, content),
    workbench: workbenchChips(c, content),
    room: room
      ? {
          items: (room.items ?? []).map((it) => itemView(it.uid, room.items)!).filter(Boolean),
          workbench: room.type === "safe" || !!room.workbench,
          services: safeServices(room, game.boxes.length),
        }
      : null,
    minimap: floor ? renderMap(floor) : null,
    mapGrid: floor ? mapGrid(floor) : null,
    account: accountView,
    settings: { combatMode: combatModeOf(account) },
    rewards: {
      boxes: game.boxes.map((b) => ({ id: b.id, name: boxName(content, b), tier: b.tier, boxType: b.boxType, source: b.source })),
      achievements: achievements,
      earned: achievements.filter((a) => a.earned).length,
      total: content.achievements.all.length,
      mood: { value: game.narrator.mood, word: moodWord(game.narrator.mood) },
      shop: room && room.type === "safe" ? shopView(game, content, room) ?? null : null,
      canOpen: !!room && room.type === "safe" && game.phase === "exploring" && game.boxes.length > 0,
    },
    echo: game.echo
      ? {
          vessel: vesselOf(content, game.echo).short,
          wholeness: wholenessOn(content, floor?.floor ?? 1),
          stage: stageOn(content, floor?.floor ?? 1).name,
          act: stageOn(content, floor?.floor ?? 1).act,
          temper: game.echo.temper,
          temperMin: content.temper.min,
          temperMax: content.temper.max,
          side: sideOf(content, game.echo.temper),
          modules: moduleViews(game, content),
          shards: game.echo.shards.length,
          urge: game.echo.urge ? URGE_TEXT[game.echo.urge.kind] ?? null : null,
        }
      : null,
    codex,
    runEnd: runEndView(world),
    guide: guideView(game),
  };
}

const URGE_TEXT: Record<string, string> = {
  rummage: "Echo wants to rummage through this room.",
  listen: "Echo wants to listen for the stairs.",
  zap: "Echo wants to zap something.",
};

function weaponInHand(c: NonNullable<World["game"]["crawler"]>) {
  const uid = c.equipment.mainHand;
  const w = uid ? c.inventory.find((i) => i.uid === uid) : undefined;
  return w?.power ? w : undefined;
}

function weaponReach(c: NonNullable<World["game"]["crawler"]>): RangeBand {
  return weaponInHand(c)?.range ?? "close";
}

/** "Day 2, 14:30" from the run's clock in minutes. */
function formatClock(minutes: number): string {
  const day = Math.floor(minutes / 1440) + 1;
  const h = Math.floor((minutes % 1440) / 60);
  const m = Math.floor(minutes % 60);
  return `Day ${day}, ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Drop the empty margins of the map so the Guide shows just the part you've explored. */
function trimMap(rows: string[]): string[] {
  const used = rows.map((r, y) => (r.trim() ? y : -1)).filter((y) => y >= 0);
  if (used.length === 0) return rows;
  const y0 = Math.min(...used), y1 = Math.max(...used);
  const cols = rows.flatMap((r) => [...r].map((ch, x) => (ch !== " " ? x : -1))).filter((x) => x >= 0);
  const x0 = Math.min(...cols), x1 = Math.max(...cols);
  return rows.slice(y0, y1 + 1).map((r) => r.slice(x0, x1 + 1));
}
