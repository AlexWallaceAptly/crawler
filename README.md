# Crawler

A browser text adventure about being game-show content for an alien audience.
You roll a nobody, get dropped into the Undercroft, and try to find the stairs
before the floor stops existing. The System AI is not on your side.

**Play it:** https://alexwallaceaptly.github.io/crawler/

## For playtesters

- Type commands or click the buttons. `help` lists everything.
- `n / e / s / w` to move, `map` for the floor, `search` / `rest` / `sleep`.
- Fights: `attack`, `advance` / `retreat`, `flee`, `talk` (some things listen), `use <item>`.
- The floor collapses in 5 in-game days. The stairwells are marked `>` on the map.
- Your save lives in your browser (localStorage). Dying is intended. Frequently.
- Feedback wanted: how fights feel, pacing against the timer, anything confusing,
  and any line of text that made you exhale through your nose.

## Development

```
npm install
npm run dev      # Vite client on :5173 + Hono server on :8787
npm run check    # content validation, typecheck, tests
npm run sim      # headless auto-play balance tool
npm run deploy   # build and push to GitHub Pages
```

The design doc is `docs/SPEC.md`; implementation assumptions are logged in
`DECISIONS.md`. Game content is JSON in `packages/content`, validated by Zod
schemas in the engine.
