import { afterEach, describe, expect, it } from "vitest";
import { startApp } from "./helpers";
import type { App } from "./helpers";

let app: App;
afterEach(async () => {
  const errors = app?.errors.filter((e) => !e.includes("404")) ?? [];
  await app?.close();
  expect(errors, "the page reported errors").toEqual([]);
});

const location = (a: App) => a.page.textContent(".location");

describe("reading and navigating", () => {
  it("opens where it was left and moves between chapters, across books", async () => {
    app = await startApp({ position: { book: 43, chapter: 21, scroll: 0 } });
    expect(await location(app)).toBe("John 21");
    await app.page.keyboard.press("ArrowRight"); // last chapter of John -> Acts 1
    await app.page.waitForFunction(() => document.querySelector(".location")?.textContent === "Acts 1");
    await app.page.keyboard.press("ArrowLeft");
    await app.page.waitForFunction(() => document.querySelector(".location")?.textContent === "John 21");
  });

  it("remembers the chapter across a reload", async () => {
    app = await startApp();
    await app.page.keyboard.press("ArrowRight");
    await app.page.waitForFunction(() => document.querySelector(".location")?.textContent === "John 4");
    await app.page.reload();
    await app.page.waitForSelector(".chapter");
    expect(await location(app)).toBe("John 4");
  });

  it("jumps to a reference typed in Go to and highlights the verse", async () => {
    app = await startApp();
    await app.page.keyboard.press("/");
    await app.page.fill(".goto-input", "ps 23:4");
    await app.page.keyboard.press("Enter");
    await app.page.waitForSelector('.verse.is-target[data-verse="4"]');
    expect(await location(app)).toBe("Psalm 23");
  });

  it("browses books and chapters when Go to is empty", async () => {
    app = await startApp();
    await app.page.keyboard.press("Control+k");
    await app.page.click('.goto-row:has-text("Romans")');
    await app.page.click('.goto-chapter:text-is("8")');
    await app.page.waitForFunction(() => document.querySelector(".location")?.textContent === "Romans 8");
  });

  it("shows poetry, titles and stanzas in a Psalm, and subscriptions after an epistle", async () => {
    app = await startApp({ position: { book: 19, chapter: 3, scroll: 0 } });
    expect(await app.page.textContent(".superscription")).toContain("A Psalm of David");
    expect(await app.page.$$eval(".line", (e) => e.length)).toBeGreaterThan(5);
    expect(await app.page.$$eval(".line.stanza", (e) => e.length)).toBeGreaterThan(0);
    await app.close();
    app = await startApp({ position: { book: 45, chapter: 16, scroll: 0 } });
    expect(await app.page.textContent(".subscription")).toContain("Written to the Romans");
  });
});

