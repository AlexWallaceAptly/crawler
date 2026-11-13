/**
 * Save = game + account in localStorage after every action.
 * Every access is wrapped: storage can be blocked or full, and the game must still run.
 */
import type { AccountState, Engine, World } from "@crawler/engine";

const GAME_KEY = "crawler.game";
const ACCOUNT_KEY = "crawler.account";

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveWorld(world: World): void {
  try {
    localStorage.setItem(GAME_KEY, JSON.stringify(world.game));
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(world.account));
  } catch {
    // Storage unavailable: the run continues unsaved.
  }
}

export function loadWorld(engine: Engine): World {
  const restored = engine.restore(read(GAME_KEY), read(ACCOUNT_KEY));
  if (restored) return restored;
  // No save, or an incompatible one: keep the account if it survived, start a fresh crawler.
  const account: AccountState | undefined = engine.restoreAccount(read(ACCOUNT_KEY)) ?? undefined;
  const fresh = engine.newWorld(account).world;
  saveWorld(fresh);
  return fresh;
}

export function wipeSave(): void {
  try {
    localStorage.removeItem(GAME_KEY);
    localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    // ignore
  }
}

/** Per-viewer UI conveniences (collapsed panels, active tab). */
export function readPref<T>(key: string, fallback: T): T {
  const v = read(`crawler.ui.${key}`);
  return v === null ? fallback : (v as T);
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`crawler.ui.${key}`, JSON.stringify(value));
  } catch {
    // ignore
  }
}
