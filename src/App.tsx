import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { EMPTY_MARKS, getChapter, getMarks, getPlans, getWordTags, HIGHLIGHT_COLORS, listBooks, listChapters, saveNote, setHighlight, setPlanDay, startPlan, stopPlan, toggleBookmark } from "./api";
import type { Book, ChapterMarks, HighlightColor, StartedPlan, Verse, WordTag } from "./api";
import glossaryText from "../data/glossary.txt?raw";
import { TRANSLATION, TRANSLATION_NAME } from "./config";
import { Chapter } from "./Chapter";
import type { Neighbor, Target } from "./Chapter";
import { buildIndex, parseGlossary } from "./glossary";
import { GoTo } from "./GoTo";
import type { Destination } from "./GoTo";
import { CrossReferences } from "./CrossReferences";
import type { RefSource } from "./CrossReferences";
import { Library } from "./Library";
import { buildPlans, dayLabel, localDate, nextDay } from "./plans";
import type { Plan } from "./plans";
import { ReadingPlans } from "./ReadingPlans";
import { ShareCard } from "./ShareCard";
import { adjacent, chapterTitle } from "./nav";
import type { Position } from "./nav";
import { NoteEditor } from "./NoteEditor";
import type { NoteDraft } from "./NoteEditor";
import { EMPTY_SEARCH, Search } from "./Search";
import type { SearchMemory } from "./Search";
import { SelectionBar } from "./SelectionBar";
import { Settings } from "./Settings";
import { applySettings, FONTS, loadSettings, saveSettings, UI_FONT_STACK } from "./userSettings";
import { loadJson, saveJson } from "./storage";
import { quotation, referenceLabel, span } from "./verses";
import { appVersion, findUpdate } from "./updater";
import type { UpdateOffer } from "./updater";
import { VerseOfTheDay } from "./VerseOfTheDay";
import { WordHelp } from "./WordHelp";
import type { WordTarget } from "./wordUnits";
import { hasSeenVerseToday, markVerseSeen } from "./votd";
import { KIND_LABELS } from "./glossary";
import { shortcutLabel } from "./platform";

const IDLE_MS = 2500;
/** Wait this long after the first chapter appears before asking about updates, so startup stays quick. */
const UPDATE_CHECK_DELAY_MS = 2500;

type UpdateStatus = "idle" | "checking" | "current" | "available" | "installing" | "failed";
/** How far below the top of the window text is hidden by the fixed top bar. */
const TOPBAR_CLEARANCE = 90;

/** Scrolls `el` to the middle of the window unless it is already comfortably on screen. */
function keepInView(el: Element | null) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.top < TOPBAR_CLEARANCE || r.bottom > window.innerHeight - TOPBAR_CLEARANCE) el.scrollIntoView({ block: "center" });
}

/** The full-screen panels. Only one is open at a time. */
type Panel = "goto" | "search" | "settings" | "library" | "votd" | "refs" | "share" | "plans";
const DEFAULT_POSITION: Position = { book: 1, chapter: 1 };

interface SavedPosition extends Position {
  scroll: number;
}

interface Loaded extends Position {
  verses: Verse[];
  marks: ChapterMarks;
  /** Strong's numbers by verse; null when original-language words are off or could not be loaded. */
  tags: ReadonlyMap<number, WordTag[]> | null;
}

