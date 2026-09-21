import type { CrossRef } from "./api";
import type { Destination } from "./GoTo";
import { referenceLabel } from "./verses";

const inOneChapter = (r: CrossRef) => r.endChapter === r.chapter;

/** "Romans 1:19–20", or "Genesis 11:32–12:1" when the passage runs into the next chapter. `title` is the book's name. */
export function crossRefLabel(title: string, r: CrossRef): string {
  if (!inOneChapter(r)) return `${title} ${r.chapter}:${r.verse}–${r.endChapter}:${r.endVerse}`;
  const verses = Array.from({ length: Math.max(0, r.endVerse - r.verse) + 1 }, (_, i) => r.verse + i);
  return referenceLabel(title, r.chapter, verses);
}

/**
 * Where to jump for a cross-reference. The reader highlights a run of verses within one chapter, so a passage that
 * runs into the next chapter is highlighted only up to the end of its first.
 */
export function crossRefDestination(r: CrossRef): Destination {
  const dest: Destination = { book: r.book, chapter: r.chapter, verse: r.verse };
  if (inOneChapter(r) && r.endVerse > r.verse) dest.verseEnd = r.endVerse;
  return dest;
}
