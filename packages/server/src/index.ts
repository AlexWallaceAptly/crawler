/**
 * Tiny API server. Its only real job (from Milestone 10) is proxying boss-fight
 * calls to Claude so the API key never reaches the browser.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { ContentError, loadDefaultContent } from "@crawler/engine";

const envPath = resolve(import.meta.dirname, "../../../.env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

// Validate content on boot. Under `tsx watch` this re-runs whenever a content file changes,
// so a bad edit shows up here immediately with a readable error.
try {
  loadDefaultContent();
  console.log("✓ content OK");
} catch (err) {
  console.error(`\x1b[31m${err instanceof ContentError ? err.message : String(err)}\x1b[0m`);
  console.error("Fix the content file(s) above; the server will restart when you save.");
  process.exitCode = 1;
}

const app = new Hono();

app.get("/api/health", (c) =>
  c.json({ ok: true, claude: Boolean(process.env.ANTHROPIC_API_KEY), model: process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5" }),
);

// Boss battles arrive in Milestone 10. Until then the client uses the rule-based AI.
app.post("/api/boss", (c) => c.json({ error: "boss AI not implemented yet" }, 501));

const port = Number(process.env.PORT ?? 8787);
if (process.exitCode !== 1) {
  serve({ fetch: app.fetch, port }, (info) => console.log(`server listening on http://localhost:${info.port}`));
}
