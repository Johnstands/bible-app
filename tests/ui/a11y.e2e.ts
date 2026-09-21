import { afterEach, describe, expect, it } from "vitest";
import { axeViolations, startApp } from "./helpers";
import type { App, Violation } from "./helpers";

let app: App;
afterEach(async () => app?.close());

// Every finding fails, whatever its impact: the screens are clean now and should stay that way.
const report = (name: string, v: Violation[]) => {
  if (v.length) console.log(`axe on ${name}:`, JSON.stringify(v, null, 1));
};

const screens: [string, (a: App) => Promise<void>][] = [
  ["the reader", async () => {}],
  ["the reader with a verse selected", async (a) => { await a.page.click('[data-verse="16"]'); await a.page.waitForSelector(".selbar"); }],
  ["a word card", async (a) => { await a.page.keyboard.press("w"); await a.page.waitForSelector(".wordhelp"); }],
  ["Go to", async (a) => { await a.page.keyboard.press("/"); await a.page.waitForSelector(".goto-input"); }],
  ["Search results", async (a) => { await a.page.keyboard.press("Control+f"); await a.page.fill(".goto-input", "shepherd"); await a.page.waitForSelector(".hit"); }],
  ["the Library", async (a) => { await a.page.keyboard.press("Control+l"); await a.page.waitForSelector(".library"); }],
  ["Settings", async (a) => { await a.page.keyboard.press("Control+,"); await a.page.waitForSelector(".settings"); }],
  ["the note editor", async (a) => { await a.page.click('[data-verse="16"]'); await a.page.click(".selbar-action >> text=Note"); await a.page.waitForSelector(".note-body"); }],
];

describe.each(["paper", "sepia", "dark"] as const)("accessibility scan, %s theme", (theme) => {
  it.each(screens)("%s", async (name, arrive) => {
    app = await startApp({ settings: { theme } });
    await arrive(app);
    const found = await axeViolations(app.page);
    report(`${name} (${theme})`, found);
    expect(found).toEqual([]);
  });
});

const focusedIn = (a: App, selector: string) => a.page.evaluate((sel) => !!document.activeElement?.closest(sel), selector);

describe("focus around dialogs", () => {
  it.each([
    ["Go to", "/", ".goto", ".goto-input"],
    ["Search", "Control+f", ".search", ".goto-input"],
    ["Settings", "Control+,", ".settings", null],
    ["the Library", "Control+l", ".library", null],
  ] as const)("%s takes focus, hides the page behind it, and gives focus back", async (_name, key, dialog, field) => {
    app = await startApp();
    await app.page.locator(".location").focus();
    await app.page.keyboard.press(key);
    await app.page.waitForSelector(dialog);
    expect(await focusedIn(app, dialog)).toBe(true);
    if (field) expect(await app.page.evaluate((f) => document.activeElement?.matches(f), field)).toBe(true);
    expect(await app.page.$eval(".app-shell", (e) => e.hasAttribute("inert"))).toBe(true);

    // Tab and Shift+Tab can't reach the page behind it.
    for (let i = 0; i < 12; i++) await app.page.keyboard.press("Tab");
    expect(await focusedIn(app, dialog) || (await app.page.evaluate(() => document.activeElement === document.body))).toBe(true);
    expect(await focusedIn(app, ".app-shell")).toBe(false);

    await app.page.keyboard.press("Escape");
    await app.page.waitForSelector(dialog, { state: "detached" });
    expect(await app.page.$eval(".app-shell", (e) => e.hasAttribute("inert"))).toBe(false);
    expect(await app.page.evaluate(() => document.activeElement?.className)).toContain("location");
  });
});

describe("lists in the dialogs", () => {
  it("tells assistive technology which search result is current", async () => {
    app = await startApp();
    await app.page.keyboard.press("Control+f");
    await app.page.fill(".goto-input", "shepherd");
    await app.page.waitForSelector(".hit");
    const input = app.page.locator(".goto-input");
    expect(await input.getAttribute("role")).toBe("combobox");
    const first = await input.getAttribute("aria-activedescendant");
    expect(await app.page.$eval(`[id="${first}"]`, (e) => e.getAttribute("aria-selected"))).toBe("true");
    await app.page.keyboard.press("ArrowDown");
    const second = await input.getAttribute("aria-activedescendant");
    expect(second).not.toBe(first);
    expect(await app.page.$eval(`[id="${second}"]`, (e) => e.getAttribute("aria-selected"))).toBe("true");
  });

  it("moves through the Library with the arrow keys and Tab", async () => {
    app = await startApp();
    for (const v of ["16", "20"]) {
      await app.page.click(`[data-verse="${v}"]`);
      await app.page.keyboard.press("b");
      await app.page.waitForSelector(`[data-verse="${v}"] .mk-bookmark`);
    }
    await app.page.keyboard.press("Escape");
    await app.page.keyboard.press("Control+l");
    await app.page.waitForSelector(".lib-row");
    await app.page.keyboard.press("ArrowRight"); // Notes tab
    await app.page.waitForFunction(() => document.activeElement?.getAttribute("role") === "tab");
    expect(await app.page.$eval('[role="tab"][aria-selected="true"]', (e) => e.textContent)).toContain("Notes");
    await app.page.keyboard.press("ArrowLeft");
    await app.page.waitForFunction(() => document.activeElement?.textContent?.includes("Bookmarks"));
    await app.page.keyboard.press("ArrowDown");
    expect(await app.page.evaluate(() => document.activeElement?.className)).toContain("lib-go");
    await app.page.keyboard.press("ArrowDown");
    expect(await app.page.evaluate(() => document.querySelectorAll(".lib-row")[1]?.contains(document.activeElement))).toBe(true);
    await app.page.keyboard.press("Enter");
    await app.page.waitForSelector(".library", { state: "detached" });
    expect(await app.page.$(".verse.is-target")).not.toBeNull();
  });
});
