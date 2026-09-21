// Runs the built UI in headless Chromium against the mock backend. Not the real app: for looking at
// the UI and exercising flows without a Tauri window. Needs a Vite server (see `npm run ui:dev`).
import { chromium } from "playwright-core";
import { serve } from "./mock-backend.mjs";

const CHROMIUM = process.env.CHROMIUM ?? "/usr/bin/chromium";
export const APP_URL = process.env.APP_URL ?? "http://localhost:1430";

// Stands in for Tauri's invoke bridge and forwards commands to the mock backend.
const bridge = `
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      const res = await fetch("http://127.0.0.1:9100/invoke", { method: "POST", body: JSON.stringify({ cmd, args }) });
      const out = await res.json();
      if (out.err) throw out.err;
      return out.ok;
    },
  };
`;

// `motion: "reduce"` turns the app's animations off, so screenshots never catch a fade half-done.
export async function launch({ width = 1000, height = 820, scheme = "light", motion = "no-preference", update = null } = {}) {
  const server = serve(9100, { update });
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, reducedMotion: motion, deviceScaleFactor: 1.5 });
  // Copying a picture to the clipboard needs permission in a browser; the desktop app doesn't ask.
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(APP_URL).origin });
  await context.addInitScript(bridge);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return {
    page, errors,
    /**
     * Loads the app with `settings` and `position` already saved, as if it had been used before. They are written
     * once and the page is reloaded, so a later reload keeps whatever the app itself saved. The verse of the day is
     * off unless a scene asks for it, because its card would cover the page on a fresh profile.
     */
    open: async ({ settings, position } = {}) => {
      await page.goto(APP_URL);
      await page.evaluate(([s, p]) => {
        localStorage.clear();
        localStorage.setItem("settings", JSON.stringify(s));
        if (p) localStorage.setItem("position", JSON.stringify(p));
      }, [{ verseOfTheDay: false, ...settings }, position]);
      await page.reload();
      await page.waitForSelector(".chapter");
    },
    close: async () => { await browser.close(); server.close(); },
  };
}
