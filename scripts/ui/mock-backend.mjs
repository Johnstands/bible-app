// A stand-in for the Rust commands, so the UI can run in a plain browser (no Tauri window).
// Reads the real bible.db; marks are kept in memory. Used by scripts/ui/*.mjs for screenshots
// and UI checks, and only ever answers on localhost.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { makePdf } from "./test-pdf.mjs";

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
  const plans = new Map(); // started reading plans: id -> { plan, startedOn, done: Map(day -> date) }
  const marks = { highlights: new Map(), notes: [], bookmarks: new Set(), nextId: 1 };
  // Presentation mode: saved playlists, and where the (nonexistent, in a headless browser) live view is.
  const playlists = new Map(); // id -> { id, name, updatedAt, items: [{id, kind: "passage", book, …} | {id, kind: "deck", deck, name, slideCount, label}] }
  let playlistsNextId = 1;
  let playlistItemNextId = 1;
  const decks = new Map(); // id -> { name, slideCount, pngs? }; pictures without pngs are drawn by serve() below
  let decksNextId = 1;
  // What the next "Add slides…" file picker returns; a test can change it with mock:set_picker.
  let pickerPaths = ["/home/user/Pictures/Welcome.png", "/home/user/Pictures/Slide10.png", "/home/user/Pictures/Slide2.png"];
  // The office suite presentation files convert with; a test can take it away with mock:set_converter.
  let converter = "LibreOffice";
  /** A saved item as list_playlists returns it: deck items carry their deck's name and size. */
  const storedItem = (it) => {
    const item = { id: playlistItemNextId++, ...it };
    if (it.kind === "deck") {
      const { name, slideCount } = decks.get(it.deck);
      Object.assign(item, { name, slideCount });
    }
    return item;
  };
  /** Forgets decks no playlist uses any more, like the real backend. */
  const removeUnusedDecks = () => {
    const used = new Set([...playlists.values()].flatMap((p) => p.items.filter((i) => i.kind === "deck").map((i) => i.deck)));
    for (const id of decks.keys()) if (!used.has(id)) decks.delete(id);
  };
  let presentIsOpen = false; // there is never a second monitor in headless Chromium, so it's never fullscreen anywhere.
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
    // The event plugin: inert here (see the bridge script in harness.mjs) since there is only ever one
    // page standing in for the main window, and it never needs to actually receive anything back.
    "plugin:event|listen": () => Math.floor(Math.random() * 1e9),
    "plugin:event|unlisten": () => {},
    "plugin:event|emit": () => {},
    "plugin:event|emit_to": () => {},
    list_translations: () => db.prepare("SELECT id, name FROM translations").all(),
    list_books: () => db.prepare("SELECT id, code, name, abbrev, testament, chapters FROM books ORDER BY id").all(),
    get_chapter: ({ translation, book, chapter }) =>
      db.prepare("SELECT verse, verse_end, text, kind, new_block, gap, heading, heading_kind, subscription FROM verses WHERE translation=? AND book=? AND chapter=? ORDER BY verse")
        .all(translation, book, chapter)
        .map((r) => ({
          verse: r.verse, verseEnd: r.verse_end, text: r.text, kind: r.kind, newBlock: bool(r.new_block), gap: bool(r.gap),
          heading: r.heading, headingKind: r.heading_kind, subscription: r.subscription,
        })),
    list_chapters: ({ translation }) =>
      db.prepare(`SELECT book, chapter, MAX(COALESCE(verse_end, verse)) AS verses FROM verses WHERE translation = ?
        GROUP BY book, chapter ORDER BY book, chapter`).all(translation),
    get_plans: () => [...plans.values()].sort((a, b) => a.startedOn.localeCompare(b.startedOn) || a.plan.localeCompare(b.plan))
      .map((p) => ({ plan: p.plan, startedOn: p.startedOn, done: [...p.done].sort((x, y) => x[0] - y[0]).map(([day, doneOn]) => ({ day, doneOn })) })),
    start_plan: ({ plan, startedOn }) => { if (!plans.has(plan)) plans.set(plan, { plan, startedOn, done: new Map() }); },
    stop_plan: ({ plan }) => { plans.delete(plan); },
    set_plan_day: ({ plan, day, done, doneOn }) => {
      const p = plans.get(plan);
      if (!p) throw "plan has not been started";
      if (done) { if (!p.done.has(day)) p.done.set(day, doneOn); } else p.done.delete(day);
    },
    // The real command saves into Pictures; here the card goes to a temp folder so the test can read it back.
    save_image: ({ fileName, bytes }) => {
      const dir = path.join(os.tmpdir(), "kjv-ui-test-cards");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${Date.now()}-${fileName.replace(/[^\w .-]/g, "")}`);
      fs.writeFileSync(file, Buffer.from(bytes));
      return file;
    },
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
          snippet(verses_fts, 0, char(1), char(2), '…', 32) AS snippet ${from} ORDER BY v.book, v.chapter, v.verse, v.translation LIMIT ? OFFSET ?`)
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
    list_playlists: () => [...playlists.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
      .map((s) => ({ ...s, items: [...s.items] })),
    create_playlist: ({ name }) => {
      const id = playlistsNextId++;
      playlists.set(id, { id, name: name.trim() || "Untitled playlist", updatedAt: new Date().toISOString(), items: [] });
      return id;
    },
    rename_playlist: ({ id, name }) => {
      const s = playlists.get(id);
      if (s) { s.name = name.trim() || "Untitled playlist"; s.updatedAt = new Date().toISOString(); }
    },
    delete_playlist: ({ id }) => { playlists.delete(id); removeUnusedDecks(); },
    save_playlist_items: ({ id, items }) => {
      const s = playlists.get(id);
      if (!s) return;
      s.items = items.map(storedItem);
      s.updatedAt = new Date().toISOString();
      removeUnusedDecks();
    },
    import_slides: ({ playlist, paths }) => {
      const s = playlists.get(playlist);
      if (!s) throw new Error("That playlist no longer exists.");
      const bad = paths.find((p) => !/\.(png|jpe?g|webp|gif)$/i.test(p));
      if (bad) throw new Error(`${bad} isn't a supported image (PNG, JPG, WebP or GIF).`);
      const first = paths[0].split("/").pop();
      const deck = decksNextId++;
      decks.set(deck, { name: paths.length === 1 ? first : `${first} + ${paths.length - 1} more`, slideCount: paths.length });
      s.items.push(storedItem({ kind: "deck", deck, label: null }));
      s.updatedAt = new Date().toISOString();
    },
    // Any PDF path reads as a small three-page PDF, except one named "broken", which isn't a PDF at all.
    read_slide_pdf: ({ path }) => {
      if (!/\.pdf$/i.test(path)) throw new Error(`${path} isn't a PDF.`);
      return { __bytes: (/broken/i.test(path) ? Buffer.from("this is not a pdf") : makePdf(3)).toString("base64") };
    },
    office_converter: () => converter,
    // Like the real thing: a presentation becomes a (three-page) PDF, unless it's "broken".
    convert_slides_to_pdf: ({ path }) => {
      const name = path.split("/").pop();
      if (!converter) throw new Error("Adding PowerPoint or Keynote files needs LibreOffice (free, from libreoffice.org). Or save the file as a PDF and add that.");
      if (/broken/i.test(path)) throw new Error(`LibreOffice couldn't convert ${name}. It may be damaged or password-protected; try saving it as a PDF and adding that.`);
      return { __bytes: makePdf(3).toString("base64") };
    },
    "mock:set_converter": ({ name }) => { converter = name; },
    import_rendered_slides: (_args, { raw, headers }) => {
      const s = playlists.get(Number(headers["x-playlist"]));
      if (!s) throw new Error("That playlist no longer exists.");
      const frames = [];
      for (let at = 0; at < raw.length; ) {
        const len = raw.readUInt32LE(at);
        frames.push(raw.subarray(at + 4, at + 4 + len));
        at += 4 + len;
      }
      const [name, ...pngs] = frames;
      const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      if (pngs.length === 0 || !pngs.every((p) => p.subarray(0, 8).equals(signature))) throw new Error("A rendered page isn't a PNG image.");
      const deck = decksNextId++;
      decks.set(deck, { name: name.toString("utf8"), slideCount: pngs.length, pngs: pngs.map((p) => Buffer.from(p)) });
      s.items.push(storedItem({ kind: "deck", deck, label: null }));
      s.updatedAt = new Date().toISOString();
    },
    "plugin:dialog|open": () => pickerPaths,
    "mock:set_picker": ({ paths }) => { pickerPaths = paths; },
    /** Not a command: the stored PNG for a PDF deck's slide `n` (1-based), for serve(). */
    __deckPng: (deck, n) => decks.get(deck)?.pngs?.[n - 1],
    // No real second window exists in a headless browser; the dock's own live preview (driven by
    // React state, not this bridge) is what actually gets exercised by the UI tests for this feature.
    present_open: () => ({ open: (presentIsOpen = true), monitorLabel: null }),
    present_close: () => ({ open: (presentIsOpen = false), monitorLabel: null }),
    present_status: () => ({ open: presentIsOpen, monitorLabel: null }),
  };
  return commands;
}

