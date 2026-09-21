// A stand-in for the Rust commands, so the UI can run in a plain browser (no Tauri window).
// Reads the real bible.db; marks are kept in memory. Used by scripts/ui/*.mjs for screenshots
// and UI checks, and only ever answers on localhost.
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(import.meta.dirname, "../..");
const db = new DatabaseSync(path.join(ROOT, "src-tauri/resources/bible.db"), { readOnly: true });

const bool = (n) => n === 1;
/** "h7225", "G 26" -> "H7225" / "G26"; null when the query isn't a Strong's number. */
const strongsNumber = (q) => {
  const m = /^\s*([HhGg])\s*(\d{1,5})\s*$/.exec(q);
  return m && +m[2] > 0 ? `${m[1].toUpperCase()}${+m[2]}` : null;
};
/** The verse text with each [start, end) span wrapped in the search-match markers. */
const markSpans = (text, spans) => {
  let out = "", at = 0;
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    out += `${text.slice(at, a)}\u0001${text.slice(a, b)}\u0002`;
    at = b;
  }
  return out + text.slice(at);
};
const ftsQuery = (q) => {
  const words = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.length ? words.map((w, i) => (i === words.length - 1 ? `"${w}"*` : `"${w}"`)).join(" ") : null;
};

export function createBackend({ update = null } = {}) {
  const marks = { highlights: new Map(), notes: [], bookmarks: new Set(), nextId: 1 };
  const key = (b, c, v) => `${b}:${c}:${v}`;
  const parse = (k) => k.split(":").map(Number);
  const verseText = (book, chapter, verse, end) =>
    db.prepare("SELECT text FROM verses WHERE book=? AND chapter=? AND verse BETWEEN ? AND ? ORDER BY verse")
      .all(book, chapter, verse, end ?? verse).map((r) => r.text).join(" ");

  const commands = {
    // The updater and app-version commands that Tauri's plugins call.
    "plugin:app|version": () => "0.1.0",
    "plugin:updater|check": () =>
      update ? { rid: 1, currentVersion: "0.1.0", version: update.version, date: null, body: update.notes ?? null, rawJson: {} } : null,
    list_translations: () => db.prepare("SELECT id, name FROM translations").all(),
    list_books: () => db.prepare("SELECT id, code, name, abbrev, testament, chapters FROM books ORDER BY id").all(),
    get_chapter: ({ translation, book, chapter }) =>
      db.prepare("SELECT verse, verse_end, text, kind, new_block, gap, heading, heading_kind, subscription FROM verses WHERE translation=? AND book=? AND chapter=? ORDER BY verse")
        .all(translation, book, chapter)
        .map((r) => ({
          verse: r.verse, verseEnd: r.verse_end, text: r.text, kind: r.kind, newBlock: bool(r.new_block), gap: bool(r.gap),
          heading: r.heading, headingKind: r.heading_kind, subscription: r.subscription,
        })),
    get_cross_refs: ({ translation, book, chapter, verse }) => {
      const split = (k) => [Math.floor(k / 1e6), Math.floor(k / 1e3) % 1e3, k % 1e3];
      const text = db.prepare(`SELECT text FROM verses WHERE translation = ? AND book = ? AND (chapter, verse) >= (?, ?)
        AND (chapter, verse) <= (?, ?) ORDER BY chapter, verse LIMIT 3`);
      return db.prepare("SELECT dst, dst_end, votes FROM cross_refs WHERE src = ? ORDER BY votes DESC, dst, dst_end")
        .all(book * 1e6 + chapter * 1e3 + verse).map((r) => {
          const [b, c, v] = split(r.dst), [, ec, ev] = split(r.dst_end);
          return { book: b, chapter: c, verse: v, endChapter: ec, endVerse: ev, votes: r.votes,
            text: text.all(translation, b, c, v, ec, ev).map((t) => t.text).join(" ") };
        });
    },
    get_word_tags: ({ translation, book, chapter }) => {
      const rows = db.prepare(`SELECT v.verse, t.start_at AS start, t.end_at AS end, t.num
        FROM verses v JOIN word_tags t ON t.verse_id = v.id
        WHERE v.translation = ? AND v.book = ? AND v.chapter = ? ORDER BY v.verse, t.start_at`).all(translation, book, chapter);
      const byVerse = new Map();
      for (const r of rows) {
        if (!byVerse.has(r.verse)) byVerse.set(r.verse, { verse: r.verse, tags: [] });
        byVerse.get(r.verse).tags.push({ start: r.start, end: r.end, num: r.num });
      }
      return [...byVerse.values()];
    },
    get_strongs: ({ num }) => {
      const n = strongsNumber(num);
      const e = n && db.prepare("SELECT lemma, translit, pron, def, kjv FROM strongs WHERE num = ?").get(n);
      if (!e) return null;
      const uses = db.prepare("SELECT COUNT(*) AS n FROM word_tags WHERE num = ?").get(n).n;
      const renderings = db.prepare(`SELECT lower(substr(v.text, t.start_at + 1, t.end_at - t.start_at)) AS word, COUNT(*) AS count
        FROM word_tags t JOIN verses v ON v.id = t.verse_id WHERE t.num = ? GROUP BY word ORDER BY count DESC, word LIMIT 8`).all(n);
      return { num: n, lemma: e.lemma, translit: e.translit, pron: e.pron, def: e.def, kjv: e.kjv, uses, renderings };
    },
    search: ({ query, testament, book, limit = 50, offset = 0 }) => {
      const num = strongsNumber(query);
      if (num) {
        const from = `FROM word_tags t JOIN verses v ON v.id = t.verse_id JOIN books b ON b.id = v.book
          WHERE t.num = ? AND (? IS NULL OR b.testament = ?) AND (? IS NULL OR v.book = ?)`;
        const args = [num, testament ?? null, testament ?? null, book ?? null, book ?? null];
        const total = db.prepare(`SELECT COUNT(DISTINCT v.id) AS n ${from}`).get(...args).n;
        const hits = db.prepare(`SELECT v.translation, v.book, b.name AS bookName, v.chapter, v.verse, v.text,
            group_concat(t.start_at || ',' || t.end_at, ';') AS spans ${from}
            GROUP BY v.id ORDER BY v.book, v.chapter, v.verse LIMIT ? OFFSET ?`).all(...args, limit, offset)
          .map(({ text, spans, ...h }) => ({ ...h, snippet: markSpans(text, spans.split(";").map((p) => p.split(",").map(Number))) }));
        return { total, hits };
      }
      const q = ftsQuery(query);
      if (!q) return { total: 0, hits: [] };
      const from = `FROM verses_fts JOIN verses v ON v.id = verses_fts.rowid JOIN books b ON b.id = v.book
        WHERE verses_fts MATCH ? AND (? IS NULL OR b.testament = ?) AND (? IS NULL OR v.book = ?)`;
      const args = [q, testament ?? null, testament ?? null, book ?? null, book ?? null];
      const total = db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...args).n;
      const hits = db.prepare(`SELECT v.translation, v.book, b.name AS bookName, v.chapter, v.verse,
          snippet(verses_fts, 0, char(1), char(2), '…', 32) AS snippet ${from} ORDER BY verses_fts.rank LIMIT ? OFFSET ?`)
        .all(...args, limit, offset);
      return { total, hits };
    },
    get_marks: ({ book, chapter }) => ({
      highlights: [...marks.highlights].map(([k, color]) => [...parse(k), color]).filter(([b, c]) => b === book && c === chapter)
        .map(([, , verse, color]) => ({ verse, color })).sort((a, b) => a.verse - b.verse),
      notes: marks.notes.filter((n) => n.book === book && n.chapter === chapter)
        .map(({ id, verse, verseEnd, body, updatedAt }) => ({ id, verse, verseEnd, body, updatedAt })),
      bookmarks: [...marks.bookmarks].map(parse).filter(([b, c]) => b === book && c === chapter).map(([, , v]) => v).sort((a, b) => a - b),
    }),
    set_highlight: ({ book, chapter, verses, color }) => {
      for (const v of verses) color ? marks.highlights.set(key(book, chapter, v), color) : marks.highlights.delete(key(book, chapter, v));
    },
    save_note: ({ book, chapter, verse, verseEnd, body }) => {
      const at = marks.notes.findIndex((n) => n.book === book && n.chapter === chapter && n.verse === verse);
      if (!body.trim()) { if (at >= 0) marks.notes.splice(at, 1); return null; }
      const note = { id: at >= 0 ? marks.notes[at].id : marks.nextId++, book, chapter, verse, verseEnd: verseEnd > verse ? verseEnd : null, body: body.trim(), updatedAt: "2026-09-21 12:00:00" };
      if (at >= 0) marks.notes[at] = note; else marks.notes.push(note);
      return note;
    },
    delete_note: ({ id }) => { marks.notes = marks.notes.filter((n) => n.id !== id); },
    toggle_bookmark: ({ book, chapter, verse }) => {
      const k = key(book, chapter, verse);
      return marks.bookmarks.delete(k) ? false : (marks.bookmarks.add(k), true);
    },
    get_library: () => {
      const at = "2026-09-21 12:00:00";
      const entry = (o) => ({ verseEnd: null, color: null, body: null, at, ...o, text: verseText(o.book, o.chapter, o.verse, o.verseEnd) });
      const runs = [];
      for (const [k, color] of [...marks.highlights].sort(([a], [b]) => { const [x, y] = [parse(a), parse(b)]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; })) {
        const [book, chapter, verse] = parse(k);
        const last = runs.at(-1);
        if (last && last.book === book && last.chapter === chapter && (last.verseEnd ?? last.verse) + 1 === verse && last.color === color) last.verseEnd = verse;
        else runs.push({ id: runs.length + 1, book, chapter, verse, verseEnd: null, color });
      }
      return {
        bookmarks: [...marks.bookmarks].map((k, i) => { const [book, chapter, verse] = parse(k); return entry({ id: i + 1, book, chapter, verse }); }),
        notes: marks.notes.map((n) => entry({ id: n.id, book: n.book, chapter: n.chapter, verse: n.verse, verseEnd: n.verseEnd, body: n.body })),
        highlights: runs.map(entry),
      };
    },
  };
  return commands;
}

/** Serves the commands as POST /invoke {cmd, args}. Returns the http.Server. */
export function serve(port = 9100, options = {}) {
  const commands = createBackend(options);
  const server = http.createServer((req, res) => {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" };
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { cmd, args } = JSON.parse(body);
        if (!commands[cmd]) throw new Error(`unknown command ${cmd}`);
        res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ ok: commands[cmd](args ?? {}) ?? null }));
      } catch (e) {
        res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ err: String(e.message ?? e) }));
      }
    });
  });
  server.listen(port, "127.0.0.1");
  return server;
}
