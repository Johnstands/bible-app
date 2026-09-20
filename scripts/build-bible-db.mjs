// Builds src-tauri/resources/bible.db (verses + FTS5 index) from the USFX sources.
// Usage: npm run data:fetch && npm run data:build
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "src-tauri/resources/bible.db");

const TRANSLATIONS = [
  { id: "KJV", name: "King James Version", source: "eng-kjv2006" },
  { id: "WEB", name: "World English Bible", source: "eng-web" },
];

// [usfx code, name, abbreviation, chapter count]; array index + 1 is the book id.
const BOOKS = [
  ["GEN", "Genesis", "Gen", 50], ["EXO", "Exodus", "Exod", 40], ["LEV", "Leviticus", "Lev", 27],
  ["NUM", "Numbers", "Num", 36], ["DEU", "Deuteronomy", "Deut", 34], ["JOS", "Joshua", "Josh", 24],
  ["JDG", "Judges", "Judg", 21], ["RUT", "Ruth", "Ruth", 4], ["1SA", "1 Samuel", "1 Sam", 31],
  ["2SA", "2 Samuel", "2 Sam", 24], ["1KI", "1 Kings", "1 Kgs", 22], ["2KI", "2 Kings", "2 Kgs", 25],
  ["1CH", "1 Chronicles", "1 Chr", 29], ["2CH", "2 Chronicles", "2 Chr", 36], ["EZR", "Ezra", "Ezra", 10],
  ["NEH", "Nehemiah", "Neh", 13], ["EST", "Esther", "Esth", 10], ["JOB", "Job", "Job", 42],
  ["PSA", "Psalms", "Ps", 150], ["PRO", "Proverbs", "Prov", 31], ["ECC", "Ecclesiastes", "Eccl", 12],
  ["SNG", "Song of Solomon", "Song", 8], ["ISA", "Isaiah", "Isa", 66], ["JER", "Jeremiah", "Jer", 52],
  ["LAM", "Lamentations", "Lam", 5], ["EZK", "Ezekiel", "Ezek", 48], ["DAN", "Daniel", "Dan", 12],
  ["HOS", "Hosea", "Hos", 14], ["JOL", "Joel", "Joel", 3], ["AMO", "Amos", "Amos", 9],
  ["OBA", "Obadiah", "Obad", 1], ["JON", "Jonah", "Jonah", 4], ["MIC", "Micah", "Mic", 7],
  ["NAM", "Nahum", "Nah", 3], ["HAB", "Habakkuk", "Hab", 3], ["ZEP", "Zephaniah", "Zeph", 3],
  ["HAG", "Haggai", "Hag", 2], ["ZEC", "Zechariah", "Zech", 14], ["MAL", "Malachi", "Mal", 4],
  ["MAT", "Matthew", "Matt", 28], ["MRK", "Mark", "Mark", 16], ["LUK", "Luke", "Luke", 24],
  ["JHN", "John", "John", 21], ["ACT", "Acts", "Acts", 28], ["ROM", "Romans", "Rom", 16],
  ["1CO", "1 Corinthians", "1 Cor", 16], ["2CO", "2 Corinthians", "2 Cor", 13], ["GAL", "Galatians", "Gal", 6],
  ["EPH", "Ephesians", "Eph", 6], ["PHP", "Philippians", "Phil", 4], ["COL", "Colossians", "Col", 4],
  ["1TH", "1 Thessalonians", "1 Thess", 5], ["2TH", "2 Thessalonians", "2 Thess", 3], ["1TI", "1 Timothy", "1 Tim", 6],
  ["2TI", "2 Timothy", "2 Tim", 4], ["TIT", "Titus", "Titus", 3], ["PHM", "Philemon", "Phlm", 1],
  ["HEB", "Hebrews", "Heb", 13], ["JAS", "James", "Jas", 5], ["1PE", "1 Peter", "1 Pet", 5],
  ["2PE", "2 Peter", "2 Pet", 3], ["1JN", "1 John", "1 John", 5], ["2JN", "2 John", "2 John", 1],
  ["3JN", "3 John", "3 John", 1], ["JUD", "Jude", "Jude", 1], ["REV", "Revelation", "Rev", 22],
];
const BOOK_ID = new Map(BOOKS.map(([code], i) => [code, i + 1]));

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (m, dec, hex, name) =>
    dec ? String.fromCodePoint(+dec) : hex ? String.fromCodePoint(parseInt(hex, 16)) : (ENTITIES[name] ?? m),
  );

// Elements whose content is never verse text (notes, cross-references, headings).
const SKIP = new Set(["f", "x", "fig", "s", "r", "ms", "mr", "sp", "cl", "cp", "rq"]);
// Elements that break the line, so adjacent words must not be glued together.
const BREAK = new Set(["p", "q", "b", "l", "li", "d"]);