describe("marking verses with the mouse", () => {
  it("selects a range, highlights it, bookmarks it and saves a note, and all of it survives a reload", async () => {
    app = await startApp();
    await app.page.click('[data-verse="16"]');
    await app.page.click('[data-verse="18"]', { modifiers: ["Shift"] });
    expect(await app.page.textContent(".selbar-label")).toBe("John 3:16–18");
    await app.page.click('.dot[data-color="yellow"]');
    await app.page.waitForFunction(() => document.querySelectorAll('.verse[data-hl="yellow"]').length === 3);

    await app.page.click("text=Bookmark");
    await app.page.waitForSelector('[data-verse="16"] .mk-bookmark');
    await app.page.click(".selbar-action >> text=Note");
    await app.page.fill(".note-body", "The measure of the gift is the love that gave it.");
    await app.page.click(".note-save");
    await app.page.waitForSelector('[data-verse="16"] .mk-note');

    await app.page.reload();
    await app.page.waitForSelector(".chapter");
    expect(await app.page.$$eval('.verse[data-hl="yellow"]', (e) => e.length)).toBe(3);
    expect(await app.page.$('[data-verse="16"] .mk-bookmark')).not.toBeNull();
    await app.page.click('[data-verse="16"] .mk-note'); // the marker reopens the note
    expect(await app.page.inputValue(".note-body")).toContain("measure of the gift");
  });

  it("takes a highlight off by choosing the same color again, and deletes a note", async () => {
    app = await startApp();
    await app.page.click('[data-verse="20"]');
    await app.page.click('.dot[data-color="blue"]');
    await app.page.waitForSelector('.verse[data-hl="blue"]');
    await app.page.click('.dot[data-color="blue"]');
    await app.page.waitForFunction(() => document.querySelectorAll("[data-hl]").length === 0);

    await app.page.click(".selbar-action >> text=Note");
    await app.page.fill(".note-body", "temporary");
    await app.page.click(".note-save");
    await app.page.waitForSelector(".mk-note");
    await app.page.click(".mk-note");
    await app.page.click("text=Delete note");
    await app.page.waitForFunction(() => document.querySelectorAll(".mk-note").length === 0);
  });

  it("lists everything in the Library and opens a mark at its verse", async () => {
    app = await startApp();
    await app.page.click('[data-verse="16"]');
    await app.page.click('.dot[data-color="green"]');
    await app.page.click("text=Bookmark");
    await app.page.waitForSelector(".mk-bookmark");
    await app.page.keyboard.press("Escape");
    await app.page.keyboard.press("ArrowRight"); // leave the chapter
    await app.page.waitForFunction(() => document.querySelector(".location")?.textContent === "John 4");
    await app.page.keyboard.press("Control+l");
    await app.page.waitForSelector(".lib-row");
    expect(await app.page.textContent(".lib-row")).toContain("John 3:16");
    await app.page.click(".lib-go");
    await app.page.waitForSelector('.verse.is-target[data-verse="16"]');
    expect(await location(app)).toBe("John 3");
  });

  it("copies the selection with its reference", async () => {
    app = await startApp();
    await app.page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await app.page.click('[data-verse="16"]');
    await app.page.click(".selbar-action >> text=Copy");
    await app.page.waitForSelector("text=Copied");
    const text = await app.page.evaluate(() => navigator.clipboard.readText());
    expect(text).toMatch(/^“For God so loved the world/);
    expect(text).toMatch(/— John 3:16 \(KJV\)$/);
  });
});

describe("search", () => {
  it("finds verses, narrows to a testament, and jumps to a result", async () => {
    app = await startApp();
    await app.page.keyboard.press("Control+f");
    await app.page.fill(".goto-input", "shepherd");
    await app.page.waitForSelector(".hit");
    const all = Number((await app.page.textContent(".goto-footer span"))!.replace(/,/g, "").match(/\d+/)![0]);
    expect(all).toBeGreaterThan(50);
    expect(await app.page.$$eval(".hit mark", (m) => m.length)).toBeGreaterThan(0);

    await app.page.click('.search-filters button:has-text("New Testament")');
    await app.page.waitForFunction((n) => Number(document.querySelector(".goto-footer span")?.textContent?.replace(/,/g, "").match(/\d+/)?.[0]) < n, all);

    await app.page.keyboard.press("Enter");
    await app.page.waitForSelector(".verse.is-target");
    expect(await app.page.$(".search")).toBeNull();
  });

  it("remembers the last query and offers a search from Go to", async () => {
    app = await startApp();
    await app.page.keyboard.press("Control+f");
    await app.page.fill(".goto-input", "charity");
    await app.page.waitForSelector(".hit");
    await app.page.keyboard.press("Escape");
    await app.page.keyboard.press("Control+f");
    expect(await app.page.inputValue(".goto-input")).toBe("charity");
    await app.page.keyboard.press("Escape");

    await app.page.keyboard.press("/");
    await app.page.fill(".goto-input", "the lord is my shepherd");
    await app.page.click('.goto-row:has-text("Search for")');
    await app.page.waitForSelector(".search .hit");
    expect(await app.page.inputValue(".goto-input")).toBe("the lord is my shepherd");
  });
});

