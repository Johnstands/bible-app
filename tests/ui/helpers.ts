import { createRequire } from "node:module";
import type { Page } from "playwright-core";
// @ts-expect-error the harness is plain JavaScript
import { launch } from "../../scripts/ui/harness.mjs";

export interface App {
  page: Page;
  errors: string[];
  open: (opts?: { settings?: Record<string, unknown>; position?: { book: number; chapter: number; scroll: number } }) => Promise<void>;
  close: () => Promise<void>;
}

/** A browser with the app loaded (animations off so nothing is caught half-way). John 3 unless told otherwise. */
export async function startApp(
  opts: Parameters<App["open"]>[0] = {},
  size: { width?: number; height?: number; update?: { version: string; notes?: string } } = {},
): Promise<App> {
  const app: App = await launch({ motion: "reduce", ...size });
  await app.open({ position: { book: 43, chapter: 3, scroll: 0 }, ...opts });
  return app;
}

/** The text a screen reader would be told most recently. */
export const announced = (page: Page) => page.locator(".sr-only[role=status]").textContent();

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

export interface Violation {
  id: string;
  impact: string | null;
  help: string;
  where: string[];
}

/** Runs axe-core on the page (or on one part of it) and returns what it found. */
export async function axeViolations(page: Page, selector?: string): Promise<Violation[]> {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async (sel) => {
    // @ts-expect-error axe is injected above
    const result = await window.axe.run(sel ? document.querySelector(sel) : document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] },
    });
    return result.violations.map((v: { id: string; impact: string | null; help: string; nodes: { target: string[] }[] }) => ({
      id: v.id, impact: v.impact, help: v.help, where: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
    }));
  }, selector);
}
