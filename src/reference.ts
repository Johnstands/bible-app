import type { Book } from "./api";

export type ParsedReference =
  | { kind: "ref"; book: Book; chapter: number; verse?: number; verseEnd?: number }
  /** The text names a book but not uniquely (e.g. "jo", "kings"). */
  | { kind: "books"; books: Book[]; chapter?: number }
  /** A book was recognised but the chapter is out of range. */
  | { kind: "invalid"; message: string }
  | { kind: "none" };

// Extra spellings by USFX book code, beyond the name and abbreviation stored in the DB.
// Lowercase, no spaces, and without any leading number ("1 Sam" is stored as "sam" on 1SA).
const ALIASES: Record<string, string[]> = {
  GEN: ["ge", "gn"], EXO: ["ex", "exo", "exod"], LEV: ["le", "lv"], NUM: ["nu", "nm", "nb"],
  DEU: ["dt", "de"], JOS: ["jsh"], JDG: ["jg", "jdgs"], RUT: ["rth", "ru"],
  "1SA": ["sm", "sa"], "2SA": ["sm", "sa"], "1KI": ["kgs", "ki", "kin", "kings"], "2KI": ["kgs", "ki", "kin", "kings"],
  "1CH": ["chron", "ch"], "2CH": ["chron", "ch"], EZR: [], NEH: ["ne"], EST: ["es"], JOB: ["jb"],
  PSA: ["ps", "psa", "psalm", "pslm", "psm", "pss"], PRO: ["prov", "pro", "prv", "pr"],
  ECC: ["eccles", "ecc", "ec", "qoh"], SNG: ["sos", "so", "sng", "songofsongs", "canticles"],
  ISA: ["is"], JER: ["je", "jr"], LAM: ["la"], EZK: ["eze", "ezk"], DAN: ["da", "dn"],
  HOS: ["ho"], JOL: ["jl"], AMO: ["am"], OBA: ["ob"], JON: ["jnh"], MIC: ["mc"], NAM: ["na"],
  HAB: ["hb"], ZEP: ["zep", "zp"], HAG: ["hg"], ZEC: ["zec", "zc"], MAL: ["ml"],
  MAT: ["mt"], MRK: ["mrk", "mk", "mr"], LUK: ["lk"], JHN: ["jn", "jhn"], ACT: ["ac"],
  ROM: ["ro", "rm"], "1CO": ["cor"], "2CO": ["cor"], GAL: ["ga"], EPH: ["ephes"],
  PHP: ["php", "pp"], COL: [], "1TH": ["thes", "th"], "2TH": ["thes", "th"],
  "1TI": ["ti", "tm"], "2TI": ["ti", "tm"], TIT: [], PHM: ["philem", "phm", "pm"], HEB: [],
  JAS: ["jm"], "1PE": ["pe", "pt"], "2PE": ["pe", "pt"], "1JN": ["jn", "jhn"], "2JN": ["jn", "jhn"],
  "3JN": ["jn", "jhn"], JUD: ["jud", "jd"], REV: ["re", "rv", "revelations"],
};

interface Entry {
  book: Book;
  ordinal: number | null;
  names: string[];
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Splits "1 Samuel" into its leading number and the rest. */
function splitOrdinal(name: string): [number | null, string] {
  const m = /^([123])\s+(.*)$/.exec(name);
  return m ? [+m[1], m[2]] : [null, name];
}

const cache = new WeakMap<Book[], Entry[]>();
function entriesFor(books: Book[]): Entry[] {
  let entries = cache.get(books);
  if (!entries) {
    entries = books.map((book) => {
      const [ordinal, base] = splitOrdinal(book.name);
      const [, abbrev] = splitOrdinal(book.abbrev);
      const names = [base, abbrev, ...(ALIASES[book.code] ?? [])].map(squash);
      return { book, ordinal, names: [...new Set(names)] };
    });
    cache.set(books, entries);
  }
  return entries;
}

const ORDINALS: Record<string, number> = {
  "1": 1, "2": 2, "3": 3, "1st": 1, "2nd": 2, "3rd": 3,
  first: 1, second: 2, third: 3, i: 1, ii: 2, iii: 3,
};

// [ordinal] book [chapter [verse[-end]]]. A roman numeral must be followed by a space so that
// "isa" isn't read as "i" + "sa", while "1cor13" (no spaces) still parses.
const PATTERN =
  /^(?:(?:(1st|2nd|3rd|first|second|third|[123])\s*)|(?:(iii|ii|i)\s+))?([a-z][a-z ]*?)\s*(?:(\d+)(?:\s*[:.\s]\s*(\d+)(?:\s*[-–—]\s*(\d+))?)?)?\s*:?$/;

function findBooks(entries: Entry[], ordinal: number | null, name: string): Book[] {
  const key = squash(name);
  const search = (pool: Entry[]) => {
    const exact = pool.filter((e) => e.names.includes(key));
    return (exact.length ? exact : pool.filter((e) => e.names.some((n) => n.startsWith(key)))).map((e) => e.book);
  };
  const found = search(entries.filter((e) => e.ordinal === ordinal));
  // "kings" or "cor" without a number: offer every numbered book that matches.
  return found.length || ordinal !== null ? found : search(entries.filter((e) => e.ordinal !== null));
}

/** Parses free text such as "jn 3:16", "1 cor 13", "psalm 23:1-3" or "song of sol". */
export function parseReference(input: string, books: Book[]): ParsedReference {
  const text = input
    .toLowerCase()
    .replace(/\bchapter\b/g, " ")
    .replace(/\bverses?\b/g, ":")
    .replace(/[.,;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = PATTERN.exec(text);
  if (!m) return { kind: "none" };
  const [, ord1, ord2, name, ch, vs, ve] = m;
  const ordinal = ORDINALS[ord1 ?? ord2] ?? null;
  const found = findBooks(entriesFor(books), ordinal, name);
  const chapter = ch ? +ch : undefined;

  if (found.length === 0) return { kind: "none" };
  if (found.length > 1) return { kind: "books", books: found, chapter };

  const book = found[0];
  if (chapter !== undefined && (chapter < 1 || chapter > book.chapters)) {
    const n = book.chapters;
    return { kind: "invalid", message: `${book.name} has ${n} chapter${n === 1 ? "" : "s"}` };
  }
  const verse = vs ? +vs : undefined;
  const verseEnd = ve && verse !== undefined && +ve > verse ? +ve : undefined;
  return { kind: "ref", book, chapter: chapter ?? 1, verse: verse || undefined, verseEnd };
}