describe("settings", () => {
  it("applies and remembers theme, font, size and the text features", async () => {
    app = await startApp();
    await app.page.keyboard.press("Control+,");
    await app.page.click('.set-themes button:has-text("Dark")');
    await app.page.click('.set-fonts button:has-text("Literata")');
    await app.page.click('button[aria-label="Larger text"]');
    await app.page.click('[role="switch"]:has-text("Verse by verse")');
    await app.page.click('[role="switch"]:has-text("Pilcrows")');
    await app.page.keyboard.press("Escape");

    const state = () =>
      app.page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        font: getComputedStyle(document.documentElement).getPropertyValue("--font-scripture"),
        scale: getComputedStyle(document.documentElement).getPropertyValue("--reading-scale"),
        lines: document.querySelectorAll(".line").length,
        pilcrows: document.querySelectorAll(".pilcrow").length,
      }));
    const before = await state();
    expect(before).toMatchObject({ theme: "dark", scale: "1.05" });
    expect(before.font).toContain("Literata");
    expect(before.lines).toBeGreaterThan(20); // one line per verse in John 3
    expect(before.pilcrows).toBeGreaterThan(0);

    await app.page.reload();
    await app.page.waitForSelector(".chapter");
    expect(await state()).toEqual(before);
  });

  it("resets to the defaults", async () => {
    app = await startApp({ settings: { theme: "sepia", fontScale: 1.4, pilcrows: true } });
    await app.page.keyboard.press("Control+,");
    await app.page.click("text=Reset to defaults");
    expect(await app.page.evaluate(() => document.documentElement.dataset.theme)).toBe("paper");
    expect(await app.page.$$eval(".pilcrow", (e) => e.length)).toBe(0);
  });
});

describe("word help", () => {
  const kinds = (a: App) => a.page.$$eval(".kjv-word", (els) => [...new Set(els.map((e) => (e as HTMLElement).dataset.kind))].sort().join("+") || "none");

  it("shows what a word meant and what it means now, and never selects the verse", async () => {
    app = await startApp({ position: { book: 42, chapter: 2, scroll: 0 } });
    await app.page.click('.kjv-word:has-text("taxed")');
    const card = await app.page.textContent(".wordhelp");
    expect(card).toContain("Changed meaning");
    expect(card).toContain("a census; registering");
    expect(card).toContain("charging a tax");
    expect(await app.page.$(".verse.is-selected")).toBeNull();
    await app.page.mouse.click(30, 400); // anywhere else puts it away
    expect(await app.page.$(".wordhelp")).toBeNull();
  });

  it("offers Off, Changed meanings and All words", async () => {
    app = await startApp({ position: { book: 40, chapter: 6, scroll: 0 } });
    expect(await kinds(app)).toBe("archaic+changed+unit");
    await app.page.keyboard.press("Control+,");
    await app.page.click('.set-levels button:has-text("Changed meanings")');
    expect(await kinds(app)).toBe("changed");
    await app.page.click('.set-levels button:has-text("Off")');
    expect(await kinds(app)).toBe("none");
  });

  it("keeps the two senses of a word apart", async () => {
    app = await startApp({ position: { book: 40, chapter: 12, scroll: 0 } });
    const inVerse = (v: number) => app.page.$$eval(`[data-verse="${v}"] .kjv-word`, (e) => e.map((x) => x.textContent!.toLowerCase()));
    expect(await inVerse(46)).toContain("without"); // "his brethren stood without" = outside
    await app.close();
    app = await startApp({ position: { book: 49, chapter: 2, scroll: 0 } });
    expect(await app.page.$$eval('[data-verse="12"] .kjv-word', (e) => e.map((x) => x.textContent!.toLowerCase()))).not.toContain("without"); // "without Christ" = lacking
  });
});
