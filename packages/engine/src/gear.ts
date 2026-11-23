/**
 * What gear does for you, in numbers a player can read: which stat a weapon swings
 * with and what that stat adds, the odds of each power-roll tier, the average hit,
 * and what equipping something would change (armor 2 → 3). Combat uses the same
 * numbers (swingNumbers), so what the sheet says is what the dice do.
 */
import type { Content } from "./content/load";
import { STATS, type Power, type RangeBand, type Stat } from "./content/schemas";
import { collectModifiers, derive, modTotal, type Derived } from "./rules/derived";
import { AP_COST } from "./rules/ap";
import { CRIT_NATURAL, tierOdds } from "./rules/power";
import { equip, equippedSlot } from "./inventory";
import type { Crawler, ItemInstance } from "./state";

export interface WeaponProfile {
  name: string;
  /** Damage by power-roll tier. */
  power: Power;
  /** AP per swing. */
  apCost: number;
  /** A swing ends the turn (and carries a 3-AP swing's weight). */
  unwieldy?: boolean;
  stat: "STR" | "DEX";
  reach: RangeBand;
  skillId?: string;
  weaponType?: string;
  damageType?: string;
  /** Crafted weapons: a status that can land on a hit. */
  onHit?: { id: string; chance: number; duration?: number };
}

export const BARE_HANDS: WeaponProfile = { name: "bare hands", power: [1, 2, 2], apCost: 1, stat: "STR", reach: "close", skillId: "unarmed", weaponType: "unarmed" };

/** A weapon item as a swing profile (or bare hands). */
export function profileOf(content: Content, weapon: ItemInstance | undefined): WeaponProfile {
  if (!weapon?.power) return BARE_HANDS;
  const skill = content.skills.all.find((s) => s.weaponType && s.weaponType === weapon.weaponType);
  return {
    name: weapon.name,
    power: weapon.power,
    apCost: weapon.apCost ?? AP_COST.attack,
    ...(weapon.unwieldy ? { unwieldy: true } : {}),
    stat: weapon.stat ?? "STR",
    reach: (weapon.range as RangeBand | undefined) ?? "close",
    ...(skill ? { skillId: skill.id } : {}),
    ...(weapon.weaponType ? { weaponType: weapon.weaponType } : {}),
    ...(weapon.damageType ? { damageType: weapon.damageType } : {}),
    ...(weapon.onHit ? { onHit: weapon.onHit } : {}),
  };
}

export function heldWeapon(c: Crawler): ItemInstance | undefined {
  const uid = c.equipment.mainHand;
  const w = uid ? c.inventory.find((i) => i.uid === uid) : undefined;
  return w?.power ? w : undefined;
}

/** The numbers behind one swing (before the target's guard, armor or a Spiteful grudge). */
export interface SwingNumbers {
  stat: "STR" | "DEX";
  statValue: number;
  /** half the stat, on the power roll */
  statBonus: number;
  skillName?: string;
  skillRank: number;
  /** attack modifiers from gear, statuses and perks */
  gearBonus: number;
  /** everything added to 2d10 */
  rollBonus: number;
  /** the stat's flat damage (scaled by the swing's AP) plus damage modifiers */
  flat: number;
  /** the weapon's power plus `flat`, per tier */
  damage: Power;
  critAt: number;
  /** chance of tier 1 / 2 / 3, crits counted as 3 */
  odds: [number, number, number];
  /** expected damage per swing against no armor */
  average: number;
}

export function swingNumbers(c: Crawler, content: Content, w: WeaponProfile, d: Derived = derive(c, content), mods = collectModifiers(c, content)): SwingNumbers {
  const statValue = d.stats[w.stat];
  const statBonus = Math.floor(statValue / 2);
  const skillRank = w.skillId ? (c.skills[w.skillId]?.rank ?? 0) : 0;
  const skillName = w.skillId ? content.skills.byId[w.skillId]?.name : undefined;
  const gearBonus = modTotal(mods, "attack", "hit");
  const rollBonus = statBonus + skillRank + gearBonus;
  // The stat's flat bonus scales with the swing's AP: quarter for a 1-AP poke, half at 2, three quarters at 3.
  const flat = Math.floor((statValue * (w.unwieldy ? 3 : w.apCost)) / 4) + modTotal(mods, "damage");
  const damage = w.power.map((p) => Math.max(1, p + flat)) as Power;
  const critAt = CRIT_NATURAL - Math.max(0, modTotal(mods, "critRange"));
  const odds = tierOdds(rollBonus, critAt);
  const average = Math.round((odds[0] * damage[0] + odds[1] * damage[1] + odds[2] * damage[2]) * 10) / 10;
  return { stat: w.stat, statValue, statBonus, ...(skillName ? { skillName } : {}), skillRank, gearBonus, rollBonus, flat, damage, critAt, odds, average };
}

