import { afterEach, describe, expect, it } from "vitest";
import { announced, axeViolations, startApp } from "./helpers";
import type { App } from "./helpers";

let app: App;
afterEach(async () => app?.close());

const panel = (a: App) => a.page.locator('.plans[role="dialog"]');
const plan = (a: App, id: string) => a.page.locator(`.plan[data-plan="${id}"]`);
const chip = (a: App) => a.page.locator(".plan-chip");

async function openPlans(a: App) {
  await a.page.getByRole("button", { name: "Plans", exact: true }).click();
  await panel(a).waitFor();
}

/** The reader with the Gospels plan started and the panel closed again. */
async function withGospels(opts: Parameters<typeof startApp>[0] = {}) {
  app = await startApp(opts);
  await openPlans(app);
  await plan(app, "gospels-30").getByRole("button", { name: "Start" }).click();
  await app.page.waitForSelector('.plan[data-plan="gospels-30"] .plan-bar');
}

describe("reading plans", () => {
  it("offer four plans and none is started at first", async () => {
    app = await startApp();
    await openPlans(app);
    expect(await panel(app).getAttribute("aria-label")).toBe("Reading plans");
    expect(await app.page.locator(".plan-offer .plan-name").allTextContents()).toEqual([
      "The Bible in a year",
      "The New Testament in 90 days",
      "The Gospels in a month",
      "Psalms and Proverbs in a month",
    ]);
    expect(await app.page.locator(".plan-bar").count()).toBe(0);
  });

  it("start a plan and show its first day", async () => {
    await withGospels();
    const gospels = plan(app, "gospels-30");
    expect(await gospels.locator(".plan-count").textContent()).toBe("0 of 30 days");
    expect(await gospels.locator(".plan-next-what").textContent()).toMatch(/^Day 1Matthew 1/);
    expect(await gospels.locator(".plan-bar").getAttribute("aria-valuenow")).toBe("0");
    // It is no longer offered.
    expect(await app.page.locator('.plan-offer[data-plan="gospels-30"]').count()).toBe(0);
  });

  it("jump to the day's reading with Read", async () => {
    await withGospels();
    await plan(app, "gospels-30").getByRole("button", { name: "Read" }).click();
    await panel(app).waitFor({ state: "detached" });
    await app.page.waitForFunction(() => document.querySelector(".location")?.textContent === "Matthew 1");
  });

  it("mark a day done from the panel, and move to the next", async () => {
    await withGospels();
    await plan(app, "gospels-30").getByRole("button", { name: "Mark day done" }).click();
    await app.page.waitForFunction(() => document.querySelector('.plan[data-plan="gospels-30"] .plan-count')?.textContent === "1 of 30 days");
    expect(await plan(app, "gospels-30").locator(".plan-next-what").textContent()).toMatch(/^Day 2/);
    expect(await plan(app, "gospels-30").locator(".plan-bar").getAttribute("aria-valuenow")).toBe("3");
    expect(await announced(app.page)).toBe("Day 1 of The Gospels in a month marked done.");
  });

  it("show a strip under a chapter that belongs to today's reading, and tick the day off there", async () => {
    await withGospels();
    await plan(app, "gospels-30").getByRole("button", { name: "Read" }).click();
    await app.page.waitForFunction(() => document.querySelector(".location")?.textContent === "Matthew 1");
    await chip(app).waitFor();
    expect(await chip(app).getAttribute("aria-label")).toBe("The Gospels in a month, day 1");
    expect(await chip(app).locator(".plan-label").textContent()).toBe("The Gospels in a month · Day 1");
    expect(await chip(app).locator('button[aria-current="page"]').textContent()).toBe("Matthew 1");
    await chip(app).getByRole("button", { name: "Mark day done" }).click();
    await chip(app).waitFor({ state: "detached" });
    await openPlans(app);
    expect(await plan(app, "gospels-30").locator(".plan-count").textContent()).toBe("1 of 30 days");
  });

  it("show no strip on a chapter that isn't part of today's reading", async () => {
    await withGospels({ position: { book: 45, chapter: 8, scroll: 0 } });
    await app.page.keyboard.press("Escape");
    expect(await chip(app).count()).toBe(0);
  });

  it("list a mixed day's chapters in the strip, and open one", async () => {
    app = await startApp({ position: { book: 19, chapter: 1, scroll: 0 } });
    await openPlans(app);
    await plan(app, "psalms-proverbs").getByRole("button", { name: "Start" }).click();
    await app.page.waitForSelector('.plan[data-plan="psalms-proverbs"] .plan-bar');
    await app.page.keyboard.press("Escape");
    await chip(app).waitFor();
    expect(await chip(app).locator(".plan-chip-chapters button").allTextContents()).toEqual([
      "Psalm 1", "Psalm 31", "Psalm 61", "Psalm 91", "Psalm 121", "Proverbs 1",
    ]);
    await chip(app).getByRole("button", { name: "Proverbs 1" }).click();
    await app.page.waitForFunction(() => document.querySelector(".location")?.textContent === "Proverbs 1");
    await chip(app).waitFor(); // Proverbs 1 is part of the same day, so the strip is still there
    expect(await chip(app).locator('button[aria-current="page"]').textContent()).toBe("Proverbs 1");
  });

  it("list every day, and check and uncheck one", async () => {
    await withGospels();
    const gospels = plan(app, "gospels-30");
    await gospels.getByRole("button", { name: "All the days" }).click();
    expect(await gospels.locator(".plan-day").count()).toBe(30);
    const third = gospels.getByRole("checkbox", { name: /^Day 3(?!\d)/ });
    expect(await third.getAttribute("aria-checked")).toBe("false");
    await third.click();
    await app.page.waitForFunction(() => document.querySelector('.plan[data-plan="gospels-30"] .plan-count')?.textContent === "1 of 30 days");
    expect(await gospels.getByRole("checkbox", { name: /^Day 3(?!\d)/ }).getAttribute("aria-checked")).toBe("true");
    // Day 1 is still the next reading: a later day can be done first.
    expect(await gospels.locator(".plan-next-what").textContent()).toMatch(/^Day 1/);
    await gospels.getByRole("checkbox", { name: /^Day 3(?!\d)/ }).click();
    await app.page.waitForFunction(() => document.querySelector('.plan[data-plan="gospels-30"] .plan-count')?.textContent === "0 of 30 days");
  });

  it("read any day from the list", async () => {
    await withGospels();
    await plan(app, "gospels-30").getByRole("button", { name: "All the days" }).click();
    await plan(app, "gospels-30").getByRole("button", { name: "Read day 30" }).click();
    await panel(app).waitFor({ state: "detached" });
    await app.page.waitForFunction(() => document.querySelector(".location")?.textContent?.startsWith("John"));
  });

  it("stop a plan with nothing done straight away", async () => {
    await withGospels();
    await plan(app, "gospels-30").getByRole("button", { name: "Stop", exact: true }).click();
    await app.page.waitForSelector('.plan-offer[data-plan="gospels-30"]');
    expect(await app.page.locator(".plan-bar").count()).toBe(0);
  });

  it("ask before stopping a plan that has progress, and let you keep it", async () => {
    await withGospels();
    await plan(app, "gospels-30").getByRole("button", { name: "Mark day done" }).click();
    await app.page.waitForFunction(() => document.querySelector('.plan[data-plan="gospels-30"] .plan-count')?.textContent === "1 of 30 days");
    await plan(app, "gospels-30").getByRole("button", { name: "Stop", exact: true }).click();
    await app.page.getByRole("group", { name: "Stop this plan?" }).waitFor();
    await app.page.getByRole("button", { name: "Keep it" }).click();
    expect(await app.page.getByRole("group", { name: "Stop this plan?" }).count()).toBe(0);
    expect(await plan(app, "gospels-30").locator(".plan-count").textContent()).toBe("1 of 30 days");
    await plan(app, "gospels-30").getByRole("button", { name: "Stop", exact: true }).click();
    await app.page.getByRole("button", { name: "Stop the plan" }).click();
    await app.page.waitForSelector('.plan-offer[data-plan="gospels-30"]');
  });

  it("finish a plan, and start it over", async () => {
    app = await startApp();
    await openPlans(app);
    await plan(app, "psalms-proverbs").getByRole("button", { name: "Start" }).click();
    const card = plan(app, "psalms-proverbs");
    await card.getByRole("button", { name: "All the days" }).click();
    for (let day = 1; day <= 31; day++) {
      await card.getByRole("checkbox", { name: new RegExp(`Day ${day}\\b`) }).click();
      await app.page.waitForFunction(
        (n) => document.querySelector('.plan[data-plan="psalms-proverbs"] .plan-count')?.textContent === `${n} of 31 days`,
        day,
      );
    }
    await card.locator(".plan-finished").waitFor();
    expect(await card.locator(".plan-finished").textContent()).toBe("Finished. Well done.");
    await card.getByRole("button", { name: "Start over" }).click();
    await app.page.waitForFunction(() => document.querySelector('.plan[data-plan="psalms-proverbs"] .plan-count')?.textContent === "0 of 31 days");
    expect(await card.locator(".plan-finished").count()).toBe(0);
  });

  it("remember a plan after the app is reloaded", async () => {
    await withGospels();
    await plan(app, "gospels-30").getByRole("button", { name: "Mark day done" }).click();
    await app.page.waitForFunction(() => document.querySelector('.plan[data-plan="gospels-30"] .plan-count')?.textContent === "1 of 30 days");
    await app.page.reload();
    await app.page.waitForSelector("[data-verse]");
    await openPlans(app);
    expect(await plan(app, "gospels-30").locator(".plan-count").textContent()).toBe("1 of 30 days");
  });

  it("still close with Escape after the button that had focus has gone", async () => {
    app = await startApp();
    await openPlans(app);
    await plan(app, "gospels-30").getByRole("button", { name: "Start" }).focus();
    await app.page.keyboard.press("Enter"); // starting the plan removes the button that was focused
    await app.page.waitForSelector('.plan[data-plan="gospels-30"] .plan-bar');
    expect(await app.page.evaluate(() => document.activeElement?.closest(".plans") !== null)).toBe(true);
    await app.page.keyboard.press("Escape");
    await panel(app).waitFor({ state: "detached" });
  });

  it("open with P and close with Escape", async () => {
    app = await startApp();
    await app.page.keyboard.press("p");
    await panel(app).waitFor();
    expect(await app.page.$eval(".app-shell", (e) => e.hasAttribute("inert"))).toBe(true);
    await app.page.keyboard.press("Escape");
    await panel(app).waitFor({ state: "detached" });
    expect(await app.page.$eval(".app-shell", (e) => e.hasAttribute("inert"))).toBe(false);
  });

  it("leave the panel, its day list and the strip free of accessibility problems", async () => {
    await withGospels();
    expect(await axeViolations(app.page)).toEqual([]);
    await plan(app, "gospels-30").getByRole("button", { name: "All the days" }).click();
    expect(await axeViolations(app.page)).toEqual([]);
    await plan(app, "gospels-30").getByRole("button", { name: "Read", exact: true }).first().click();
    await chip(app).waitFor();
    expect(await axeViolations(app.page)).toEqual([]);
  });
});
