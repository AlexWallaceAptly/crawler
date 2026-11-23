/**
 * Crafting (Milestone 4b). At a workbench (any safe room, or a workshop), name
 * the junk you want to put together: `combine bat tacks tape`. If some recipe
 * can use exactly those things, you make it and the recipe goes in your book.
 * If not, the System AI laughs at you and five minutes are gone.
 *
 * Recipes are tag-based (any blunt weapon + anything sharp + anything that binds),
 * so they're data in recipes.json. Matching:
 *   1. split what you typed into item names (commas, "+", "and", "with", or
 *      spaces — trying every way to group the words);
 *   2. each name resolves to candidate items (exact, whole words, substring), or,
 *      when it names a crafting property instead (`combine blunt sharp bind`),
 *      to everything with that property (craftParts.json). The workbench chips
 *      send `#sharp` (a property, never an item name) and `#item:box_of_nails`;
 *   3. search candidate choices × recipes × input slots: every named item must
 *      fill a slot, and every slot must be filled;
 *   4. the most specific recipe wins (id 4, a single tag 2, a list of tags 1,
 *      plus one per input, plus its priority); ties go to file order.
 * The workbench shows those properties as chips (workbenchChips): tap a few and the
 * game picks the items. The book counts what you have of each part ("Sharp 3/1").
 * Upgrades are baked into the item (name, power, on-hit) and recorded in
 * `item.crafted`, so an equipped bat stays equipped and each upgrade applies once.
 */
import type { CraftPart, Recipe, RecipeInput } from "./content/schemas";
import { advanceTime } from "./explore";
import { autoEquip } from "./gen/backstory";
import { itemFromRef } from "./gen/item";
import { addToPile, effectiveTags, equippedSlot, findItems, unequipUid } from "./inventory";
import { dcFor, describeCheck, resolveCheck, type DcTier } from "./rules/checks";
import { rollDice } from "./rules/dice";
import { addPower, stepPower } from "./rules/power";
import { collectModifiers, derive } from "./rules/derived";
import { skillRank, trainSkill } from "./progression";
import { applyStatus } from "./rules/effects";
import { pick } from "./rng";
import { killCrawler, type StepContext } from "./step";
import type { Crawler, ItemInstance, Room } from "./state";
import type { Content } from "./content/load";

/** Time wasted fiddling with junk that doesn't go together. */
export const FIDDLE_MINUTES = 5;
/** An item can carry this many crafted upgrades. */
export const MAX_UPGRADES = 2;

export function atWorkbench(room: Room | undefined): boolean {
  return !!room && (room.type === "safe" || !!room.workbench);
}

function inputMatches(input: RecipeInput, item: ItemInstance, recipe: Recipe): boolean {
  if (input.id && item.baseId !== input.id) return false;
  if (input.tags) {
    const tags = effectiveTags(item);
    if (!input.tags.some((t) => tags.includes(t))) return false;
  }
  if (input.base) {
    if (item.kind !== "gear") return false;
    const done = item.crafted ?? [];
    if (done.includes(recipe.id) || done.length >= MAX_UPGRADES) return false;
  }
  return true;
}

export function specificity(r: Recipe): number {
  return r.inputs.reduce((s, i) => s + (i.id ? 4 : i.tags!.length === 1 ? 2 : 1), 0) + r.inputs.length + r.priority;
}

/** Which item fills which input. */
export type Assignment = { input: RecipeInput; items: ItemInstance[] }[];

/**
 * Fit `items` (all of them) into the recipe's inputs. Each item fills one input;
 * an input's qty can come from one stack or several items.
 * `more`: for an item picked by property, the other items with that property. A slot
 * still short of its qty tops up from them (one tap on "Sharp" can fill "Sharp ×2").
 */
