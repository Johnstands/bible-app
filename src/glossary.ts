import { parseReference } from "./reference";
import type { Book } from "./api";

export const KINDS = ["archaic", "changed", "unit"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABELS: Record<Kind, string> = {
  archaic: "Archaic",
  changed: "Changed meaning",
  unit: "Old measure",
};

export interface GlossaryEntry {
  /** Lowercase words or phrases this entry explains. */
  forms: string[];
  kind: Kind;
  meaning: string;
  /** What a modern reader is likely to assume instead. */
  today: string | null;
  /** "Book 1:2" references. When set, the entry applies only in these verses (or, if `except`, in all the others). */
  verses: string[] | null;
  /** True for an "@!" scope: the entry applies everywhere except the listed verses. */
  except: boolean;
  /** The line in glossary.txt, for error messages. */
  line: number;
}

/** Parses data/glossary.txt. Throws a descriptive error for the first bad line. */
export function parseGlossary(text: string): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim() || raw.trimStart().startsWith("#")) return;
    const fail = (why: string): never => {
      throw new Error(`glossary.txt line ${line}: ${why}: ${raw}`);
    };
    const [forms, kind, meaning, today, scope, ...extra] = raw.split("|").map((s) => s.trim());
    if (extra.length) fail("too many fields");
    const list = (forms ?? "").split(",").map((f) => f.trim());
    if (!forms || list.some((f) => !/^[a-z]+(?:['’ ][a-z]+)*$/.test(f))) fail("forms must be lowercase words");
    if (!KINDS.includes(kind as Kind)) fail(`kind must be one of ${KINDS.join(", ")}`);
    if (!meaning) fail("missing meaning");
    let verses: string[] | null = null;
    let except = false;
    if (scope) {
      if (!scope.startsWith("@")) fail("the fifth field must start with @ or @!");
      except = scope.startsWith("@!");
      verses = scope.slice(except ? 2 : 1).split(";").map((v) => v.trim()).filter(Boolean);
      if (verses.length === 0) fail("empty verse list");
    }
    // The data reads "Today: ..."; the popover supplies that label itself.
    const modern = (today ?? "").replace(/^today:\s*/i, "");
    entries.push({ forms: list, kind: kind as Kind, meaning, today: modern || null, verses, except, line });
  });
  return entries;
}

interface Candidate {
  entry: GlossaryEntry;
  /** Verse keys ("book:chapter:verse") the entry is limited to (or excluded from); null means everywhere. */
  scope: ReadonlySet<string> | null;
}

const applies = (c: Candidate, key: string) => c.scope === null || c.scope.has(key) !== c.entry.except;

interface Phrase {
  words: string[];
  candidates: Candidate[];
}

export interface GlossaryIndex {
  words: Map<string, Candidate[]>;
  /** Phrases by their first word, longest first. */
  phrases: Map<string, Phrase[]>;
  entries: GlossaryEntry[];
}

export const verseKey = (book: number, chapter: number, verse: number) => `${book}:${chapter}:${verse}`;

/** Turns parsed entries into a lookup, resolving each verse reference against the book list. */
export function buildIndex(entries: GlossaryEntry[], books: Book[]): GlossaryIndex {
  const words = new Map<string, Candidate[]>();
  const phraseMap = new Map<string, Map<string, Phrase>>();

  for (const entry of entries) {
    let scope: Set<string> | null = null;
    if (entry.verses) {
      scope = new Set();
      for (const ref of entry.verses) {
        const r = parseReference(ref, books);
        if (r.kind !== "ref" || !r.verse) throw new Error(`glossary.txt line ${entry.line}: bad verse "${ref}"`);
        scope.add(verseKey(r.book.id, r.chapter, r.verse));
      }
    }
    for (const form of entry.forms) {
      const parts = form.split(/\s+/);
      if (parts.length === 1) {
        const list = words.get(form) ?? [];
        list.push({ entry, scope });
        words.set(form, list);
      } else {
        const byText = phraseMap.get(parts[0]) ?? new Map<string, Phrase>();
        const phrase = byText.get(form) ?? { words: parts, candidates: [] };
        phrase.candidates.push({ entry, scope });
        byText.set(form, phrase);
        phraseMap.set(parts[0], byText);
      }
    }
  }

  // Scoped entries are more specific, so they are tried before an entry that applies everywhere.
  const specificFirst = (a: Candidate, b: Candidate) => Number(b.scope !== null) - Number(a.scope !== null);
  for (const list of words.values()) list.sort(specificFirst);
  const phrases = new Map<string, Phrase[]>();
  for (const [first, byText] of phraseMap) {
    const list = [...byText.values()];
    for (const p of list) p.candidates.sort(specificFirst);
    phrases.set(first, list.sort((a, b) => b.words.length - a.words.length));
  }
  return { words, phrases, entries };
}

export interface Segment {
  text: string;
  /** Set when this run of text is a word or phrase the glossary explains. */
  entry?: GlossaryEntry;
}

const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

function pick(candidates: Candidate[] | undefined, key: string): GlossaryEntry | null {
  return candidates?.find((c) => applies(c, key))?.entry ?? null;
}

/**
 * Splits verse text into plain runs and glossary matches. A match must be a whole word: a piece of
 * a hyphenated name ("Bath" in "Bath-sheba") never counts, and a capitalised word counts only where
 * a sentence or quotation could begin, so a name such as "Ephod" isn't mistaken for the garment.
 */
export function annotate(text: string, key: string, index: GlossaryIndex): Segment[] {
  const tokens = [...text.matchAll(WORD)].map((m) => ({ word: m[0], start: m.index!, end: m.index! + m[0].length }));
  const segments: Segment[] = [];
  let done = 0; // text before this offset is already emitted

  const emit = (start: number, end: number, entry: GlossaryEntry) => {
    if (start > done) segments.push({ text: text.slice(done, start) });
    segments.push({ text: text.slice(start, end), entry });
    done = end;
  };

  const inHyphenatedName = (t: (typeof tokens)[number]) => text[t.start - 1] === "-" || text[t.end] === "-";
  // A capitalised single word is probably a name unless a sentence or quotation could begin there.
  const mayBeName = (t: (typeof tokens)[number]) => {
    if (!/[A-Z]/.test(t.word[0])) return false;
    const before = text.slice(0, t.start).trimEnd();
    return before !== "" && !/[.!?:;,“”‘’"'(]$/.test(before);
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (inHyphenatedName(t)) continue;
    const lower = t.word.toLowerCase();

    let matched = false;
    for (const phrase of index.phrases.get(lower) ?? []) {
      const parts = tokens.slice(i, i + phrase.words.length);
      const same =
        parts.length === phrase.words.length &&
        parts.every((p, j) => p.word.toLowerCase() === phrase.words[j]) &&
        parts.every((p, j) => j === 0 || /^\s+$/.test(text.slice(parts[j - 1].end, p.start)));
      const entry = same ? pick(phrase.candidates, key) : null;
      if (entry) {
        emit(t.start, parts[parts.length - 1].end, entry);
        i += phrase.words.length - 1;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    if (mayBeName(t)) continue; // phrases were tried above, so a name inside one is still fine
    // "ass’s" and "ass" are the same word.
    const stem = lower.replace(/['’]s$/, "");
    const entry = pick(index.words.get(lower), key) ?? (stem !== lower ? pick(index.words.get(stem), key) : null);
    if (entry) emit(t.start, t.end, entry);
  }
  if (done < text.length) segments.push({ text: text.slice(done) });
  return segments;
}
