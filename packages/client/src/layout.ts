/**
 * Which shell to draw: phone (one view at a time), tablet (touch, two columns)
 * or desktop (the panel dashboard with a typed command bar).
 */
import { useEffect, useState } from "react";
import { readPref, writePref } from "./storage";

export type Layout = "phone" | "tablet" | "desktop";
export type LayoutChoice = "auto" | Layout;

const CHOICES: LayoutChoice[] = ["auto", "tablet", "desktop", "phone"];
const PHONE = "(max-width: 699px)";
/** Any touch screen, so an iPad with a keyboard and trackpad attached still counts. */
const TOUCH = "(any-pointer: coarse)";

function detect(): Layout {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia(PHONE).matches) return "phone";
  return window.matchMedia(TOUCH).matches ? "tablet" : "desktop";
}

export interface LayoutControl {
  layout: Layout;
  choice: LayoutChoice;
  /** Step to the next choice: auto, tablet, desktop, phone. */
  cycle: () => void;
  label: string;
}

export function useLayout(): LayoutControl {
  const [choice, setChoice] = useState<LayoutChoice>(() => {
    const saved = readPref<LayoutChoice>("layout", "auto");
    return CHOICES.includes(saved) ? saved : "auto";
  });
  const [auto, setAuto] = useState<Layout>(detect);
  useEffect(() => {
    const queries = [window.matchMedia(PHONE), window.matchMedia(TOUCH)];
    const on = () => setAuto(detect());
    for (const q of queries) q.addEventListener("change", on);
    return () => { for (const q of queries) q.removeEventListener("change", on); };
  }, []);
  const cycle = () => setChoice((c) => {
    const next = CHOICES[(CHOICES.indexOf(c) + 1) % CHOICES.length]!;
    writePref("layout", next);
    return next;
  });
  const layout = choice === "auto" ? auto : choice;
  return { layout, choice, cycle, label: `Layout: ${choice === "auto" ? `auto (${auto})` : choice}` };
}
