import { describe, expect, it } from "vitest";
import type { Book } from "./api";
import { parseReference } from "./reference";

// [code, name, abbrev, chapters] for the books these tests touch, in canonical order.
const RAW: [string, string, string, number][] = [
  ["GEN", "Genesis", "Gen", 50], ["JOS", "Joshua", "Josh", 24], ["1SA", "1 Samuel", "1 Sam", 31],
  ["2SA", "2 Samuel", "2 Sam", 24], ["1KI", "1 Kings", "1 Kgs", 22], ["2KI", "2 Kings", "2 Kgs", 25],
  ["JOB", "Job", "Job", 42], ["PSA", "Psalms", "Ps", 150], ["SNG", "Song of Solomon", "Song", 8],
  ["ISA", "Isaiah", "Isa", 66], ["JOL", "Joel", "Joel", 3], ["JON", "Jonah", "Jonah", 4],
  ["MAT", "Matthew", "Matt", 28], ["JHN", "John", "John", 21], ["1CO", "1 Corinthians", "1 Cor", 16],
  ["2CO", "2 Corinthians", "2 Cor", 13], ["PHP", "Philippians", "Phil", 4], ["PHM", "Philemon", "Phlm", 1],
  ["1JN", "1 John", "1 John", 5], ["2JN", "2 John", "2 John", 1], ["3JN", "3 John", "3 John", 1],
  ["JUD", "Jude", "Jude", 1], ["JDG", "Judges", "Judg", 21],
];
const books: Book[] = RAW.map(([code, name, abbrev, chapters], i) => ({
  id: i + 1, code, name, abbrev, chapters, testament: i < 11 ? "OT" : "NT",
}));

function ref(input: string) {
  const r = parseReference(input, books);
  if (r.kind !== "ref") throw new Error(`"${input}" parsed as ${r.kind}`);
  return `${r.book.name} ${r.chapter}${r.verse ? ":" + r.verse : ""}${r.verseEnd ? "-" + r.verseEnd : ""}`;
}

describe("parseReference", () => {
  it("parses common shapes", () => {
    expect(ref("john 3:16")).toBe("John 3:16");
    expect(ref("John 3 16")).toBe("John 3:16");
    expect(ref("jn3:16")).toBe("John 3:16");
    expect(ref("  JOHN   3.16 ")).toBe("John 3:16");
    expect(ref("john chapter 3 verse 16")).toBe("John 3:16");
    expect(ref("john 3:16-18")).toBe("John 3:16-18");
    expect(ref("john 3:")).toBe("John 3");
    expect(ref("john")).toBe("John 1");
  });

  it("handles numbered books in every spelling", () => {
    expect(ref("1 cor 13")).toBe("1 Corinthians 13");
    expect(ref("1cor13:4")).toBe("1 Corinthians 13:4");
    expect(ref("1st john 2")).toBe("1 John 2");
    expect(ref("ii kings 5")).toBe("2 Kings 5");
    expect(ref("second samuel 7")).toBe("2 Samuel 7");
    expect(ref("3 jn")).toBe("3 John 1");
    expect(ref("1 john 3:16")).toBe("1 John 3:16");
  });

  it("does not confuse a book name that starts with i, or plain John with 1 John", () => {
    expect(ref("isa 53")).toBe("Isaiah 53");
    expect(ref("isaiah 40:31")).toBe("Isaiah 40:31");
    expect(ref("jn 1")).toBe("John 1");
  });

  it("accepts abbreviations, aliases and unique prefixes", () => {
    expect(ref("ps 23")).toBe("Psalms 23");
    expect(ref("psalm 119:105")).toBe("Psalms 119:105");
    expect(ref("gen")).toBe("Genesis 1");
    expect(ref("matt 5:3")).toBe("Matthew 5:3");
    expect(ref("song of sol 2:1")).toBe("Song of Solomon 2:1");
    expect(ref("song 2")).toBe("Song of Solomon 2");
    expect(ref("phil 4:13")).toBe("Philippians 4:13"); // alias beats being a prefix of Philemon
    expect(ref("philem")).toBe("Philemon 1");
    expect(ref("jud")).toBe("Jude 1"); // alias beats being a prefix of Judges
    expect(ref("judg 6")).toBe("Judges 6");
  });

  it("lists candidates when the book is ambiguous", () => {
    for (const [input, names] of [
      ["jo", ["Joshua", "Job", "Joel", "John", "Jonah"]],
      ["kings", ["1 Kings", "2 Kings"]],
      ["cor 13", ["1 Corinthians", "2 Corinthians"]],
    ] as const) {
      const r = parseReference(input, books);
      expect(r.kind).toBe("books");
      if (r.kind === "books") expect(r.books.map((b) => b.name).sort()).toEqual([...names].sort());
    }
    const r = parseReference("cor 13", books);
    expect(r.kind === "books" && r.chapter).toBe(13);
  });

  it("reports out-of-range chapters", () => {
    expect(parseReference("john 22", books)).toEqual({ kind: "invalid", message: "John has 21 chapters" });
    expect(parseReference("jude 2", books)).toEqual({ kind: "invalid", message: "Jude has 1 chapter" });
    expect(parseReference("john 0", books).kind).toBe("invalid");
  });

  it("returns none for nonsense", () => {
    for (const input of ["", "   ", "123", "3:16", "zzz 3", "1 zzz", "john 3:16:2"]) {
      expect(parseReference(input, books).kind).toBe("none");
    }
  });

  it("ignores a reversed or empty verse range", () => {
    expect(ref("john 3:18-16")).toBe("John 3:18");
    expect(ref("john 3:16-16")).toBe("John 3:16");
  });
});
