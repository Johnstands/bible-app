import type { WordTag } from "./api";
import type { GlossaryEntry, Segment } from "./glossary";

/** What a click on a word in the text opens: word help, the original-language word, or both. */
export interface WordTarget {
  /** The word or phrase as the verse prints it. */
  word: string;
  entry?: GlossaryEntry;
  /** Strong's numbers, e.g. `H7225`. */
  nums?: string[];
}

/** A run of verse text; it is clickable when it has `entry` or `nums`. The runs of a verse join back into its text. */
export interface Unit {
  text: string;
  entry?: GlossaryEntry;
  /** The glossary's own wording when it matched a longer phrase than this unit ("I pray thee" over "pray"). */
  helpWord?: string;
  nums?: string[];
}

interface Span {
  start: number;
  end: number;
  entry?: GlossaryEntry;
  helpWord?: string;
  nums?: string[];
}

/**
 * Splits a verse into plain and clickable runs. Words with Strong's numbers (`tags`) are clickable units; a
 * glossary word or phrase (`segments`, as `annotate` returns them) that overlaps them is attached to those units,
 * so one click shows both. A glossary word with no tag stays a unit of its own. `shows` decides which glossary
 * entries count, so the word-help level still applies. Either input may be null.
 */
export function buildUnits(
  text: string,
  segments: readonly Segment[] | null,
  tags: readonly WordTag[] | null,
  shows: (entry: GlossaryEntry) => boolean,
): Unit[] {
  const spans: Span[] = [];
  let last = 0;
  for (const t of [...(tags ?? [])].sort((a, b) => a.start - b.start)) {
    // A tag that doesn't fit the text, or overlaps the one before it, would garble the verse; skip it.
    if (t.start < last || t.end <= t.start || t.end > text.length) continue;
    spans.push({ start: t.start, end: t.end, nums: [t.num] });
    last = t.end;
  }

  let at = 0;
  const helped: Span[] = [];
  for (const seg of segments ?? []) {
    const end = at + seg.text.length;
    if (seg.entry && shows(seg.entry)) helped.push({ start: at, end, entry: seg.entry, helpWord: seg.text });
    at = end;
  }
  const alone: Span[] = [];
  for (const h of helped) {
    const over = spans.filter((s) => s.nums && s.start < h.end && s.end > h.start);
    if (over.length === 0) alone.push(h);
    for (const s of over) {
      s.entry ??= h.entry;
      s.helpWord ??= h.helpWord;
    }
  }

  const all = [...spans, ...alone].sort((a, b) => a.start - b.start);
  const units: Unit[] = [];
  let done = 0;
  for (const s of all) {
    if (s.start > done) units.push({ text: text.slice(done, s.start) });
    const unit: Unit = { text: text.slice(s.start, s.end) };
    if (s.entry) unit.entry = s.entry;
    if (s.helpWord && s.helpWord !== unit.text) unit.helpWord = s.helpWord;
    if (s.nums) unit.nums = s.nums;
    units.push(unit);
    done = s.end;
  }
  if (done < text.length) units.push({ text: text.slice(done) });
  return units;
}
