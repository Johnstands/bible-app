// Runs the built UI in headless Chromium against the mock backend. Not the real app: for looking at
// the UI and exercising flows without a Tauri window. Needs a Vite server (see `npm run ui:dev`).
import { chromium } from "playwright-core";
import { serve } from "./mock-backend.mjs";

const CHROMIUM = process.env.CHROMIUM ?? "/usr/bin/chromium";
export const APP_URL = process.env.APP_URL ?? "http://localhost:1430";

// Stands in for Tauri's invoke bridge and forwards commands to the mock backend. There is only ever
// one page here, standing in for the main window; presentation mode's event plumbing (see App.tsx,
// PresentationWindow.tsx) is stubbed inert rather than wired up, since a dedicated presentation window can't
// exist in a single headless page anyway — the mock backend's present_open always answers "inline"
// for exactly that reason (see mock-backend.mjs), so nothing here ever needs to actually deliver.
const bridge = `
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: () => 0,
    // Custom URI schemes (the app's slides://) are served by the mock backend instead.
    convertFileSrc: (path, protocol) => "http://127.0.0.1:9100/" + protocol + "/" + encodeURIComponent(path),
    // Raw bytes (Tauri's non-JSON invoke body and ipc::Response) travel as base64 in both directions.
    invoke: async (cmd, args, options) => {
      const toBase64 = (bytes) => {
        let s = "";
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
      };
      const raw = args instanceof ArrayBuffer || ArrayBuffer.isView(args);
      const body = raw
        ? { cmd, raw: toBase64(new Uint8Array(args.buffer ?? args, args.byteOffset ?? 0, args.byteLength)), headers: options?.headers ?? {} }
        : { cmd, args };
      const res = await fetch("http://127.0.0.1:9100/invoke", { method: "POST", body: JSON.stringify(body) });
      const out = await res.json();
      if (out.err) throw out.err;
      if (out.ok && typeof out.ok.__bytes === "string") return Uint8Array.from(atob(out.ok.__bytes), (c) => c.charCodeAt(0)).buffer;
      return out.ok;
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
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
