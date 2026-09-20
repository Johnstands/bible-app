import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./App.css";
import { getChapter, listBooks } from "./api";
import type { Book, Verse } from "./api";
import { Chapter } from "./Chapter";
import type { Neighbor, Target } from "./Chapter";
import { GoTo } from "./GoTo";
import type { Destination } from "./GoTo";
import { adjacent, chapterTitle } from "./nav";
import { EMPTY_SEARCH, Search } from "./Search";
import type { SearchMemory } from "./Search";
import type { Position } from "./nav";
import { loadJson, saveJson } from "./storage";

const THEMES = ["paper", "sepia", "dark"] as const;
type Theme = (typeof THEMES)[number];

const IDLE_MS = 2500;
const TRANSLATION = "KJV";
const DEFAULT_POSITION: Position = { book: 1, chapter: 1 };

interface SavedPosition extends Position {
  scroll: number;
}

interface Loaded extends Position {
  verses: Verse[];
}

function loadTheme(): Theme {
  const t = loadJson<string>("theme");
  return THEMES.includes(t as Theme) ? (t as Theme) : "paper";
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
  const [gotoOpen, setGotoOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchMemory = useRef<SearchMemory>(EMPTY_SEARCH);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const jumpId = useRef(0);
  const restoreScroll = useRef<number | null>(saved.current.scroll);
  const idle = useIdle(IDLE_MS);

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
    getChapter(TRANSLATION, pos.book, pos.chapter)
      .then((verses) => {
        if (stale) return;
        setLoaded({ book: pos.book, chapter: pos.chapter, verses });
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
  }, [loaded, ready, target]);

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
    document.documentElement.dataset.theme = theme;
    saveJson("theme", theme);
  }, [theme]);

  const navigate = (dest: Destination) => {
    const { book, chapter, verse, verseEnd } = dest;
    setTarget(verse ? { verse, end: verseEnd ?? verse, id: ++jumpId.current } : null);
    setPos((p) => (p.book === book && p.chapter === chapter ? p : { book, chapter }));
    if (!verse && pos.book === book && pos.chapter === chapter) window.scrollTo(0, 0);
    setGotoOpen(false);
    setSearchOpen(false);
  };

  // Go to and Search share the screen, so opening one closes the other.
  const openGoto = () => {
    setSearchOpen(false);
    setGotoOpen(true);
  };
  const openSearch = (seed?: string) => {
    if (seed) searchMemory.current = { ...searchMemory.current, query: seed };
    setGotoOpen(false);
    setSearchOpen(true);
  };
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
        if (!searchOpen) openSearch();
        return;
      }
      const typing = e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.isContentEditable);
      if (e.ctrlKey || e.metaKey || e.altKey || typing || gotoOpen || searchOpen) return;
      if (e.key === "/") {
        e.preventDefault();
        openGoto();
      } else if (e.key === "ArrowLeft" && prev) navigate({ ...prev.pos });
      else if (e.key === "ArrowRight" && next) navigate({ ...next.pos });
      // Temporary: lets the three themes be compared until Phase 4 adds settings.
      else if (e.key === "t") setTheme((t) => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]);
    };
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <>
      <header className={`topbar${idle && !gotoOpen && !searchOpen ? " is-idle" : ""}`}>
        <button className="location" onClick={openGoto} title="Go to… (Ctrl+K or /)">
          {book ? label(pos) : ""}
        </button>
        <div className="topbar-right">
          <button className="topbar-button" onClick={() => openSearch()} title="Search (Ctrl+F)">
            Search
          </button>
          <span className="translation" title="King James Version">
            {TRANSLATION}
          </span>
        </div>
      </header>

      <main className="page">
        {error && <p className="status">Couldn’t load this chapter: {error}</p>}
        {shown && loaded && !error && (
          <div key={`${loaded.book}-${loaded.chapter}`} className="settle">
            <Chapter
              book={shown}
              chapter={loaded.chapter}
              verses={loaded.verses}
              target={ready ? target : null}
              prev={prev}
              next={next}
              onNavigate={(p) => navigate({ ...p })}
            />
          </div>
        )}
      </main>

      {gotoOpen && books.length > 0 && (
        <GoTo
          books={books}
          current={pos}
          onGo={navigate}
          onSearch={openSearch}
          onClose={() => setGotoOpen(false)}
        />
      )}
      {searchOpen && books.length > 0 && (
        <Search
          books={books}
          initial={searchMemory.current}
          onRemember={remember}
          onGo={navigate}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </>
  );
}

export default App;
