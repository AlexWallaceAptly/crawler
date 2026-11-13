# Crawler

A browser text adventure (TypeScript monorepo). The source of truth is `docs/SPEC.md`. Build in that file's milestone order, and log every assumption in `DECISIONS.md` instead of asking.

## Commands

- `npm run dev`: validates content, then starts Vite on :5173 and the Hono server on :8787 (Vite proxies `/api`).
- `npm run check`: validates content, typechecks and runs the tests. Run it before calling a milestone done.
- `npm test`: runs Vitest (tests are in `packages/*/test`).
- `npm run validate`: checks only the JSON content.

## Layout

- `packages/engine`: pure game logic with no DOM, React or `fetch`. All randomness goes through `src/rng.ts`. The reducer is `step()` in `src/step.ts`, and the UI projection is `src/view.ts`.
- `packages/content`: the JSON tables. `index.ts` imports each file, and the engine's `CONTENT_FILES` maps each file to its Zod schema.
- `packages/client`: Vite + React terminal UI. Panels render from `engine.view()` and routed events, never from raw state.
- `packages/server`: Hono. It will proxy `/api/boss` to Claude in Milestone 10.

## Rules

- Content is data. A new entry is a JSON edit. A new content file needs both `content/index.ts` and `CONTENT_FILES` updated.
- All game text is original. Never use names, characters or lines from the books. Tone: crude, bored, cruel, funny.
- The engine state must stay JSON-serializable, because it's cloned and saved to `localStorage` every step.
