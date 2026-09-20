import type { Book } from "./api";

export interface Position {
  book: number;
  chapter: number;
}

/** The chapter before (-1) or after (1) `pos`, crossing book boundaries; null at either end of the Bible. */
export function adjacent(books: Book[], pos: Position, dir: 1 | -1): Position | null {
  const i = books.findIndex((b) => b.id === pos.book);
  if (i < 0) return null;
  const chapter = pos.chapter + dir;
  if (chapter >= 1 && chapter <= books[i].chapters) return { book: pos.book, chapter };
  const next = books[i + dir];
  if (!next) return null;
  return { book: next.id, chapter: dir === 1 ? 1 : next.chapters };
}

/** The book name as it reads before a chapter number: "Psalm 23", not "Psalms 23". */
export function chapterTitle(book: Book): string {
  return book.code === "PSA" ? "Psalm" : book.name;
}
