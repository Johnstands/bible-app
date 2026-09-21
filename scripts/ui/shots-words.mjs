// Screenshots of word help. Usage: node scripts/ui/shots-words.mjs <output-dir>
import fs from "node:fs";
import path from "node:path";
import { launch } from "./harness.mjs";

const out = process.argv[2] ?? "ui-shots";
fs.mkdirSync(out, { recursive: true });
const shot = (page, name, clip) => page.screenshot({ path: path.join(out, `${name}.png`), clip });

const ui = await launch({ motion: "reduce", width: 1000, height: 900 });
const { page } = ui;

// How much gets underlined in a few well-known chapters (a gauge for noise).
const chapters = [[1, 1, "Genesis 1"], [19, 23, "Psalm 23"], [40, 6, "Matthew 6"], [42, 2, "Luke 2"], [43, 3, "John 3"], [45, 8, "Romans 8"]];
for (const [book, chapter, name] of chapters) {
  await ui.open({ position: { book, chapter, scroll: 0 } });
  const counts = await page.$$eval(".kjv-word", (els) => {
    const n = { archaic: 0, changed: 0, unit: 0 };
    for (const e of els) n[e.dataset.kind]++;
    return n;
  });
  const words = await page.$$eval(".kjv-word", (els) => [...new Set(els.map((e) => e.textContent.toLowerCase()))].slice(0, 14).join(", "));
  console.log(`${name}: ${JSON.stringify(counts)}  e.g. ${words}`);
}

// A false friend, in Luke 2.
await ui.open({ position: { book: 42, chapter: 2, scroll: 0 } });
await page.click('.kjv-word:has-text("taxed")');
await page.waitForSelector(".wordhelp");
console.log("popover:", (await page.textContent(".wordhelp")).replace(/\s+/g, " "));
await shot(page, "14-word-taxed");
await page.keyboard.press("Escape");
console.log("closed with Escape:", (await page.$(".wordhelp")) === null);

// An archaic word, and the verse must not be selected by clicking it.
await page.click('.kjv-word:has-text("tidings")');
console.log("tidings:", (await page.textContent(".wordhelp")).replace(/\s+/g, " "));
console.log("verse selected by word click:", (await page.$(".verse.is-selected")) !== null);
await shot(page, "15-word-tidings");
await page.mouse.click(40, 500);
console.log("closed by outside click:", (await page.$(".wordhelp")) === null);

// The three levels in Settings: everything, only changed meanings, nothing.
const kinds = () => page.$$eval(".kjv-word", (els) => [...new Set(els.map((e) => e.dataset.kind))].sort().join("+") || "none");
await page.click('button[aria-label="Settings"]');
await page.waitForSelector(".settings");
await shot(page, "17-settings-word-help");
console.log("level All words shows:", await kinds());
await page.click('.set-levels button:has-text("Changed meanings")');
console.log("level Changed meanings shows:", await kinds());
await page.click('.set-levels button:has-text("Off")');
console.log("level Off shows:", await kinds());
await page.click('.set-levels button:has-text("All words")');
console.log("back to All words:", await kinds());
console.log("saved:", await page.evaluate(() => JSON.parse(localStorage.getItem("settings")).wordHelp));
await page.keyboard.press("Escape");
console.log("errors:", ui.errors.filter((e) => !e.includes("404")));
await ui.close();
