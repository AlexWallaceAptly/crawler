/**
 * Item details for the panels: what a weapon does in your hands (stat, skill, roll,
 * damage, odds), what armor takes off, what an affix rolled, and what equipping it
 * would change for you. See gear.ts for the numbers.
 */
import type { Content } from "./content/load";
import { AP_COST } from "./rules/ap";
import { describeModifier } from "./rules/modifiers";
import { skillLine } from "./progression";
import { potencyFor } from "./gen/item";
import { displaced, formatChanges, gearChanges, isEquipped, profileOf, swingNumbers, verdictOf, withEquipped } from "./gear";
import type { Crawler, ItemInstance } from "./state";

const SLOT_NAMES: Record<string, string> = {
  mainHand: "Main hand", offHand: "Off hand", head: "Head", eyes: "Eyes", chest: "Chest", legs: "Legs", feet: "Feet",
  hands: "Hands", neck: "Neck", ring: "Ring", back: "Back", belt: "Belt",
};

const pct = (p: number) => `${Math.round(p * 100)}%`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export interface ItemInfo {
  detail: string[];
  /** One line for the list: "6/8/10 dmg · DEX · 2 AP", "armor 1". */
  summary?: string;
  /** Against what you have on now. Absent for consumables and what you're already using. */
  verdict?: "better" | "worse" | "mixed" | "same";
}

/** A weapon's lines, worked out for `holding` (the crawler with this weapon in hand). */
export function weaponLines(content: Content, it: ItemInstance, holding: Crawler): string[] {
  const w = profileOf(content, it, holding);
  const sw = swingNumbers(holding, content, w);
  const skill = w.skillId ? content.skills.byId[w.skillId] : undefined;
  const ap = w.unwieldy ? "2 AP, and a swing ends your turn" : `${w.apCost} AP a swing`;
  const statFlat = Math.floor((sw.statValue * (w.unwieldy ? 3 : w.apCost)) / 4);
  const gearFlat = sw.flat - statFlat;
  const adds = [`${w.stat} ${sw.statValue}: +${sw.statBonus}`];
  if (skill) adds.push(`${skill.name} rank ${sw.skillRank}: +${sw.skillRank}`);
  if (sw.gearBonus) adds.push(`gear ${signed(sw.gearBonus)}`);
  const out = [
    `${cap(it.weaponType ?? "weapon")} · swings with ${w.stat} · ${ap} · ${w.reach} reach${it.twoHanded ? " · two-handed" : ""}`,
    `Power ${it.power!.join("/")}${it.damageType && it.damageType !== "physical" ? ` ${it.damageType}` : ""} by tier (weak / solid / great).`,
    `Your roll: 2d10 ${signed(sw.rollBonus)} (${adds.join(", ")}). Solid needs 12, great needs 17.`,
    `Your damage: ${sw.damage.join("/")} (power ${signed(statFlat)} from ${w.stat}${gearFlat ? `, ${signed(gearFlat)} from gear` : ""}), minus the target's armor.`,
    `Odds: weak ${pct(sw.odds[0])} · solid ${pct(sw.odds[1])} · great ${pct(sw.odds[2])}${sw.critAt < 19 ? ` (crits on ${sw.critAt}+)` : ""}. Average hit ${sw.average}.`,
  ];
  if (skill) out.push(`${skillLine(holding, content, skill.id, "swings")}. Every swing trains it; each rank is +1 to the roll.`);
  return out;
}

export function itemInfo(c: Crawler, content: Content, it: ItemInstance): ItemInfo {
  const detail: string[] = [];
  const gear = it.kind === "gear" && !!it.slot;
  const equipped = gear && isEquipped(c, it);

  if (gear) {
    const material = it.material ? content.items.materials.byId[it.material]?.name : undefined;
    detail.push([cap(it.rarity), material, SLOT_NAMES[it.slot!], it.itemLevel ? `item level ${it.itemLevel}` : undefined].filter(Boolean).join(" · "));
  }

  // A weapon's numbers are worked out as if you were holding it.
  const holding = gear && !equipped ? withEquipped(c, it) : c;
  if (it.power) detail.push(...weaponLines(content, it, holding));
  if (it.armor) detail.push(`Armor ${it.armor}: takes ${it.armor} off every hit you take (never below 1).`);

  for (const a of it.affixes ?? []) detail.push(`${a.name}: ${a.text}`);
  if (it.legendary) detail.push(`★ ${it.legendary.name}: ${it.legendary.text}`);
  const fromAffix = (it.affixes ?? []).some((a) => content.items.affixes.byId[a.id]?.onHit) ||
    !!(it.legendary && content.items.legendaryPowers.byId[it.legendary.id]?.onHit);
  if (it.onHit && !fromAffix) {
    const name = content.statusEffects.byId[it.onHit.id]?.name.toLowerCase() ?? it.onHit.id;
    detail.push(`On a solid hit: ${pct(it.onHit.chance)} chance it's ${name} (a great hit always does it).`);
  }
  for (const m of it.modifiers.filter((x) => !x.note?.startsWith("affix:") && !x.note?.startsWith("legendary:"))) {
    detail.push(`${describeModifier(m, content)}${m.note ? ` (${m.note})` : ""}`);
  }

  if (it.kind === "consumable" && content.items.consumables.byId[it.baseId]?.scales) {
    detail.push(`Stronger on deeper floors: ×${potencyFor(1)} on Floor 1, ×${potencyFor(2)} on 2, ×${potencyFor(3)} on 3.`);
  }

  let verdict: ItemInfo["verdict"];
  if (gear && equipped) detail.push(it.slot === "mainHand" ? "In your hand." : "You're wearing it.");
  else if (gear) {
    const changes = gearChanges(c, holding, content);
    const out = displaced(c, holding, it).map((x) => x.name);
    verdict = verdictOf(changes);
    detail.push(`If you equip it: ${changes.length ? formatChanges(changes) : "nothing you'd notice"}${out.length ? ` (replaces ${out.join(" and ")})` : ""}.`);
  }

  let summary: string | undefined;
  if (it.power) {
    const sw = swingNumbers(holding, content, profileOf(content, it, holding));
    summary = `${sw.damage.join("/")} dmg · ${it.stat ?? "STR"} · ${it.apCost ?? AP_COST.attack} AP`;
  } else if (gear) {
    const first = it.modifiers[0];
    summary = it.armor ? `armor ${it.armor}` : first ? describeModifier(first, content) : undefined;
  }
  return { detail, ...(summary ? { summary } : {}), ...(verdict ? { verdict } : {}) };
}
