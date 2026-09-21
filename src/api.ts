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

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "purple"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface Highlight {
  verse: number;
  color: HighlightColor;
}

export interface Note {
  id: number;
  verse: number;
  verseEnd: number | null;
  body: string;
  updatedAt: string;
}

/** Everything the reader draws on top of one chapter. */
export interface ChapterMarks {
  highlights: Highlight[];
  notes: Note[];
  bookmarks: number[];
}

export const EMPTY_MARKS: ChapterMarks = { highlights: [], notes: [], bookmarks: [] };

/** One row of the Library: a place plus the reader's mark on it. */
export interface LibraryEntry {
  id: number;
  book: number;
  chapter: number;
  verse: number;
  verseEnd: number | null;
  text: string;
  color: HighlightColor | null;
  body: string | null;
  /** UTC, `YYYY-MM-DD HH:MM:SS`. */
  at: string;
}

export interface Library {
  bookmarks: LibraryEntry[];
  notes: LibraryEntry[];
  highlights: LibraryEntry[];
}

export const getMarks = (book: number, chapter: number) => invoke<ChapterMarks>("get_marks", { book, chapter });
/** Highlights the verses with `color`, or clears their highlights when it is null. */
export const setHighlight = (book: number, chapter: number, verses: number[], color: HighlightColor | null) =>
  invoke<void>("set_highlight", { book, chapter, verses, color });
/** Saves the note starting at `verse`; an empty body deletes it. */
export const saveNote = (book: number, chapter: number, verse: number, verseEnd: number | null, body: string) =>
  invoke<Note | null>("save_note", { book, chapter, verse, verseEnd, body });
export const deleteNote = (id: number) => invoke<void>("delete_note", { id });
/** Returns whether the verse is bookmarked afterwards. */
export const toggleBookmark = (book: number, chapter: number, verse: number) =>
  invoke<boolean>("toggle_bookmark", { book, chapter, verse });
export const getLibrary = () => invoke<Library>("get_library");
