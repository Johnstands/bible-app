import { useEffect, useId, useRef, useState } from "react";
import { search } from "./api";
import type { Book, SearchHit, SearchResults, SearchScope } from "./api";
import type { Destination } from "./GoTo";
import { splitMarks } from "./highlight";
import { chapterTitle } from "./nav";
import { useReturnFocus } from "./useReturnFocus";

const PAGE_SIZE = 50;
const DEBOUNCE_MS = 120;

export interface SearchMemory {
  query: string;
  scope: SearchScope;
}

export const EMPTY_SEARCH: SearchMemory = { query: "", scope: { testament: null, book: null } };

interface Props {
  books: Book[];
  /** Where the last search left off, so coming back from a result keeps the query and filters. */
  initial: SearchMemory;
  onRemember: (memory: SearchMemory) => void;
  onGo: (dest: Destination) => void;
  onClose: () => void;
}

const formatCount = (n: number) => n.toLocaleString("en-US");

export function Search({ books, initial, onRemember, onGo, onClose }: Props) {
  const [query, setQuery] = useState(initial.query);
  const [scope, setScope] = useState(initial.scope);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const request = useRef(0); // lets a slow response for an older query be ignored
  const uid = useId();

  useReturnFocus();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => onRemember({ query, scope }), [query, scope, onRemember]);

  useEffect(() => {
    const q = query.trim();
    const id = ++request.current;
    if (!q) {
      setResults(null);
      setError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      search(q, scope, PAGE_SIZE, 0)
        .then((r) => {
          if (id !== request.current) return;
          setResults(r);
          setActive(0);
          setError(null);
        })
        .catch((e) => id === request.current && setError(String(e)));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, scope]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, results]);

  const hits = results?.hits ?? [];
  const canLoadMore = results !== null && hits.length < results.total;

  const loadMore = () => {
    const id = request.current;
    search(query.trim(), scope, PAGE_SIZE, hits.length)
      .then((r) => {
        if (id !== request.current) return;
        setResults((prev) => (prev ? { total: r.total, hits: [...prev.hits, ...r.hits] } : r));
      })
      .catch((e) => setError(String(e)));
  };

  const go = (hit: SearchHit) => onGo({ book: hit.book, chapter: hit.chapter, verse: hit.verse });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (e.key === "ArrowDown" && active === hits.length - 1 && canLoadMore) loadMore();
      setActive((a) => Math.max(0, Math.min(hits.length - 1, a + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    }
  };

  const setTestament = (testament: SearchScope["testament"]) => setScope({ testament, book: null });
  const bookName = (id: number) => {
    const b = books.find((x) => x.id === id);
    return b ? chapterTitle(b) : "";
  };

  const trimmed = query.trim();
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        className="goto search"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="goto-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the Bible… love, or “in the beginning”"
          aria-label="Search the Bible"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={`${uid}-hits`}
          aria-autocomplete="list"
          aria-activedescendant={hits[active] ? `${uid}-hit-${active}` : undefined}
          spellCheck={false}
          autoComplete="off"
        />
        <div className="search-filters" role="group" aria-label="Where to search">
          <button aria-pressed={!scope.testament && !scope.book} onClick={() => setTestament(null)}>
            Whole Bible
          </button>
          <button aria-pressed={scope.testament === "OT"} onClick={() => setTestament("OT")}>
            Old Testament
          </button>
          <button aria-pressed={scope.testament === "NT"} onClick={() => setTestament("NT")}>
            New Testament
          </button>
          <span className="select-wrap">
          <select
            aria-label="Search one book"
            data-active={scope.book ? "" : undefined}
            value={scope.book ?? ""}
            onChange={(e) => setScope({ testament: null, book: e.target.value ? +e.target.value : null })}
          >
            <option value="">Any book</option>
            <optgroup label="Old Testament">
              {books.filter((b) => b.testament === "OT").map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </optgroup>
            <optgroup label="New Testament">
              {books.filter((b) => b.testament === "NT").map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </optgroup>
          </select>
          </span>
        </div>

        <div className="search-results" ref={listRef} tabIndex={0} aria-label="Search results">
          {error && <p className="goto-empty">Search failed: {error}</p>}
          {!error && !trimmed && (
            <p className="goto-empty">Search the King James Bible. Put words in quotes to find an exact phrase.</p>
          )}
          {!error && trimmed && results && hits.length === 0 && (
            <p className="goto-empty">No verses match “{trimmed}”.</p>
          )}
          {hits.length > 0 && (
            <div role="listbox" id={`${uid}-hits`} aria-label="Matching verses">
              {hits.map((hit, i) => (
                <button
                  key={`${hit.book}-${hit.chapter}-${hit.verse}`}
                  id={`${uid}-hit-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className="hit"
                  tabIndex={-1}
                  onClick={() => go(hit)}
                  onMouseMove={() => setActive(i)}
                >
                  <span className="hit-ref">
                    {bookName(hit.book)} {hit.chapter}:{hit.verse}
                  </span>
                  <span className="hit-text">
                    {splitMarks(hit.snippet).map((seg, j) =>
                      seg.match ? <mark key={j}>{seg.text}</mark> : seg.text,
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
          {canLoadMore && (
            <button className="hit-more" onClick={loadMore}>
              Show more
            </button>
          )}
        </div>

        <div className="goto-footer">
          <span>
            {results
              ? `${formatCount(results.total)} verse${results.total === 1 ? "" : "s"}` +
                (hits.length < results.total ? ` · showing ${formatCount(hits.length)}` : "")
              : "↑↓ choose · ↵ go"}
          </span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
