import { afterEach, describe, expect, it } from "vitest";
import { axeViolations, startApp } from "./helpers";
import type { App } from "./helpers";

let app: App;
afterEach(async () => app?.close());

const NEWER = { version: "0.2.0", notes: "Adds reading plans." };

describe("updates", () => {
  it("offers a newer version when the app opens, and lets it wait", async () => {
    app = await startApp({}, { update: NEWER });
    await app.page.waitForSelector(".update-banner", { timeout: 15_000 });
    expect(await app.page.textContent(".update-banner")).toContain("Version 0.2.0 is available.");
    expect(await axeViolations(app.page)).toEqual([]);
    await app.page.click(".update-banner >> text=Later");
    expect(await app.page.$(".update-banner")).toBeNull();
  });

  it("says nothing when the app is up to date, and Settings can check by hand", async () => {
    app = await startApp();
    await app.page.waitForTimeout(4000); // longer than the wait before the launch check
    expect(await app.page.$(".update-banner")).toBeNull();
    await app.page.keyboard.press("Control+,");
    await app.page.waitForFunction(() => document.querySelector(".set-about")?.textContent?.includes("This is the latest version."));
    expect(await app.page.textContent(".set-about")).toContain("You have version 0.1.0.");
    await app.page.click('button:has-text("Check for updates")');
    await app.page.waitForFunction(() => document.querySelector(".set-about")?.textContent?.includes("This is the latest version."));
    expect(await axeViolations(app.page)).toEqual([]);
  });

  it("offers to install from Settings when one is available", async () => {
    app = await startApp({}, { update: NEWER });
    await app.page.keyboard.press("Control+,");
    await app.page.click('button:has-text("Check for updates")');
    await app.page.waitForSelector('.settings button:has-text("Install and restart")');
    expect(await app.page.textContent(".set-about")).toContain("Version 0.2.0 is available.");
  });
});
