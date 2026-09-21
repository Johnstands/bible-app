import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Book } from "./api";
import { chapterTitle } from "./nav";
import type { Position } from "./nav";
import { parseReference } from "./reference";
import { useReturnFocus } from "./useReturnFocus";
import { shortcutLabel } from "./platform";

export interface Destination extends Position {
  verse?: number;
  verseEnd?: number;
}

interface Row {
  label: string;
  hint?: string;
  go?: Destination;
  /** Hands the typed text to the search panel instead of navigating. */
  search?: boolean;
}

interface Props {
  books: Book[];
  current: Position;
  onGo: (dest: Destination) => void;
  onSearch: (query: string) => void;
  onClose: () => void;
}

/** A jump box ("jn 3:16") that doubles as a book and chapter browser while it is empty. */
export function GoTo({ books, current, onGo, onSearch, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [browsed, setBrowsed] = useState(current.book);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const listId = `${uid}-list`;

  useReturnFocus();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const rows = useMemo<Row[]>(() => {
    const parsed = parseReference(query, books);
    let found: Row[] = [];
    switch (parsed.kind) {
      case "ref": {
        const { book, chapter, verse, verseEnd } = parsed;
        const label = `${chapterTitle(book)} ${chapter}${verse ? `:${verse}${verseEnd ? `–${verseEnd}` : ""}` : ""}`;
        found = [{ label, hint: "↵", go: { book: book.id, chapter, verse, verseEnd } }];
        break;
      }
      case "books":
        found = parsed.books.map((b) => {
          const chapter = Math.min(parsed.chapter ?? 1, b.chapters);
          return { label: `${b.name}${parsed.chapter ? ` ${chapter}` : ""}`, go: { book: b.id, chapter } };
        });
        break;
      case "invalid":
        found = [{ label: parsed.message }];
        break;
    }
    // Anything typed can also be searched for, so "job" can mean the book or the word.
    const text = query.trim();
    return text ? [...found, { label: `Search for “${text}”`, hint: shortcutLabel("F"), search: true }] : found;
  }, [query, books]);

  const browsing = query.trim() === "";
  const browsedBook = books.find((b) => b.id === browsed);

  useEffect(() => setActive(0), [rows]);

  // Keep the highlighted row or book in view as the arrow keys move it.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, browsed, browsing]);

  const choose = (row: Row) => {
    if (row.search) onSearch(query.trim());
    else if (row.go) onGo(row.go);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      // Stop here so the app's own Ctrl+F handler doesn't reopen search without the typed text.
      e.preventDefault();
      e.stopPropagation();
      onSearch(query.trim());
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (step) {
      e.preventDefault();
      if (browsing) {
        const i = books.findIndex((b) => b.id === browsed);
        setBrowsed(books[Math.max(0, Math.min(books.length - 1, i + step))].id);
      } else if (rows.length) {
        setActive((a) => (a + step + rows.length) % rows.length);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (browsing) onGo({ book: browsed, chapter: 1 });
      else if (rows[active]) choose(rows[active]);
    }
  };

  const renderBooks = (testament: "OT" | "NT", heading: string) => (
    <div role="group" aria-labelledby={`${uid}-${testament}`}>
      <div className="goto-group" id={`${uid}-${testament}`}>
        {heading}
      </div>
      {books
        .filter((b) => b.testament === testament)
        .map((b) => (
          <button
            key={b.id}
            id={`${uid}-book-${b.id}`}
            role="option"
            aria-selected={b.id === browsed}
            className="goto-row"
            onClick={() => setBrowsed(b.id)}
            onDoubleClick={() => onGo({ book: b.id, chapter: 1 })}
            tabIndex={-1}
          >
            {b.name}
          </button>
        ))}
    </div>
  );

  // The input drives whichever list is showing, and says which entry is current.
  const activeId = browsing ? `${uid}-book-${browsed}` : rows[active] ? `${uid}-row-${active}` : undefined;

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        className="goto"
        role="dialog"
        aria-modal="true"
        aria-label="Go to"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="goto-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Go to… John 3:16, 1 Cor 13, Ps 23"
          aria-label="Go to a book, chapter or verse"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          spellCheck={false}
          autoComplete="off"
        />
        {browsing ? (
          <div className="goto-browse">
            <div className="goto-books" role="listbox" id={listId} aria-label="Books" ref={listRef} tabIndex={0}>
              {renderBooks("OT", "Old Testament")}
              {renderBooks("NT", "New Testament")}
            </div>
            <div className="goto-chapters" role="group" aria-label={`${browsedBook?.name} chapters`}>
              {Array.from({ length: browsedBook?.chapters ?? 0 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  className="goto-chapter"
                  aria-current={browsed === current.book && n === current.chapter ? "true" : undefined}
                  onClick={() => onGo({ book: browsed, chapter: n })}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="goto-results" role="listbox" id={listId} aria-label="Matches" ref={listRef} tabIndex={0}>
            {rows.map((row, i) => (
              <button
                key={row.label}
                id={`${uid}-row-${i}`}
                role="option"
                aria-selected={i === active}
                disabled={!row.go && !row.search}
                className="goto-row"
                onClick={() => choose(row)}
                onMouseMove={() => setActive(i)}
                tabIndex={-1}
              >
                <span>{row.label}</span>
                {row.hint && <span className="goto-hint-key">{row.hint}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="goto-footer">
          {browsing ? "↑↓ choose a book · ↵ open it · or pick a chapter" : "↑↓ choose · ↵ go"}
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
