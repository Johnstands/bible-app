import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { announced, axeViolations, startApp } from "./helpers";
import type { App } from "./helpers";

let app: App;
afterEach(async () => app?.close());

const dialog = (a: App) => a.page.locator('.share[role="dialog"]');
const card = (a: App) => a.page.locator(".share canvas");

/** John 3 with verse 16 selected and the share dialog open, its card drawn. */
async function openForVerse16(opts: Parameters<typeof startApp>[0] = {}) {
  app = await startApp(opts);
  await app.page.click('[data-verse="16"]');
  await app.page.getByRole("button", { name: "Share" }).click();
  await dialog(app).waitFor();
  await drawn(app.page);
}

/** Waits until the card has been drawn (its font size is recorded on the canvas once it is). */
const drawn = (page: Page) => page.waitForFunction(() => document.querySelector(".share canvas")?.getAttribute("data-lines"));

/** The color of one pixel of the card. */
const pixel = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => {
    const c = document.querySelector<HTMLCanvasElement>(".share canvas")!;
    const [r, g, b] = c.getContext("2d")!.getImageData(px, py, 1, 1).data;
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }, [x, y] as const);

describe("share as an image", () => {
  it("opens from the toolbar with a card of the verse in the paper colors", async () => {
    await openForVerse16();
    expect(await dialog(app).getAttribute("aria-label")).toBe("Share John 3:16 as an image");
    expect(await card(app).getAttribute("width")).toBe("1080");
    expect(await card(app).getAttribute("height")).toBe("1080");
    expect(await pixel(app.page, 5, 5)).toBe("#faf6ec");
    expect(Number(await card(app).getAttribute("data-font-size"))).toBeGreaterThan(30);
    expect(Number(await card(app).getAttribute("data-lines"))).toBeGreaterThan(2);
  });

  it("really draws the verse: dark ink appears in the middle, and the frame at the edge", async () => {
    await openForVerse16();
    const ink = await app.page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>(".share canvas")!;
      const data = c.getContext("2d")!.getImageData(200, 300, 680, 400).data;
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] < 90) dark++;
      return dark;
    });
    expect(ink).toBeGreaterThan(3000);
  });

  it("changes shape", async () => {
    await openForVerse16();
    for (const [name, w, h] of [["Portrait", "1080", "1350"], ["Wide", "1200", "630"], ["Square", "1080", "1080"]] as const) {
      await app.page.getByRole("button", { name, exact: true }).click();
      await app.page.waitForFunction((n) => document.querySelector(".share canvas")?.getAttribute("data-size") === n.toLowerCase(), name);
      await drawn(app.page);
      expect([await card(app).getAttribute("width"), await card(app).getAttribute("height")]).toEqual([w, h]);
    }
  });

  it("changes color, and starts in the reader's own theme", async () => {
    await openForVerse16({ settings: { theme: "dark" } });
    expect(await card(app).getAttribute("data-theme")).toBe("dark");
    expect(await pixel(app.page, 5, 5)).toBe("#1c1917");
    await app.page.getByRole("button", { name: "Sepia" }).click();
    await app.page.waitForFunction(() => document.querySelector(".share canvas")?.getAttribute("data-theme") === "sepia");
    await drawn(app.page);
    expect(await pixel(app.page, 5, 5)).toBe("#f0e4cc");
  });

  it("makes short text bigger than long text, and fits several verses", async () => {
    await openForVerse16();
    const one = Number(await card(app).getAttribute("data-font-size"));
    await app.page.keyboard.press("Escape");
    await dialog(app).waitFor({ state: "detached" });
    await app.page.click('[data-verse="14"]');
    await app.page.click('[data-verse="17"]', { modifiers: ["Shift"] });
    await app.page.keyboard.press("i");
    await dialog(app).waitFor();
    await app.page.waitForFunction(() => Number(document.querySelector(".share canvas")?.getAttribute("data-font-size")) > 0);
    const four = Number(await card(app).getAttribute("data-font-size"));
    expect(four).toBeGreaterThan(0);
    expect(four).toBeLessThan(one);
    expect(await dialog(app).getAttribute("aria-label")).toBe("Share John 3:14–17 as an image");
  });

  it("says so when there is too much text for one card, and won't save it", async () => {
    app = await startApp();
    await app.page.click('[data-verse="1"]');
    await app.page.click('[data-verse="21"]', { modifiers: ["Shift"] });
    await app.page.keyboard.press("i");
    await dialog(app).waitFor();
    await app.page.waitForFunction(() => document.querySelector(".share canvas")?.getAttribute("data-lines") === "0");
    expect(await app.page.locator(".share-status").textContent()).toContain("too much text for one card");
    expect(await app.page.getByRole("button", { name: "Save image" }).isDisabled()).toBe(true);
    expect(await app.page.getByRole("button", { name: "Copy image" }).isDisabled()).toBe(true);
  });

  it("saves a real PNG and says where", async () => {
    await openForVerse16();
    await app.page.getByRole("button", { name: "Save image" }).click();
    await app.page.waitForFunction(() => document.querySelector(".share-status")?.textContent?.startsWith("Saved to"));
    const path = (await app.page.locator(".share-status").textContent())!.replace(/^Saved to /, "").replace(/\s*Show in folder$/, "").trim();
    expect(path).toContain("John 3-16.png");
    const bytes = fs.readFileSync(path);
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR: width and height, big-endian, at byte 16.
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1080, 1080]);
    expect(await app.page.getByRole("button", { name: "Show in folder" }).count()).toBe(1);
    fs.rmSync(path);
  });

  it("copies the image to the clipboard", async () => {
    await openForVerse16();
    await app.page.getByRole("button", { name: "Copy image" }).click();
    await app.page.waitForFunction(() => document.querySelector(".share-status")?.textContent?.startsWith("Image copied"));
    const type = await app.page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      return items[0]?.types[0];
    });
    expect(type).toBe("image/png");
  });

  it("opens with I, closes with Escape, and gives the page back", async () => {
    app = await startApp();
    await app.page.click('[data-verse="16"]');
    await app.page.keyboard.press("i");
    await dialog(app).waitFor();
    expect(await app.page.$eval(".app-shell", (e) => e.hasAttribute("inert"))).toBe(true);
    await app.page.keyboard.press("Escape");
    await dialog(app).waitFor({ state: "detached" });
    expect(await app.page.$eval(".app-shell", (e) => e.hasAttribute("inert"))).toBe(false);
  });

  it("does nothing with I when no verse is selected", async () => {
    app = await startApp();
    await app.page.keyboard.press("i");
    expect(await dialog(app).count()).toBe(0);
    expect(await announced(app.page)).not.toContain("card");
  });

  it("leaves the dialog free of accessibility problems", async () => {
    await openForVerse16();
    expect(await axeViolations(app.page)).toEqual([]);
  });
});
