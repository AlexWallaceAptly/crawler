import type { Content } from "../content/load";
import { STATS, type FormativeEvent, type Occupation, type Quirk, type StatBlock } from "../content/schemas";
import { int, pick, weightedKey } from "../rng";
import { derive } from "../rules/derived";
import type { Crawler, EquipSlot, ItemInstance } from "../state";
import { isWeapon, itemFromRef } from "./item";

export const STAT_MIN = 3;
export const STAT_MAX = 12;
export const STAT_BASE = 5;
export const STAT_POOL = 12;

/** Spec: base 5 each, spend 12 points weighted by occupation, apply event and quirk, clamp 3..12. */
export function generateStats(occ: Occupation, ev: FormativeEvent, quirk: Quirk): StatBlock {
  const stats: StatBlock = { STR: STAT_BASE, DEX: STAT_BASE, CON: STAT_BASE, INT: STAT_BASE, CHA: STAT_BASE };
  for (let i = 0; i < STAT_POOL; i++) stats[weightedKey(occ.weights)] += 1;
  stats[ev.plus] += 2;
  stats[ev.minus] -= 1;
  for (const s of STATS) stats[s] += quirk.statMods[s] ?? 0;
  for (const s of STATS) stats[s] = Math.min(STAT_MAX, Math.max(STAT_MIN, stats[s]));
  return stats;
}

/** Put an item into the first sensible empty slot. Returns the slot used, if any. */
export function autoEquip(c: Crawler, item: ItemInstance): EquipSlot | null {
  if (item.kind !== "gear" || !item.slot) return null;
  let slot: EquipSlot;
  if (item.slot === "ring") slot = c.equipment.ring1 ? "ring2" : "ring1";
  else slot = item.slot;
  if (c.equipment[slot]) return null;
  if (item.twoHanded && c.equipment.offHand) return null;
  if (slot === "offHand") {
    const main = c.inventory.find((i) => i.uid === c.equipment.mainHand);
    if (main?.twoHanded) return null;
  }
  c.equipment[slot] = item.uid;
  return slot;
}

/**
 * Roll a crawler. `pools` are the backstory pools the account has unlocked (Milestone 8): entries
 * tagged with any other pool are left out, and untagged entries are always in.
 */
export function generateCrawler(content: Content, pools: readonly string[] = []): Crawler {
  const b = content.backstory;
  const open = <T extends { pool?: string | undefined }>(all: T[]) => all.filter((e) => !e.pool || pools.includes(e.pool));
  const occ = pick(open(b.occupations.all));
  const ev = pick(open(b.events.all));
  const quirk = pick(open(b.quirks.all));
  const loc = pick(open(b.locations.all));

  const crawler: Crawler = {
    name: `${pick(b.names.first)} ${pick(b.names.last)}`,
    age: int(occ.ageRange[0], occ.ageRange[1]),
    hometown: pick(b.names.hometowns),
    backstory: { occupation: occ.id, event: ev.id, quirk: quirk.id, location: loc.id },
    level: 1,
    xp: 0,
    baseStats: generateStats(occ, ev, quirk),
    unspentStatPoints: 0,
    skillPoints: 0,
    hp: 1,
    mp: 0,
    skills: { [occ.skill]: { rank: 1, xp: 0 } },
    // A magic-leaning job (or past) starts you with one spell; the job's wins.
    spells: (occ.spell ?? ev.spell) ? { [(occ.spell ?? ev.spell)!]: { level: 1, casts: 0, cooldown: 0 } } : {},
    race: null,
    charClass: null,
    equipment: {},
    inventory: [],
    statuses: [],
    gold: 0,
    counters: {},
    achievements: [],
  };

  // Clothing first so it claims body slots, then the occupation item, then the location item.
  const kit = [...loc.clothing.map((id) => itemFromRef(content, id)), itemFromRef(content, occ.item), itemFromRef(content, loc.item)];
  for (const item of kit) crawler.inventory.push(item);
  for (const item of kit) {
    // Prefer the occupation weapon in the main hand; location weapons ride along in the pack.
    if (isWeapon(item) && crawler.equipment.mainHand) continue;
    autoEquip(crawler, item);
  }

  const d = derive(crawler, content);
  crawler.hp = d.maxHP;
  crawler.mp = d.maxMP;
  return crawler;
}

/** Context object for the intro roast templates. */
export function introContext(crawler: Crawler, content: Content) {
  const b = content.backstory;
  const loc = b.locations.get(crawler.backstory.location);
  const clothing = content.items.bases.get(loc.clothing[0]!).name.toLowerCase();
  const stats = crawler.baseStats;
  const sorted = STATS.slice().sort((a, z) => stats[a] - stats[z]);
  const low = sorted[0]!;
  const high = sorted[sorted.length - 1]!;
  return {
    crawler,
    occupation: b.occupations.get(crawler.backstory.occupation).name,
    event: b.events.get(crawler.backstory.event).phrase,
    quirk: b.quirks.get(crawler.backstory.quirk).phrase,
    location: loc.phrase,
    clothing,
    lowStat: low,
    lowValue: stats[low],
    highStat: high,
    highValue: stats[high],
  };
}
