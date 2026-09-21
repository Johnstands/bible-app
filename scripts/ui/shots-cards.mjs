// Renders verse cards to PNG files. Usage: node scripts/ui/shots-cards.mjs <output-dir>
import fs from "node:fs";
import path from "node:path";
import { launch } from "./harness.mjs";

const out = process.argv[2] ?? "ui-shots";
fs.mkdirSync(out, { recursive: true });

const scenes = [
  // [file, book, chapter, first verse, last verse, shape, color]
  ["card-square-paper-john316", 43, 3, 16, 16, "Square", "Paper"],
  ["card-portrait-sepia-psalm23", 19, 23, 1, 4, "Portrait", "Sepia"],
  ["card-wide-dark-romans828", 45, 8, 28, 28, "Wide", "Dark"],
  ["card-square-dark-short", 43, 11, 35, 35, "Square", "Dark"],
  ["card-wide-paper-long", 1, 1, 1, 3, "Wide", "Paper"],
];

for (const [name, book, chapter, from, to, shape, color] of scenes) {
  const ui = await launch({ motion: "reduce", width: 1100, height: 800 });
  const { page } = ui;
  await ui.open({ position: { book, chapter, scroll: 0 } });
  await page.click(`[data-verse="${from}"]`);
  if (to !== from) await page.click(`[data-verse="${to}"]`, { modifiers: ["Shift"] });
  await page.keyboard.press("i");
  await page.waitForSelector(".share canvas");
  await page.getByRole("button", { name: shape, exact: true }).click();
  await page.getByRole("button", { name: color, exact: true }).click();
  await page.waitForFunction(([s, c]) => {
    const el = document.querySelector(".share canvas");
    return el?.dataset.size === s && el?.dataset.theme === c && el?.dataset.lines;
  }, [shape.toLowerCase(), color.toLowerCase()]);
  const url = await page.evaluate(() => document.querySelector(".share canvas").toDataURL("image/png"));
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(url.split(",")[1], "base64"));
  if (name.includes("john316")) await page.screenshot({ path: path.join(out, "share-dialog.png") });
  await ui.close();
}
console.log("wrote", fs.readdirSync(out).filter((f) => f.startsWith("card-") || f.startsWith("share-")).join(", "));
