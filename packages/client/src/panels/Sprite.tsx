import { useState, type ReactNode } from "react";

/**
 * A PNG from public/ with a fallback chain: try each name in order, then show the
 * glyph. Art can land one file at a time; a missing file costs one 404 per
 * session, because failed URLs are remembered across every cell that uses them.
 */
const failed = new Set<string>();

export const spriteUrl = (path: string) => `${import.meta.env.BASE_URL}${path}.png`;

interface SpriteProps {
  /** Paths under public/ without the extension, best first ("combat/unit/sump_rat"). */
  paths: string[];
  /** Shown when no image loads. Empty string = draw nothing. */
  glyph: string;
  className?: string;
  glyphClassName?: string;
  title?: string;
  /** Rendered instead of the glyph when no image loads (e.g. a CSS stand-in). */
  fallback?: ReactNode;
}

export function Sprite({ paths, glyph, className, glyphClassName, title, fallback }: SpriteProps) {
  const [, bump] = useState(0);
  const path = paths.find((p) => !failed.has(spriteUrl(p)));
  if (!path) {
    if (fallback !== undefined) return <>{fallback}</>;
    return glyph ? <span className={glyphClassName} title={title}>{glyph}</span> : null;
  }
  const url = spriteUrl(path);
  return (
    <img
      key={url}
      className={className}
      src={url}
      alt=""
      title={title}
      draggable={false}
      onError={() => {
        failed.add(url);
        bump((n) => n + 1);
      }}
    />
  );
}
