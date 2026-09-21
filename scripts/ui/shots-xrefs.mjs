// Screenshots of cross-references. Usage: node scripts/ui/shots-xrefs.mjs <output-dir>
import fs from "node:fs";
import path from "node:path";
import { launch } from "./harness.mjs";

const out = process.argv[2] ?? "ui-shots";
fs.mkdirSync(out, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });

for (const [name, width, theme] of [["wide", 1000, "paper"], ["narrow", 520, "paper"], ["dark", 1000, "dark"]]) {
  const ui = await launch({ motion: "reduce", width, height: 800 });
  const { page } = ui;
  await ui.open({ settings: { theme }, position: { book: 43, chapter: 3, scroll: 0 } });
  await page.evaluate(() => window.scrollTo(0, 420));
  await page.click('[data-verse="16"]');
  await page.waitForSelector(".selbar");
  await shot(page, `xrefs-${name}-1-toolbar`);
  await page.keyboard.press("x");
  await page.waitForSelector(".xrefs .lib-row");
  await shot(page, `xrefs-${name}-2-panel`);
  await ui.close();
}
console.log("wrote", fs.readdirSync(out).filter((f) => f.startsWith("xrefs")).join(", "));
