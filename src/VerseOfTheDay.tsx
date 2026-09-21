import { useEffect, useRef, useState } from "react";
import { getChapter } from "./api";
import type { Book } from "./api";
import { TRANSLATION } from "./config";
import type { Destination } from "./GoTo";
import { chapterTitle } from "./nav";
import { parseReference } from "./reference";
import { referenceLabel } from "./verses";
import { verseRefFor } from "./votd";
import { useReturnFocus } from "./useReturnFocus";

interface Props {
  books: Book[];
  date: Date;
  onGo: (dest: Destination) => void;
  onClose: () => void;
}

interface Passage {
  destination: Destination;
  label: string;
  text: string;
}

/** Today's verse, in a quiet card. */
export function VerseOfTheDay({ books, date, onGo, onClose }: Props) {
  const [passage, setPassage] = useState<Passage | null>(null);
  const [failed, setFailed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useReturnFocus();

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const parsed = parseReference(verseRefFor(date), books);
    if (parsed.kind !== "ref" || !parsed.verse) {
      setFailed(true);
      return;
    }
    const { book, chapter, verse, verseEnd } = parsed;
    getChapter(TRANSLATION, book.id, chapter)
      .then((verses) => {
        const end = verseEnd ?? verse;
        const covered = verses.filter((v) => v.verse >= verse && v.verse <= end);
        setPassage({
          destination: { book: book.id, chapter, verse, verseEnd },
          label: referenceLabel(chapterTitle(book), chapter, covered.map((v) => v.verse)),
          text: covered.map((v) => v.text).join(" "),
        });
      })
      .catch(() => setFailed(true));
  }, [books, date]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter" && passage && e.target === e.currentTarget) {
      e.preventDefault();
      onGo(passage.destination);
    }
  };

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="goto votd"
        role="dialog"
        aria-modal="true"
        aria-label="Verse of the day"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 className="votd-heading">Verse of the day</h2>
        <div className="ornament" aria-hidden="true" />
        {failed && <p className="votd-text">Today’s verse couldn’t be loaded.</p>}
        {passage && (
          <>
            <blockquote className="votd-text">{passage.text}</blockquote>
            <p className="votd-ref">{passage.label}</p>
          </>
        )}
        <div className="votd-actions">
          <button onClick={onClose}>Close</button>
          {passage && <button className="votd-read" onClick={() => onGo(passage.destination)}>Read in context</button>}
        </div>
      </div>
    </div>
  );
}
