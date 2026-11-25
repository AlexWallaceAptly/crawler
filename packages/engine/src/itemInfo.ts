/**
 * Item details for the panels: what a weapon does in your hands (stat, skill, roll,
 * damage, odds), what armor takes off, what an affix rolled, and what equipping it
 * would change for you. See gear.ts for the numbers.
 */
import type { Content } from "./content/load";
import { SPELL_LEVEL_CAP, schoolSkillId, spellEffectText, spellFlat, spellNumbers } from "./spells";
import { AP_COST } from "./rules/ap";
import { describeModifier } from "./rules/modifiers";
import { skillLine } from "./progression";
import { potencyFor } from "./gen/item";
import { displaced, formatChanges, gearChanges, isEquipped, profileOf, swingNumbers, verdictOf, withEquipped, type GearChange } from "./gear";
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
  /** What the list row shows: the stat a weapon swings with, and one number against what you have on. */
  quick: ItemQuick;
  /** The same facts as `detail`, structured for the item card. */
  card: ItemCard;
}

export interface ItemQuick {
  /** Weapons: the stat it swings with. */
  stat?: "STR" | "DEX" | "INT";
  /**
   * Gear you aren't using: the one number that matters against what it would replace. A weapon:
   * damage a turn (3 AP). Anything else: armor, or the stat or other number it moves most.
   */
  delta?: { text: string; better: number; mixed: boolean; title: string };
}

export interface WeaponCard {
  type: string;
  stat: "STR" | "DEX" | "INT";
  /** "1 AP", "2 AP, ends your turn". */
  ap: string;
  reach: string;
  twoHanded: boolean;
  /** Your damage by tier, weak/solid/great. */
  damage: string;
  damageType?: string;
  average: number;
  /** Average damage over a turn's 3 AP. */
  perTurn: number;
  /** "2d10 +9" */
  roll: string;
  odds: [number, number, number];
  /** Crits below 20 only. */
  critAt?: number;
  /** "Blades 2 · 4/10 to rank 3 · rank 5: Decapitation" */
  skill?: string;
}

export interface ItemCard {
  /** "Rare · Iron · Main hand · item level 7" (gear) or "Potion" (a consumable). */
  kind: string;
  weapon?: WeaponCard;
  armor?: number;
  /** Affixes, the legendary power, an on-hit status and plain modifiers: a name and what it does. */
  traits: { name: string; text: string; legendary?: boolean }[];
  /** A tome or scroll: the spell, at the level it would give you. */
  spell?: { name: string; school: string; description: string; effect: string; note: string };
  /** Gear you aren't using: what changes if you put it on, and what it would take the place of. */
  changes?: GearChange[];
  replaces?: string[];
  /** Gear you are using: "In your hand." / "You're wearing it." */
  equipped?: string;
  /** Anything else worth a line: potency on deeper floors, an heirloom's story. */
  notes: string[];
}

/** Average damage over a turn's 3 AP with this weapon in hand (a 2-AP swing is worth 1.5 of these). */
function perTurn(content: Content, holding: Crawler, weapon: ItemInstance | undefined): number {
  const w = profileOf(content, weapon, holding);
  const sw = swingNumbers(holding, content, w);
  return Math.round(((sw.average / (w.unwieldy ? 3 : w.apCost)) * 3) * 10) / 10;
}

/** Which change a non-weapon's row should show, most telling first. */
const DELTA_ORDER = ["Armor", "STR", "DEX", "CON", "INT", "CHA", "Max HP", "Max MP", "Guard", "Initiative", "Carry", "Attack roll"];
const DELTA_UNIT: Record<string, string> = {
  Armor: "armor", "Max HP": "max HP", "Max MP": "max MP", Guard: "guard", Initiative: "init", Carry: "carry", "Attack roll": "to hit",
};

