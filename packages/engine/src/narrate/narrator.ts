/**
 * Template engine for System AI lines.
 *  {path}          inserts a value from the context
 *  {pick:a|b|c}    picks one option at random (options may contain {path} and nested picks)
 * Variants with a matching `when` are preferred over unconditional ones.
 * The narrator remembers the last MEMORY lines and avoids repeating them.
 */
import type { Content } from "../content/load";
import type { NarrationTemplate } from "../content/schemas";
import { getPath, matchWhere } from "../rules/conditions";
import { pick } from "../rng";

export const NARRATOR_MEMORY = 20;

export interface NarratorMemory {
  recent: string[];
}

export class MissingTemplateError extends Error {}

/** Find the matching close brace for the "{" at index `open`. */
function findClose(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split on "|" at brace depth 0. */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === "|" && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

function formatValue(v: unknown): string {
  if (v === undefined || v === null) return "???";
  if (Array.isArray(v)) return v.map(formatValue).join(", ");
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (typeof v === "object") return "???";
  return String(v);
}

export function render(text: string, ctx: unknown): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch !== "{") {
      out += ch;
      i++;
      continue;
    }
    const close = findClose(text, i);
    if (close === -1) {
      out += text.slice(i);
      break;
    }
    const inner = text.slice(i + 1, close);
    if (inner.startsWith("pick:")) {
      out += render(pick(splitTop(inner.slice(5))), ctx);
    } else {
      out += formatValue(getPath(ctx, inner.trim()));
    }
    i = close + 1;
  }
  return out;
}

/** List the {paths} a template uses (for content tests). */
export function templatePaths(text: string): string[] {
  const paths: string[] = [];
  const walk = (t: string) => {
    let i = 0;
    while (i < t.length) {
      if (t[i] !== "{") {
        i++;
        continue;
      }
      const close = findClose(t, i);
      if (close === -1) return;
      const inner = t.slice(i + 1, close);
      if (inner.startsWith("pick:")) splitTop(inner.slice(5)).forEach(walk);
      else paths.push(inner.trim());
      i = close + 1;
    }
  };
  walk(text);
  return paths;
}

export function chooseVariant(
  tpl: NarrationTemplate,
  ctx: unknown,
  memory: NarratorMemory,
): { index: number; text: string } {
  const indexed = tpl.variants.map((v, index) => ({ v, index }));
  const conditional = indexed.filter((x) => x.v.when && matchWhere(x.v.when, ctx));
  let pool = conditional.length > 0 ? conditional : indexed.filter((x) => !x.v.when);
  if (pool.length === 0) pool = indexed; // only conditional variants, none matched: use anything
  const fresh = pool.filter((x) => !memory.recent.includes(`${tpl.key}#${x.index}`));
  const chosen = pick(fresh.length > 0 ? fresh : pool);
  return { index: chosen.index, text: chosen.v.text };
}

export function narrate(content: Content, memory: NarratorMemory, key: string, ctx: unknown): string {
  const tpl = content.narration[key];
  if (!tpl) {
    // Missing keys fail the content test, not the game.
    return `[System AI is speechless: no template "${key}"]`;
  }
  const { index, text } = chooseVariant(tpl, ctx, memory);
  memory.recent.push(`${key}#${index}`);
  if (memory.recent.length > NARRATOR_MEMORY) memory.recent.splice(0, memory.recent.length - NARRATOR_MEMORY);
  return render(text, ctx);
}
