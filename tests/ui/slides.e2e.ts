import { afterEach, describe, expect, it } from "vitest";
import { axeViolations, startApp } from "./helpers";
import type { App } from "./helpers";

let app: App;
afterEach(async () => app?.close());

const dock = (a: App) => a.page.locator(".pres-dock");
const items = (a: App) => dock(a).locator(".pres-item");
const itemRefs = (a: App) => dock(a).locator(".pres-item-ref").allTextContents();
const deckName = "Slide2.png + 2 more";

/** Waits until the dock's live caption reads `text`. */
async function showing(a: App, text: string) {
  await a.page.waitForFunction(
    ([sel, t]) => document.querySelector(sel)?.textContent === t,
    [".pres-dock .pres-preview-meta", text] as const,
  );
}

/** Presenting, with a "Sunday" playlist of John 3:16–17 followed by a three-picture deck. */
async function withPassageAndDeck() {
  app = await startApp();
  const { page } = app;
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await dock(app).waitFor();
  await page.getByLabel("New playlist name").fill("Sunday");
  await page.getByRole("button", { name: "Create" }).click();
  await page.click('[data-verse="16"]');
  await page.click('[data-verse="17"]', { modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Add to playlist" }).click();
  await page.getByRole("button", { name: "Clear selection" }).click();
  await page.getByRole("button", { name: "Add slides…" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".pres-dock .pres-item").length === 2);
  await showing(app, "John 3:16 · 1 of 5");
}

describe("slides in a playlist", () => {
  it("adds the picked pictures as one deck, in filename order, after the passage", async () => {
    await withPassageAndDeck();
    expect(await itemRefs(app)).toEqual(["John 3:16–17", deckName]);
    expect(await items(app).nth(1).locator(".pres-item-count").textContent()).toBe("3 slides");
    // The picker returned Welcome, Slide10, Slide2; they're stored Slide2, Slide10, Welcome.
    expect(await items(app).nth(1).locator(".pres-thumb").getAttribute("src")).toMatch(/\/slides\/1%2F1$/);
  });

  it("steps with Next from the passage's verses straight into the deck's pictures", async () => {
    await withPassageAndDeck();
    const next = dock(app).getByRole("button", { name: "Next ▶" });
    await next.click();
    await showing(app, "John 3:17 · 2 of 5");
    await next.click();
    await showing(app, `${deckName} · 1 of 3`);
    const picture = dock(app).locator(".pres-preview-frame .present-image");
    expect(await picture.getAttribute("src")).toMatch(/\/slides\/1%2F1$/);
    expect(await picture.getAttribute("alt")).toBe(`${deckName}, slide 1 of 3`);
    await next.click();
    await next.click();
    await showing(app, `${deckName} · 3 of 3`);
    expect(await next.isDisabled()).toBe(true);
    await dock(app).getByRole("button", { name: "◀ Previous" }).click();
    await showing(app, `${deckName} · 2 of 3`);
  });

  it("jumps to any item, or any single slide, with a click, and marks what's live", async () => {
    await withPassageAndDeck();
    const go = (i: number) => items(app).nth(i).locator(".pres-item-go");
    expect(await go(0).getAttribute("aria-current")).toBe("true");

    await go(1).click();
    await showing(app, `${deckName} · 1 of 3`);
    expect(await go(1).getAttribute("aria-current")).toBe("true");
    expect(await go(0).getAttribute("aria-current")).toBeNull();

    // The live deck's slides are laid out to pick from.
    const strip = dock(app).getByRole("list", { name: `Slides in ${deckName}` });
    await strip.getByRole("button", { name: "Show slide 3 of 3" }).click();
    await showing(app, `${deckName} · 3 of 3`);
    expect(await strip.getByRole("button", { name: "Show slide 3 of 3" }).getAttribute("aria-current")).toBe("true");

    await go(0).click();
    await showing(app, "John 3:16 · 1 of 5");
  });

  it("shows a deck's slides on request even when it isn't live", async () => {
    await withPassageAndDeck();
    const toggle = dock(app).getByRole("button", { name: `Show the slides in ${deckName}` });
    expect(await toggle.getAttribute("aria-expanded")).toBe("false");
    await toggle.click();
    const strip = dock(app).getByRole("list", { name: `Slides in ${deckName}` });
    expect(await strip.getByRole("button").count()).toBe(3);
    await strip.getByRole("button", { name: "Show slide 2 of 3" }).click();
    await showing(app, `${deckName} · 2 of 3`);
  });

  it("goes back to the exact slide after presenting an unplanned verse", async () => {
    await withPassageAndDeck();
    await items(app).nth(1).locator(".pres-item-go").click();
    await dock(app).getByRole("button", { name: "Next ▶" }).click();
    await showing(app, `${deckName} · 2 of 3`);

    await app.page.click('[data-verse="18"]');
    await app.page.getByRole("button", { name: "Present now" }).click();
    await showing(app, "John 3:18");
    await dock(app).getByRole("button", { name: `Back to ${deckName} · 2 of 3` }).click();
    await showing(app, `${deckName} · 2 of 3`);
  });

  it("reorders and removes a deck like any other item", async () => {
    await withPassageAndDeck();
    await items(app).nth(1).getByRole("button", { name: "Move up" }).click();
    await app.page.waitForFunction((name) => document.querySelector(".pres-dock .pres-item-ref")?.textContent === name, deckName);
    expect(await itemRefs(app)).toEqual([deckName, "John 3:16–17"]);

    await dock(app).getByRole("button", { name: `Remove ${deckName}` }).click();
    await app.page.waitForFunction(() => document.querySelectorAll(".pres-dock .pres-item").length === 1);
    expect(await itemRefs(app)).toEqual(["John 3:16–17"]);
  });

  it("says why a file that isn't a picture can't be added", async () => {
    await withPassageAndDeck();
    await app.page.evaluate(() =>
      // @ts-expect-error the harness's stand-in for Tauri's bridge
      window.__TAURI_INTERNALS__.invoke("mock:set_picker", { paths: ["/home/user/Sunday.pptx"] }),
    );
    await app.page.getByRole("button", { name: "Add slides…" }).click();
    await app.page.waitForSelector(".toast");
    expect(await app.page.locator(".toast").textContent()).toMatch(/Couldn’t add those slides: .*Sunday\.pptx isn't a supported image/);
    expect(await items(app).count()).toBe(2);
  });

  it("offers no Add slides button until a playlist is chosen", async () => {
    app = await startApp();
    await app.page.getByRole("button", { name: "Present", exact: true }).click();
    await dock(app).waitFor();
    expect(await app.page.getByRole("button", { name: "Add slides…" }).count()).toBe(0);
  });

  it("has no accessibility problems with a deck's slides laid out", async () => {
    await withPassageAndDeck();
    await items(app).nth(1).locator(".pres-item-go").click();
    await dock(app).getByRole("list", { name: `Slides in ${deckName}` }).waitFor();
    expect(await axeViolations(app.page, ".pres-dock")).toEqual([]);
    // (A 404 is the page asking for a favicon it doesn't have; the other suites ignore it too.)
    expect(app.errors.filter((e) => !e.includes("404"))).toEqual([]);
  });
});
