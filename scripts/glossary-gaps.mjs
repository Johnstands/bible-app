// Lists words that are common in the KJV but (almost) absent from the modern World English Bible and not yet
// explained in data/glossary.txt: candidates for archaic-word help. Old verb endings (-eth, -est) are left out.
// Needs the WEB source: npm run data:fetch -- web
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(import.meta.dirname, "..");
const webFile = path.join(ROOT, "data/sources/eng-web/eng-web_usfx.xml");
if (!fs.existsSync(webFile)) throw new Error("Missing the WEB source: run `npm run data:fetch -- web` first");

const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
const db = new DatabaseSync(path.join(ROOT, "src-tauri/resources/bible.db"), { readOnly: true });

const kjv = new Map(); // word -> [total, written lowercase]
for (const { text } of db.prepare("SELECT text FROM verses").all()) {
  for (const w of text.match(WORD) ?? []) {
    const k = w.toLowerCase();
    const [n, low] = kjv.get(k) ?? [0, 0];
    kjv.set(k, [n + 1, low + (w[0] === w[0].toLowerCase() ? 1 : 0)]);
  }
}
const web = new Map();
const xml = fs.readFileSync(webFile, "utf8").replace(/<f .*?<\/f>|<x .*?<\/x>/gs, " ").replace(/<[^>]+>/g, " ");
for (const w of xml.match(WORD) ?? []) web.set(w.toLowerCase(), (web.get(w.toLowerCase()) ?? 0) + 1);

const explained = new Set();
for (const line of fs.readFileSync(path.join(ROOT, "data/glossary.txt"), "utf8").split("\n")) {
  if (!line.trim() || line.startsWith("#")) continue;
  for (const f of line.split("|")[0].split(",")) for (const part of f.trim().split(/\s+/)) explained.add(part);
}

const min = +(process.argv[2] ?? 4);
const gaps = [...kjv]
  .filter(([w, [n, low]]) => n >= min && low >= 0.8 * n && (web.get(w) ?? 0) <= 1 && !explained.has(w) && !/(eth|est)$/.test(w))
  .sort((a, b) => b[1][0] - a[1][0]);
console.log(`${gaps.length} unexplained candidates with at least ${min} uses (most frequent first):`);
console.log(gaps.map(([w, [n]]) => `${w}:${n}`).join(" "));
