// Screenshots of the main flows. Usage: node scripts/ui/shots.mjs <output-dir>
import fs from "node:fs";
import path from "node:path";
import { launch } from "./harness.mjs";

const out = process.argv[2] ?? "ui-shots";
fs.mkdirSync(out, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });

const ui = await launch({ motion: "reduce" });
const { page } = ui;
await ui.open({ position: { book: 43, chapter: 3, scroll: 0 } });

// Select a range: click 16, shift-click 18.
await page.click('[data-verse="16"]');
await page.click('[data-verse="18"]', { modifiers: ["Shift"] });
await page.waitForSelector(".selbar");
const picked = await page.$$eval(".verse.is-selected", (els) => els.map((e) => e.dataset.verse));
console.log("selected after click 16 + shift-click 18:", picked.join(","), "| label:", await page.textContent(".selbar-label"));
await shot(page, "1-selected");

// Highlight it, then bookmark and add a note.
await page.click('.dot[data-color="yellow"]');
await page.waitForSelector('.verse[data-hl="yellow"]');
await page.click('[data-verse="20"]');
await page.click('.dot[data-color="blue"]');
await page.click('[data-verse="16"]');
await page.click("text=Bookmark");
await page.waitForSelector(".mk-bookmark");
await page.click('[data-verse="17"]');
await page.click(".selbar-action >> text=Note");
await page.waitForSelector(".note-body");
await page.fill(".note-body", "For God so loved: the measure of the gift is the love that gave it.");
await shot(page, "2-note-editor");
await page.click(".note-save");
await page.waitForSelector(".mk-note");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await shot(page, "3-marks");

console.log("page errors:", ui.errors.length ? ui.errors : "none");
await ui.close();
