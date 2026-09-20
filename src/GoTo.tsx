import { useEffect, useMemo, useRef, useState } from "react";
import type { Book } from "./api";
import { chapterTitle } from "./nav";
import type { Position } from "./nav";
import { parseReference } from "./reference";

export interface Destination extends Position {
  verse?: number;
  verseEnd?: number;
}

interface Row {
  label: string;
  hint?: string;
  go?: Destination;
}

interface Props {
  books: Book[];
  current: Position;
  onGo: (dest: Destination) => void;
  onClose: () => void;
}

/** A jump box ("jn 3:16") that doubles as a book and chapter browser while it is empty. */
export function GoTo({ books, current, onGo, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [browsed, setBrowsed] = useState(current.book);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  const rows = useMemo<Row[]>(() => {
    const parsed = parseReference(query, books);
    switch (parsed.kind) {
      case "ref": {
        const { book, chapter, verse, verseEnd } = parsed;
        const label = `${chapterTitle(book)} ${chapter}${verse ? `:${verse}${verseEnd ? `–${verseEnd}` : ""}` : ""}`;
        return [{ label, hint: "↵", go: { book: book.id, chapter, verse, verseEnd } }];
      }
      case "books":
        return parsed.books.map((b) => {
          const chapter = Math.min(parsed.chapter ?? 1, b.chapters);
          return { label: `${b.name}${parsed.chapter ? ` ${chapter}` : ""}`, go: { book: b.id, chapter } };
        });
      case "invalid":
        return [{ label: parsed.message }];
      default:
        return [];
    }
  }, [query, books]);

  const browsing = query.trim() === "";
  const browsedBook = books.find((b) => b.id === browsed);

  useEffect(() => setActive(0), [rows]);

  // Keep the highlighted row or book in view as the arrow keys move it.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, browsed, browsing]);

  const onKeyDown = (e: React.KeyboardEvent) => {
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
      else if (rows[active]?.go) onGo(rows[active].go);
    }
  };

  const renderBooks = (testament: "OT" | "NT", heading: string) => (
    <>
      <div className="goto-group">{heading}</div>
      {books
        .filter((b) => b.testament === testament)
        .map((b) => (
          <button
            key={b.id}
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
    </>
  );

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
          spellCheck={false}
          autoComplete="off"
        />
        {browsing ? (
          <div className="goto-browse">
            <div className="goto-books" role="listbox" aria-label="Books" ref={listRef}>
              {renderBooks("OT", "Old Testament")}
              {renderBooks("NT", "New Testament")}
            </div>
            <div className="goto-chapters" aria-label={`${browsedBook?.name} chapters`}>
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
          <div className="goto-results" role="listbox" ref={listRef}>
            {rows.length === 0 && <p className="goto-empty">No matching book</p>}
            {rows.map((row, i) => (
              <button
                key={row.label}
                role="option"
                aria-selected={i === active}
                disabled={!row.go}
                className="goto-row"
                onClick={() => row.go && onGo(row.go)}
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
