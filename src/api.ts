import { invoke } from "@tauri-apps/api/core";

export interface Translation {
  id: string;
  name: string;
}

export interface Book {
  id: number;
  code: string;
  name: string;
  abbrev: string;
  testament: "OT" | "NT";
  chapters: number;
}

export interface Verse {
  verse: number;
  /** Set when the source merges several verses into one (e.g. "15-16"). */
  verseEnd: number | null;
  text: string;
  /** The enclosing block: a prose paragraph or a poetry line. */
  kind: "p" | "q";
  /** True when this verse opens a new paragraph or poetry line. */
  newBlock: boolean;
  /** True when a stanza break (blank line) precedes this verse. */
  gap: boolean;
  /** A heading shown before the verse: a Psalm title or a section heading. */
  heading: string | null;
  headingKind: "title" | "section" | null;
  /** A closing note shown after the verse (an epistle's subscription). */
  subscription: string | null;
}

export interface SearchHit {
  translation: string;
  book: number;
  bookName: string;
  chapter: number;
  verse: number;
  /** The verse text, shortened around the match if long, with matched words between \u0001 and \u0002. */
  snippet: string;
}

export interface SearchResults {
  /** How many verses match in all, however many `hits` came back. */
  total: number;
  hits: SearchHit[];
}

/** Narrows a search to one testament or one book; both null searches the whole Bible. */
export interface SearchScope {
  testament: "OT" | "NT" | null;
  book: number | null;
}

export const listTranslations = () => invoke<Translation[]>("list_translations");
export const listBooks = () => invoke<Book[]>("list_books");
export const getChapter = (translation: string, book: number, chapter: number) =>
  invoke<Verse[]>("get_chapter", { translation, book, chapter });
export const search = (query: string, scope: SearchScope, limit: number, offset: number) =>
  invoke<SearchResults>("search", { query, testament: scope.testament, book: scope.book, limit, offset });