/** Serves the commands as POST /invoke {cmd, args}. Returns the http.Server. */
export function serve(port = 9100, options = {}) {
  const commands = createBackend(options);
  const server = http.createServer((req, res) => {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" };
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    // Stands in for the app's slides:// scheme (see harness.mjs's convertFileSrc): a numbered placeholder slide.
    const slide = req.method === "GET" && /^\/slides\/(\d+)%2F(\d+)$/.exec(req.url ?? "");
    const rendered = slide && commands.__deckPng(Number(slide[1]), Number(slide[2]));
    if (rendered) return res.writeHead(200, { ...cors, "content-type": "image/png" }).end(rendered);
    if (slide) {
      const [, deck, n] = slide;
      const hue = (Number(deck) * 67) % 360;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
        <rect width="1600" height="900" fill="hsl(${hue} 45% 32%)"/>
        <text x="800" y="420" font-family="sans-serif" font-size="120" fill="#fff" text-anchor="middle">Slide ${n}</text>
        <text x="800" y="560" font-family="sans-serif" font-size="56" fill="#fff" opacity="0.7" text-anchor="middle">Deck ${deck}</text>
      </svg>`;
      return res.writeHead(200, { ...cors, "content-type": "image/svg+xml" }).end(svg);
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { cmd, args, raw, headers } = JSON.parse(body);
        if (!commands[cmd]) throw new Error(`unknown command ${cmd}`);
        // Run the command before writing anything, so one that throws can still answer with its error.
        const ok = commands[cmd](args ?? {}, { raw: raw === undefined ? undefined : Buffer.from(raw, "base64"), headers: headers ?? {} }) ?? null;
        res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ ok }));
      } catch (e) {
        res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ err: String(e.message ?? e) }));
      }
    });
  });
  server.listen(port, "127.0.0.1");
  return server;
}
