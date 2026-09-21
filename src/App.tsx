import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./App.css";
import { EMPTY_MARKS, getChapter, getMarks, listBooks, saveNote, setHighlight, toggleBookmark } from "./api";
import type { Book, ChapterMarks, HighlightColor, Verse } from "./api";
import { TRANSLATION } from "./config";
import { Chapter } from "./Chapter";
import type { Neighbor, Target } from "./Chapter";
import { GoTo } from "./GoTo";
import type { Destination } from "./GoTo";
import { Library } from "./Library";
import { adjacent, chapterTitle } from "./nav";
import type { Position } from "./nav";
import { NoteEditor } from "./NoteEditor";
import type { NoteDraft } from "./NoteEditor";
import { EMPTY_SEARCH, Search } from "./Search";
import type { SearchMemory } from "./Search";
import { SelectionBar } from "./SelectionBar";
import { Settings } from "./Settings";
import { applySettings, loadSettings, saveSettings } from "./settings";
import { loadJson, saveJson } from "./storage";
import { quotation, referenceLabel, span } from "./verses";
import { VerseOfTheDay } from "./VerseOfTheDay";
import { hasSeenVerseToday, markVerseSeen } from "./votd";

const IDLE_MS = 2500;

/** The full-screen panels. Only one is open at a time. */
type Panel = "goto" | "search" | "settings" | "library" | "votd";
const DEFAULT_POSITION: Position = { book: 1, chapter: 1 };

interface SavedPosition extends Position {
  scroll: number;
}

interface Loaded extends Position {
  verses: Verse[];
  marks: ChapterMarks;
}

function loadPosition(): SavedPosition {
  const p = loadJson<Partial<SavedPosition>>("position");
  if (p && Number.isInteger(p.book) && Number.isInteger(p.chapter) && p.book! >= 1 && p.chapter! >= 1) {
    return { book: p.book!, chapter: p.chapter!, scroll: Math.max(0, p.scroll ?? 0) };
  }
  return { ...DEFAULT_POSITION, scroll: 0 };
}

/** True once the user has neither moved the mouse nor pressed a key for `ms`. */
function useIdle(ms: number) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer: number;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), ms);
    };
    const onMove = (e: MouseEvent) => {
      // Scrolling can synthesize zero-distance moves; those aren't the user reaching for the UI.
      if (e.movementX || e.movementY) wake();
    };
    wake();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("keydown", wake);
    window.addEventListener("pointerdown", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("keydown", wake);
      window.removeEventListener("pointerdown", wake);
    };
  }, [ms]);
  return idle;
}