/**
 * The crawler as it would be with `item` equipped (whatever it pushes out comes off).
 * The item can be one lying on the floor. Only the equipment map and the pack list
 * are copied: equipping touches nothing else, and the panels ask this once per item
 * on every step, so a deep clone would be wasted.
 */
export function withEquipped(c: Crawler, item: ItemInstance): Crawler {
  const copy: Crawler = { ...c, equipment: { ...c.equipment }, inventory: c.inventory.includes(item) ? c.inventory : [...c.inventory, item] };
  equip(copy, item);
  return copy;
}

/** What wearing or wielding this pushes out of its slot(s), given `after` from withEquipped. */
export function displaced(c: Crawler, after: Crawler, item: ItemInstance): ItemInstance[] {
  const kept = new Set(Object.values(after.equipment));
  return c.inventory.filter((i) => i.uid !== item.uid && equippedSlot(c, i.uid) && !kept.has(i.uid));
}

export interface GearChange {
  label: string;
  from: string;
  to: string;
  /** +1 better for you, -1 worse, 0 a sideways change. */
  better: number;
}

/** What changes between two versions of the crawler: armor, HP, stats, the swing. */
export function gearChanges(before: Crawler, after: Crawler, content: Content): GearChange[] {
  const a = derive(before, content);
  const b = derive(after, content);
  const out: GearChange[] = [];
  const num = (label: string, x: number, y: number) => {
    if (x !== y) out.push({ label, from: String(x), to: String(y), better: Math.sign(y - x) });
  };
  num("Armor", a.armor, b.armor);
  num("Max HP", a.maxHP, b.maxHP);
  num("Max MP", a.maxMP, b.maxMP);
  for (const s of STATS) num(s, a.stats[s], b.stats[s]);
  num("Guard", a.guard, b.guard);
  num("Initiative", a.initiativeBonus, b.initiativeBonus);
  num("Carry", a.carryLimit, b.carryLimit);
  const wa = profileOf(content, heldWeapon(before));
  const wb = profileOf(content, heldWeapon(after));
  const sa = swingNumbers(before, content, wa, a);
  const sb = swingNumbers(after, content, wb, b);
  if (sa.rollBonus !== sb.rollBonus) num("Attack roll", sa.rollBonus, sb.rollBonus);
  if (sa.damage.join() !== sb.damage.join()) {
    out.push({ label: "Damage", from: sa.damage.join("/"), to: sb.damage.join("/"), better: 0 });
  }
  // Per AP, so a 1-AP poke and a 2-AP swing compare fairly.
  const perA = Math.round((sa.average / (wa.unwieldy ? 3 : wa.apCost)) * 10) / 10;
  const perB = Math.round((sb.average / (wb.unwieldy ? 3 : wb.apCost)) * 10) / 10;
  if (sa.average !== sb.average || perA !== perB) {
    out.push({ label: "Average hit", from: `${sa.average}`, to: `${sb.average}`, better: Math.sign(perB - perA) });
  }
  return out;
}

/** Better, worse, or a trade-off, from a list of changes. */
export function verdictOf(changes: GearChange[]): "better" | "worse" | "mixed" | "same" {
  const up = changes.some((ch) => ch.better > 0);
  const down = changes.some((ch) => ch.better < 0);
  return up && down ? "mixed" : up ? "better" : down ? "worse" : "same";
}

export function formatChanges(changes: GearChange[]): string {
  return changes.map((ch) => `${ch.label} ${ch.from} → ${ch.to}`).join(", ");
}

/** Which weapon stat suits this crawler, and the weapon types that use it most. */
export function weaponFit(c: Crawler, content: Content, d: Derived = derive(c, content)): { stat: Stat | "either"; text: string } {
  const str = d.stats.STR;
  const dex = d.stats.DEX;
  const ranks = (stat: Stat) => content.skills.all
    .filter((s) => s.category === "weapon" && s.stat === stat && (c.skills[s.id]?.rank ?? 0) > 0)
    .map((s) => `${s.name} ${c.skills[s.id]!.rank}`);
  const line = (stat: "STR" | "DEX", other: number) =>
    `Your ${stat} (${d.stats[stat]}) beats your ${stat === "STR" ? "DEX" : "STR"} (${other}): weapons marked ${stat} hit harder for you`;
  if (Math.floor(str / 2) === Math.floor(dex / 2)) {
    return { stat: "either", text: `STR ${str} and DEX ${dex} add the same: pick by weapon skill${ranks("STR").length + ranks("DEX").length ? ` (${[...ranks("STR"), ...ranks("DEX")].join(", ")})` : ""}.` };
  }
  const stat = str > dex ? "STR" : "DEX";
  const skilled = ranks(stat);
  return { stat, text: `${line(stat, stat === "STR" ? dex : str)}${skilled.length ? `, and you're trained in ${skilled.join(", ")}` : ""}.` };
}

/** Is this item equipped right now? */
export function isEquipped(c: Crawler, item: ItemInstance): boolean {
  return !!equippedSlot(c, item.uid);
}