/** The row's one number: weapons by damage a turn, everything else by the change that matters most. */
function quickDelta(content: Content, c: Crawler, holding: Crawler, it: ItemInstance, changes: GearChange[], mixed: boolean): ItemQuick["delta"] {
  if (it.power && it.slot === "mainHand") {
    const now = perTurn(content, c, c.inventory.find((i) => i.uid === c.equipment.mainHand));
    const then = perTurn(content, holding, it);
    const diff = Math.round(then - now);
    const better = Math.sign(Math.round((then - now) * 10));
    return {
      text: diff === 0 ? (better > 0 ? "+0" : better < 0 ? "−0" : "±0") : diff > 0 ? `+${diff}` : `−${-diff}`,
      better, mixed,
      title: `About ${then} damage a turn, against ${now} with what you're holding`,
    };
  }
  const pick = DELTA_ORDER.map((label) => changes.find((ch) => ch.label === label)).find((ch) => ch && Number.isFinite(Number(ch.from)));
  if (!pick) return undefined;
  const diff = Number(pick.to) - Number(pick.from);
  const unit = DELTA_UNIT[pick.label] ?? pick.label;
  return { text: `${diff > 0 ? "+" : "−"}${Math.abs(diff)} ${unit}`, better: pick.better, mixed, title: `${pick.label} ${pick.from} → ${pick.to}` };
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
  const consumable = it.kind === "consumable" ? content.items.consumables.byId[it.baseId] : undefined;
  const card: ItemCard = { kind: consumable ? cap(consumable.type) : cap(it.rarity), traits: [], notes: [] };

  if (gear) {
    const material = it.material ? content.items.materials.byId[it.material]?.name : undefined;
    detail.push([cap(it.rarity), material, SLOT_NAMES[it.slot!], it.itemLevel ? `item level ${it.itemLevel}` : undefined].filter(Boolean).join(" · "));
    card.kind = detail[0]!;
  }

  // A weapon's numbers are worked out as if you were holding it.
  const holding = gear && !equipped ? withEquipped(c, it) : c;
  if (it.power) {
    detail.push(...weaponLines(content, it, holding));
    const w = profileOf(content, it, holding);
    const sw = swingNumbers(holding, content, w);
    card.weapon = {
      type: cap(it.weaponType ?? "weapon"), stat: w.stat, ap: w.unwieldy ? "2 AP, ends your turn" : `${w.apCost} AP`, reach: w.reach,
      twoHanded: !!it.twoHanded, damage: sw.damage.join("/"),
      ...(it.damageType && it.damageType !== "physical" ? { damageType: it.damageType } : {}),
      average: sw.average, perTurn: perTurn(content, holding, it), roll: `2d10 ${signed(sw.rollBonus)}`, odds: sw.odds,
      ...(sw.critAt < 19 ? { critAt: sw.critAt } : {}),
      ...(w.skillId && content.skills.byId[w.skillId] ? { skill: skillLine(holding, content, w.skillId, "swings") } : {}),
    };
  }
  if (it.armor) {
    detail.push(`Armor ${it.armor}: takes ${it.armor} off every hit you take (never below 1).`);
    card.armor = it.armor;
  }

  for (const a of it.affixes ?? []) {
    detail.push(`${a.name}: ${a.text}`);
    card.traits.push({ name: a.name, text: a.text });
  }
  if (it.legendary) {
    detail.push(`★ ${it.legendary.name}: ${it.legendary.text}`);
    card.traits.push({ name: it.legendary.name, text: it.legendary.text, legendary: true });
  }
  const fromAffix = (it.affixes ?? []).some((a) => content.items.affixes.byId[a.id]?.onHit) ||
    !!(it.legendary && content.items.legendaryPowers.byId[it.legendary.id]?.onHit);
  if (it.onHit && !fromAffix) {
    const name = content.statusEffects.byId[it.onHit.id]?.name.toLowerCase() ?? it.onHit.id;
    detail.push(`On a solid hit: ${pct(it.onHit.chance)} chance it's ${name} (a great hit always does it).`);
    card.traits.push({ name: "On hit", text: `${pct(it.onHit.chance)} chance it's ${name} on a solid hit; always on a great one` });
  }
  for (const m of it.modifiers.filter((x) => !x.note?.startsWith("affix:") && !x.note?.startsWith("legendary:"))) {
    detail.push(`${describeModifier(m, content)}${m.note ? ` (${m.note})` : ""}`);
    card.traits.push({ name: m.note ? cap(m.note) : "Bonus", text: describeModifier(m, content) });
  }

  if (consumable?.scales) {
    detail.push(`Stronger on deeper floors: ×${potencyFor(1)} on Floor 1, ×${potencyFor(2)} on 2, ×${potencyFor(3)} on 3.`);
    card.notes.push(`Stronger deeper down: ×${potencyFor(1)} / ×${potencyFor(2)} / ×${potencyFor(3)} on Floors 1-3.`);
  }

  // Tomes and scrolls: the spell, and what it would do for you.
  const spell = it.spellId ? content.spells.byId[it.spellId] : undefined;
  if (spell) {
    const known = c.spells[spell.id];
    const scroll = it.spellLevel !== undefined;
    const level = scroll ? it.spellLevel! : Math.min(SPELL_LEVEL_CAP, known ? known.level + 1 : 1);
    const n = spellNumbers(c, content, spell, level);
    const school = content.skills.byId[schoolSkillId(content, spell.school)]?.name ?? spell.school;
    const effect = `At level ${level}: ${spellEffectText(content, spell, n, spellFlat(c, content, spell, n))} · ${scroll ? "free" : `${n.mp} MP`}, ${n.ap} AP${n.cooldown ? `, then ${n.cooldown} rounds to recharge` : ""}.`;
    const note = scroll ? "Reading it casts the spell once, no MP, whether you know it or not. It doesn't level your spell."
      : known ? (known.level >= SPELL_LEVEL_CAP ? "You know it as well as it can be known." : `You know it (level ${known.level}). Reading this makes it level ${known.level + 1}.`)
      : "Reading it teaches you the spell. Out of fights only.";
    detail.push(`${spell.name} · ${school} · ${spell.description}`, effect, note);
    card.spell = { name: spell.name, school, description: spell.description, effect, note };
  }

  let verdict: ItemInfo["verdict"];
  const quick: ItemQuick = it.power ? { stat: profileOf(content, it, holding).stat } : {};
  if (gear && equipped) {
    card.equipped = it.slot === "mainHand" ? "In your hand." : "You're wearing it.";
    detail.push(card.equipped);
  } else if (gear) {
    const changes = gearChanges(c, holding, content);
    const out = displaced(c, holding, it).map((x) => x.name);
    verdict = verdictOf(changes);
    detail.push(`If you equip it: ${changes.length ? formatChanges(changes) : "nothing you'd notice"}${out.length ? ` (replaces ${out.join(" and ")})` : ""}.`);
    card.changes = changes;
    if (out.length) card.replaces = out;
    const delta = quickDelta(content, c, holding, it, changes, verdict === "mixed");
    if (delta) quick.delta = delta;
  }

  if (it.heirloom) {
    const h = it.heirloom;
    const line = `An heirloom: left by ${h.from} (run ${h.run}), who ${h.cause === "quit" ? "quit" : h.cause.startsWith("descended") ? "made it out" : `died to ${h.cause}`}.`;
    detail.push(line);
    card.notes.push(line);
  }

  let summary: string | undefined;
  if (it.power) {
    const sw = swingNumbers(holding, content, profileOf(content, it, holding));
    summary = `${sw.damage.join("/")} dmg · ${it.stat ?? "STR"} · ${it.apCost ?? AP_COST.attack} AP`;
  } else if (gear) {
    const first = it.modifiers[0];
    summary = it.armor ? `armor ${it.armor}` : first ? describeModifier(first, content) : undefined;
  }
  return { detail, ...(summary ? { summary } : {}), ...(verdict ? { verdict } : {}), quick, card };
}
