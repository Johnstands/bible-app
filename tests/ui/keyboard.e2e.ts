import { afterEach, describe, expect, it } from "vitest";
import { announced, startApp } from "./helpers";
import type { App } from "./helpers";

let app: App;
afterEach(async () => app?.close());

const selected = (a: App) => a.page.$$eval(".verse.is-selected", (els) => els.map((e) => (e as HTMLElement).dataset.verse));
const cursor = (a: App) => a.page.$eval(".verse.is-cursor", (e) => (e as HTMLElement).dataset.verse).catch(() => null);

describe("verses from the keyboard", () => {
  it("moves a visible cursor with j and k and reads each verse out", async () => {
    app = await startApp();
    await app.page.keyboard.press("j");
    const first = await cursor(app);
    expect(first).not.toBeNull();
    await app.page.keyboard.press("j");
    expect(await cursor(app)).toBe(String(Number(first) + 1));
    expect(await announced(app.page)).toMatch(new RegExp(`^Verse ${Number(first) + 1}\\. \\S`));
    await app.page.keyboard.press("k");
    expect(await cursor(app)).toBe(first);
  });

  it("selects with Space, toggles, and extends with Shift+J", async () => {
    app = await startApp({ position: { book: 43, chapter: 3, scroll: 0 } });
    await app.page.keyboard.press("j");
    await app.page.keyboard.press("Space");
    const start = Number(await cursor(app));
    expect(await selected(app)).toEqual([String(start)]);
    expect(await announced(app.page)).toContain("1 verse selected");

    await app.page.keyboard.press("Shift+J");
    await app.page.keyboard.press("Shift+J");
    expect(await selected(app)).toEqual([start, start + 1, start + 2].map(String));
    await app.page.keyboard.press("Space"); // unselect the verse under the cursor
    expect(await selected(app)).toEqual([start, start + 1].map(String));
  });

  it("does not scroll the page with Space until there is a verse cursor", async () => {
    app = await startApp();
    const before = await app.page.evaluate(() => window.scrollY);
    await app.page.keyboard.press("Space");
    await app.page.waitForTimeout(150);
    expect(await app.page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(before);
    expect(await selected(app)).toEqual([]);
  });

  it("highlights, bookmarks and opens a note with single keys", async () => {
    app = await startApp();
    await app.page.keyboard.press("j");
    await app.page.keyboard.press("Space");
    await app.page.keyboard.press("2");
    await app.page.waitForSelector('.verse[data-hl="green"]');
    await app.page.keyboard.press("b");
    await app.page.waitForSelector(".mk-bookmark");
    await app.page.keyboard.press("n");
    await app.page.waitForSelector(".note-body");
    expect(await app.page.evaluate(() => document.activeElement?.className)).toContain("note-body");
    await app.page.keyboard.type("A note typed without touching the mouse.");
    await app.page.keyboard.press("Control+Enter");
    await app.page.waitForSelector(".mk-note");
    // 1..5 are ignored while typing, so the digits in a note are safe
    expect(await app.page.$$eval("[data-hl]", (e) => e.length)).toBe(1);
  });

  it("clears the cursor and selection with Escape", async () => {
    app = await startApp();
    await app.page.keyboard.press("j");
    await app.page.keyboard.press("Space");
    await app.page.keyboard.press("Escape");
    expect(await selected(app)).toEqual([]);
    expect(await cursor(app)).toBeNull();
  });

  it("stays put at the end of the chapter and says so", async () => {
    app = await startApp();
    const count = await app.page.$$eval("[data-verse]", (e) => e.length);
    for (let i = 0; i < count + 2; i++) await app.page.keyboard.press("j");
    expect(await announced(app.page)).toBe("End of the chapter.");
    expect(await cursor(app)).toBe(String(count));
  });
});

describe("word meanings from the keyboard", () => {
  it("steps through the underlined words with w and W, reading each card out", async () => {
    app = await startApp();
    await app.page.keyboard.press("w");
    await app.page.waitForSelector(".wordhelp");
    const first = await app.page.textContent(".wh-word");
    expect(await announced(app.page)).toContain(first!.trim());
    await app.page.keyboard.press("w");
    const second = await app.page.textContent(".wh-word");
    expect(second).not.toBe(first);
    await app.page.keyboard.press("Shift+W");
    expect(await app.page.textContent(".wh-word")).toBe(first);
    expect(await app.page.$(".verse.is-selected")).toBeNull(); // opening a word never selects the verse
  });

  it("ties the open card to its word for assistive technology and drops it on Escape", async () => {
    app = await startApp();
    await app.page.keyboard.press("w");
    const id = await app.page.$eval(".wordhelp", (e) => e.id);
    expect(await app.page.$eval(".kjv-word[aria-describedby]", (e) => e.getAttribute("aria-describedby"))).toBe(id);
    await app.page.keyboard.press("Escape");
    expect(await app.page.$(".wordhelp")).toBeNull();
    expect(await app.page.$(".kjv-word[aria-describedby]")).toBeNull();
  });
});
