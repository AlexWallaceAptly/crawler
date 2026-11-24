/**
 * Modifier targets the engine actually reads, and how to say each one to a player.
 * Generated gear (affixes, legendary powers, generated bases) may only use these:
 * validation fails on anything else, so an affix can't promise something no rule does.
 */
import type { Content } from "../content/load";
import { DAMAGE_TYPES, SPELL_SCHOOLS, STATS, type Modifier } from "../content/schemas";

/** Plain targets: what each does, for "+2 damage" style lines. */
const PLAIN: Record<string, { text: string; unit?: string; percent?: boolean }> = {
  attack: { text: "to attack rolls" },
  hit: { text: "to attack rolls" },
  damage: { text: "damage per hit" },
  damageReduction: { text: "armor" },
  dr: { text: "armor" },
  defense: { text: "guard (every 2 is a bane on attackers)" },
  flee: { text: "to flee" },
  initiative: { text: "initiative" },
  maxHP: { text: "max HP" },
  maxMP: { text: "max MP" },
  shove: { text: "to shove" },
  carry: { text: "carry limit" },
  regen: { text: "HP back per room walked" },
  leech: { text: "of damage dealt healed", percent: true },
  thorns: { text: "damage back to anything that hits you in melee" },
  spite: { text: "damage against whatever hit you last round" },
  killAp: { text: "AP back on a kill" },
  critRange: { text: "crit range (crits on a lower natural roll)" },
  executioner: { text: "damage against targets under half HP", percent: true },
  secondWind: { text: "HP back, once a fight, when you drop under a quarter", percent: true },
};

/**
 * Targets typed by weapon (`damage:blades`), mostly from weapon-skill perks. Each reads
 * only while you swing that kind of weapon (gear.ts swingNumbers, combat.ts). The first
 * four also take a spell school (`damage:fire`): a cast is a swing with the school as its type.
 */
const TYPED: Record<string, (v: number, type: string) => string> = {
  attack: (v, t) => `${signed(v)} to the roll with ${kindOf(t)}`,
  damage: (v, t) => `${signed(v)} damage with ${kindOf(t)}`,
  critRange: (v, t) => `${t} ${isSchool(t) ? "spells crit" : "crits land"} ${v} lower (on ${19 - v}+)`,
  armorPierce: (v, t) => `${t} ${isSchool(t) ? "spells" : "hits"} ignore ${v} armor`,
  defense: (v, t) => `${signed(v)} guard while holding a ${t} weapon`,
  reach: (_v, t) => `${t} weapons swing at near range`,
  decapitate: (v, t) => `${v}% chance a ${t} hit takes a non-boss's head off`,
  knockout: (v, t) => `${v}% chance a ${t} hit knocks a non-boss out for good`,
  tier3Mult: (v, t) => `great ${t} hits do ${v}% more damage`,
};
/** Typed kinds a spell school can carry (`damage:fire`); the rest of TYPED is weapons only. */
const SCHOOL_TYPED = new Set(["attack", "damage", "critRange", "armorPierce", "tier3Mult"]);

/** School-only perk targets, read by the spell rules (spells.ts). */
const SCHOOL: Record<string, (v: number, school: string) => string> = {
  mpCost: (v, t) => `${t} spells cost ${-v} less MP (minimum 1)`,
  cooldown: (v, t) => `${t} spells come back ${-v} round${v === -1 ? "" : "s"} sooner`,
  duration: (v, t) => `what your ${t} spells inflict lasts ${v} ${t === "utility" ? "room" : "round"}${v === 1 ? "" : "s"} longer`,
  area: (_v, t) => `${t} spells cover a wider area (one target becomes a plus, a plus becomes a square)`,
  healPct: (v, t) => `${t} heals do ${v}% more`,
  drain: (v, t) => `${t} spells heal you ${v}% more of the damage they do`,
  chain: (v, t) => `${t} spells arc to ${v} more enem${v === 1 ? "y" : "ies"}`,
  riderUp: (_v, t) => `what ${t} spells inflict lands on every solid hit (tier 2), not just great ones`,
  radius: (v, t) => `${t} sensing spells reach ${v} more room${v === 1 ? "" : "s"}`,
};