export function assign(recipe: Recipe, items: ItemInstance[], more?: Map<ItemInstance, ItemInstance[]>): Assignment | null {
  const slots: Assignment = recipe.inputs.map((input) => ({ input, items: [] }));
  const have = (s: Assignment[number]) => s.items.reduce((n, it) => n + it.qty, 0);
  const topUp = (): boolean => {
    const used = new Set(slots.flatMap((s) => s.items));
    const added: Assignment[number][] = [];
    let ok = true;
    for (const s of slots) {
      let need = s.input.qty - have(s);
      if (need <= 0) continue;
      if (!s.input.base) {
        for (const extra of s.items.flatMap((it) => more?.get(it) ?? [])) {
          if (need <= 0) break;
          if (used.has(extra) || !inputMatches(s.input, extra, recipe)) continue;
          s.items.push(extra);
          used.add(extra);
          added.push(s);
          need -= extra.qty;
        }
      }
      if (need > 0) {
        ok = false;
        break;
      }
    }
    if (!ok) for (const s of added.reverse()) s.items.pop();
    return ok;
  };
  const go = (i: number): boolean => {
    if (i === items.length) return slots.every((s) => s.items.length > 0) && topUp();
    const item = items[i]!;
    for (const s of slots) {
      if (!inputMatches(s.input, item, recipe)) continue;
      if (s.items.length > 0 && (s.input.base || have(s) >= s.input.qty)) continue; // already full
      s.items.push(item);
      if (go(i + 1)) return true;
      s.items.pop();
    }
    return false;
  };
  return go(0) ? slots : null;
}

function* choices(cands: ItemInstance[][], i = 0, chosen: ItemInstance[] = []): Generator<ItemInstance[]> {
  if (i === cands.length) {
    yield chosen.slice();
    return;
  }
  for (const c of cands[i]!.slice(0, 4)) {
    if (chosen.includes(c)) continue;
    chosen.push(c);
    yield* choices(cands, i + 1, chosen);
    chosen.pop();
  }
}

/** Every way to cut a word list into 2-4 contiguous names, fewest pieces first. */
function groupings(words: string[]): string[][] {
  const out: string[][] = [];
  const n = words.length;
  for (let mask = 0; mask < 1 << Math.max(0, n - 1); mask++) {
    const parts: string[] = [];
    let cur: string[] = [words[0]!];
    for (let i = 1; i < n; i++) {
      if (mask & (1 << (i - 1))) {
        parts.push(cur.join(" "));
        cur = [words[i]!];
      } else cur.push(words[i]!);
    }
    parts.push(cur.join(" "));
    if (parts.length >= 1 && parts.length <= 4) out.push(parts);
  }
  return out.sort((a, b) => a.length - b.length);
}

/** Split `combine ...` text into item names. */
export function splitNames(text: string): string[][] {
  const t = text.trim().toLowerCase();
  // The workbench chips send `#part` names with a bar between them: no item name contains one.
  if (t.includes("|")) return [t.split(/\s*\|\s*/).filter(Boolean)];
  if (/[,+]| and | with | & /.test(t)) return [t.split(/\s*(?:,|\+|&| and | with )\s*/).filter(Boolean)];
  const words = t.split(/\s+/).filter(Boolean).filter((w) => w !== "the" && w !== "a");
  return words.length > 12 ? [words] : groupings(words);
}

export interface Match {
  recipe: Recipe;
  assignment: Assignment;
}

/** A crafting property named in `combine` text ("sharp", "blunt weapon", "Echo's parts"), if any. */
export function partNamed(content: Content, name: string): CraftPart | undefined {
  const q = name.toLowerCase().trim();
  const forms = (p: CraftPart) => [p.id, p.label, p.term ?? p.label].flatMap((n) => {
    const l = n.toLowerCase().replace(/_/g, " ");
    return [l, l.endsWith("s") ? l.slice(0, -1) : `${l}s`];
  });
  return content.craftParts.all.find((p) => forms(p).includes(q));
}

export function inPart(part: CraftPart, item: ItemInstance): boolean {
  const tags = effectiveTags(item);
  return part.tags.some((t) => tags.includes(t));
}

