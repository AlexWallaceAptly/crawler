import { d20 } from "../rng";

export const DC_TIERS = {
  trivial: 10,
  easy: 15,
  medium: 20,
  hard: 25,
  brutal: 30,
  absurd: 35,
} as const;

export type DcTier = keyof typeof DC_TIERS;
export const DC_TIER_NAMES = Object.keys(DC_TIERS) as DcTier[];

/** DC = tier + 2 * (floor - 1). Floors below 1 are treated as 1. */
export function dcFor(tier: DcTier, floor: number): number {
  return DC_TIERS[tier] + 2 * (Math.max(1, Math.floor(floor)) - 1);
}

export type CheckOutcome = "critSuccess" | "success" | "failure" | "critFailure";

export interface CheckInput {
  /** What the roll is for, e.g. "Perception" or "Force door". */
  label: string;
  /** Total flat modifier: stat + skill rank + bonuses. */
  modifier: number;
  dc: number;
  /** Optional breakdown for the battle log, e.g. { DEX: 7, Stealth: 2 }. */
  parts?: Record<string, number>;
}

export interface CheckResult {
  label: string;
  natural: number;
  modifier: number;
  total: number;
  dc: number;
  /** total - dc */
  margin: number;
  success: boolean;
  outcome: CheckOutcome;
  parts?: Record<string, number>;
}

/** Decide the outcome of an already-rolled check. Combat doesn't use this: attacks are power rolls (power.ts). */
export function judge(natural: number, modifier: number, dc: number): Pick<CheckResult, "total" | "margin" | "success" | "outcome"> {
  const total = natural + modifier;
  const margin = total - dc;
  const success = natural === 20 ? true : natural === 1 ? false : total >= dc;
  let outcome: CheckOutcome;
  if (success) outcome = margin >= 10 ? "critSuccess" : "success";
  else outcome = margin <= -10 ? "critFailure" : "failure";
  return { total, margin, success, outcome };
}

/** Roll d20 + modifier against a DC. */
export function resolveCheck(input: CheckInput): CheckResult {
  const natural = d20();
  return {
    label: input.label,
    natural,
    modifier: input.modifier,
    dc: input.dc,
    ...(input.parts ? { parts: input.parts } : {}),
    ...judge(natural, input.modifier, input.dc),
  };
}

export interface OpposedSide {
  label: string;
  modifier: number;
}

export interface OpposedResult {
  attacker: { label: string; natural: number; modifier: number; total: number };
  defender: { label: string; natural: number; modifier: number; total: number };
  winner: "attacker" | "defender";
  margin: number;
}

/** Both sides roll d20 + modifier. Higher total wins; ties go to the defender. */
export function resolveOpposed(attacker: OpposedSide, defender: OpposedSide): OpposedResult {
  const an = d20();
  const dn = d20();
  const at = an + attacker.modifier;
  const dt = dn + defender.modifier;
  return {
    attacker: { label: attacker.label, natural: an, modifier: attacker.modifier, total: at },
    defender: { label: defender.label, natural: dn, modifier: defender.modifier, total: dt },
    winner: at > dt ? "attacker" : "defender",
    margin: at - dt,
  };
}

export function describeCheck(r: CheckResult): string {
  const mod = r.modifier >= 0 ? `+${r.modifier}` : `${r.modifier}`;
  const tag =
    r.outcome === "critSuccess" ? "CRITICAL SUCCESS" :
    r.outcome === "critFailure" ? "CRITICAL FAILURE" :
    r.success ? "success" : "failure";
  const nat = r.natural === 20 ? " (nat 20)" : r.natural === 1 ? " (nat 1)" : "";
  return `${r.label}: d20(${r.natural})${mod} = ${r.total} vs DC ${r.dc}${nat} → ${tag}`;
}
