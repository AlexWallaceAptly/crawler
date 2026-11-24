/**
 * Items: plain ones straight from a base or consumable (starting kit, junk, loot tables),
 * and generated gear (Milestone 5): base + material + rarity + affixes, then a name.
 * See "Item generation" in docs/DESIGN.md. All randomness goes through rng.ts.
 */
import type { Content } from "../content/load";
import { RARITIES, type Affix, type Consumable, type ItemBase, type LegendaryPower, type Modifier, type Power, type Rarity, type Slot } from "../content/schemas";
import { int, pick, uid, weightedPick } from "../rng";
import { describeModifier } from "../rules/modifiers";
import { narrate, type NarratorMemory } from "../narrate/narrator";
import type { ItemInstance } from "../state";

/** A plain common item straight from its base (no material/affixes). Used for starting kit. */
export function itemFromBase(base: ItemBase): ItemInstance {
  return {
    uid: uid("it"),
    baseId: base.id,
    kind: "gear",
    name: base.name,
    rarity: "common",
    slot: base.slot,
    ...(base.twoHanded ? { twoHanded: true } : {}),
    ...(base.weaponType ? { weaponType: base.weaponType } : {}),
    ...(base.power ? { power: [...base.power] as [number, number, number] } : {}),
    ...(base.apCost ? { apCost: base.apCost } : {}),
    ...(base.unwieldy ? { unwieldy: true } : {}),
    ...(base.damageType ? { damageType: base.damageType } : {}),
    ...(base.stat ? { stat: base.stat } : {}),
    ...(base.range ? { range: base.range } : {}),
    ...(base.armor !== undefined ? { armor: base.armor } : {}),
    modifiers: base.modifiers.slice(),
    weight: base.weight,
    value: base.value,
    qty: 1,
    ...(base.flavor ? { flavor: base.flavor } : {}),
    tags: base.tags.slice(),
    ...(base.onHit ? { onHit: { ...base.onHit } } : {}),
  };
}

export function itemFromConsumable(c: Consumable, qty = 1): ItemInstance {
  return {
    uid: uid("it"),
    baseId: c.id,
    kind: "consumable",
    name: c.name,
    rarity: "common",
    modifiers: [],
    weight: c.weight,
    value: c.value,
    qty,
    flavor: c.text,
    tags: c.tags.slice(),
  };
}

/** Workbook rarities for the hand-written oddities. */
const ODDITY_RARITY: Record<string, ItemInstance["rarity"]> = { Common: "common", Uncommon: "uncommon", Rare: "rare", Unique: "legendary" };

/**
 * Build an item from a base or consumable id. Oddities keep their workbook rarity.
 * Tomes and scrolls get their spell here: a fixed one, or (`"random"`) one rolled from
 * the spells whose `floor` is this floor or shallower. Scrolls cast at the floor's level.
 */
export function itemFromRef(content: Content, id: string, qty = 1, floor = 1): ItemInstance {
  const item = content.items.bases.has(id) ? itemFromBase(content.items.bases.get(id)) : itemFromConsumable(content.items.consumables.get(id), qty);
  const odd = content.oddities.byId[id];
  if (odd) item.rarity = ODDITY_RARITY[odd.rarityText] ?? "common";
  const def = content.items.consumables.byId[id];
  if (def?.spell) {
    const pool = content.spells.all.filter((s) => s.floor <= floor);
    const spell = def.spell === "random" ? (pool.length ? pick(pool) : undefined) : content.spells.byId[def.spell];
    if (spell) {
      item.spellId = spell.id;
      item.name = `${def.type === "scroll" ? "Scroll" : "Tome"} of ${spell.name}`;
      if (def.type === "scroll") item.spellLevel = Math.max(1, floor);
      if (def.type === "tome") item.flavor = spell.tomeText;
      item.rarity = spell.floor >= 3 ? "rare" : spell.floor === 2 ? "uncommon" : "common";
    }
  }
  return item;
}

export function isWeapon(item: ItemInstance): boolean {
  return item.kind === "gear" && item.slot === "mainHand" && !!item.power;
}

// ---------------------------------------------------------------- consumable potency

/** Consumables marked `scales`: their numbers grow a quarter per floor past the first. */
export function potencyFor(floor: number): number {
  return 1 + 0.25 * (Math.max(1, floor) - 1);
}

