import { describe, expect, it } from "vitest";
import type { Verse } from "./api";
import { formatVerses, quotation, referenceLabel, span } from "./verses";

const verse = (n: number, text: string): Verse => ({
  verse: n, verseEnd: null, text, kind: "p", newBlock: false, gap: false,
  heading: null, headingKind: null, subscription: null,
});

describe("formatVerses", () => {
  it("collapses consecutive verses into runs", () => {
    expect(formatVerses([16, 17, 18, 20])).toBe("16–18, 20");
    expect(formatVerses([3, 1, 2])).toBe("1–3");
    expect(formatVerses([5])).toBe("5");
    expect(formatVerses([2, 4, 6])).toBe("2, 4, 6");
    expect(formatVerses(new Set([9, 10]))).toBe("9–10");
    expect(formatVerses([])).toBe("");
    expect(formatVerses([7, 7, 8])).toBe("7–8");
  });
});

describe("referenceLabel", () => {
  it("names the chapter alone or with verses", () => {
    expect(referenceLabel("John", 3)).toBe("John 3");
    expect(referenceLabel("John", 3, [16, 17])).toBe("John 3:16–17");
  });
});

describe("quotation", () => {
  it("joins the chosen verses in order with their reference", () => {
    const verses = [verse(1, "One."), verse(2, "Two."), verse(3, "Three.")];
    expect(quotation("Psalm", 9, verses, new Set([3, 1]))).toBe("“One. Three.”\n— Psalm 9:1, 3 (KJV)");
  });
});

describe("span", () => {
  it("covers the first to the last selected verse", () => {
    expect(span([18, 16, 17])).toEqual({ verse: 16, verseEnd: 18 });
    expect(span([16])).toEqual({ verse: 16, verseEnd: null });
    expect(span([2, 9])).toEqual({ verse: 2, verseEnd: 9 });
  });
});
