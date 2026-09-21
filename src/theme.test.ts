/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.resolve(import.meta.dirname, "theme.css"), "utf8");

/** The color tokens of one theme: the rule whose selector names it and that defines the page background. */
function tokens(theme: string): Record<string, string> {
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!selector.includes(`[data-theme="${theme}"]`) || !body.includes("--bg:")) continue;
    return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  }
  throw new Error(`no color rule for the ${theme} theme in theme.css`);
}

const channel = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio between two colors. */
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("theme colors meet WCAG AA (4.5:1) for text", () => {
  it("computes contrast the way WCAG does", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });

  for (const theme of ["paper", "sepia", "dark"]) {
    describe(theme, () => {
      const t = tokens(theme);
      it.each(["ink", "ink-muted", "accent"])("%s on the page background", (name) => {
        expect(t[name], `--${name} is defined`).toBeDefined();
        // A little headroom over 4.5 so a rounding difference in another renderer can't tip it under.
        expect(contrast(t[name], t.bg)).toBeGreaterThanOrEqual(4.6);
      });
      it("text stays readable on the highlight of selected text", () => {
        expect(contrast(t.ink, t.selection)).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
});
