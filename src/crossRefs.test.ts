import { describe, expect, it } from "vitest";
import type { CrossRef } from "./api";
import { crossRefDestination, crossRefLabel } from "./crossRefs";

const ref = (chapter: number, verse: number, endChapter = chapter, endVerse = verse): CrossRef => ({
  book: 45, chapter, verse, endChapter, endVerse, votes: 10, text: "",
});

describe("crossRefLabel", () => {
  it("names a single verse", () => {
    expect(crossRefLabel("Romans", ref(5, 8))).toBe("Romans 5:8");
  });

  it("names a range in one chapter", () => {
    expect(crossRefLabel("Romans", ref(1, 19, 1, 20))).toBe("Romans 1:19–20");
    expect(crossRefLabel("John", ref(1, 1, 1, 14))).toBe("John 1:1–14");
  });

  it("names a range that runs into the next chapter with both ends", () => {
    expect(crossRefLabel("Genesis", ref(11, 32, 12, 1))).toBe("Genesis 11:32–12:1");
  });

  it("copes with an end before the start by naming just the start", () => {
    expect(crossRefLabel("Romans", ref(5, 8, 5, 3))).toBe("Romans 5:8");
  });
});

describe("crossRefDestination", () => {
  it("jumps to a single verse", () => {
    expect(crossRefDestination(ref(5, 8))).toEqual({ book: 45, chapter: 5, verse: 8 });
  });

  it("highlights the whole range when it stays in one chapter", () => {
    expect(crossRefDestination(ref(1, 19, 1, 20))).toEqual({ book: 45, chapter: 1, verse: 19, verseEnd: 20 });
  });

  it("highlights only the first verse of a range that leaves its chapter", () => {
    expect(crossRefDestination(ref(11, 32, 12, 1))).toEqual({ book: 45, chapter: 11, verse: 32 });
  });
});
