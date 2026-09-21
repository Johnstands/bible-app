import type { Book, ChapterMarks, HighlightColor, Verse } from "./api";
import { chapterTitle } from "./nav";
import type { Position } from "./nav";

export interface Target {
  verse: number;
  end: number;
  /** Changes on every jump, so jumping to the same verse again replays the highlight. */
  id: number;
}

export interface Neighbor {
  pos: Position;
  label: string;
}

export interface Layout {
  verseByVerse: boolean;
  pilcrows: boolean;
}

type Item =
  | { type: "heading"; kind: "title" | "section"; text: string }
  | { type: "subscription"; text: string }
  | { type: "block"; kind: "p" | "q"; gap: boolean; verses: Verse[] };

/** Groups verses into paragraphs and poetry lines, interleaved with headings. */
function toItems(verses: Verse[]): Item[] {
  const items: Item[] = [];
  let open = false; // whether the last item is a block that later verses may join
  for (const v of verses) {
    if (v.heading && v.headingKind) {
      items.push({ type: "heading", kind: v.headingKind, text: v.heading });
      open = false;
    }
    const last = items[items.length - 1];
    if (open && !v.newBlock && last.type === "block") {
      last.verses.push(v);
    } else {
      items.push({ type: "block", kind: v.kind, gap: v.gap, verses: [v] });
      open = true;
    }
    if (v.subscription) {
      items.push({ type: "subscription", text: v.subscription });
      open = false;
    }
  }
  return items;
}

interface Props {
  book: Book;
  chapter: number;
  verses: Verse[];
  marks: ChapterMarks;
  selected: ReadonlySet<number>;
  target: Target | null;
  layout: Layout;
  prev: Neighbor | null;
  next: Neighbor | null;
  onNavigate: (pos: Position) => void;
  onVerseClick: (verse: number, e: React.MouseEvent) => void;
  onOpenNote: (verse: number) => void;
}

export function Chapter({
  book, chapter, verses, marks, selected, target, layout, prev, next,
  onNavigate, onVerseClick, onOpenNote,
}: Props) {
  const items = toItems(verses);
  const firstBlock = items.findIndex((i) => i.type === "block");
  // Psalms open with a title and stanzas, so the chapter number is centered above them
  // instead of dropping into the first line.
  const poetic = verses[0]?.kind === "q";

  const colors = new Map<number, HighlightColor>(marks.highlights.map((h) => [h.verse, h.color]));
  const notes = new Set(marks.notes.map((n) => n.verse));
  const bookmarks = new Set(marks.bookmarks);

  const renderVerse = (v: Verse, pilcrow: boolean) => {
    const hit = target !== null && v.verse >= target.verse && v.verse <= target.end;
    const classes = ["verse", hit && "is-target", selected.has(v.verse) && "is-selected"].filter(Boolean).join(" ");
    return (
      <span
        key={hit ? `${v.verse}-${target.id}` : v.verse}
        className={classes}
        data-verse={v.verse}
        data-hl={colors.get(v.verse)}
        onClick={(e) => onVerseClick(v.verse, e)}
        onMouseDown={(e) => {
          // Keep modifier-clicks (extend or toggle the verse selection) from also selecting text.
          if (e.shiftKey || e.ctrlKey || e.metaKey) e.preventDefault();
        }}
      >
        {pilcrow && (
          <span className="pilcrow" aria-hidden="true">
            ¶
          </span>
        )}
        {v.verse !== 1 && (
          <sup className="vn">
            {v.verse}
            {v.verseEnd ? `–${v.verseEnd}` : ""}
          </sup>
        )}
        {bookmarks.has(v.verse) && <span className="mk mk-bookmark" role="img" aria-label="Bookmarked" />}
        {notes.has(v.verse) && (
          <button
            className="mk mk-note"
            aria-label="Open note"
            onClick={(e) => {
              e.stopPropagation();
              onOpenNote(v.verse);
            }}
          />
        )}
        {v.text}{" "}
      </span>
    );
  };

  const dropNumeral = (
    <span className="dropnum" aria-label={`Chapter ${chapter}`}>
      {chapter}
    </span>
  );

  return (
    <article className="chapter">
      <h1 className="book-name">{chapterTitle(book)}</h1>
      {poetic && <div className="chapter-numeral">{chapter}</div>}
      <div className="ornament" aria-hidden="true" />
      {items.map((item, i) => {
        if (item.type === "heading") {
          return item.kind === "title" ? (
            <p key={i} className="superscription">
              {item.text}
            </p>
          ) : (
            <h2 key={i} className="section-heading">
              {item.text}
            </h2>
          );
        }
        if (item.type === "subscription") {
          return (
            <p key={i} className="subscription">
              {item.text}
            </p>
          );
        }
        const first = i === 0 || items[i - 1].type !== "block";
        const numeral = !poetic && i === firstBlock ? dropNumeral : null;
        if (item.kind === "q") {
          return (
            <p key={i} className={item.gap ? "line stanza" : "line"}>
              {item.verses.map((v) => renderVerse(v, false))}
            </p>
          );
        }
        // A paragraph opens with a pilcrow, except the chapter's first, which the chapter number marks.
        const pilcrowAt = (v: Verse) => layout.pilcrows && v.newBlock && i !== firstBlock;
        if (layout.verseByVerse) {
          return item.verses.map((v, j) => {
            const opensChapter = i === firstBlock && j === 0;
            const classes = ["line", opensChapter && "opens", v.newBlock && !opensChapter && "stanza"]
              .filter(Boolean)
              .join(" ");
            return (
              <p key={`${i}-${v.verse}`} className={classes}>
                {opensChapter && numeral}
                {renderVerse(v, pilcrowAt(v))}
              </p>
            );
          });
        }
        return (
          <p key={i} className={first ? "para first" : "para"}>
            {numeral}
            {item.verses.map((v) => renderVerse(v, pilcrowAt(v)))}
          </p>
        );
      })}
      <nav className="chapter-nav" aria-label="Chapter navigation">
        {prev ? <button onClick={() => onNavigate(prev.pos)}>← {prev.label}</button> : <span />}
        {next ? <button onClick={() => onNavigate(next.pos)}>{next.label} →</button> : <span />}
      </nav>
    </article>
  );
}
