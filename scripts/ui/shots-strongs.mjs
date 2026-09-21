// Screenshots of original-language words. Usage: node scripts/ui/shots-strongs.mjs <output-dir>
import fs from "node:fs";
import path from "node:path";
import { launch } from "./harness.mjs";

const out = process.argv[2] ?? "ui-shots";
fs.mkdirSync(out, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
const word = (page, verse, text) => page.locator(`[data-verse="${verse}"] .orig-word`, { hasText: new RegExp(`^${text}$`) }).first();

for (const theme of ["paper", "dark"]) {
  const ui = await launch({ motion: "reduce", width: 900, height: 760 });
  const { page } = ui;
  await ui.open({ settings: { theme, originalWords: true }, position: { book: 43, chapter: 3, scroll: 0 } });
  await page.waitForSelector(".orig-word");
  await page.evaluate(() => window.scrollTo(0, 260));
  await shot(page, `strongs-${theme}-1-reading`);
  await word(page, 16, "loved").click();
  await page.locator(".wh-lemma").waitFor();
  await shot(page, `strongs-${theme}-2-greek-card`);
  if (theme === "paper") {
    await ui.close();
    const hb = await launch({ motion: "reduce", width: 900, height: 760 });
    await hb.open({ settings: { theme, originalWords: true }, position: { book: 19, chapter: 23, scroll: 0 } });
    await hb.page.waitForSelector(".orig-word");
    await hb.page.locator('[data-verse="1"] .kjv-word.orig-word').click();
    await hb.page.locator(".wh-lemma").waitFor();
    await shot(hb.page, "strongs-paper-3-hebrew-with-help");
    await hb.page.locator(".wh-search").click();
    await hb.page.waitForSelector(".hit");
    await shot(hb.page, "strongs-paper-4-every-verse");
    await hb.close();
  } else await ui.close();
}
console.log("wrote", fs.readdirSync(out).filter((f) => f.startsWith("strongs")).join(", "));
