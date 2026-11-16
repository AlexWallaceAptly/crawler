/**
 * UI-facing projection of the world. Panels render from this, never from raw state.
 */
import type { Content } from "./content/load";
import { STATS, type Stat } from "./content/schemas";
import { formatTimer, mapGrid, renderMap, roomBadge, type MapGrid } from "./explore";
import { derive, xpToNext } from "./rules/derived";
import { combatModeOf, EQUIP_SLOTS, type CombatMode, type EquipSlot, type Phase, type World } from "./state";
import { gridView, type GridView } from "./grid/view";
import { coord } from "./grid/geometry";
import type { RangeBand } from "./content/schemas";

export interface Bar {
  current: number;
  max: number;
}

export interface ItemView {
  uid: string;
  name: string;
  rarity: string;
  detail: string[];
  equippedIn?: EquipSlot;
  qty: number;
}

export interface ViewModel {
  phase: Phase;
  status: {
    floor: number | null;
    district: string | null;
    timer: string | null;
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
    skills: { name: string; rank: number }[];
    spells: { name: string; level: number; cooldown: number }[];
    quirk: { name: string; text: string };
    unspentStatPoints: number;
    gold: number;
  };
  equipment: { slot: EquipSlot; label: string; item: ItemView | null }[];
  inventory: ItemView[];
  effects: { name: string; kind: "buff" | "debuff"; remaining: number; stacks: number }[];
  combat: null | {
    round: number;
    mode: CombatMode;
    /** Grid fights: the board, with every tap and highlight decided by the engine. */
    grid?: GridView;
    enemies: { uid: string; name: string; hp: Bar; range: string; statuses: string[]; elite: boolean; tier: string; mark?: string; at?: string }[];
  };
  /** The room you're in: what's on the floor, and whether you can craft here. */
  room: null | { items: ItemView[]; workbench: boolean };
  minimap: string[] | null;
  /** Structured map for the tile minimap; `minimap` stays as the text/fallback form. */
  mapGrid: MapGrid | null;
  account: { legacyPoints: number; rerolls: number; runs: number; deaths: number; bestFloor: number };
  settings: { combatMode: CombatMode };
}

/** Item tags that mean "crafting part"; shown in item details. */
const CRAFT_TAGS = new Set([
  "bind", "sharp", "haft", "cord", "elastic", "pouch", "weight", "battery", "wire", "fuel", "wick", "bottle",
  "spark", "padding", "plate", "hammer",
]);

const SLOT_LABELS: Record<EquipSlot, string> = {
  mainHand: "Main", offHand: "Off", head: "Head", eyes: "Eyes", chest: "Chest", hands: "Hands", legs: "Legs",
  feet: "Feet", back: "Back", belt: "Belt", neck: "Neck", ring1: "Ring", ring2: "Ring",
};

export function view(world: World, content: Content): ViewModel {
  const { game, account } = world;
  const c = game.crawler;
  const accountView = {
    legacyPoints: account.legacyPoints, rerolls: account.rerolls, runs: account.runs,
    deaths: account.deaths, bestFloor: account.bestFloor,
  };
  if (!c) {
    return {
      phase: game.phase,
      status: { floor: null, district: null, timer: null, room: null, hp: null, mp: null, xp: null, level: null },
      character: null, equipment: [], inventory: [], effects: [], combat: null, room: null, minimap: null, mapGrid: null, account: accountView,
      settings: { combatMode: combatModeOf(account) },
    };
  }
  const d = derive(c, content);
  const slotOf = new Map(Object.entries(c.equipment).map(([slot, uid]) => [uid, slot as EquipSlot]));

  const itemView = (uid: string, from = c.inventory): ItemView | null => {
    const it = from.find((i) => i.uid === uid);
    if (!it) return null;
    const detail: string[] = [];
    if (it.damage) detail.push(`${it.damage}${it.damageType && it.damageType !== "physical" ? ` ${it.damageType}` : ""} (${it.stat ?? "STR"}${it.weaponType ? `, ${it.weaponType}` : ""})`);
    if (it.twoHanded) detail.push("two-handed");
    if (it.armor) detail.push(`armor ${it.armor}`);
    for (const m of it.modifiers) detail.push(`${m.value >= 0 ? "+" : ""}${m.value} ${m.to.replace(/^(skill|stat):/, "")}`);
    if (it.onHit) detail.push(`on hit: ${Math.round(it.onHit.chance * 100)}% ${content.statusEffects.byId[it.onHit.id]?.name.toLowerCase() ?? it.onHit.id}`);
    const parts = it.tags.filter((t) => CRAFT_TAGS.has(t));
    if (parts.length) detail.push(`parts: ${parts.join(", ")}`);
    detail.push(`weight ${Math.round(it.weight * it.qty * 10) / 10}`);
    if (it.flavor) detail.push(it.flavor);
    const slot = slotOf.get(it.uid);
    return { uid: it.uid, name: it.name, rarity: it.rarity, detail, qty: it.qty, ...(slot ? { equippedIn: slot } : {}) };
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
        { label: "Defense", value: String(d.defense) },
        { label: "Init", value: `+${d.initiativeBonus}` },
        { label: "Regen", value: `${d.hpRegen} HP / ${d.mpRegen} MP` },
        { label: "Carry", value: `${Math.round(d.carried * 10) / 10}/${d.carryLimit}` },
      ],
      skills: Object.entries(c.skills)
        .map(([id, s]) => ({ name: content.skills.byId[id]?.name ?? id, rank: s.rank }))
        .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name)),
      spells: Object.entries(c.spells).map(([id, s]) => ({ name: id, level: s.level, cooldown: s.cooldown })),
      quirk: { name: quirk?.name ?? "", text: quirk?.text ?? "" },
      unspentStatPoints: c.unspentStatPoints,
      gold: c.gold,
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
              elite: e.tier === "elite",
              tier: e.tier,
              ...(e.mark ? { mark: e.mark } : {}),
              ...(e.pos ? { at: coord(e.pos) } : {}),
            })),
        }
      : null,
    room: room
      ? {
          items: (room.items ?? []).map((it) => itemView(it.uid, room.items)!).filter(Boolean),
          workbench: !!room.workbench,
        }
      : null,
    minimap: floor ? renderMap(floor) : null,
    mapGrid: floor ? mapGrid(floor) : null,
    account: accountView,
    settings: { combatMode: combatModeOf(account) },
  };
}

function weaponReach(c: NonNullable<World["game"]["crawler"]>): RangeBand {
  const uid = c.equipment.mainHand;
  const w = uid ? c.inventory.find((i) => i.uid === uid) : undefined;
  return (w?.damage && w.range) || "close";
}