/**
 * Everything with a property, in the order the game should pick it. Gear (what gets
 * upgraded) puts what you have equipped first. Junk spares what you have equipped, then
 * what's good for more than this (a bungee cord is Bind, but also your only Elastic),
 * then goes cheapest first, so the good tape is saved.
 */
export function partItems(content: Content, part: CraftPart, inventory: ItemInstance[], equipped: ReadonlySet<string> = new Set()): ItemInstance[] {
  const on = (it: ItemInstance) => (equipped.has(it.uid) ? 1 : 0);
  const uses = (it: ItemInstance) => content.craftParts.all.filter((p) => p.group && !p.gear && inPart(p, it)).length;
  return inventory
    .filter((it) => inPart(part, it))
    .sort((a, b) => (part.gear ? on(b) - on(a) : on(a) - on(b) || uses(a) - uses(b)) || a.value - b.value);
}

/** A `combine` name that picks by property or base id: `#sharp`, `#item:box_of_nails`. Never an item's name. */
function pickedBy(content: Content, name: string): { part?: CraftPart; baseId?: string } | null {
  const q = name.trim().toLowerCase();
  if (!q.startsWith("#")) return null;
  const id = q.slice(1);
  if (id.startsWith("item:")) return { baseId: id.slice(5) };
  const part = content.craftParts.byId[id];
  return part ? { part } : {};
}

/**
 * What a name in `combine` text could mean, and whether it named a property (so the
 * pick can top up a qty from the property's other items).
 * - `#part` and `#item:<id>`: the workbench chips. Exactly that, never an item name.
 * - A property name ("sharp", "cord") beats items that only contain the word, so an
 *   Accordion File doesn't hijack "cord". An item with exactly that name still wins.
 * - Otherwise items by name: exact, whole words, then any substring.
 */
export function resolveName(content: Content, inventory: ItemInstance[], name: string, equipped: ReadonlySet<string> = new Set()): { items: ItemInstance[]; property: boolean } {
  const picked = pickedBy(content, name);
  if (picked) {
    if (picked.part) return { items: partItems(content, picked.part, inventory, equipped), property: true };
    if (picked.baseId) return { items: inventory.filter((it) => it.baseId === picked.baseId), property: true };
    return { items: [], property: true };
  }
  const part = partNamed(content, name);
  const q = name.trim().toLowerCase();
  if (part && !inventory.some((it) => it.name.toLowerCase() === q)) {
    const items = partItems(content, part, inventory, equipped);
    if (items.length) return { items, property: true };
  }
  return { items: findItems(inventory, name), property: false };
}

export function candidatesFor(content: Content, inventory: ItemInstance[], name: string, equipped: ReadonlySet<string> = new Set()): ItemInstance[] {
  return resolveName(content, inventory, name, equipped).items;
}

/** The best recipe that uses exactly the named things, or null. `equipped`: uids you have on. */
export function matchCombination(content: Content, inventory: ItemInstance[], text: string, equipped: ReadonlySet<string> = new Set()): Match | null {
  const recipes = content.recipes.all.slice().sort((a, b) => specificity(b) - specificity(a));
  for (const names of splitNames(text)) {
    if (names.length < 2) continue;
    const resolved = names.map((n) => resolveName(content, inventory, n, equipped));
    const cands = resolved.map((r) => r.items);
    if (cands.some((c) => c.length === 0)) continue;
    for (const recipe of recipes) {
      for (const items of choices(cands)) {
        const more = new Map<ItemInstance, ItemInstance[]>();
        items.forEach((it, i) => {
          if (resolved[i]!.property) more.set(it, cands[i]!.filter((x) => !items.includes(x)));
        });
        const assignment = assign(recipe, items, more);
        if (assignment) return { recipe, assignment };
      }
    }
  }
  return null;
}

/**
 * Pick parts for a recipe from the whole pack (for `craft <name>` and hints).
 * Prefers your equipped weapon as an upgrade base and unequipped junk as parts.
 */
