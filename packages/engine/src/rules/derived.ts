import { sleepModifiers, sleepStage } from "./sleep";
import type { Content } from "../content/load";
import { STATS, type Modifier, type StatBlock } from "../content/schemas";
import type { Crawler, ItemInstance } from "../state";

export function equippedItems(c: Crawler): ItemInstance[] {
  const uids = new Set(Object.values(c.equipment));
  return c.inventory.filter((it) => uids.has(it.uid));
}

/** Every passive modifier currently affecting the crawler. */
export function collectModifiers(c: Crawler, content: Content): Modifier[] {
  const mods: Modifier[] = [];
  const quirk = content.backstory.quirks.byId[c.backstory.quirk];
  if (quirk) mods.push(...quirk.modifiers);
  for (const it of equippedItems(c)) mods.push(...it.modifiers);
  for (const s of c.statuses) {
    const def = content.statusEffects.byId[s.id];
    if (def) for (const m of def.modifiers) mods.push({ ...m, value: m.value * s.stacks });
  }
  for (const [id, st] of Object.entries(c.skills)) {
    const skill = content.skills.byId[id];
    if (!skill) continue;
    for (const perk of skill.perks) if (st.rank >= perk.rank) mods.push(...perk.modifiers);
  }
  mods.push(...sleepModifiers(c, content));
  return mods;
}

/** Sum of modifiers whose `to` matches any of the given tags. */
export function modTotal(mods: readonly Modifier[], ...tags: string[]): number {
  let total = 0;
  for (const m of mods) if (tags.includes(m.to)) total += m.value;
  return total;
}

export function effectiveStats(c: Crawler, content: Content, mods = collectModifiers(c, content)): StatBlock {
  const out = { ...c.baseStats };
  for (const s of STATS) out[s] += modTotal(mods, `stat:${s}`);
  // Race and class stat mods arrive with Milestone 11.
  return out;
}

export interface Derived {
  stats: StatBlock;
  maxHP: number;
  maxMP: number;
  /** Flat damage taken off every hit (never below 1): worn armor plus damage-reduction effects. */
  armor: number;
  /** Net "defense" effects (braced, hasted, blinded...). Every 2 points is a bane on attackers; -2 is an edge. */
  guard: number;
  hpRegen: number;
  mpRegen: number;
  carryLimit: number;
  carried: number;
  initiativeBonus: number;
}

export function derive(c: Crawler, content: Content): Derived {
  const mods = collectModifiers(c, content);
  const stats = effectiveStats(c, content, mods);
  const armor = equippedItems(c).reduce((sum, it) => sum + (it.armor ?? 0), 0);
  // Guard from a weapon-skill perk counts only while that kind of weapon is in your hand (Polearms 10).
  const held = c.inventory.find((it) => it.uid === c.equipment.mainHand && it.power);
  const heldType = held?.weaponType ?? "unarmed";
  return {
    stats,
    maxHP: Math.max(1, 10 + 3 * stats.CON + 2 * c.level + modTotal(mods, "maxHP")),
    maxMP: Math.max(0, 5 + 2 * stats.INT + modTotal(mods, "maxMP")),
    armor: armor + modTotal(mods, "damageReduction", "dr"),
    guard: modTotal(mods, "defense", `defense:${heldType}`),
    hpRegen: Math.floor(stats.CON / 5) + modTotal(mods, "regen"),
    mpRegen: Math.floor(Math.floor(stats.INT / 5) * (1 + sleepStage(c, content).mpRegenPct / 100)),
    carryLimit: 20 + 4 * stats.STR + modTotal(mods, "carry"),
    carried: c.inventory.reduce((sum, it) => sum + it.weight * it.qty, 0),
    initiativeBonus: stats.DEX + modTotal(mods, "initiative"),
  };
}