/** Parses one USFX file into [{book, chapter, verse, verseEnd, text}] for the 66 canonical books. */
function parseUsfx(file) {
  const xml = fs.readFileSync(file, "utf8");
  const verses = [];
  let book = null, chapter = 0, cur = null, skipDepth = 0;
  const stack = [];

  const finish = () => {
    if (!cur) return;
    cur.text = cur.text.replace(/¶/g, "").replace(/\s+/g, " ").trim();
    verses.push(cur);
    cur = null;
  };

  for (const m of xml.matchAll(/<(\/?)([A-Za-z0-9]+)([^>]*?)(\/?)>|([^<]+)/g)) {
    const [, closing, name, attrs, selfClose, text] = m;
    if (text !== undefined) {
      if (cur && !skipDepth) cur.text += decode(text);
      continue;
    }
    if (closing) {
      stack.pop();
      if (SKIP.has(name) && skipDepth) skipDepth--;
      if (BREAK.has(name) && cur && !skipDepth) cur.text += " ";
      continue;
    }
    if (name === "book") {
      finish();
      book = BOOK_ID.get(/id="([^"]+)"/.exec(attrs)?.[1]) ?? null;
      chapter = 0;
    } else if (name === "c") {
      finish();
      chapter = +/id="(\d+)"/.exec(attrs)[1];
    } else if (name === "v") {
      finish();
      const [, a, b] = /id="(\d+)(?:-(\d+))?"/.exec(attrs);
      if (book && chapter) cur = { book, chapter, verse: +a, verseEnd: b ? +b : null, text: "" };
    } else if (name === "ve") {
      finish();
    }
    if (!selfClose) {
      stack.push(name);
      if (SKIP.has(name)) skipDepth++;
    }
    if (BREAK.has(name) && cur && !skipDepth) cur.text += " ";
  }
  finish();
  return verses;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.rmSync(OUT, { force: true });
const db = new DatabaseSync(OUT);
db.exec(`
  PRAGMA journal_mode = OFF;
  CREATE TABLE translations (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE books (
    id INTEGER PRIMARY KEY,           -- 1..66 in canonical order
    code TEXT NOT NULL UNIQUE,        -- USFX code, e.g. JHN
    name TEXT NOT NULL,
    abbrev TEXT NOT NULL,
    testament TEXT NOT NULL CHECK (testament IN ('OT', 'NT')),
    chapters INTEGER NOT NULL
  );
  CREATE TABLE verses (
    id INTEGER PRIMARY KEY,
    translation TEXT NOT NULL REFERENCES translations(id),
    book INTEGER NOT NULL REFERENCES books(id),
    chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL,
    verse_end INTEGER,                -- set when the source merges several verses (e.g. 15-16)
    text TEXT NOT NULL,
    UNIQUE (translation, book, chapter, verse)
  );
  CREATE VIRTUAL TABLE verses_fts USING fts5(
    text, content = 'verses', content_rowid = 'id', tokenize = 'porter unicode61 remove_diacritics 2'
  );
`);

const insBook = db.prepare("INSERT INTO books VALUES (?, ?, ?, ?, ?, ?)");
BOOKS.forEach(([code, name, abbrev, chapters], i) =>
  insBook.run(i + 1, code, name, abbrev, i < 39 ? "OT" : "NT", chapters));

const insTr = db.prepare("INSERT INTO translations VALUES (?, ?)");
const insVerse = db.prepare(
  "INSERT INTO verses (translation, book, chapter, verse, verse_end, text) VALUES (?, ?, ?, ?, ?, ?)");

for (const t of TRANSLATIONS) {
  const file = path.join(ROOT, "data/sources", t.source, `${t.source}_usfx.xml`);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file} - run npm run data:fetch first`);
  const parsed = parseUsfx(file);
  // Some translations leave a verse number in place but omit the text (e.g. Acts 8:37 in the WEB).
  const verses = parsed.filter((v) => v.text);
  const omitted = parsed.filter((v) => !v.text).map((v) => `${BOOKS[v.book - 1][0]} ${v.chapter}:${v.verse}`);
  insTr.run(t.id, t.name);
  db.exec("BEGIN");
  for (const v of verses) insVerse.run(t.id, v.book, v.chapter, v.verse, v.verseEnd, v.text);
  db.exec("COMMIT");
  console.log(`${t.id}: ${verses.length} verses` + (omitted.length ? ` (omitted, no text: ${omitted.join(", ")})` : ""));
}

db.exec("INSERT INTO verses_fts(rowid, text) SELECT id, text FROM verses");
db.exec("INSERT INTO verses_fts(verses_fts) VALUES ('optimize')");
db.exec("CREATE INDEX verses_ref ON verses (book, chapter, verse)");

// Validation: chapter counts per book, empty verses, and KJV/WEB numbering differences.
let problems = 0;
const bad = (msg) => { problems++; console.error("PROBLEM:", msg); };
for (const t of TRANSLATIONS) {
  const rows = db.prepare(
    "SELECT b.code, b.chapters AS want, MAX(v.chapter) AS got, COUNT(DISTINCT v.chapter) AS n " +
    "FROM books b LEFT JOIN verses v ON v.book = b.id AND v.translation = ? GROUP BY b.id").all(t.id);
  for (const r of rows) if (r.got !== r.want || r.n !== r.want) bad(`${t.id} ${r.code}: chapters ${r.n}/${r.got}, expected ${r.want}`);
}
const diffs = db.prepare(`
  SELECT b.code, k.chapter, k.n AS kjv, w.n AS web FROM
    (SELECT book, chapter, COUNT(*) n FROM verses WHERE translation = 'KJV' GROUP BY book, chapter) k
    JOIN (SELECT book, chapter, MAX(COALESCE(verse_end, verse)) n FROM verses WHERE translation = 'WEB' GROUP BY book, chapter) w
      USING (book, chapter)
    JOIN books b ON b.id = k.book
  WHERE k.n != w.n`).all();
console.log(`KJV/WEB chapters with different verse counts: ${diffs.length}`);
for (const d of diffs) console.log(`  ${d.code} ${d.chapter}: KJV ${d.kjv}, WEB ${d.web}`);

db.exec("VACUUM");
db.close();
console.log(`Wrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
if (problems) process.exit(1);