export function autoAssign(c: Crawler, recipe: Recipe): Assignment | null {
  const used = new Set<ItemInstance>();
  const slots: Assignment = [];
  for (const input of recipe.inputs) {
    const fits = c.inventory.filter((it) => !used.has(it) && inputMatches(input, it, recipe));
    const equipped = (it: ItemInstance) => (equippedSlot(c, it.uid) ? 1 : 0);
    fits.sort((a, b) => (input.base ? equipped(b) - equipped(a) : equipped(a) - equipped(b)) || a.value - b.value);
    const taken: ItemInstance[] = [];
    let got = 0;
    for (const it of fits) {
      if (got >= input.qty || (input.base && taken.length)) break;
      taken.push(it);
      used.add(it);
      got += it.qty;
    }
    if (got < input.qty || taken.length === 0) return null;
    slots.push({ input, items: taken });
  }
  return slots;
}

/** What a recipe input is called: an item's name, or its property ("Blunt weapon", "Wick or Padding"). */
export function inputLabel(i: RecipeInput, content: Content): string {
  if (i.id) return content.items.bases.byId[i.id]?.name ?? content.items.consumables.byId[i.id]?.name ?? i.id;
  const tags = i.tags!;
  const name = (p: CraftPart) => p.term ?? p.label;
  const whole = content.craftParts.all.find((p) => tags.every((t) => p.tags.includes(t)));
  if (whole) return name(whole);
  return tags.map((t) => {
    const p = content.craftParts.all.find((x) => x.tags.includes(t));
    return p ? name(p) : t;
  }).join(" or ");
}

/** One part of a recipe as the book shows it: "Sharp 3/1". */
export interface RecipePart {
  label: string;
  /** Units in your pack that fit (upgrade bases count one each). */
  have: number;
  need: number;
  /** A tool: not used up. */
  kept?: boolean;
  /** The item that gets upgraded. */
  upgraded?: boolean;
}

export function recipeParts(c: Crawler, recipe: Recipe, content: Content): RecipePart[] {
  return recipe.inputs.map((i) => {
    const fits = c.inventory.filter((it) => inputMatches(i, it, recipe));
    return {
      label: inputLabel(i, content),
      have: i.base ? fits.length : fits.reduce((n, it) => n + it.qty, 0),
      need: i.qty,
      ...(!i.consumed ? { kept: true } : {}),
      ...(i.base ? { upgraded: true } : {}),
    };
  });
}

/** "Blunt weapon (upgraded) 1/1 + Sharp 3/1 + Bind 0/1" */
export function formatParts(parts: RecipePart[]): string {
  return parts.map((p) => `${p.label}${p.upgraded ? " (upgraded)" : ""}${p.kept ? " (kept)" : ""} ${p.have}/${p.need}`).join(" + ");
}

export interface RecipeBookView {
  known: { id: string; name: string; parts: RecipePart[]; text: string; ready: boolean }[];
  hints: string[];
}

/** What the recipe book shows: everything you've made, plus nudges for what you're carrying. */
export function recipeBook(c: Crawler, content: Content): RecipeBookView {
  const known = new Set(c.recipes ?? []);
  return {
    known: content.recipes.all.filter((r) => known.has(r.id)).map((r) => ({
      id: r.id, name: r.name, parts: recipeParts(c, r, content), text: r.text,
      ready: autoAssign(c, r) !== null,
    })),
    hints: content.recipes.all.filter((r) => !known.has(r.id) && autoAssign(c, r) !== null).slice(0, 3).map((r) => r.hint),
  };
}

/** One chip at the workbench: a property (Sharp 3), your gear (Weapon), or an exact item a recipe wants (Box of Nails). */
export interface WorkbenchChip {
  /** What the chip sends to `combine`: `#sharp`, `#item:box_of_nails`. */
  pick: string;
  label: string;
  kind: "gear" | "part" | "item";
  /** Units carried (a stack of 3 counts 3). */
  count: number;
  hint?: string;
  /** Gear chips: what the game would pick first ("Aluminum Baseball Bat"). */
  detail?: string;
}

