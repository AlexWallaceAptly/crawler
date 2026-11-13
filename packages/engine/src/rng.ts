/**
 * The only place in the engine that touches randomness.
 * Production uses Math.random (no seeded runs, per spec). Tests can swap the
 * source with setRandomSource() or queue exact die results with forceDice().
 */

export type RandomSource = () => number;

let source: RandomSource = Math.random;
const forcedDice: number[] = [];
let uidCounter = 0;

/** Replace the underlying [0,1) source (tests only). */
export function setRandomSource(fn: RandomSource): void {
  source = fn;
}

/** Restore Math.random and clear any forced dice. */
export function resetRng(): void {
  source = Math.random;
  forcedDice.length = 0;
}

/** Queue exact results for the next die() calls, in order (tests only). */
export function forceDice(...values: number[]): void {
  forcedDice.push(...values);
}

/** How many forced dice are still queued. */
export function pendingForcedDice(): number {
  return forcedDice.length;
}

/** Float in [0, 1). */
export function random(): number {
  return source();
}

/** Integer in [min, max], inclusive. */
export function int(min: number, max: number): number {
  if (max < min) [min, max] = [max, min];
  return min + Math.floor(source() * (max - min + 1));
}

/** Roll one die with the given number of sides. Honors forceDice(). */
export function die(sides: number): number {
  if (forcedDice.length > 0) {
    const v = forcedDice.shift()!;
    if (!Number.isInteger(v) || v < 1 || v > sides) {
      throw new Error(`forced die value ${v} is not valid for a d${sides}`);
    }
    return v;
  }
  return int(1, sides);
}

export function d20(): number {
  return die(20);
}

/** True with probability p (0..1). */
export function chance(p: number): boolean {
  return source() < p;
}

export function pick<T>(items: readonly T[]): T {
  if (items.length === 0) throw new Error("rng.pick: empty list");
  return items[Math.floor(source() * items.length)]!;
}

/** n distinct items (or all of them if n >= length). */
export function pickN<T>(items: readonly T[], n: number): T[] {
  return shuffle(items).slice(0, Math.max(0, n));
}

export function weightedPick<T>(items: readonly T[], weight: (item: T) => number): T {
  if (items.length === 0) throw new Error("rng.weightedPick: empty list");
  let total = 0;
  for (const it of items) total += Math.max(0, weight(it));
  if (total <= 0) return pick(items);
  let roll = source() * total;
  for (const it of items) {
    roll -= Math.max(0, weight(it));
    if (roll < 0) return it;
  }
  return items[items.length - 1]!;
}

/** Weighted pick from a { key: weight } record. */
export function weightedKey<K extends string>(weights: Partial<Record<K, number>>): K {
  const keys = Object.keys(weights) as K[];
  return weightedPick(keys, (k) => weights[k] ?? 0);
}

export function shuffle<T>(items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(source() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Short unique id for item/entity instances. */
export function uid(prefix = "id"): string {
  uidCounter = (uidCounter + 1) % 1_000_000;
  const r = Math.floor(source() * 36 ** 6).toString(36).padStart(6, "0");
  return `${prefix}_${r}${uidCounter.toString(36)}`;
}
