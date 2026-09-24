import { afterEach, describe, expect, it } from "vitest";
import { announced, axeViolations, startApp } from "./helpers";
import type { App } from "./helpers";

let app: App;
afterEach(async () => app?.close());

const panel = (a: App) => a.page.locator('.xrefs[role="dialog"]');
const rows = (a: App) => a.page.locator(".xrefs .lib-row");

/** John 3 with verse 16 selected and its cross-references open. */
async function openForVerse16() {
  app = await startApp();
  await app.page.click('[data-verse="16"]');
  await app.page.getByRole("button", { name: "Cross-references" }).click();
  await panel(app).waitFor();
  await rows(app).first().waitFor();
}

describe("cross-references", () => {
  it("open from the toolbar, showing the verse and its best-voted references first", async () => {
    await openForVerse16();
    expect(await panel(app).getAttribute("aria-label")).toBe("Cross-references for John 3:16");
    expect(await app.page.locator(".xr-source-ref").textContent()).toBe("John 3:16");
    expect(await app.page.locator(".xr-source").textContent()).toContain("For God so loved the world");
    expect(await rows(app).count()).toBeGreaterThan(15);
    expect(await rows(app).first().locator(".lib-ref").textContent()).toBe("Romans 5:8");
    expect(await rows(app).first().locator(".lib-text").textContent()).toContain("God commendeth his love");
    expect(await app.page.locator(".xr-title .lib-count").textContent()).toBe(String(await rows(app).count()));
  });

  it("jump to a reference and highlight it", async () => {
    await openForVerse16();
    await rows(app).first().locator(".lib-go").click();
    await panel(app).waitFor({ state: "detached" });
    await app.page.waitForFunction(() => document.querySelector(".location")?.textContent === "Romans 5");
    await app.page.waitForSelector('.verse.is-target[data-verse="8"]');
  });

  it("highlight the whole of a range", async () => {
    await openForVerse16();
    const range = rows(app).filter({ hasText: "1 John 4:9–10" });
    await range.locator(".lib-go").click();
    await app.page.waitForFunction(() => document.querySelector(".location")?.textContent === "1 John 4");
    await app.page.waitForSelector('.verse.is-target[data-verse="9"]');
    expect(await app.page.locator(".verse.is-target").count()).toBe(2);
  });

  it("open with X for the selected verse, and close with Escape", async () => {
    app = await startApp();
    await app.page.click('[data-verse="16"]');
    await app.page.keyboard.press("x");
    await panel(app).waitFor();
    expect(await panel(app).getAttribute("aria-label")).toContain("John 3:16");
    await app.page.keyboard.press("Escape");
    await panel(app).waitFor({ state: "detached" });
  });

  it("open with X for the verse the keyboard is on", async () => {
    app = await startApp();
    await app.page.keyboard.press("j");
    await app.page.keyboard.press("x");
    await panel(app).waitFor();
    expect(await panel(app).getAttribute("aria-label")).toMatch(/^Cross-references for John 3:\d+$/);
  });

  it("choose with the arrow keys and open with Enter", async () => {
    await openForVerse16();
    await app.page.keyboard.press("ArrowDown");
    await app.page.waitForFunction(() => document.activeElement?.closest(".xrefs .lib-row") !== null);
    await app.page.keyboard.press("ArrowDown");
    const second = await rows(app).nth(1).locator(".lib-ref").textContent();
    expect(await app.page.evaluate(() => document.activeElement?.closest(".lib-row")?.querySelector(".lib-ref")?.textContent)).toBe(second);
    await app.page.keyboard.press("ArrowUp");
    await app.page.keyboard.press("Enter");
    await panel(app).waitFor({ state: "detached" });
    await app.page.waitForFunction(() => document.querySelector(".location")?.textContent === "Romans 5");
  });

  it("are offered only when one verse is selected", async () => {
    app = await startApp();
    await app.page.click('[data-verse="16"]');
    expect(await app.page.getByRole("button", { name: "Cross-references" }).count()).toBe(1);
    await app.page.click('[data-verse="18"]', { modifiers: ["Shift"] });
    await app.page.waitForFunction(() => document.querySelectorAll(".verse.is-selected").length === 3);
    expect(await app.page.getByRole("button", { name: "Cross-references" }).count()).toBe(0);
    await app.page.keyboard.press("x");
    expect(await panel(app).count()).toBe(0);
    expect(await announced(app.page)).toContain("Select one verse");
  });

  it("say so when there is no verse to look up", async () => {
    app = await startApp();
    await app.page.keyboard.press("x");
    expect(await announced(app.page)).toContain("Select one verse");
    expect(await panel(app).count()).toBe(0);
  });

  it("say so when a verse has none", async () => {
    app = await startApp({ position: { book: 43, chapter: 4, scroll: 0 } });
    await app.page.click('[data-verse="17"]');
    await app.page.keyboard.press("x");
    await panel(app).waitFor();
    // "Looking…" shows in the same spot first, so wait for the answer itself (on a slow machine the
    // lookup is still running when the panel appears).
    await app.page.getByText("No cross-references for this verse.").waitFor();
    expect(await rows(app).count()).toBe(0);
  });

  it("give focus back to the page when closed", async () => {
    await openForVerse16();
    await app.page.keyboard.press("Escape");
    await panel(app).waitFor({ state: "detached" });
    expect(await app.page.$eval(".app-shell", (e) => e.hasAttribute("inert"))).toBe(false);
  });

  it("leave the panel free of accessibility problems", async () => {
    await openForVerse16();
    expect(await axeViolations(app.page)).toEqual([]);
  });
});