// ---------------------------------------------------------------- the generator

/** `itemLevel = floor * 5 + random(-2, 2)`, at least 1. */
export function itemLevelFor(floor: number): number {
  return Math.max(1, floor * 5 + int(-2, 2));
}

/** Item level 5 (Floor 1) is the baseline a base's numbers are written for. */
export const BASE_LEVEL = 5;

/** Power grows 4% per item level past 5 (not the design's 10%: see the decision log). */
export function levelFactor(itemLevel: number): number {
  return Math.max(0.8, 1 + 0.04 * (itemLevel - BASE_LEVEL));
}

/** Affix numbers grow 5% per item level past 5, and never shrink below what they rolled. */
export function affixFactor(itemLevel: number): number {
  return Math.max(1, 1 + 0.05 * (itemLevel - BASE_LEVEL));
}

/** Which affixes and powers can go on a piece: weapon, armor, or trinket. */
export type GearFamily = "weapon" | "armor" | "trinket";

export function gearFamily(b: { slot?: Slot; power?: unknown; armor?: number }): GearFamily {
  if (b.power) return "weapon";
  if (b.slot === "offHand") return b.armor ? "armor" : "trinket";
  if (b.slot === "neck" || b.slot === "ring" || b.slot === "belt" || b.slot === "eyes") return "trinket";
  return "armor";
}

function fits(slots: readonly string[], b: ItemBase): boolean {
  return slots.includes("any") || slots.includes(gearFamily(b)) || slots.includes(b.slot);
}

const rank = (r: Rarity) => RARITIES.indexOf(r);

/** The floor's rarity weights (the last row covers deeper floors), at least `min`. */
export function rollRarity(content: Content, floor: number, min: Rarity = "common"): Rarity {
  const rows = content.items.rarityWeights.slice().sort((a, b) => a.floor - b.floor);
  const row = rows.filter((r) => r.floor <= floor).pop() ?? rows[0]!;
  const options = RARITIES.filter((r) => rank(r) >= rank(min) && (row.weights[r] ?? 0) > 0);
  if (options.length === 0) return min;
  return weightedPick(options, (r) => row.weights[r] ?? 0);
}

/** Multiply a power triple, keeping it at least 1 and never weaker at a higher tier. */
export function scalePower(p: Power, f: number): Power {
  const a = Math.max(1, Math.round(p[0] * f));
  const b = Math.max(a, Math.round(p[1] * f));
  const c = Math.max(b, Math.round(p[2] * f));
  return [a, b, c];
}

/** Roll an affix number in its range, then scale it with item level (keeping its sign, never to 0). */
function rollValue([lo, hi]: readonly [number, number], scale: number): number {
  const v = int(Math.round(Math.min(lo, hi)), Math.round(Math.max(lo, hi)));
  if (scale === 1 || v === 0) return v;
  return Math.sign(v) * Math.max(1, Math.round(Math.abs(v) * scale));
}

function rollAffix(a: Affix, itemLevel: number): { modifiers: Modifier[]; onHit?: NonNullable<ItemInstance["onHit"]> } {
  const scale = affixFactor(itemLevel);
  const modifiers = a.modifiers.map((m) => ({ to: m.to, value: rollValue(m.value, m.scales ? scale : 1), note: `affix:${a.id}` }));
  if (!a.onHit) return { modifiers };
  const [lo, hi] = a.onHit.chance;
  const chance = Math.round((lo + ((hi - lo) * int(0, 20)) / 20) * 100) / 100;
  return { modifiers, onHit: { id: a.onHit.id, chance, ...(a.onHit.duration ? { duration: a.onHit.duration } : {}) } };
}

function onHitText(h: NonNullable<ItemInstance["onHit"]>, content: Content): string {
  const name = content.statusEffects.byId[h.id]?.name.toLowerCase() ?? h.id;
  return h.chance >= 1 ? `every solid hit leaves it ${name}` : `${Math.round(h.chance * 100)}% chance a solid hit leaves it ${name}`;
}

