import { afterEach, describe, expect, it } from "vitest";
import { startApp } from "./helpers";
import type { App } from "./helpers";

// The harness turns on "reduce motion" (see helpers.ts), so these also show the fade ignores it:
// that setting is about the operator's screen, and this is what the congregation sees.

let app: App;
afterEach(async () => app?.close());

const dock = (a: App) => a.page.locator(".pres-dock");
const layers = ".pres-dock .pres-preview-frame .present-layer";

/** Waits until the dock's live caption reads `text`. */
async function showing(a: App, text: string) {
  await a.page.waitForFunction(
    ([sel, t]) => document.querySelector(sel)?.textContent === t,
    [".pres-dock .pres-preview-meta", text] as const,
  );
}

/** Presenting John 3:16–21 from a playlist, on its first verse. */
async function presentingJohn3() {
  app = await startApp();
  const { page } = app;
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await dock(app).waitFor();
  await page.getByLabel("New playlist name").fill("Sunday");
  await page.getByRole("button", { name: "Create" }).click();
  await page.click('[data-verse="16"]');
  await page.click('[data-verse="21"]', { modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Add to playlist" }).click();
  await page.keyboard.press("Escape");
  await showing(app, "John 3:16 · 1 of 6");
  await settledOn(app, "For God so loved the world");
}

/** Waits until the preview shows only one screen, fully faded in, beginning with `text`. (The
 *  caption changes at once; the screen itself may still be fading in from the one before.) */
async function settledOn(a: App, text: string) {
  await a.page.waitForFunction(
    ([sel, t]) => {
      const all = document.querySelectorAll(sel);
      return all.length === 1 && !all[0].classList.contains("present-layer--in") && (all[0].textContent ?? "").startsWith(t);
    },
    [layers, text] as const,
  );
}

/** The most layers the preview had at once while `act` ran and the screen settled afterwards. */
async function mostLayersDuring(a: App, act: () => Promise<void>): Promise<number> {
  await a.page.evaluate((sel) => {
    const w = window as unknown as { __most: number };
    const count = () => document.querySelectorAll(sel).length;
    w.__most = count();
    new MutationObserver(() => (w.__most = Math.max(w.__most, count()))).observe(document.querySelector(".pres-preview-frame")!, {
      childList: true,
      subtree: true,
    });
  }, layers);
  await act();
  await a.page.waitForTimeout(800);
  return a.page.evaluate(() => (window as unknown as { __most: number }).__most);
}

const next = (a: App) => dock(a).getByRole("button", { name: "Next ▶" });
const liveText = (a: App) => a.page.locator(`${layers}[data-current] .present-text`).textContent();

describe("the transition between slides", () => {
  it("fades the next slide in over the last, then keeps only the new one", async () => {
    await presentingJohn3();
    expect(await mostLayersDuring(app, () => next(app).click())).toBe(2);
    await showing(app, "John 3:17 · 2 of 6");
    expect(await app.page.locator(layers).count()).toBe(1);
    expect(await liveText(app)).toMatch(/^For God sent not his Son/);
  });

  it("cuts straight to the next slide when set to Cut, and remembers that", async () => {
    await presentingJohn3();
    const toggle = dock(app).getByRole("button", { name: "Between slides: Fade. Click to switch." });
    await toggle.click();
    await dock(app).getByRole("button", { name: "Between slides: Cut. Click to switch." }).waitFor();
    expect(await mostLayersDuring(app, () => next(app).click())).toBe(1);
    expect(await liveText(app)).toMatch(/^For God sent not his Son/);

    await app.page.reload();
    await app.page.waitForSelector(".chapter");
    await app.page.getByRole("button", { name: "Present", exact: true }).click();
    await dock(app).getByRole("button", { name: "Between slides: Cut. Click to switch." }).waitFor();
  });

  it("fades to black for Blank screen, and back", async () => {
    await presentingJohn3();
    const blank = dock(app).getByRole("button", { name: "Blank screen" });
    expect(await mostLayersDuring(app, () => blank.click())).toBe(2);
    expect(await app.page.locator(`${layers}[data-current]`).getAttribute("data-blank")).toBe("true");
    expect(await mostLayersDuring(app, () => dock(app).getByRole("button", { name: "Unblank" }).click())).toBe(2);
    expect(await liveText(app)).toMatch(/^For God so loved the world/);
  });

  it("ends on the latest slide when Next is pressed quickly, without queueing fades", async () => {
    await presentingJohn3();
    await next(app).click();
    await next(app).click();
    await next(app).click();
    await next(app).click();
    await showing(app, "John 3:20 · 5 of 6");
    await settledOn(app, "For every one that doeth evil");
  });

  it("doesn't fade when nothing on screen changes", async () => {
    await presentingJohn3();
    // Switching Dark/Light while blanked changes nothing the audience sees.
    await dock(app).getByRole("button", { name: "Blank screen" }).click();
    await app.page.waitForFunction((sel) => {
      const all = document.querySelectorAll(sel);
      return all.length === 1 && all[0].hasAttribute("data-blank") && !all[0].classList.contains("present-layer--in");
    }, layers);
    const theme = dock(app).getByRole("button", { name: /^Screen color:/ });
    expect(await mostLayersDuring(app, () => theme.click())).toBe(1);
  });
});