/** The uids the crawler has equipped. */
export function equippedUids(c: Crawler): Set<string> {
  return new Set(Object.values(c.equipment).filter((u): u is string => !!u));
}

/**
 * The workbench chips: your gear (Weapon, Chest gear), then each junk property some
 * recipe uses (Sharp 3, Bind 5...), then the exact items a recipe asks for by name
 * (Box of Nails, Broken Glass). Only what you're carrying, and only what a recipe
 * could use: no Echo's parts, no "Other". Tap a few and the game picks the items.
 */
export function workbenchChips(c: Crawler, content: Content): WorkbenchChip[] {
  const inputs = content.recipes.all.flatMap((r) => r.inputs);
  const used = (p: CraftPart) => inputs.some((i) => i.tags?.some((t) => p.tags.includes(t)));
  const equipped = equippedUids(c);
  const units = (items: ItemInstance[]) => items.reduce((n, it) => n + it.qty, 0);
  const chips: WorkbenchChip[] = [];
  const parts = content.craftParts.all.filter((p) => p.group && used(p));
  for (const p of [...parts.filter((x) => x.gear), ...parts.filter((x) => !x.gear)]) {
    const items = partItems(content, p, c.inventory, equipped);
    if (items.length === 0) continue;
    chips.push({
      pick: `#${p.id}`, label: p.label, kind: p.gear ? "gear" : "part", count: units(items),
      ...(p.hint ? { hint: p.hint } : {}),
      ...(p.gear ? { detail: items[0]!.name + (equipped.has(items[0]!.uid) ? " (equipped)" : "") } : {}),
    });
  }
  const ids = [...new Set(inputs.flatMap((i) => (i.id ? [i.id] : [])))];
  for (const id of ids) {
    const items = c.inventory.filter((it) => it.baseId === id);
    if (items.length === 0) continue;
    chips.push({ pick: `#item:${id}`, label: items[0]!.name, kind: "item", count: units(items) });
  }
  return chips;
}

/** The junk properties an item counts as ("Bind", "Cord", "Elastic"); gear groups aren't listed. */
export function partsOf(item: ItemInstance, content: Content): string[] {
  return content.craftParts.all.filter((p) => p.group && !p.gear && inPart(p, item)).map((p) => p.label);
}

// ---------------------------------------------------------------- doing it

function learn(ctx: StepContext, recipe: Recipe): void {
  const c = ctx.crawler;
  c.recipes ??= [];
  if (c.recipes.includes(recipe.id)) return;
  c.recipes.push(recipe.id);
  ctx.emit({ type: "recipeLearned", name: recipe.name });
  ctx.say("craft.learned", { recipe: recipe.name });
}

function removeUnits(c: Crawler, item: ItemInstance, n: number): void {
  item.qty -= n;
  if (item.qty <= 0) {
    unequipUid(c, item.uid);
    c.inventory.splice(c.inventory.indexOf(item), 1);
  }
}

/** " Used Thumbtacks and Duct Tape." — the game may have picked them, so it says which. Tools are "kept". */
function usedText(a: Assignment): string {
  const gone: string[] = [];
  const kept: string[] = [];
  for (const slot of a) {
    if (slot.input.base) continue;
    let need = slot.input.qty;
    for (const it of slot.items) {
      if (need <= 0) break;
      const n = Math.min(need, it.qty);
      need -= n;
      (slot.input.consumed ? gone : kept).push(n > 1 ? `${it.name} ×${n}` : it.name);
    }
  }
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0]!);
  return (gone.length ? ` Used ${list(gone)}.` : "") + (kept.length ? ` Kept the ${list(kept)}.` : "");
}

