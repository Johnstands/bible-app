// Screenshots of the settings panel and the text features. Usage: node scripts/ui/shots-settings.mjs <output-dir>
import fs from "node:fs";
import path from "node:path";
import { launch } from "./harness.mjs";

const out = process.argv[2] ?? "ui-shots";
fs.mkdirSync(out, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
const john3 = { book: 43, chapter: 3, scroll: 0 };

// 1. The panel, with a change applied live.
{
  const ui = await launch({ motion: "reduce" });
  await ui.open({ position: john3 });
  await ui.page.click('button[aria-label="Settings"]');
  await ui.page.waitForSelector(".settings");
  await ui.page.click("text=Literata");
  await ui.page.click('button[aria-label="Larger text"]');
  await ui.page.click('button[aria-label="Larger text"]');
  await shot(ui.page, "4-settings");
  console.log("after Literata + 2 steps:", await ui.page.evaluate(() => JSON.parse(localStorage.getItem("settings"))));
  await ui.close();
}

// 2. Verse by verse with pilcrows, in paragraph-heavy John 3.
{
  const ui = await launch({ motion: "reduce" });
  await ui.open({ position: john3, settings: { verseByVerse: true, pilcrows: true } });
  await shot(ui.page, "5-verse-by-verse");
  await ui.close();
}
{
  const ui = await launch({ motion: "reduce" });
  await ui.open({ position: { book: 43, chapter: 3, scroll: 500 }, settings: { pilcrows: true } });
  await shot(ui.page, "6-pilcrows-flowing");
  await ui.close();
}

// 3. Dark theme, another face, larger text, on a Psalm.
{
  const ui = await launch({ motion: "reduce" });
  await ui.open({ position: { book: 19, chapter: 23, scroll: 0 }, settings: { theme: "dark", fontFamily: "source-serif", fontScale: 1.25 } });
  await shot(ui.page, "7-dark-source-serif");
  await ui.close();
}
