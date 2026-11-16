import { die } from "../rng";

/** Dice expressions like "2d6+1", "d20", "1d8+1d4-2". */
export type Dice = string;

export interface DiceTerm {
  count: number;
  sides: number;
  sign: 1 | -1;
}

export interface ParsedDice {
  terms: DiceTerm[];
  modifier: number;
  source: string;
}

export interface DieResult {
  sides: number;
  value: number;
  sign: 1 | -1;
}

export interface DiceRoll {
  expr: string;
  rolls: DieResult[];
  modifier: number;
  total: number;
}

const TERM = /^(\d*)d(\d+)$|^(\d+)$/;
const cache = new Map<string, ParsedDice>();

export class DiceError extends Error {}

export function parseDice(expr: string): ParsedDice {
  const hit = cache.get(expr);
  if (hit) return hit;
  const src = expr.replace(/\s+/g, "").toLowerCase();
  if (src === "") throw new DiceError(`empty dice expression`);
  if (/[+-]$/.test(src) || /^\+/.test(src) || /[+-]{2}/.test(src)) {
    throw new DiceError(`malformed dice expression "${expr}"`);
  }
  const parts = src.match(/[+-]?[^+-]+/g) ?? [];
  const terms: DiceTerm[] = [];
  let modifier = 0;
  for (const raw of parts) {
    const sign: 1 | -1 = raw.startsWith("-") ? -1 : 1;
    const body = raw.replace(/^[+-]/, "");
    const m = TERM.exec(body);
    if (!m) throw new DiceError(`malformed dice term "${raw}" in "${expr}"`);
    if (m[3] !== undefined) {
      modifier += sign * Number(m[3]);
      continue;
    }
    const count = m[1] === "" ? 1 : Number(m[1]);
    const sides = Number(m[2]);
    if (count < 1 || count > 100) throw new DiceError(`dice count ${count} out of range in "${expr}"`);
    if (sides < 1 || sides > 1000) throw new DiceError(`die size d${sides} out of range in "${expr}"`);
    terms.push({ count, sides, sign });
  }
  const parsed: ParsedDice = { terms, modifier, source: expr };
  cache.set(expr, parsed);
  return parsed;
}

export function isDice(expr: unknown): expr is Dice {
  if (typeof expr !== "string") return false;
  try {
    parseDice(expr);
    return true;
  } catch {
    return false;
  }
}

export function rollDice(expr: Dice | ParsedDice): DiceRoll {
  const p = typeof expr === "string" ? parseDice(expr) : expr;
  const rolls: DieResult[] = [];
  let total = p.modifier;
  for (const t of p.terms) {
    for (let i = 0; i < t.count; i++) {
      const value = die(t.sides);
      rolls.push({ sides: t.sides, value, sign: t.sign });
      total += t.sign * value;
    }
  }
  return { expr: p.source, rolls, modifier: p.modifier, total };
}

export function diceRange(expr: Dice | ParsedDice): { min: number; max: number } {
  const p = typeof expr === "string" ? parseDice(expr) : expr;
  let min = p.modifier;
  let max = p.modifier;
  for (const t of p.terms) {
    if (t.sign === 1) {
      min += t.count;
      max += t.count * t.sides;
    } else {
      min -= t.count * t.sides;
      max -= t.count;
    }
  }
  return { min, max };
}

export function diceAverage(expr: Dice | ParsedDice): number {
  const p = typeof expr === "string" ? parseDice(expr) : expr;
  let avg = p.modifier;
  for (const t of p.terms) avg += (t.sign * t.count * (t.sides + 1)) / 2;
  return avg;
}

export function formatDice(p: Pick<ParsedDice, "terms" | "modifier">): string {
  let out = "";
  for (const t of p.terms) {
    const s = `${t.count}d${t.sides}`;
    out += t.sign === -1 ? `-${s}` : out === "" ? s : `+${s}`;
  }
  if (out === "") return `${p.modifier}`;
  if (p.modifier > 0) out += `+${p.modifier}`;
  if (p.modifier < 0) out += `${p.modifier}`;
  return out;
}

/** Add a flat modifier: addToDice("1d8", 3) -> "1d8+3". */
export function addToDice(expr: Dice, flat: number): Dice {
  const p = parseDice(expr);
  return formatDice({ terms: p.terms, modifier: p.modifier + flat });
}

const DIE_STEPS = [2, 3, 4, 6, 8, 10, 12];

/**
 * Bump each term's die size up the standard ladder: stepDice("1d6", 1) -> "1d8".
 * A d12 stays a d12 (the bonus goes nowhere; craft something else).
 */
export function stepDice(expr: Dice, steps: number): Dice {
  const p = parseDice(expr);
  return formatDice({
    terms: p.terms.map((t) => {
      const i = DIE_STEPS.indexOf(t.sides);
      const next = i < 0 ? t.sides : DIE_STEPS[Math.min(DIE_STEPS.length - 1, i + steps)]!;
      return { ...t, sides: next };
    }),
    modifier: p.modifier,
  });
}

/** Multiply the number of dice in each term (min 1). Used for scaling. */
export function multiplyDice(expr: Dice, factor: number): Dice {
  const p = parseDice(expr);
  return formatDice({
    terms: p.terms.map((t) => ({ ...t, count: Math.max(1, Math.round(t.count * factor)) })),
    modifier: p.modifier,
  });
}

/** Human-readable breakdown, e.g. "2d6+1 → [4,2]+1 = 7". */
export function describeRoll(r: DiceRoll): string {
  const dice = r.rolls.map((d) => (d.sign === -1 ? `-${d.value}` : `${d.value}`)).join(",");
  const mod = r.modifier === 0 ? "" : r.modifier > 0 ? `+${r.modifier}` : `${r.modifier}`;
  return `${r.expr} → [${dice}]${mod} = ${r.total}`;
}