/** Use up each consumed input's qty from the items assigned to it. */
function consumeParts(c: Crawler, a: Assignment): void {
  for (const slot of a) {
    if (!slot.input.consumed || slot.input.base) continue;
    let need = slot.input.qty;
    for (const it of slot.items) {
      if (need <= 0) break;
      const n = Math.min(need, it.qty);
      removeUnits(c, it, n);
      need -= n;
    }
  }
}

function applyUpgrade(item: ItemInstance, recipe: Recipe): void {
  const out = recipe.output;
  if (out.kind !== "upgrade") return;
  item.name = `${out.prefix} ${item.name}`;
  if (item.power) {
    if (out.damageStep) item.power = stepPower(item.power, out.damageStep);
    if (out.damageBonus) item.power = addPower(item.power, out.damageBonus);
  }
  if (out.damageType) item.damageType = out.damageType;
  if (out.armorBonus) item.armor = (item.armor ?? 0) + out.armorBonus;
  if (out.range) item.range = out.range;
  if (out.onHit && (!item.onHit || out.onHit.chance >= item.onHit.chance)) item.onHit = { ...out.onHit };
  item.modifiers.push(...out.modifiers.map((m) => ({ ...m })));
  for (const t of ["crafted", ...out.addTags]) if (!item.tags.includes(t)) item.tags.push(t);
  item.crafted = [...(item.crafted ?? []), recipe.id];
  item.value += 5;
}

/** Roll the recipe's check, if it has one. Returns the outcome (success when there's no check). */
function craftCheck(ctx: StepContext, recipe: Recipe): "success" | "failure" | "critFailure" {
  const check = recipe.check;
  if (!check) return "success";
  const c = ctx.crawler;
  const d = derive(c, ctx.content);
  const mods = collectModifiers(c, ctx.content);
  const rank = check.skill ? skillRank(c, check.skill, mods) : 0;
  const skillName = check.skill ? ctx.content.skills.byId[check.skill]?.name ?? check.skill : undefined;
  const r = resolveCheck({
    label: `${recipe.name} (${check.stat}${skillName ? ` + ${skillName}` : ""})`,
    modifier: d.stats[check.stat] + rank,
    dc: dcFor(check.tier as DcTier, ctx.game.floor?.floor ?? 1),
  });
  ctx.emit({ type: "check", result: r, text: describeCheck(r) });
  if (r.success && check.skill && check.tier !== "trivial") trainSkill(ctx, check.skill, 1);
  return r.success ? "success" : r.outcome === "critFailure" ? "critFailure" : "failure";
}

function make(ctx: StepContext, m: Match): void {
  const c = ctx.crawler;
  const { recipe, assignment } = m;
  advanceTime(ctx, recipe.minutes);
  if (ctx.game.phase === "dead") return;
  const outcome = craftCheck(ctx, recipe);
  if (outcome !== "success") {
    // Fumbled: one consumed part is ruined. You still learned how it's meant to go.
    const parts = assignment.filter((s) => s.input.consumed && !s.input.base).flatMap((s) => s.items);
    const lost = parts.length ? pick(parts) : undefined;
    if (lost) removeUnits(c, lost, 1);
    ctx.describe(`It falls apart in your hands${lost ? `, and the ${lost.name.toLowerCase()} is ruined` : ""}.`);
    ctx.say("craft.botch", { recipe: recipe.name });
    const mishap = recipe.check?.mishap;
    if (outcome === "critFailure" && mishap) {
      if (mishap.dice) {
        const dmg = rollDice(mishap.dice).total;
        c.hp -= dmg;
        ctx.describe(`That cost you ${dmg} HP.`);
      }
      if (mishap.statusId) applyStatus(c.statuses, ctx.content.statusEffects.get(mishap.statusId));
      if (c.hp <= 0) {
        killCrawler(ctx, `a botched ${recipe.name.toLowerCase()}`);
        return;
      }
    }
    learn(ctx, recipe);
    return;
  }

  const used = usedText(assignment);
  if (recipe.output.kind === "upgrade") {
    const base = assignment.find((s) => s.input.base)!.items[0]!;
    consumeParts(c, assignment);
    applyUpgrade(base, recipe);
    ctx.describe(`${recipe.text} You now have the ${base.name}.${used}`);
  } else {
    const out = recipe.output;
    consumeParts(c, assignment);
    const made = addToPile(c.inventory, itemFromRef(ctx.content, out.ref, out.qty));
    const slot = autoEquip(c, made);
    ctx.describe(`${recipe.text} You made ${made.name}${slot ? ` (equipped)` : ""}.${used}`);
  }
  ctx.say("craft.success", { recipe: recipe.name });
  learn(ctx, recipe);
}

