# Crawler

A browser text adventure about being game-show content for an alien audience.
You roll a nobody, get dropped into the Welcome Lobby with something small and
nervous in your pocket, and try to find the stairs before the floor stops
existing. The System AI is not on your side. The thing in your pocket might be.

**Play it:** https://alexwallaceaptly.github.io/crawler/

## For playtesters

- Type commands or click the buttons. `help` lists everything.
- `n / e / s / w` to move, `map` for the floor, `search` / `rest` / `sleep`.
- Fights: `attack`, `advance` / `retreat`, `flee`, `talk` (some things listen), `use <item>`.
- The floor collapses in 5 in-game days. The stairwells are marked `>` on the map.
  Floors 1-3 are built: the Welcome Lobby, the Lost-and-Found Warrens, the Flooded Parking Garage.
- Echo, the voice in your pocket, sometimes asks to do things: `let echo` or `hush`.
  Which you choose (and resting, and `feed <junk>`) pushes it toward Calm or Fed.
- Some rooms hold shards of a story. They're random, and the Codex (`codex`, or the Codex
  button) remembers every one across runs. A shard can also teach Echo a module to build at a bench.
- Each floor has an optional boss in a lair marked `!`. Every boss has one weakness that always works.
- Your save lives in your browser (localStorage). Dying is intended. Frequently.
- Feedback wanted: how fights feel, pacing against the timer, anything confusing,
  whether Echo is endearing or annoying, and any line of text that made you exhale through your nose.

## Development

```
npm install
npm run dev      # Vite client on :5173 + Hono server on :8787
npm run check    # content validation, typecheck, tests
npm run sim      # headless auto-play balance tool (`-- 400 --floors 3 --craft`)
npm run import:workbook  # re-import the story workbook's CSV exports (content-csv/workbook/)
npm run import:tileset -- sprites/tilesets/lobby.tres --id lobby  # import a Godot 4 TileSet
npm run deploy   # build and push to GitHub Pages
```

The design doc is `docs/DESIGN.md`; implementation assumptions are logged in
its Decision log at the end. Game content is JSON in `packages/content`, validated by Zod
schemas in the engine.
