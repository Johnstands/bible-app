// Screenshots of the Library and the verse of the day. Usage: node scripts/ui/shots-library.mjs <output-dir>
import fs from "node:fs";
import path from "node:path";
import { launch } from "./harness.mjs";

const out = process.argv[2] ?? "ui-shots";
fs.mkdirSync(out, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });

{
  const ui = await launch({ motion: "reduce" });
  const { page } = ui;
  await ui.open({ position: { book: 43, chapter: 3, scroll: 0 } });

  // Mark some verses in John 3.
  await page.click('[data-verse="16"]');
  await page.click('[data-verse="18"]', { modifiers: ["Shift"] });
  await page.click('.dot[data-color="yellow"]');
  await page.click("text=Bookmark");
  await page.click('[data-verse="20"]');
  await page.click('.dot[data-color="blue"]');
  await page.click('[data-verse="17"]');
  await page.click(".selbar-action >> text=Note");
  await page.fill(".note-body", "The measure of the gift is the love that gave it.");
  await page.click(".note-save");
  await page.waitForSelector(".mk-note");

  // And one in Psalm 23, reached through the Go to panel.
  await page.keyboard.press("Control+k");
  await page.fill(".goto-input", "ps 23:4");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-verse="4"]');
  await page.click('[data-verse="4"]');
  await page.click('.dot[data-color="green"]');
  await page.click("text=Bookmark");

  await page.keyboard.press("Control+l");
  await page.waitForSelector(".library .lib-row");
  await shot(page, "8-library-bookmarks");
  await page.click('[role="tab"]:has-text("Notes")');
  await shot(page, "9-library-notes");
  await page.click('[role="tab"]:has-text("Highlights")');
  await shot(page, "10-library-highlights");

  // Opening a row jumps to the verse.
  await page.click('.lib-row:has-text("John 3:16") .lib-go');
  await page.waitForSelector('.verse.is-target[data-verse="16"]');
  console.log("jumped to:", await page.textContent(".location"));

  // Removing a highlight from the Library clears it in the reader.
  await page.keyboard.press("Control+l");
  await page.click('[role="tab"]:has-text("Highlights")');
  await page.hover('.lib-row:has-text("John 3:20")');
  await page.click('.lib-row:has-text("John 3:20") .lib-remove');
  await page.waitForFunction(() => !document.body.textContent.includes("John 3:20"));
  console.log("highlights left:", await page.$$eval(".lib-row", (r) => r.length));
  console.log("errors:", ui.errors.filter((e) => !e.includes("404")));
  await ui.close();
}

// The verse of the day appears once, on the first launch of the day.
{
  const ui = await launch({ motion: "reduce" });
  await ui.open({ settings: { verseOfTheDay: true } });
  await ui.page.waitForSelector(".votd-text");
  await shot(ui.page, "11-verse-of-the-day");
  console.log("verse of the day:", (await ui.page.textContent(".votd-ref")), "|", (await ui.page.textContent(".votd-text")).slice(0, 60));
  await ui.page.click(".votd-read");
  console.log("after Read in context:", await ui.page.textContent(".location"));
  await ui.page.reload();
  await ui.page.waitForSelector(".chapter");
  console.log("shows again on reload the same day:", (await ui.page.$(".votd")) !== null);
  await ui.close();
}
