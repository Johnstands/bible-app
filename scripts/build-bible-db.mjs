// Builds src-tauri/resources/bible.db (verses + FTS5 index) from the USFX sources.
// Usage: npm run data:fetch && npm run data:build
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "src-tauri/resources/bible.db");

// `verses` is the known verse count, used as an import sanity check.
const TRANSLATIONS = [{ id: "KJV", name: "King James Version", source: "eng-kjv2006", verses: 31102 }];

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

/**
 * Loads the two Strong's dictionaries (JSON edition by Open Scriptures, CC BY-SA, of James Strong's 1890 and
 * 1894 works) into rows: {num, lemma, translit, pron, def, kjv}. Strong's entries read "origin; meaning", and in
 * the Greek file the first part of the meaning sits in the origin, so the two are joined into one `def`.
 */
function loadStrongs() {
  const rows = [];
  for (const file of ["hebrew/strongs-hebrew-dictionary.js", "greek/strongs-greek-dictionary.js"]) {
    const src = path.join(ROOT, "data/sources/strongs", path.basename(file));
    if (!fs.existsSync(src)) throw new Error(`Missing ${src} - run npm run data:fetch first`);
    const js = fs.readFileSync(src, "utf8");
    // The file is `var name = {...}; module.exports = name;`
    const json = js.slice(js.indexOf("{", js.indexOf("=")), js.lastIndexOf("}") + 1);
    for (const [num, e] of Object.entries(JSON.parse(json))) {
      const def = `${e.derivation ?? ""} ${e.strongs_def ?? ""}`.replace(/\s+/g, " ").trim();
      rows.push({
        num, lemma: e.lemma ?? "", translit: e.xlit ?? e.translit ?? "", pron: e.pron || null,
        def, kjv: (e.kjv_def ?? "").replace(/\s+/g, " ").trim() || null,
      });
    }
  }
  return rows;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (m, dec, hex, name) =>
    dec ? String.fromCodePoint(+dec) : hex ? String.fromCodePoint(parseInt(hex, 16)) : (ENTITIES[name] ?? m),
  );

// Elements whose content is never verse text (notes, cross-references, headings).
const SKIP = new Set(["f", "x", "fig", "s", "r", "ms", "mr", "sp", "cl", "cp", "rq"]);
// Elements that break the line, so adjacent words must not be glued together.
const BREAK = new Set(["p", "q", "b", "l", "li", "d"]);
// Headings between verses: <d> is a Psalm title, <s> a section heading.
const HEADING = { d: "title", s: "section" };

const clean = (s) => s.replace(/¶/g, "").replace(/\s+/g, " ").trim();

// The source tags words with Strong's numbers: <w s="H7225">beginning</w>. While parsing, private-use
// markers stand in for the tag boundaries so that they survive whitespace clean-up; `splitTags` then
// turns them into offsets into the final text.
const TAG_START = "\uE000";
const TAG_END = "\uE001";

/** "G0025" and "G25" are the same word; the dictionary uses the short form. */
const strongsNumber = (s) => s.replace(/^([HG])0+(?=\d)/, "$1");

/**
 * Removes the markers from `raw` and returns the plain text with `tags`: [start, end, number] in UTF-16
 * units (what JavaScript slices by), trimmed of any space just inside the tag. A tag with no text is dropped.
 */
function splitTags(raw, nums) {
  let text = "", open = -1, n = 0;
  const tags = [];
  for (const ch of raw) {
    if (ch === TAG_START) open = text.length;
    else if (ch === TAG_END) {
      const num = nums[n++];
      if (open >= 0 && num) {
        let [a, b] = [open, text.length];
        while (a < b && text[a] === " ") a++;
        while (b > a && text[b - 1] === " ") b--;
        if (b > a) tags.push([a, b, num]);
      }
      open = -1;
    } else text += ch;
  }
  return { text, tags };
}

/**
 * Parses one USFX file into verses for the 66 canonical books:
 * {book, chapter, verse, verseEnd, text, tags, kind, newBlock, gap, heading, headingKind, subscription}.
 * `kind` is the enclosing block ('p' paragraph or 'q' poetry line), `newBlock` is set when the verse
 * opens that block, `gap` when a stanza break precedes it. A heading applies to the verse that follows
 * it, except a heading at the very end of a book (an epistle's subscription), which is attached to
 * the last verse.
 */