function isSchool(t: string): boolean {
  return (SPELL_SCHOOLS as readonly string[]).includes(t);
}
const kindOf = (t: string) => (isSchool(t) ? `${t} spells` : `${t} weapons`);

/** Weapon-skill perk flags read by the swing (gear.ts). */
const PERKS: Record<string, string> = {
  unarmedD6: "fists hit 2/4/6",
  unarmedD8: "fists hit 3/5/7",
  xpBonus: "XP",
};

/** Does some rule read this modifier target? */
export function knownTarget(to: string, content: Content): boolean {
  if (to in PLAIN) return true;
  const [kind, what] = to.split(":", 2) as [string, string | undefined];
  if (!what) return false;
  if (kind === "stat") return (STATS as readonly string[]).includes(what);
  if (kind === "skill") return content.skills.has(what);
  if (kind === "resist") return (DAMAGE_TYPES as readonly string[]).includes(what);
  if (kind === "critStatus") return content.statusEffects.has(what);
  if (kind === "healing") return what === "items";
  if (kind === "perk") return what in PERKS;
  const weaponTypes = new Set(content.skills.all.flatMap((s) => (s.weaponType ? [s.weaponType] : [])));
  if (kind in SCHOOL) return isSchool(what);
  if (kind in TYPED) {
    return weaponTypes.has(what) || (SCHOOL_TYPED.has(kind) && isSchool(what)) || (kind === "attack" && ["close", "near", "far"].includes(what));
  }
  // "critStatus@thrown:stunned", "tier3Status@bow:slowed", "tier3Status@frost:stunned"
  const [status, type] = kind.split("@") as [string, string | undefined];
  if (type && (status === "critStatus" || status === "tier3Status")) return (weaponTypes.has(type) || isSchool(type)) && content.statusEffects.has(what);
  return false;
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** "+2 STR", "+1 to attack rolls", "+15% of damage dealt healed", "-1 Stealth". */
export function describeModifier(m: Modifier, content: Content): string {
  const plain = PLAIN[m.to];
  if (plain) return `${signed(m.value)}${plain.percent ? "%" : ""} ${plain.text}`;
  const [kind, what = ""] = m.to.split(":", 2) as [string, string | undefined];
  if (kind === "stat") return `${signed(m.value)} ${what}`;
  if (kind === "skill") return `${signed(m.value)} ${content.skills.byId[what]?.name ?? what}`;
  if (kind === "resist") return `${signed(m.value)} ${what} resistance`;
  if (kind === "critStatus") {
    const name = content.statusEffects.byId[what]?.name.toLowerCase() ?? what;
    return `a crit leaves the target ${name} (${m.value} round${m.value === 1 ? "" : "s"})`;
  }
  if (kind === "healing") return `healing items do ${m.value}% more`;
  if (kind === "perk" && PERKS[what]) return what === "xpBonus" ? `${signed(m.value)}% XP` : PERKS[what]!;
  if (SCHOOL[kind]) return SCHOOL[kind]!(m.value, what);
  if (TYPED[kind]) return TYPED[kind]!(m.value, what);
  const [status, type] = kind.split("@") as [string, string | undefined];
  if (type) {
    const name = content.statusEffects.byId[what]?.name.toLowerCase() ?? what;
    const hit = isSchool(type) ? `${type} spell` : type;
    return `${status === "critStatus" ? `a ${hit} crit` : `a great ${hit} hit`} leaves the target ${name} (${m.value} round${m.value === 1 ? "" : "s"})`;
  }
  return `${signed(m.value)} ${m.to.replace(/^(skill|stat|perk):/, "")}`;
}