function requireBench(ctx: StepContext): boolean {
  const floor = ctx.game.floor;
  const room = floor ? floor.rooms[floor.currentRoom] : undefined;
  if (atWorkbench(room)) return true;
  ctx.say("craft.noBench");
  return false;
}

/** `combine bat tacks tape` */
export function combine(ctx: StepContext, text: string): void {
  if (!requireBench(ctx)) return;
  const inv = ctx.crawler.inventory;
  const equipped = equippedUids(ctx.crawler);
  const carrying = splitNames(text).some((g) => g.length >= 2 && g.every((n) => candidatesFor(ctx.content, inv, n, equipped).length > 0));
  if (!carrying) {
    ctx.error("You aren't carrying all of that (and it takes at least two things). Check your pack.");
    return;
  }
  const match = matchCombination(ctx.content, inv, text, equipped);
  if (!match) {
    advanceTime(ctx, FIDDLE_MINUTES);
    if (ctx.game.phase === "dead") return;
    ctx.say("craft.noMatch");
    return;
  }
  make(ctx, match);
}

/** `craft nail bat`: a known recipe, parts picked from the pack. */
export function craftKnown(ctx: StepContext, name: string): void {
  const c = ctx.crawler;
  const q = name.toLowerCase().trim();
  const known = ctx.content.recipes.all.filter((r) => (c.recipes ?? []).includes(r.id));
  const recipe = known.find((r) => r.name.toLowerCase() === q) ?? known.find((r) => r.name.toLowerCase().includes(q));
  if (!recipe) {
    ctx.error(known.length
      ? `Your recipe book has no "${name}". Known: ${known.map((r) => r.name).join(", ")}.`
      : "Your recipe book is empty. Find out what goes together: `combine <thing> <thing>` at a workbench.");
    return;
  }
  if (!requireBench(ctx)) return;
  const assignment = autoAssign(c, recipe);
  if (!assignment) {
    ctx.error(`You're missing parts for the ${recipe.name}: ${formatParts(recipeParts(c, recipe, ctx.content))}.`);
    return;
  }
  make(ctx, { recipe, assignment });
}

/** `recipes`: print the book. */
export function showRecipes(ctx: StepContext): void {
  const book = recipeBook(ctx.crawler, ctx.content);
  const lines = [
    ...book.known.map((r) => `${r.ready ? "✓" : "·"} ${r.name}: ${formatParts(r.parts)}`),
    ...(book.known.length ? [] : ["(empty: combine things at a workbench to find out what works)"]),
    ...(book.hints.length ? ["", "Ideas, based on what you're carrying:", ...book.hints.map((h) => `  ? ${h}`)] : []),
  ];
  ctx.info("Recipe book:", lines);
}

/**
 * After picking something up: if it just made an unknown recipe possible, the
 * System AI drops a hint (once per recipe).
 */
export function nudge(ctx: StepContext): void {
  const c = ctx.crawler;
  const known = new Set(c.recipes ?? []);
  c.ideas ??= [];
  for (const r of ctx.content.recipes.all) {
    if (known.has(r.id) || c.ideas.includes(r.id) || !autoAssign(c, r)) continue;
    c.ideas.push(r.id);
    ctx.say("craft.idea", { hint: r.hint });
    return;
  }
}