function parseUsfx(file) {
  const xml = fs.readFileSync(file, "utf8");
  const verses = [];
  let book = null, chapter = 0, cur = null, skipDepth = 0;
  let kind = "p", inBlock = false, blockOpened = false, gap = false, heading = null, pending = null;

  const finish = () => {
    if (!cur) return;
    Object.assign(cur, splitTags(clean(cur.text), cur.nums));
    delete cur.nums;
    verses.push(cur);
    cur = null;
  };

  for (const m of xml.matchAll(/<(\/?)([A-Za-z0-9]+)([^>]*?)(\/?)>|([^<]+)/g)) {
    const [, closing, name, attrs, selfClose, text] = m;
    if (text !== undefined) {
      if (skipDepth) continue;
      if (cur) cur.text += decode(text);
      else if (heading) heading.text += decode(text);
      continue;
    }
    if (closing) {
      if (name === "w" && cur && !skipDepth) cur.text += TAG_END;
      if (heading && name === heading.tag) {
        pending = { text: clean(heading.text), kind: HEADING[name] };
        heading = null;
        continue;
      }
      if (SKIP.has(name) && skipDepth) skipDepth--;
      if (name === "p" || name === "q") inBlock = false;
      if (name === "book") {
        finish();
        if (pending && verses.length) verses[verses.length - 1].subscription = pending.text;
        pending = null;
      }
      if (BREAK.has(name) && cur && !skipDepth) cur.text += " ";
      continue;
    }
    if (name === "w" && cur && !skipDepth) {
      const num = /\bs="([^"]+)"/.exec(attrs)?.[1];
      cur.nums.push(num ? strongsNumber(num) : null);
      cur.text += TAG_START;
      continue;
    }
    if (name === "book") {
      finish();
      book = BOOK_ID.get(/id="([^"]+)"/.exec(attrs)?.[1]) ?? null;
      chapter = 0;
      inBlock = false;
      gap = false;
      pending = null;
    } else if (name === "c") {
      finish();
      chapter = +/id="(\d+)"/.exec(attrs)[1];
      inBlock = false;
    } else if ((name === "p" && !/style="m/.test(attrs)) || name === "q") {
      finish();
      kind = name;
      inBlock = true;
      blockOpened = true;
    } else if (name === "b") {
      gap = true;
    } else if (name === "v") {
      finish();
      const [, a, b] = /id="(\d+)(?:-(\d+))?"/.exec(attrs);
      if (book && chapter) {
        cur = {
          book, chapter, verse: +a, verseEnd: b ? +b : null, text: "",
          kind: inBlock ? kind : "p", newBlock: blockOpened || !inBlock, gap,
          heading: pending?.text ?? null, headingKind: pending?.kind ?? null, subscription: null, nums: [],
        };
      }
      blockOpened = false;
      gap = false;
      pending = null;
    } else if (name === "ve") {
      finish();
    } else if (name in HEADING && !cur) {
      heading = { tag: name, text: "" };
      continue; // its content is captured, not skipped
    }
    if (!selfClose && SKIP.has(name)) skipDepth++;
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
    kind TEXT NOT NULL CHECK (kind IN ('p', 'q')),  -- enclosing block: paragraph or poetry line
    new_block INTEGER NOT NULL,       -- 1 when this verse opens a new paragraph or poetry line
    gap INTEGER NOT NULL,             -- 1 when a stanza break (blank line) precedes it
    heading TEXT,                     -- heading shown before the verse (Psalm title, Hebrew letter)
    heading_kind TEXT CHECK (heading_kind IN ('title', 'section')),
    subscription TEXT,                -- closing note after the verse (an epistle's subscription)
    UNIQUE (translation, book, chapter, verse)
  );
  -- Strong's numbers on words in the KJV: verses.text[start_at, end_at) (UTF-16 units) is the tagged phrase.
  CREATE TABLE word_tags (
    verse_id INTEGER NOT NULL REFERENCES verses(id),
    start_at INTEGER NOT NULL,
    end_at INTEGER NOT NULL,
    num TEXT NOT NULL,                -- H7225 or G25, no zero padding
    PRIMARY KEY (verse_id, start_at)
  ) WITHOUT ROWID;
  CREATE TABLE strongs (
    num TEXT PRIMARY KEY,
    lemma TEXT NOT NULL,              -- the word in Hebrew or Greek letters
    translit TEXT NOT NULL,
    pron TEXT,                        -- Hebrew only
    def TEXT NOT NULL,                -- Strong's entry: origin, then meaning
    kjv TEXT                          -- Strong's list of the KJV renderings
  ) WITHOUT ROWID;
  CREATE VIRTUAL TABLE verses_fts USING fts5(
    text, content = 'verses', content_rowid = 'id', tokenize = 'porter unicode61 remove_diacritics 2'
  );
`);

const insBook = db.prepare("INSERT INTO books VALUES (?, ?, ?, ?, ?, ?)");
BOOKS.forEach(([code, name, abbrev, chapters], i) =>
  insBook.run(i + 1, code, name, abbrev, i < 39 ? "OT" : "NT", chapters));

const insTr = db.prepare("INSERT INTO translations VALUES (?, ?)");
const insTag = db.prepare("INSERT INTO word_tags (verse_id, start_at, end_at, num) VALUES (?, ?, ?, ?)");
const insVerse = db.prepare(
  "INSERT INTO verses (translation, book, chapter, verse, verse_end, text, kind, new_block, gap, heading, heading_kind, subscription) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");

for (const t of TRANSLATIONS) {
  const file = path.join(ROOT, "data/sources", t.source, `${t.source}_usfx.xml`);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file} - run npm run data:fetch first`);
  const parsed = parseUsfx(file);
  // Some translations leave a verse number in place but omit the text; skip those rows.
  const verses = parsed.filter((v) => v.text);
  const omitted = parsed.filter((v) => !v.text).map((v) => `${BOOKS[v.book - 1][0]} ${v.chapter}:${v.verse}`);
  insTr.run(t.id, t.name);
  db.exec("BEGIN");
  for (const v of verses) {
    const { lastInsertRowid: id } = insVerse.run(t.id, v.book, v.chapter, v.verse, v.verseEnd, v.text, v.kind,
      +v.newBlock, +v.gap, v.heading, v.headingKind, v.subscription);
    for (const [a, b, num] of v.tags) insTag.run(id, a, b, num);
  }
  db.exec("COMMIT");
  console.log(`${t.id}: ${verses.length} verses` + (omitted.length ? ` (omitted, no text: ${omitted.join(", ")})` : ""));
}

