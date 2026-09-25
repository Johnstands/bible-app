import { afterEach, describe, expect, it } from "vitest";
import { axeViolations, startApp } from "./helpers";
import type { App } from "./helpers";

let app: App;
afterEach(async () => app?.close());

describe("about", () => {
  it("opens from Settings with the version and sources, and Esc goes back to Settings", async () => {
    app = await startApp();
    await app.page.keyboard.press("Control+,");
    await app.page.click('.settings button:has-text("About and support")');
    await app.page.waitForSelector(".about");
    await app.page.waitForFunction(() => document.querySelector(".about-version")?.textContent === "Version 0.1.0");
    const text = await app.page.textContent(".about");
    expect(text).toContain("eBible.org");
    expect(text).toContain("Support");
    expect(await axeViolations(app.page)).toEqual([]);
    await app.page.click('button:has-text("Source code on GitHub")');
    await app.page.keyboard.press("Escape");
    await app.page.waitForSelector(".settings:not(.about)");
    expect(app.errors.filter((e) => !e.includes("404"))).toEqual([]);
  });
});
