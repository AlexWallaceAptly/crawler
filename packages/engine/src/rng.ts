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

export function d10(): number {
  return die(10);
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

// ---------------------------------------------------------------- looks only

/*
 * Randomness for how things look (which floor tile, where the puddles go), kept
 * apart from the game's dice: none of it reads or advances the source above, so
 * adding a cosmetic roll never shifts a fight's outcome or a test's forced dice.
 * Seeds come from state that's already random (an arena's layout, say).
 */

/** Mix integers into a 32-bit hash. Same inputs, same hash. */
export function hash32(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return h >>> 0;
}

/** Hash a string (for seeding from a layout). */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return hash32(h);
}

/** A stable [0, 1) value for these integers: a cosmetic coin with no state. */
export function hashUnit(...values: number[]): number {
  return hash32(...values) / 0x1_0000_0000;
}

export interface CosmeticStream {
  random(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
}

/** A seeded stream for cosmetic layouts (mulberry32). Never touches the game's dice. */
export function cosmeticStream(seed: number): CosmeticStream {
  let s = seed >>> 0;
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
  return {
    random,
    int: (min, max) => (max < min ? max : min + Math.floor(random() * (max - min + 1))),
    pick: (items) => {
      if (items.length === 0) throw new Error("cosmeticStream.pick: empty list");
      return items[Math.floor(random() * items.length)]!;
    },
  };
}
