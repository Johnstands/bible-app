import type { Verse } from "./api";

/** Formats verse numbers as runs: [16, 17, 18, 20] becomes "16–18, 20". */
export function formatVerses(verses: Iterable<number>): string {
  const sorted = [...new Set(verses)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(j > i ? `${sorted[i]}–${sorted[j]}` : `${sorted[i]}`);
    i = j + 1;
  }
  return runs.join(", ");
}

/** "John 3:16–18", or just "John 3" when no verses are given. */
export function referenceLabel(title: string, chapter: number, verses: Iterable<number> = []): string {
  const v = formatVerses(verses);
  return v ? `${title} ${chapter}:${v}` : `${title} ${chapter}`;
}

/** The selected verses as one quotation followed by its reference, ready for the clipboard. */
export function quotation(title: string, chapter: number, verses: Verse[], selected: ReadonlySet<number>): string {
  const chosen = verses.filter((v) => selected.has(v.verse));
  const text = chosen.map((v) => v.text).join(" ");
  return `“${text}”\n— ${referenceLabel(title, chapter, chosen.map((v) => v.verse))} (KJV)`;
}

/** The first and last of the given verse numbers, which is the span a note covers. */
export function span(verses: Iterable<number>): { verse: number; verseEnd: number | null } {
  const sorted = [...verses].sort((a, b) => a - b);
  const verse = sorted[0];
  const last = sorted[sorted.length - 1];
  return { verse, verseEnd: last > verse ? last : null };
}
