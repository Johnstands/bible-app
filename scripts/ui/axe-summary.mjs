// Runs axe-core on every main screen in each theme and prints the distinct findings. Needs a Vite server: npm run ui:dev
import { createRequire } from "node:module";
import { launch } from "./harness.mjs";

const axe = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const screens = {
  reader: async () => {},
  selected: async (p) => { await p.click('[data-verse="16"]'); await p.waitForSelector(".selbar"); },
  wordcard: async (p) => { await p.keyboard.press("w"); await p.waitForSelector(".wordhelp"); },
  goto: async (p) => { await p.keyboard.press("/"); await p.waitForSelector(".goto-input"); },
  search: async (p) => { await p.keyboard.press("Control+f"); await p.fill(".goto-input", "shepherd"); await p.waitForSelector(".hit"); },
  library: async (p) => { await p.keyboard.press("Control+l"); await p.waitForSelector(".library"); },
  settings: async (p) => { await p.keyboard.press("Control+,"); await p.waitForSelector(".settings"); },
  note: async (p) => { await p.click('[data-verse="16"]'); await p.click(".selbar-action >> text=Note"); await p.waitForSelector(".note-body"); },
};
const found = new Map();
for (const theme of ["paper", "sepia", "dark"]) {
  for (const [name, arrive] of Object.entries(screens)) {
    const ui = await launch({ motion: "reduce" });
    await ui.open({ position: { book: 43, chapter: 3, scroll: 0 }, settings: { theme } });
    await arrive(ui.page);
    await ui.page.addScriptTag({ path: axe });
    const results = await ui.page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ t: n.target.join(" "), s: (n.any[0] ?? n.all[0] ?? n.none[0])?.message ?? "" })) }));
    });
    for (const v of results) for (const n of v.nodes) {
      const key = `${v.impact.padEnd(8)} ${v.id} @ ${n.t}`;
      const e = found.get(key) ?? { msg: n.s, on: new Set() };
      e.on.add(`${name}/${theme}`);
      found.set(key, e);
    }
    await ui.close();
  }
}
for (const [key, e] of [...found].sort()) console.log(`${key}\n    ${e.msg}\n    on: ${[...e.on].slice(0, 6).join(", ")}${e.on.size > 6 ? ` (+${e.on.size - 6})` : ""}`);
console.log(found.size ? `\n${found.size} distinct findings` : "no findings");
