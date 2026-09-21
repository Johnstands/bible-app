import { useEffect, useId, useMemo, useRef, useState } from "react";
import { deleteNote, getLibrary, setHighlight, toggleBookmark } from "./api";
import type { Book, Library as LibraryData, LibraryEntry } from "./api";
import { formatDate } from "./dates";
import type { Destination } from "./GoTo";
import { chapterTitle } from "./nav";
import { referenceLabel } from "./verses";
import { useReturnFocus } from "./useReturnFocus";

type Tab = "bookmarks" | "notes" | "highlights";
const TABS: { id: Tab; label: string; empty: string }[] = [
  { id: "bookmarks", label: "Bookmarks", empty: "No bookmarks yet. Select a verse and choose Bookmark." },
  { id: "notes", label: "Notes", empty: "No notes yet. Select a verse and choose Note." },
  { id: "highlights", label: "Highlights", empty: "No highlights yet. Select a verse and pick a color." },
];

interface Props {
  books: Book[];
  onGo: (dest: Destination) => void;
  onClose: () => void;
}

/** Everything the reader has marked, in one place. */
export function Library({ books, onGo, onClose }: Props) {
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [tab, setTab] = useState<Tab>("bookmarks");
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const uid = useId();

  const load = () =>
    getLibrary()
      .then((l) => {
        setLibrary(l);
        setError(null);
      })
      .catch((e) => setError(String(e)));

  useReturnFocus();

  useEffect(() => {
    panelRef.current?.focus();
    void load();
  }, []);

  // Open on the first tab that has something in it.
  const chosen = useRef(false);
  useEffect(() => {
    if (!library || chosen.current) return;
    chosen.current = true;
    const first = TABS.find((t) => library[t.id].length > 0);
    if (first) setTab(first.id);
  }, [library]);

  const rows = library?.[tab] ?? [];
  useEffect(() => setActive(0), [tab]);

  const titleOf = useMemo(() => {
    const byId = new Map(books.map((b) => [b.id, chapterTitle(b)]));
    return (id: number) => byId.get(id) ?? "";
  }, [books]);

  const label = (e: LibraryEntry) => {
    const verses = e.verseEnd ? Array.from({ length: e.verseEnd - e.verse + 1 }, (_, i) => e.verse + i) : [e.verse];
    return referenceLabel(titleOf(e.book), e.chapter, verses);
  };
  const go = (e: LibraryEntry) => onGo({ book: e.book, chapter: e.chapter, verse: e.verse, verseEnd: e.verseEnd ?? undefined });

  const remove = (e: LibraryEntry) => {
    const verses = Array.from({ length: (e.verseEnd ?? e.verse) - e.verse + 1 }, (_, i) => e.verse + i);
    const work =
      tab === "bookmarks"
        ? toggleBookmark(e.book, e.chapter, e.verse)
        : tab === "notes"
          ? deleteNote(e.id)
          : setHighlight(e.book, e.chapter, verses, null);
    work.then(load).catch((err) => setError(String(err)));
  };

  const focusRow = (i: number) => panelRef.current?.querySelectorAll<HTMLElement>(".lib-go")[i]?.focus();
  const focusTab = (id: Tab) => requestAnimationFrame(() => document.getElementById(`${uid}-tab-${id}`)?.focus());

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    const target = e.target as HTMLElement;
    const onTab = target.getAttribute("role") === "tab";
    const row = target.closest("li");
    const at = row ? [...(row.parentElement?.children ?? [])].indexOf(row) : -1;
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length].id;
      setTab(next);
      focusTab(next);
    } else if (e.key === "ArrowDown" && rows.length) {
      focusRow(at < 0 ? 0 : Math.min(rows.length - 1, at + 1));
    } else if (e.key === "ArrowUp" && rows.length) {
      if (at > 0) focusRow(at - 1);
      else if (!onTab) focusTab(tab);
    } else if (e.key === "Enter" && target === e.currentTarget && rows[active]) go(rows[active]);
    else return;
    e.preventDefault();
  };

  const current = TABS.find((t) => t.id === tab)!;
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="goto library"
        role="dialog"
        aria-modal="true"
        aria-label="Library"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="lib-tabs" role="tablist" aria-label="Kinds of marks">
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`${uid}-tab-${t.id}`}
              role="tab"
              aria-selected={t.id === tab}
              aria-controls={`${uid}-panel`}
              tabIndex={t.id === tab ? 0 : -1}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              <span className="lib-count">{library ? library[t.id].length : ""}</span>
            </button>
          ))}
        </div>

        <div className="lib-list" role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab}`}>
          {error && <p className="goto-empty">Couldn’t load the library: {error}</p>}
          {!error && library && rows.length === 0 && <p className="goto-empty">{current.empty}</p>}
          {rows.length > 0 && (
            <ul className="lib-items">
              {rows.map((entry, i) => (
                <li key={`${tab}-${entry.id}`} className="lib-row" data-active={i === active ? "" : undefined} onMouseMove={() => setActive(i)}>
                  <button className="lib-go" onFocus={() => setActive(i)} onClick={() => go(entry)}>
                    <span className="lib-ref">
                      {label(entry)}
                      {entry.color && <span className="lib-dot dot" data-color={entry.color} role="img" aria-label={`${entry.color} highlight`} />}
                      {tab !== "highlights" && <span className="lib-date">{formatDate(entry.at)}</span>}
                    </span>
                    {entry.body && <span className="lib-note">{entry.body}</span>}
                    <span className="lib-text">{entry.text}</span>
                  </button>
                  <button className="lib-remove" aria-label={`Remove ${label(entry)}`} title="Remove" onClick={() => remove(entry)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="goto-footer">
          <span>↑↓ choose · ↵ open · ←→ switch</span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}

