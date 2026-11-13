import type { Where } from "../content/schemas";

/** Read "a.b.c" from an object. Arrays support numeric segments and ".length". */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

type Cmp = Where[string];

export function matchComparison(value: unknown, cmp: Cmp): boolean {
  if (typeof cmp !== "object" || cmp === null) return value === cmp;
  if (cmp.eq !== undefined && value !== cmp.eq) return false;
  if (cmp.ne !== undefined && value === cmp.ne) return false;
  if (cmp.in !== undefined && !cmp.in.includes(value as never)) return false;
  if (cmp.has !== undefined && !(Array.isArray(value) && value.includes(cmp.has))) return false;
  const numeric = cmp.gte !== undefined || cmp.lte !== undefined || cmp.gt !== undefined || cmp.lt !== undefined;
  if (numeric) {
    if (typeof value !== "number") return false;
    if (cmp.gte !== undefined && !(value >= cmp.gte)) return false;
    if (cmp.lte !== undefined && !(value <= cmp.lte)) return false;
    if (cmp.gt !== undefined && !(value > cmp.gt)) return false;
    if (cmp.lt !== undefined && !(value < cmp.lt)) return false;
  }
  return true;
}

/** Every path in `where` must match. */
export function matchWhere(where: Where | undefined, ctx: unknown): boolean {
  if (!where) return true;
  for (const [path, cmp] of Object.entries(where)) {
    if (!matchComparison(getPath(ctx, path), cmp)) return false;
  }
  return true;
}
