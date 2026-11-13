import { rawContent } from "@crawler/content";
import { loadContent, type Content, type RawContent } from "./load";

let cached: Content | null = null;

/** Validate and return the shipped content. Throws ContentError with a readable list of problems. */
export function loadDefaultContent(): Content {
  if (!cached) cached = loadContent(rawContent as RawContent);
  return cached;
}