function App() {
  const saved = useRef(loadPosition()); // read once; `scroll` is restored after the first chapter loads
  const [books, setBooks] = useState<Book[]>([]);
  const [pos, setPos] = useState<Position>({ book: saved.current.book, chapter: saved.current.chapter });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const searchMemory = useRef<SearchMemory>(EMPTY_SEARCH);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const anchor = useRef<number | null>(null); // where a shift-click range starts
  const [note, setNote] = useState<NoteDraft | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState(loadSettings);
  const jumpId = useRef(0);
  const restoreScroll = useRef<number | null>(saved.current.scroll);
  const idle = useIdle(IDLE_MS);
  const overlayOpen = panel !== null || note !== null;

  useEffect(() => {
    listBooks()
      .then((b) => {
        setBooks(b);
        // A saved position can predate a data change; fall back rather than show nothing.
        setPos((p) => {
          const book = b.find((x) => x.id === p.book);
          return book && p.chapter <= book.chapters ? p : DEFAULT_POSITION;
        });
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    let stale = false;
    Promise.all([
      getChapter(TRANSLATION, pos.book, pos.chapter),
      // Marks live in a separate DB; if it can't be read the chapter should still open.
      getMarks(pos.book, pos.chapter).catch(() => EMPTY_MARKS),
    ])
      .then(([verses, marks]) => {
        if (stale) return;
        setLoaded({ book: pos.book, chapter: pos.chapter, verses, marks });
        setError(null);
      })
      .catch((e) => !stale && setError(String(e)));
    return () => {
      stale = true;
    };
  }, [pos.book, pos.chapter]);

  // The chapter on screen lags `pos` until its verses arrive; only act once they match.
  const ready = loaded !== null && loaded.book === pos.book && loaded.chapter === pos.chapter;

  useLayoutEffect(() => {
    if (!ready) return;
    const y = restoreScroll.current;
    restoreScroll.current = null;
    if (target) {
      document.querySelector(`[data-verse="${target.verse}"]`)?.scrollIntoView({ block: "center" });
    } else {
      window.scrollTo(0, y ?? 0);
    }
  }, [loaded?.book, loaded?.chapter, ready, target]);

  // A selection belongs to one chapter.
  useEffect(() => {
    setSelected(new Set());
    anchor.current = null;
  }, [loaded?.book, loaded?.chapter]);

  useEffect(() => {
    saveJson("position", { ...pos, scroll: 0 });
    let timer: number;
    const onScroll = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => saveJson("position", { ...pos, scroll: Math.round(window.scrollY) }), 300);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [pos]);

  useEffect(() => {
    applySettings(settings);
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Once a day, the first time the app opens with the chapter on screen.
  const today = useRef(new Date()).current;
  const votdChecked = useRef(false);
  useEffect(() => {
    if (votdChecked.current || !ready || books.length === 0) return;
    votdChecked.current = true;
    if (settings.verseOfTheDay && !hasSeenVerseToday(today)) {
      markVerseSeen(today);
      setPanel("votd");
    }
  }, [ready, books.length, settings.verseOfTheDay, today]);

  const navigate = (dest: Destination) => {
    const { book, chapter, verse, verseEnd } = dest;
    setTarget(verse ? { verse, end: verseEnd ?? verse, id: ++jumpId.current } : null);
    setPos((p) => (p.book === book && p.chapter === chapter ? p : { book, chapter }));
    if (!verse && pos.book === book && pos.chapter === chapter) window.scrollTo(0, 0);
    setPanel(null);
  };

  const show = (p: Panel) => {
    setNote(null); // a panel and the note editor never share the screen
    setPanel(p);
  };
  const openGoto = () => show("goto");
  const openSettings = () => show("settings");
  const openLibrary = () => show("library");
  const openSearch = (seed?: string) => {
    if (seed) searchMemory.current = { ...searchMemory.current, query: seed };
    show("search");
  };
  const closePanel = () => setPanel(null);
  const remember = useCallback((m: SearchMemory) => {
    searchMemory.current = m;
  }, []);

  const book = books.find((b) => b.id === pos.book);
  const shown = loaded && books.find((b) => b.id === loaded.book);
  const label = (p: Position) => {
    const b = books.find((x) => x.id === p.book);
    return `${b ? chapterTitle(b) : ""} ${p.chapter}`;
  };
  const neighbor = (dir: 1 | -1): Neighbor | null => {
    const p = adjacent(books, pos, dir);
    return p && { pos: p, label: label(p) };
  };
  const prev = neighbor(-1);
  const next = neighbor(1);

  // ---- Selecting verses, and what can be done to a selection ----

  const clearSelection = () => {
    setSelected(new Set());
    anchor.current = null;
  };

  const onVerseClick = (verse: number, e: React.MouseEvent) => {
    const modified = e.shiftKey || e.ctrlKey || e.metaKey;
    // Shift-click natively extends the text selection, which would look like a drag; drop it.
    // Otherwise ignore the tail of a real text selection (dragging, double-click) so copying words still works.
    if (modified) window.getSelection()?.removeAllRanges();
    else if (window.getSelection()?.toString()) return;
    setSelected((prev) => {
      if (e.shiftKey && anchor.current !== null) {
        const [lo, hi] = [anchor.current, verse].sort((a, b) => a - b);
        return new Set(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
      }
      if (e.ctrlKey || e.metaKey) {
        const next = new Set(prev);
        if (!next.delete(verse)) next.add(verse);
        return next;
      }
      return prev.size === 1 && prev.has(verse) ? new Set() : new Set([verse]);
    });
    if (!e.shiftKey) anchor.current = verse;
  };

  const chosen = [...selected].sort((a, b) => a - b);
  const marks = loaded?.marks ?? EMPTY_MARKS;
  const title = shown ? chapterTitle(shown) : "";

  const refreshMarks = async () => {
    if (!loaded) return;
    const { book: b, chapter: c } = loaded;
    const fresh = await getMarks(b, c);
    setLoaded((l) => (l && l.book === b && l.chapter === c ? { ...l, marks: fresh } : l));
  };
  const attempt = (work: Promise<unknown>) =>
    work.then(refreshMarks).catch((e) => setNotice(`That didn’t save: ${e}`));

  const colorOf = new Map(marks.highlights.map((h) => [h.verse, h.color]));
  const sharedColor: HighlightColor | null =
    chosen.length > 0 && chosen.every((v) => colorOf.get(v) === colorOf.get(chosen[0]))
      ? (colorOf.get(chosen[0]) ?? null)
      : null;

  const applyColor = (color: HighlightColor) => {
    if (!loaded) return;
    // Choosing the color the selection already has takes it off again.
    void attempt(setHighlight(loaded.book, loaded.chapter, chosen, color === sharedColor ? null : color));
  };

  const bookmarkSelection = () => {
    if (loaded) void attempt(toggleBookmark(loaded.book, loaded.chapter, chosen[0]));
  };

  const copySelection = () => {
    if (!loaded) return;
    navigator.clipboard
      .writeText(quotation(title, loaded.chapter, loaded.verses, selected))
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setNotice("Couldn’t copy to the clipboard."));
  };

  /** Opens the note editor for the selection, or for the note starting at `verse` (from its margin marker). */
  const openNote = (verse?: number) => {
    if (!loaded) return;
    const start = verse ?? chosen[0];
    const existing = marks.notes.find((n) => n.verse === start);
    const range = verse === undefined ? span(chosen) : { verse, verseEnd: existing?.verseEnd ?? null };
    const covered = loaded.verses.filter((v) => v.verse >= range.verse && v.verse <= (range.verseEnd ?? range.verse));
    setNote({
      book: loaded.book,
      chapter: loaded.chapter,
      ...range,
      label: referenceLabel(title, loaded.chapter, covered.map((v) => v.verse)),
      quote: covered.map((v) => v.text).join(" "),
      id: existing?.id ?? null,
      body: existing?.body ?? "",
    });
  };

  const commitNote = (body: string) => {
    if (!note) return;
    void attempt(saveNote(note.book, note.chapter, note.verse, note.verseEnd, body));
    setNote(null);
  };

  // One stable listener that calls the latest handler. Re-registering per render would drop keys:
  // the first key after the top bar idles re-renders mid-event and removes the handler before it runs.
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onKeyRef.current = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openGoto();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (panel !== "search") openSearch();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        openSettings();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        openLibrary();
        return;
      }
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable);
      if (e.ctrlKey || e.metaKey || e.altKey || typing || overlayOpen) return;
      if (e.key === "Escape") clearSelection();
      else if (e.key === "/") {
        e.preventDefault();
        openGoto();
      } else if (e.key === "ArrowLeft" && prev) navigate({ ...prev.pos });
      else if (e.key === "ArrowRight" && next) navigate({ ...next.pos });
    };
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <>
      <header className={`topbar${idle && !overlayOpen ? " is-idle" : ""}`}>
        <button className="location" onClick={openGoto} title="Go to… (Ctrl+K or /)">
          {book ? label(pos) : ""}
        </button>
        <div className="topbar-right">
          <button className="topbar-button" onClick={openLibrary} title="Library: bookmarks, notes and highlights (Ctrl+L)">
            Library
          </button>
          <button className="topbar-button" onClick={() => openSearch()} title="Search (Ctrl+F)">
            Search
          </button>
          <button className="topbar-button topbar-type" onClick={openSettings} title="Settings (Ctrl+,)" aria-label="Settings">
            Aa
          </button>
          <span className="translation" title="King James Version">
            {TRANSLATION}
          </span>
        </div>
      </header>

      <main
        className="page"
        onClick={(e) => {
          // Clicking the margin or between verses puts the selection away.
          if (!(e.target as HTMLElement).closest(".verse, button")) clearSelection();
        }}
      >
        {error && <p className="status">Couldn’t load this chapter: {error}</p>}
        {shown && loaded && !error && (
          <div key={`${loaded.book}-${loaded.chapter}`} className="settle">
            <Chapter
              book={shown}
              chapter={loaded.chapter}
              verses={loaded.verses}
              marks={loaded.marks}
              selected={selected}
              target={ready ? target : null}
              layout={settings}
              prev={prev}
              next={next}
              onNavigate={(p) => navigate({ ...p })}
              onVerseClick={onVerseClick}
              onOpenNote={openNote}
            />
          </div>
        )}
      </main>

      {ready && chosen.length > 0 && !overlayOpen && (
        <SelectionBar
          label={referenceLabel(title, loaded.chapter, chosen)}
          color={sharedColor}
          hasNote={marks.notes.some((n) => n.verse === chosen[0])}
          bookmarked={marks.bookmarks.includes(chosen[0])}
          copied={copied}
          onColor={applyColor}
          onNote={() => openNote()}
          onBookmark={bookmarkSelection}
          onCopy={copySelection}
          onClear={clearSelection}
        />
      )}

      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}

      {panel === "goto" && books.length > 0 && (
        <GoTo books={books} current={pos} onGo={navigate} onSearch={openSearch} onClose={closePanel} />
      )}
      {panel === "search" && books.length > 0 && (
        <Search
          books={books}
          initial={searchMemory.current}
          onRemember={remember}
          onGo={navigate}
          onClose={closePanel}
        />
      )}
      {panel === "settings" && (
        <Settings settings={settings} onChange={setSettings} onShowVerse={() => setPanel("votd")} onClose={closePanel} />
      )}
      {panel === "library" && books.length > 0 && <Library books={books} onGo={navigate} onClose={closePanel} />}
      {panel === "votd" && books.length > 0 && (
        <VerseOfTheDay books={books} date={today} onGo={navigate} onClose={closePanel} />
      )}
      {note && (
        <NoteEditor
          draft={note}
          onSave={commitNote}
          onDelete={() => commitNote("")}
          onClose={() => setNote(null)}
        />
      )}
    </>
  );
}

export default App;
