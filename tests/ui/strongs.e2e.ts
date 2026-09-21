import { afterEach, describe, expect, it } from "vitest";
import { announced, axeViolations, startApp } from "./helpers";
import type { App } from "./helpers";

let app: App;
afterEach(async () => app?.close());

const ON = { settings: { originalWords: true } };
const PSALM_23 = { position: { book: 19, chapter: 23, scroll: 0 } };
const ROMANS_5 = { position: { book: 45, chapter: 5, scroll: 0 } };

/** The tagged word `word` in verse `verse`. */
const word = (a: App, verse: number, text: string) => a.page.locator(`[data-verse="${verse}"] .orig-word`, { hasText: new RegExp(`^${text}$`) }).first();

describe("original-language words", () => {
  it("are off by default: no word is marked, and pressing W finds no original words", async () => {
    app = await startApp({ position: { book: 45, chapter: 5, scroll: 0 } });
    await app.page.waitForSelector('[data-verse="8"]');
    expect(await app.page.locator(".orig-word").count()).toBe(0);
    await app.page.click('[data-verse="8"]');
    expect(await app.page.locator(".wordhelp").count()).toBe(0);
  });

  it("mark most words when turned on, without changing the text", async () => {
    app = await startApp();
    const plain = await app.page.locator('[data-verse="16"]').textContent();
    await app.close();
    app = await startApp(ON);
    await app.page.waitForSelector(".orig-word");
    expect(await app.page.locator('[data-verse="16"] .orig-word').count()).toBeGreaterThan(10);
    expect(await app.page.locator('[data-verse="16"]').textContent()).toBe(plain);
  });

  it("show the Greek behind a word: letters, sound, meaning and how the KJV renders it", async () => {
    app = await startApp(ON);
    await app.page.waitForSelector(".orig-word");
    await word(app, 16, "loved").click();
    const card = app.page.locator(".wordhelp");
    await card.waitFor();
    await card.locator(".wh-lemma").waitFor();
    expect(await card.locator(".wh-label-row .wh-label").textContent()).toBe("Greek · G25");
    expect(await card.locator(".wh-lemma").textContent()).toBe("ἀγαπάω");
    expect(await card.locator(".wh-translit").textContent()).toContain("agapáō");
    expect(await card.locator(".wh-def").textContent()).toMatch(/love/i);
    expect(await card.locator(".wh-renders").textContent()).toMatch(/love ×\d+/);
    expect(await card.getAttribute("role")).toBe("dialog");
  });

  it("show the Hebrew right to left", async () => {
    app = await startApp({ ...ON, ...PSALM_23 });
    await app.page.waitForSelector(".orig-word");
    await word(app, 1, "shepherd").click();
    const lemma = app.page.locator(".wh-lemma");
    await lemma.waitFor();
    expect(await lemma.getAttribute("dir")).toBe("rtl");
    expect(await app.page.locator(".wh-label-row .wh-label").textContent()).toBe("Hebrew · H7462");
    expect(await lemma.textContent()).toMatch(/^[֐-׿]+$/);
  });

  it("put word help and the original in one card when a word has both", async () => {
    app = await startApp({ ...ON, ...PSALM_23 });
    await app.page.waitForSelector(".orig-word");
    const want = app.page.locator('[data-verse="1"] .kjv-word.orig-word');
    await want.click();
    const card = app.page.locator(".wordhelp");
    await card.locator(".wh-lemma").waitFor();
    expect(await card.locator(".wh-meaning").textContent()).toContain("lack");
    expect(await card.locator(".wh-label-row .wh-label").textContent()).toBe("Hebrew · H2637");
  });

  it("follow a number in the definition, and come back", async () => {
    app = await startApp({ ...ON, ...ROMANS_5 });
    await app.page.waitForSelector(".orig-word");
    await word(app, 8, "love").click();
    const card = app.page.locator(".wordhelp");
    await card.locator(".wh-def").waitFor();
    expect(await card.locator(".wh-label-row .wh-label").textContent()).toBe("Greek · G26");
    await card.locator(".wh-ref", { hasText: "G25" }).click();
    await app.page.waitForFunction(() => document.querySelector(".wh-label-row .wh-label")?.textContent === "Greek · G25");
    await card.getByRole("button", { name: "← Back" }).click();
    await app.page.waitForFunction(() => document.querySelector(".wh-label-row .wh-label")?.textContent === "Greek · G26");
    expect(await card.getByRole("button", { name: "← Back" }).count()).toBe(0);
  });

  it("list every verse that uses the word, in Bible order, with the word marked", async () => {
    app = await startApp({ ...ON, ...ROMANS_5 });
    await app.page.waitForSelector(".orig-word");
    await word(app, 8, "love").click();
    await app.page.locator(".wh-search").click();
    await app.page.waitForSelector(".hit");
    expect(await app.page.locator(".goto-input").inputValue()).toBe("G26");
    const hits = await app.page.locator(".hit").allTextContents();
    expect(hits.length).toBeGreaterThan(20);
    expect(hits.some((h) => h.includes("Romans") && h.includes("commendeth"))).toBe(true);
    // Bible order: Matthew's or Luke's verses come before Romans'.
    expect(hits.findIndex((h) => h.includes("Romans"))).toBeGreaterThan(hits.findIndex((h) => /Matthew|Luke|John/.test(h)));
  });

  it("can be searched by typing the number", async () => {
    app = await startApp();
    await app.page.keyboard.press("Control+f");
    await app.page.fill(".goto-input", "h7225");
    await app.page.waitForSelector(".hit");
    expect((await app.page.locator(".hit").first().textContent())).toContain("Genesis");
  });

  it("switch on and off with S, and say so", async () => {
    app = await startApp();
    await app.page.keyboard.press("s");
    await app.page.waitForSelector(".orig-word");
    expect(await announced(app.page)).toContain("Original-language words on");
    await app.page.keyboard.press("s");
    await app.page.waitForFunction(() => document.querySelectorAll(".orig-word").length === 0);
    expect(await announced(app.page)).toContain("off");
  });

  it("open from the keyboard with W, and Enter lists the verses", async () => {
    app = await startApp(ON);
    await app.page.waitForSelector(".orig-word");
    await app.page.keyboard.press("w");
    await app.page.locator(".wordhelp .wh-lemma").waitFor();
    expect(await announced(app.page)).toMatch(/(Hebrew|Greek) word [HG]\d+\. Press Enter/);
    await app.page.keyboard.press("Enter");
    await app.page.waitForSelector(".hit");
    expect(await app.page.locator(".goto-input").inputValue()).toMatch(/^[HG]\d+$/);
  });

  it("switch on from Settings and take effect at once", async () => {
    app = await startApp();
    await app.page.keyboard.press("Control+,");
    await app.page.getByRole("switch", { name: /Original-language words/ }).click();
    await app.page.keyboard.press("Escape");
    await app.page.waitForSelector(".orig-word");
  });

  it("leave the reader and the card free of accessibility problems", async () => {
    app = await startApp(ON);
    await app.page.waitForSelector(".orig-word");
    expect(await axeViolations(app.page)).toEqual([]);
    await word(app, 16, "loved").click();
    await app.page.locator(".wordhelp .wh-lemma").waitFor();
    expect(await axeViolations(app.page)).toEqual([]);
  });
});
