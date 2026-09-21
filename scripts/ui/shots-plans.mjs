// Screenshots of reading plans. Usage: node scripts/ui/shots-plans.mjs <output-dir>
import fs from "node:fs";
import path from "node:path";
import { launch } from "./harness.mjs";

const out = process.argv[2] ?? "ui-shots";
fs.mkdirSync(out, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
const plan = (page, id) => page.locator(`.plan[data-plan="${id}"]`);

for (const theme of ["paper", "dark"]) {
  const ui = await launch({ motion: "reduce", width: 1000, height: 860 });
  const { page } = ui;
  await ui.open({ settings: { theme }, position: { book: 40, chapter: 1, scroll: 0 } });
  await page.getByRole("button", { name: "Plans", exact: true }).click();
  await page.waitForSelector(".plans");
  await shot(page, `plans-${theme}-1-choose`);
  await plan(page, "gospels-30").getByRole("button", { name: "Start" }).click();
  await page.waitForSelector(".plan-bar");
  await plan(page, "gospels-30").getByRole("button", { name: "Mark day done" }).click();
  await page.waitForFunction(() => document.querySelector(".plan-count")?.textContent === "1 of 30 days");
  await plan(page, "psalms-proverbs").getByRole("button", { name: "Start" }).click();
  await page.waitForSelector('.plan[data-plan="psalms-proverbs"] .plan-bar');
  await plan(page, "gospels-30").getByRole("button", { name: "All the days" }).click();
  await shot(page, `plans-${theme}-2-under-way`);
  await ui.close();
}
// The strip under a chapter that is part of today's reading.
const ui = await launch({ motion: "reduce", width: 1000, height: 860 });
await ui.open({ settings: { theme: "paper" }, position: { book: 19, chapter: 1, scroll: 0 } });
await ui.page.getByRole("button", { name: "Plans", exact: true }).click();
await plan(ui.page, "psalms-proverbs").getByRole("button", { name: "Start" }).click();
await ui.page.waitForSelector(".plan-bar");
await ui.page.keyboard.press("Escape");
await ui.page.locator(".plan-chip").waitFor();
await ui.page.locator(".plan-chip").scrollIntoViewIfNeeded();
await ui.page.evaluate(() => window.scrollBy(0, 250));
await shot(ui.page, "plans-paper-3-strip");
await ui.close();
console.log("wrote", fs.readdirSync(out).filter((f) => f.startsWith("plans-")).join(", "));
