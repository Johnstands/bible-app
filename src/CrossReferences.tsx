import { useEffect, useMemo, useRef, useState } from "react";
import { getCrossRefs } from "./api";
import type { Book, CrossRef } from "./api";
import { crossRefDestination, crossRefLabel } from "./crossRefs";
import type { Destination } from "./GoTo";
import { chapterTitle } from "./nav";
import { useReturnFocus } from "./useReturnFocus";

export interface RefSource {
  book: number;
  chapter: number;
  verse: number;
}

interface Props {
  books: Book[];
  translation: string;
  source: RefSource;
  /** "John 3:16" */
  sourceLabel: string;
  sourceText: string;
  onGo: (dest: Destination) => void;
  onClose: () => void;
}

/** Other passages that bear on one verse, best first; choose one to read it. */
export function CrossReferences({ books, translation, source, sourceLabel, sourceText, onGo, onClose }: Props) {
  const [refs, setRefs] = useState<CrossRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  useReturnFocus();

  useEffect(() => {
    panelRef.current?.focus();
    let stale = false;
    getCrossRefs(translation, source.book, source.chapter, source.verse)
      .then((r) => !stale && setRefs(r))
      .catch((e) => !stale && setError(String(e)));
    return () => {
      stale = true;
    };
  }, [translation, source.book, source.chapter, source.verse]);

  const titleOf = useMemo(() => {
    const byId = new Map(books.map((b) => [b.id, chapterTitle(b)]));
    return (id: number) => byId.get(id) ?? "";
  }, [books]);

  const focusRow = (i: number) => panelRef.current?.querySelectorAll<HTMLElement>(".lib-go")[i]?.focus();

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    const count = refs?.length ?? 0;
    const row = (e.target as HTMLElement).closest("li");
    const at = row ? [...(row.parentElement?.children ?? [])].indexOf(row) : -1;
    if (e.key === "ArrowDown" && count) focusRow(at < 0 ? 0 : Math.min(count - 1, at + 1));
    else if (e.key === "ArrowUp" && count) focusRow(Math.max(0, at - 1));
    else if (e.key === "Enter" && e.target === e.currentTarget && refs?.[active]) onGo(crossRefDestination(refs[active]));
    else return;
    e.preventDefault();
  };

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="goto library xrefs"
        role="dialog"
        aria-modal="true"
        aria-label={`Cross-references for ${sourceLabel}`}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="xr-head">
          <h2 className="xr-title">
            Cross-references
            {refs && refs.length > 0 && <span className="lib-count">{refs.length}</span>}
          </h2>
          <p className="xr-source">
            <span className="xr-source-ref">{sourceLabel}</span> {sourceText}
          </p>
        </div>

        <div className="lib-list">
          {error && <p className="goto-empty">Couldn’t load the cross-references: {error}</p>}
          {!error && !refs && <p className="goto-empty" role="status">Looking…</p>}
          {refs && refs.length === 0 && <p className="goto-empty">No cross-references for this verse.</p>}
          {refs && refs.length > 0 && (
            <ul className="lib-items">
              {refs.map((r, i) => (
                <li
                  key={`${r.book}.${r.chapter}.${r.verse}-${r.endChapter}.${r.endVerse}`}
                  className="lib-row"
                  data-active={i === active ? "" : undefined}
                  onMouseMove={() => setActive(i)}
                >
                  <button className="lib-go" onFocus={() => setActive(i)} onClick={() => onGo(crossRefDestination(r))}>
                    <span className="lib-ref">{crossRefLabel(titleOf(r.book), r)}</span>
                    <span className="lib-text">{r.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="goto-footer">
          <span>↑↓ choose · ↵ open</span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
