import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ContentError, createEngine, loadDefaultContent, type Engine } from "@crawler/engine";
import { App } from "./App";
import "./styles/theme.css";

function ContentErrorScreen({ error }: { error: unknown }) {
  const lines = error instanceof ContentError ? error.problems : [String(error)];
  return (
    <main className="fatal">
      <h1>Content failed to load</h1>
      <p>Fix these and save; the page reloads on its own.</p>
      <ul>
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </main>
  );
}

let engine: Engine | null = null;
let failure: unknown = null;
try {
  engine = createEngine(loadDefaultContent());
} catch (err) {
  failure = err;
  console.error(err);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>{engine ? <App engine={engine} /> : <ContentErrorScreen error={failure} />}</StrictMode>,
);