const strongs = loadStrongs();
const insStrongs = db.prepare("INSERT INTO strongs VALUES (?, ?, ?, ?, ?, ?)");
db.exec("BEGIN");
for (const r of strongs) insStrongs.run(r.num, r.lemma, r.translit, r.pron, r.def, r.kjv);
db.exec("COMMIT");
db.exec("CREATE INDEX word_tags_num ON word_tags (num, verse_id)");
console.log(`Strong's: ${strongs.length} dictionary entries, ${db.prepare("SELECT COUNT(*) AS n FROM word_tags").get().n} tagged phrases`);

db.exec("INSERT INTO verses_fts(rowid, text) SELECT id, text FROM verses");
db.exec("INSERT INTO verses_fts(verses_fts) VALUES ('optimize')");
db.exec("CREATE INDEX verses_ref ON verses (book, chapter, verse)");

// Validation: verse total and chapter counts per book.
let problems = 0;
const bad = (msg) => { problems++; console.error("PROBLEM:", msg); };
for (const t of TRANSLATIONS) {
  const total = db.prepare("SELECT COUNT(*) AS n FROM verses WHERE translation = ?").get(t.id).n;
  if (total !== t.verses) bad(`${t.id}: ${total} verses, expected ${t.verses}`);
  const rows = db.prepare(
    "SELECT b.code, b.chapters AS want, MAX(v.chapter) AS got, COUNT(DISTINCT v.chapter) AS n " +
    "FROM books b LEFT JOIN verses v ON v.book = b.id AND v.translation = ? GROUP BY b.id").all(t.id);
  for (const r of rows) if (r.got !== r.want || r.n !== r.want) bad(`${t.id} ${r.code}: chapters ${r.n}/${r.got}, expected ${r.want}`);
}

// Strong's: offsets must land on real text, and every tagged number should be in the dictionary.
const tagRows = db.prepare("SELECT t.num, t.start_at, t.end_at, v.text FROM word_tags t JOIN verses v ON v.id = t.verse_id").all();
let empty = 0;
for (const r of tagRows) if (!r.text.slice(r.start_at, r.end_at).trim()) empty++;
if (empty) bad(`${empty} word tags point at no text`);
const astral = db.prepare("SELECT COUNT(*) AS n FROM verses").get().n && db.prepare("SELECT text FROM verses").all().filter((v) => /[\u{10000}-\u{10FFFF}]/u.test(v.text)).length;
if (astral) bad(`${astral} verses have characters outside the BMP; SQL substr and JavaScript offsets would disagree`);
const known = new Set(strongs.map((r) => r.num));
const unknown = [...new Set(tagRows.map((r) => r.num).filter((n) => !known.has(n)))];
if (unknown.length) console.log(`Note: ${unknown.length} tagged numbers are not in the dictionary: ${unknown.slice(0, 12).join(", ")}${unknown.length > 12 ? ", …" : ""}`);
if (tagRows.length < 300000) bad(`only ${tagRows.length} word tags; the source has about 349,000`);

db.exec("VACUUM");
db.close();
console.log(`Wrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
if (problems) process.exit(1);