/** A chapter's Strong's tags by verse. A failure is not worth stopping the reader for. */
const fetchTags = (book: number, chapter: number) =>
  getWordTags(TRANSLATION, book, chapter)
    .then((rows) => new Map(rows.map((r) => [r.verse, r.tags] as const)))
    .catch(() => null);

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
  const [planDefs, setPlanDefs] = useState<Plan[]>([]);
  const [startedPlans, setStartedPlans] = useState<StartedPlan[]>([]);
  const [shareFor, setShareFor] = useState<{ reference: string; text: string } | null>(null);
  const [refsFor, setRefsFor] = useState<(RefSource & { label: string; text: string }) | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState(loadSettings);
  const [help, setHelp] = useState<{ target: WordTarget; anchor: HTMLElement } | null>(null);
  // The verse the keyboard is on. `shown` is false after a mouse click, so the outline only appears for keyboard users.
  const [cursor, setCursor] = useState<{ verse: number; shown: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState<{ text: string; id: number } | null>(null);
  const [update, setUpdate] = useState<UpdateOffer | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const announceId = useRef(0);
  const announce = useCallback((text: string) => setAnnouncement({ text, id: ++announceId.current }), []);
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

  // The chapter effect reads this instead of depending on it, so switching the setting doesn't reload the chapter.
  const wantTags = useRef(settings.originalWords);
  wantTags.current = settings.originalWords;

  useEffect(() => {
    let stale = false;
    Promise.all([
      getChapter(TRANSLATION, pos.book, pos.chapter),
      // Marks live in a separate DB; if it can't be read the chapter should still open.
      getMarks(pos.book, pos.chapter).catch(() => EMPTY_MARKS),
      wantTags.current ? fetchTags(pos.book, pos.chapter) : Promise.resolve(null),
    ])
      .then(([verses, marks, tags]) => {
        if (stale) return;
        setLoaded({ book: pos.book, chapter: pos.chapter, verses, marks, tags });
        setError(null);
      })
      .catch((e) => !stale && setError(String(e)));
    return () => {
      stale = true;
    };
  }, [pos.book, pos.chapter]);

  // Turning original-language words on while reading fetches the open chapter's tags.
  useEffect(() => {
    if (!settings.originalWords || !loaded || loaded.tags) return;
    let stale = false;
    fetchTags(loaded.book, loaded.chapter).then((tags) => {
      if (stale || !tags) return;
      setLoaded((l) => (l && l.book === loaded.book && l.chapter === loaded.chapter ? { ...l, tags } : l));
    });
    return () => {
      stale = true;
    };
  }, [settings.originalWords, loaded]);

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

  // A selection, and an open word card, belong to one chapter.
  useEffect(() => {
    setSelected(new Set());
    anchor.current = null;
    setHelp(null);
    setCursor(null);
  }, [loaded?.book, loaded?.chapter]);

  // Reading plans: what each day reads comes from the chapter lengths; progress lives in the user DB. Neither
  // is worth stopping the reader for if it can't be loaded.
  useEffect(() => {
    listChapters(TRANSLATION).then((sizes) => setPlanDefs(buildPlans(sizes))).catch((e) => console.error(e));
    getPlans().then(setStartedPlans).catch((e) => console.error(e));
  }, []);
  const refreshPlans = () => getPlans().then(setStartedPlans).catch((e) => setError(String(e)));
  const beginPlan = (id: string) => startPlan(id, localDate()).then(refreshPlans).catch((e) => setError(String(e)));
  const endPlan = (id: string) => stopPlan(id).then(refreshPlans).catch((e) => setError(String(e)));
  const restartPlan = (id: string) =>
    stopPlan(id).then(() => startPlan(id, localDate())).then(refreshPlans).catch((e) => setError(String(e)));
  const markPlanDay = (id: string, day: number, done: boolean) =>
    setPlanDay(id, day, done, localDate())
      .then(refreshPlans)
      .then(() => {
        const name = planDefs.find((p) => p.id === id)?.name ?? "the plan";
        announce(done ? `Day ${day} of ${name} marked done.` : `Day ${day} of ${name} marked not done.`);
      })
      .catch((e) => setError(String(e)));

  // The glossary needs the book list to resolve its verse references. A bad entry must not take the reader down.
  const glossary = useMemo(() => {
    if (books.length === 0) return null;
    try {
      return buildIndex(parseGlossary(glossaryText), books);
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [books]);
  const closeHelp = useCallback(() => setHelp(null), []);
  const showWord = useCallback((target: WordTarget, anchorEl: HTMLElement) => {
    setHelp((cur) => (cur?.anchor === anchorEl ? null : { target, anchor: anchorEl })); // a second click puts it away
  }, []);

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

  // ---- Updates: checked once when the app opens, and whenever asked for in Settings ----

  const checkForUpdate = useCallback(async () => {
    setUpdateStatus("checking");
    try {
      const offer = await findUpdate();
      setUpdate(offer);
      setUpdateStatus(offer ? "available" : "current");
    } catch {
      setUpdateStatus("failed");
    }
  }, []);

  const installUpdate = async () => {
    if (!update) return;
    setUpdateStatus("installing");
    try {
      await update.install(); // restarts the app when it succeeds
    } catch (e) {
      setUpdateStatus("failed");
      setNotice(`The update couldn’t be installed: ${e}`);
    }
  };

  const checkedOnLaunch = useRef(false);
  useEffect(() => {
    void appVersion().then(setVersion);
    if (checkedOnLaunch.current || !ready) return;
    checkedOnLaunch.current = true;
    const timer = window.setTimeout(() => void checkForUpdate(), UPDATE_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, checkForUpdate]);

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
    setHelp(null);
    setPanel(p);
  };
  const openGoto = () => show("goto");
  const openSettings = () => show("settings");
  const openLibrary = () => show("library");
  const openPlans = () => show("plans");
  const openSearch = (seed?: string) => {
    if (seed) searchMemory.current = { ...searchMemory.current, query: seed };
    show("search");
  };
  /** Lists every verse that uses a Strong's number; an earlier testament or book filter would hide most of them. */
  const searchNumber = (num: string) => {
    searchMemory.current = { ...EMPTY_SEARCH, query: num };
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

  /** Replaces the selection with one verse, adds or removes a verse, or extends the selection from where it began. */
  const changeSelection = (verse: number, how: "replace" | "toggle" | "extend") => {
    setSelected((prev) => {
      if (how === "extend" && anchor.current !== null) {
        const [lo, hi] = [anchor.current, verse].sort((a, b) => a - b);
        return new Set(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
      }
      if (how === "toggle") {
        const next = new Set(prev);
        if (!next.delete(verse)) next.add(verse);
        return next;
      }
      return prev.size === 1 && prev.has(verse) ? new Set() : new Set([verse]);
    });
    if (how !== "extend") anchor.current = verse;
  };

  const onVerseClick = (verse: number, e: React.MouseEvent) => {
    const modified = e.shiftKey || e.ctrlKey || e.metaKey;
    // Shift-click natively extends the text selection, which would look like a drag; drop it.
    // Otherwise ignore the tail of a real text selection (dragging, double-click) so copying words still works.
    if (modified) window.getSelection()?.removeAllRanges();
    else if (window.getSelection()?.toString()) return;
    changeSelection(verse, e.shiftKey ? "extend" : e.ctrlKey || e.metaKey ? "toggle" : "replace");
    setCursor({ verse, shown: false });
  };

  const chosen = [...selected].sort((a, b) => a - b);
  const marks = loaded?.marks ?? EMPTY_MARKS;
  const title = shown ? chapterTitle(shown) : "";
  // Plans under way whose next day includes the chapter on screen, so the day can be ticked off where it is read.
  const planChips = useMemo(() => {
    if (!ready || !loaded) return [];
    return planDefs.flatMap((plan) => {
      const s = startedPlans.find((x) => x.plan === plan.id);
      const day = s && nextDay(plan, new Set(s.done.map((d) => d.day)));
      return day && day.chapters.some((c) => c.book === loaded.book && c.chapter === loaded.chapter) ? [{ plan, day }] : [];
    });
  }, [ready, loaded, planDefs, startedPlans]);
  const bookTitle = (id: number) => {
    const b = books.find((x) => x.id === id);
    return b ? chapterTitle(b) : "";
  };

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

  /** Opens the dialog that makes the selected verses into a picture to share. */
  const openShare = () => {
    if (!loaded || !ready || chosen.length === 0) return;
    const text = loaded.verses.filter((v) => selected.has(v.verse)).map((v) => v.text).join(" ");
    setShareFor({ reference: referenceLabel(title, loaded.chapter, chosen), text });
    show("share");
  };

  /** Opens the cross-references for the one selected verse, or for the verse the keyboard is on. */
  const openRefs = () => {
    if (!loaded || !ready) return;
    const verse = chosen.length === 1 ? chosen[0] : chosen.length === 0 && cursor ? cursor.verse : null;
    if (verse === null) {
      announce("Select one verse, or move to it with J and K, then press X for its cross-references.");
      return;
    }
    const text = loaded.verses.find((v) => v.verse === verse)?.text ?? "";
    setRefsFor({ book: loaded.book, chapter: loaded.chapter, verse, label: referenceLabel(title, loaded.chapter, [verse]), text });
    show("refs");
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

  // ---- Keyboard: a verse cursor, and stepping through the glossary words ----

  const verseNumbers = loaded?.verses.map((v) => v.verse) ?? [];
  const verseText = (n: number) => loaded?.verses.find((v) => v.verse === n)?.text ?? "";

  const moveCursor = (dir: 1 | -1, extend: boolean) => {
    if (!ready || verseNumbers.length === 0) return;
    let target: number;
    if (cursor === null) {
      // Start on the first verse that is on screen.
      const onScreen = verseNumbers.find((n) => {
        const el = document.querySelector(`[data-verse="${n}"]`);
        return el ? el.getBoundingClientRect().bottom > TOPBAR_CLEARANCE : false;
      });
      target = onScreen ?? verseNumbers[0];
    } else {
      const i = verseNumbers.indexOf(cursor.verse) + dir;
      if (i < 0 || i >= verseNumbers.length) {
        announce(dir > 0 ? "End of the chapter." : "Start of the chapter.");
        return;
      }
      target = verseNumbers[i];
    }
    if (extend) {
      if (anchor.current === null) anchor.current = cursor?.verse ?? target;
      changeSelection(target, "extend");
    }
    setCursor({ verse: target, shown: true });
    announce(`Verse ${target}. ${verseText(target)}`);
  };

  const toggleAtCursor = () => {
    if (!cursor) return;
    const was = selected.has(cursor.verse);
    changeSelection(cursor.verse, "toggle");
    setCursor({ verse: cursor.verse, shown: true });
    const count = selected.size + (was ? -1 : 1);
    announce(`Verse ${cursor.verse} ${was ? "unselected" : "selected"}. ${count} ${count === 1 ? "verse" : "verses"} selected.`);
  };

  /** Opens the card for the next (or previous) underlined word in the chapter, wrapping around. */
  const stepWord = (dir: 1 | -1) => {
    const words = [...document.querySelectorAll<HTMLElement>(".kjv-word, .orig-word")];
    if (words.length === 0) {
      announce("This chapter has no word help.");
      return;
    }
    const current = help ? words.indexOf(help.anchor) : -1;
    let i: number;
    if (current >= 0) i = (current + dir + words.length) % words.length;
    else if (dir > 0) i = Math.max(0, words.findIndex((w) => w.getBoundingClientRect().top > TOPBAR_CLEARANCE));
    else {
      // Going backwards from nothing: the last word above the visible text, or the chapter's last word.
      i = words.length - 1;
      for (let j = words.length - 1; j >= 0; j--) {
        if (words[j].getBoundingClientRect().top < TOPBAR_CLEARANCE) {
          i = j;
          break;
        }
      }
    }
    const el = words[i];
    keepInView(el);
    el.click(); // the click handler opens the card, exactly as a mouse click would
  };

  // The cursor stays in view as it moves, clear of the top bar and the selection bar.
  useEffect(() => {
    if (cursor?.shown) keepInView(document.querySelector(`[data-verse="${cursor.verse}"]`));
  }, [cursor]);

  // Words opened from the keyboard are read out too.
  useEffect(() => {
    if (!help) return;
    const { entry, word, nums } = help.target;
    const original = nums?.[0] ? `${nums[0].startsWith("H") ? "Hebrew" : "Greek"} word ${nums[0]}` : null;
    const said = entry
      ? `${word}, ${KIND_LABELS[entry.kind]}: ${entry.meaning}.${entry.today ? ` Today: ${entry.today}.` : ""}${original ? ` Also a ${original}.` : ""}`
      : `${word}, ${original}.`;
    announce(original ? `${said} Press Enter to list every verse that uses it.` : said);
  }, [help, announce]);

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
      const openNum = help?.target.nums?.[0];
      if (e.key === "Enter" && openNum && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        searchNumber(openNum);
        return;
      }
      if (e.key === "p" || e.key === "P") {
        openPlans();
        return;
      }
      if (e.key === "x" || e.key === "X") {
        openRefs();
        return;
      }
      if (e.key === "s" || e.key === "S") {
        const on = !settings.originalWords;
        setSettings({ ...settings, originalWords: on });
        announce(on ? "Original-language words on. Click a word for its Hebrew or Greek." : "Original-language words off.");
        return;
      }
      if (e.key === "Escape") {
        if (help) setHelp(null);
        else {
          clearSelection();
          setCursor(null);
        }
      }
      else if (e.key === "/") {
        e.preventDefault();
        openGoto();
      } else if (e.key === "ArrowLeft" && prev) navigate({ ...prev.pos });
      else if (e.key === "ArrowRight" && next) navigate({ ...next.pos });
      else if (e.key === "j" || e.key === "k" || e.key === "J" || e.key === "K") {
        moveCursor(e.key.toLowerCase() === "j" ? 1 : -1, e.shiftKey);
      } else if ((e.key === " " || e.key === "Enter") && cursor && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        toggleAtCursor();
      } else if (e.key === "w" || e.key === "W") stepWord(e.shiftKey ? -1 : 1);
      else if (chosen.length > 0) {
        if (e.key === "b") bookmarkSelection();
        else if (e.key === "n") openNote();
        else if (e.key === "i") openShare();
        else if (e.key === "c") copySelection();
        else if (/^[1-5]$/.test(e.key)) applyColor(HIGHLIGHT_COLORS[+e.key - 1]);
      }
    };
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <>
      {/* While a dialog is open the page behind it can't be focused or read: the dialog is all there is. */}
      <div className="app-shell" inert={overlayOpen}>
        <header className={`topbar${idle && !overlayOpen ? " is-idle" : ""}`}>
          <button className="location" onClick={openGoto} title={`Go to… (${shortcutLabel("K")} or /)`}>
            {book ? label(pos) : ""}
          </button>
          <div className="topbar-right">
            <button className="topbar-button" onClick={openPlans} title="Reading plans (P)">
              Plans
            </button>
            <button className="topbar-button" onClick={openLibrary} title={`Library: bookmarks, notes and highlights (${shortcutLabel("L")})`}>
              Library
            </button>
            <button className="topbar-button" onClick={() => openSearch()} title={`Search (${shortcutLabel("F")})`}>
              Search
            </button>
            <button className="topbar-button topbar-type" onClick={openSettings} title={`Settings (${shortcutLabel(",")})`} aria-label="Settings">
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
                cursor={cursor?.shown ? cursor.verse : null}
                target={ready ? target : null}
                layout={settings}
                glossary={glossary}
                tags={settings.originalWords ? loaded.tags : null}
                prev={prev}
                next={next}
                onNavigate={(p) => navigate({ ...p })}
                onVerseClick={onVerseClick}
                onOpenNote={openNote}
                onWordClick={showWord}
              />
              {planChips.length > 0 && (
                <div className="plan-chips">
                  {planChips.map(({ plan, day }) => (
                    <div key={plan.id} className="plan-chip" role="group" aria-label={`${plan.name}, day ${day.day}`}>
                      <div className="plan-chip-text">
                        <span className="plan-label">
                          {plan.name} · Day {day.day}
                        </span>
                        <span className="plan-chip-chapters" aria-label={dayLabel(day, bookTitle)}>
                          {day.chapters.map((c) => {
                            const here = c.book === loaded.book && c.chapter === loaded.chapter;
                            return (
                              <button
                                key={`${c.book}-${c.chapter}`}
                                aria-current={here ? "page" : undefined}
                                onClick={() => !here && navigate({ book: c.book, chapter: c.chapter })}
                              >
                                {bookTitle(c.book)} {c.chapter}
                              </button>
                            );
                          })}
                        </span>
                      </div>
                      <button className="plan-chip-done" onClick={() => markPlanDay(plan.id, day.day, true)}>
                        Mark day done
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {ready && chosen.length > 0 && !overlayOpen && (
        <div role="region" aria-label="Verse actions">
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
            onShare={openShare}
            onRefs={chosen.length === 1 ? openRefs : null}
            onClear={clearSelection}
          />
        </div>
      )}

      {help && !overlayOpen && (
        <div role="region" aria-label="Word meaning">
          <WordHelp target={help.target} anchor={help.anchor} onClose={closeHelp} onSearchNumber={searchNumber} />
        </div>
      )}

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement && <span key={announcement.id}>{announcement.text}</span>}
      </div>

      {update && !updateDismissed && !overlayOpen && updateStatus !== "current" && (
        <div className="update-banner" role="region" aria-label="Update available">
          <span>{updateStatus === "installing" ? "Installing the update…" : `Version ${update.version} is available.`}</span>
          <button onClick={() => void installUpdate()} disabled={updateStatus === "installing"}>
            Install and restart
          </button>
          <button onClick={() => setUpdateDismissed(true)} disabled={updateStatus === "installing"}>
            Later
          </button>
        </div>
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
        <Settings
          settings={settings}
          onChange={setSettings}
          onShowVerse={() => setPanel("votd")}
          version={version}
          updateStatus={updateStatus}
          updateVersion={update?.version ?? null}
          onCheckUpdates={() => void checkForUpdate()}
          onInstallUpdate={() => void installUpdate()}
          onClose={closePanel}
        />
      )}
      {panel === "library" && books.length > 0 && <Library books={books} onGo={navigate} onClose={closePanel} />}
      {panel === "plans" && books.length > 0 && (
        <ReadingPlans
          books={books}
          plans={planDefs}
          started={startedPlans}
          today={localDate()}
          onStart={beginPlan}
          onStop={endPlan}
          onRestart={restartPlan}
          onSetDay={markPlanDay}
          onGo={navigate}
          onClose={closePanel}
        />
      )}
      {panel === "share" && shareFor && (
        <ShareCard
          reference={shareFor.reference}
          text={shareFor.text}
          translation={TRANSLATION_NAME}
          fontStack={FONTS[settings.fontFamily].stack}
          uiStack={UI_FONT_STACK}
          theme={settings.theme}
          onClose={closePanel}
        />
      )}
      {panel === "refs" && refsFor && books.length > 0 && (
        <CrossReferences
          books={books}
          translation={TRANSLATION}
          source={refsFor}
          sourceLabel={refsFor.label}
          sourceText={refsFor.text}
          onGo={navigate}
          onClose={closePanel}
        />
      )}
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
