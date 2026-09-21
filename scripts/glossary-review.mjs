// Writes docs/glossary-review.md: every entry in data/glossary.txt with a checkbox, its meaning, and a real verse
// where it applies, so the definitions can be read in context. Regenerate after editing the glossary.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(import.meta.dirname, "..");
const db = new DatabaseSync(path.join(ROOT, "src-tauri/resources/bible.db"), { readOnly: true });
const bookByName = new Map(db.prepare("SELECT id, name FROM books").all().map((b) => [b.name, b.id]));
const nameById = new Map([...bookByName].map(([n, id]) => [id, n]));
const verses = db.prepare("SELECT book, chapter, verse, text FROM verses WHERE translation = 'KJV' ORDER BY id").all();

const entries = fs.readFileSync(path.join(ROOT, "data/glossary.txt"), "utf8").split("\n")
  .filter((l) => l.trim() && !l.startsWith("#"))
  .map((line) => {
    const [forms, kind, meaning, today, scope] = line.split("|").map((s) => s.trim());
    const except = !!scope?.startsWith("@!");
    return {
      forms: forms.split(",").map((f) => f.trim()), kind, meaning, today: (today ?? "").replace(/^today:\s*/i, ""),
      refs: scope ? scope.slice(except ? 2 : 1).split(";").map((r) => r.trim()) : null, except,
    };
  });

const formRx = (forms) =>
  new RegExp(`(?<![A-Za-z-])(?:${forms.map((f) => f.replace(/ /g, "\\s+")).sort((a, b) => b.length - a.length).join("|")})(?![A-Za-z-])`, "i");
const refOf = (v) => `${nameById.get(v.book)} ${v.chapter}:${v.verse}`;
const excerpt = (text, m) => {
  const from = Math.max(0, m.index - 48), to = Math.min(text.length, m.index + m[0].length + 48);
  return `${from > 0 ? "…" : ""}${text.slice(from, m.index)}**${m[0]}**${text.slice(m.index + m[0].length, to)}${to < text.length ? "…" : ""}`;
};

const examples = (e) => {
  const rx = formRx(e.forms);
  let pool;
  if (e.refs && !e.except) {
    const want = new Set(e.refs);
    pool = verses.filter((v) => want.has(refOf(v)));
  } else {
    const skip = e.except ? new Set(e.refs) : new Set();
    pool = verses.filter((v) => !skip.has(refOf(v)));
  }
  const hits = pool.filter((v) => rx.test(v.text));
  // A spread across the Bible shows how the word is used, not just where it first appears.
  const take = e.refs && !e.except ? 3 : 2;
  const step = Math.max(1, Math.floor(hits.length / take));
  return { total: hits.length, shown: Array.from({ length: Math.min(take, hits.length) }, (_, i) => hits[i * step]) };
};

const KINDS = [
  ["changed", "Changed meanings", "Familiar-looking words that meant something else. These matter most: a reader has no reason to suspect them."],
  ["archaic", "Archaic words and phrases", "Words and forms no longer in ordinary use."],
  ["unit", "Old measures, weights and coins", ""],
];
const out = [
  "# KJV word help: definitions to review",
  "",
  "Generated from `data/glossary.txt` by `npm run glossary:review`; not committed. For each entry, tick the box if the",
  "definition is right in the verse shown, or note what to change. Bold marks the word the reader sees underlined.",
  "An entry limited to certain verses shows how many; the sample is drawn from those verses only.",
  "",
];
for (const [kind, title, blurb] of KINDS) {
  const list = entries.filter((e) => e.kind === kind).sort((a, b) => a.forms[0].localeCompare(b.forms[0]));
  out.push(`## ${title} (${list.length})`, "", ...(blurb ? [blurb, ""] : []));
  for (const e of list) {
    const { total, shown } = examples(e);
    const n = (k) => `${k} verse${k === 1 ? "" : "s"}`;
    const scope = e.refs ? (e.except ? ` *(everywhere except ${n(e.refs.length)})*` : ` *(only ${n(e.refs.length)})*`) : ` *(${n(total)})*`;
    out.push(`- [ ] **${e.forms.join(", ")}**${scope}: ${e.meaning}${e.today ? ` — *today:* ${e.today}` : ""}`);
    for (const v of shown) out.push(`  - ${refOf(v)}: ${excerpt(v.text, formRx(e.forms).exec(v.text))}`);
  }
  out.push("");
}
fs.writeFileSync(path.join(ROOT, "docs/glossary-review.md"), out.join("\n"));
console.log(`Wrote docs/glossary-review.md: ${entries.length} entries`);
