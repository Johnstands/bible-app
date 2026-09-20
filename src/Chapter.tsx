import type { Book, Verse } from "./api";
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
  target: Target | null;
  prev: Neighbor | null;
  next: Neighbor | null;
  onNavigate: (pos: Position) => void;
}

export function Chapter({ book, chapter, verses, target, prev, next, onNavigate }: Props) {
  const items = toItems(verses);
  // Psalms open with a title and stanzas, so the chapter number is centered above them
  // instead of dropping into the first line.
  const poetic = verses[0]?.kind === "q";

  const renderVerse = (v: Verse) => {
    const hit = target !== null && v.verse >= target.verse && v.verse <= target.end;
    return (
      <span
        key={hit ? `${v.verse}-${target.id}` : v.verse}
        className={hit ? "verse is-target" : "verse"}
        data-verse={v.verse}
      >
        {v.verse !== 1 && (
          <sup className="vn">
            {v.verse}
            {v.verseEnd ? `–${v.verseEnd}` : ""}
          </sup>
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
        const numeral = !poetic && i === 0 ? dropNumeral : null;
        if (item.kind === "q") {
          return (
            <p key={i} className={item.gap ? "line stanza" : "line"}>
              {item.verses.map(renderVerse)}
            </p>
          );
        }
        return (
          <p key={i} className={first ? "para first" : "para"}>
            {numeral}
            {item.verses.map(renderVerse)}
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