/** Pick affixes: no two from one group, at most one suffix (it's the "of ..." in the name). */
function pickAffixes(content: Content, base: ItemBase, itemLevel: number, n: number): Affix[] {
  const chosen: Affix[] = [];
  for (let i = 0; i < n; i++) {
    const groups = new Set(chosen.map((a) => a.group));
    const suffixed = chosen.some((a) => a.kind === "suffix");
    const prefixes = chosen.filter((a) => a.kind === "prefix").length;
    const pool = content.items.affixes.all.filter((a) =>
      a.minLevel <= itemLevel && fits(a.slots, base) && !groups.has(a.group) &&
      !(a.kind === "suffix" && suffixed) && !(a.kind === "prefix" && prefixes >= 2));
    if (pool.length === 0) break;
    chosen.push(weightedPick(pool, (a) => a.weight));
  }
  return chosen;
}

export interface GenerateOptions {
  /** Only bases for this slot. */
  slot?: Slot;
  /** Exactly this rarity. */
  rarity?: Rarity;
  /** At least this rarity (boss drops, boxes). */
  minRarity?: Rarity;
  /** Whose rarity weights to use; defaults to the floor the item level belongs to. */
  floor?: number;
  /** The narrator's memory, so flavor lines don't repeat. */
  narrator?: NarratorMemory;
}

/**
 * `generateItem(itemLevel, slot?, rarityOverride?)` from the design: rarity, base,
 * material, scaled numbers, affixes, a legendary power, the name, flavor and value.
 */
export function generateItem(content: Content, itemLevel: number, opts: GenerateOptions = {}): ItemInstance {
  const level = Math.max(1, Math.round(itemLevel));
  const floor = opts.floor ?? Math.max(1, Math.round(level / 5));
  const rarity = opts.rarity ?? rollRarity(content, floor, opts.minRarity);
  const rule = content.items.rarities.get(rarity);
  const gen = content.items.bases.all.filter((b) => b.generate && (!opts.slot || b.slot === opts.slot));
  const eligible = gen.filter((b) => b.minLevel <= level);
  const base = pick(eligible.length ? eligible : gen.length ? gen : content.items.bases.all.filter((b) => b.generate));

  const materials = content.items.materials.all.filter((m) =>
    m.kind === base.material && m.minLevel <= level && (m.maxLevel === undefined || level <= m.maxLevel));
  const material = materials.length ? weightedPick(materials, (m) => m.weight) : undefined;
  const matMult = material?.mult ?? 1;

  const item = itemFromBase(base);
  item.rarity = rarity;
  item.itemLevel = level;
  if (material) item.material = material.id;
  // Power takes material, rarity and level. Armor takes the material only: it's flat
  // damage off every hit, so it stays small (see the decision log).
  if (base.power) item.power = scalePower(base.power, matMult * rule.mult * levelFactor(level));
  if (base.armor) item.armor = Math.max(1, Math.round(base.armor * matMult));

  const affixes = pickAffixes(content, base, level, rule.affixes);
  item.affixes = [];
  for (const a of affixes) {
    const rolled = rollAffix(a, level);
    item.modifiers.push(...rolled.modifiers);
    if (rolled.onHit && (!item.onHit || rolled.onHit.chance > item.onHit.chance)) item.onHit = rolled.onHit;
    const parts = [...rolled.modifiers.map((m) => describeModifier(m, content)), ...(rolled.onHit ? [onHitText(rolled.onHit, content)] : [])];
    item.affixes.push({ id: a.id, name: a.name, kind: a.kind, text: parts.join(", ") });
  }

  let power: LegendaryPower | undefined;
  if (rule.legendaryPower) {
    const pool = content.items.legendaryPowers.all.filter((p) => fits(p.slots, base));
    if (pool.length) {
      power = pick(pool);
      item.modifiers.push(...power.modifiers.map((m) => ({ ...m, note: `legendary:${power!.id}` })));
      if (power.onHit) item.onHit = { ...power.onHit };
      item.legendary = { id: power.id, name: power.name, text: power.text };
    }
  }

  const prefixes = item.affixes.filter((a) => a.kind === "prefix").map((a) => a.name);
  const suffix = item.affixes.find((a) => a.kind === "suffix")?.name;
  item.name = [...prefixes, material?.name, base.name, suffix].filter(Boolean).join(" ");
  item.value = Math.round(base.value * rule.mult ** 2 * (1 + level / 5));
  if (rank(rarity) >= rank("rare")) {
    const line = narrate(content, opts.narrator ?? { recent: [] }, "item.flavor", { item: { name: item.name, base: base.name, rarity } });
    item.flavor = [base.flavor, line].filter(Boolean).join(" ");
  }
  return item;
}
