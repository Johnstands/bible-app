import { describe, expect, it } from "vitest";
import { balanceLines, cardFileName, fitText, quoted, wrapLines } from "./verseCard";
import type { Measure } from "./verseCard";

// Every character is half as wide as the type is tall, so widths are easy to reason about.
const measure: Measure = (text, size) => text.length * size * 0.5;

describe("wrapLines", () => {
  const w10 = (t: string) => t.length;

  it("breaks at spaces without exceeding the width", () => {
    expect(wrapLines("the quick brown fox jumps", 10, w10)).toEqual(["the quick", "brown fox", "jumps"]);
  });

  it("keeps a short text on one line", () => {
    expect(wrapLines("In the beginning", 40, w10)).toEqual(["In the beginning"]);
  });

  it("gives a word wider than the line a line of its own", () => {
    expect(wrapLines("a supercalifragilistic b", 10, w10)).toEqual(["a", "supercalifragilistic", "b"]);
  });

  it("ignores extra whitespace and returns nothing for empty text", () => {
    expect(wrapLines("  a   b \n c ", 20, w10)).toEqual(["a b c"]);
    expect(wrapLines("   ", 20, w10)).toEqual([]);
  });
});

describe("balanceLines", () => {
  const w = (t: string) => t.length;

  it("keeps the number of lines but evens them out, so the last line isn't a lone word", () => {
    const text = "aaa bbb ccc ddd eee fff ggg";
    expect(wrapLines(text, 11, w)).toEqual(["aaa bbb ccc", "ddd eee fff", "ggg"]);
    const balanced = balanceLines(text, 11, 3, w);
    expect(balanced).toHaveLength(3);
    expect(balanced.join(" ")).toBe(text);
    expect(balanced.every((l) => w(l) <= 11)).toBe(true);
    expect(balanced[2].split(" ").length).toBeGreaterThanOrEqual(2);
  });

  it("never loses or reorders a word", () => {
    const text = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him";
    for (const width of [20, 28, 40]) {
      const count = wrapLines(text, width, w).length;
      const lines = balanceLines(text, width, count, w);
      expect(lines).toHaveLength(count);
      expect(lines.join(" ")).toBe(text);
      expect(lines.every((l) => w(l) <= width)).toBe(true);
    }
  });

  it("leaves one line and tiny texts alone", () => {
    expect(balanceLines("God is love", 40, 1, w)).toEqual(["God is love"]);
    expect(balanceLines("God is", 3, 2, w)).toEqual(["God", "is"]);
  });

  it("gives an over-long word its own line rather than failing", () => {
    expect(balanceLines("a supercalifragilistic b", 10, 3, w)).toEqual(["a", "supercalifragilistic", "b"]);
  });
});

describe("fitText", () => {
  const opts = { maxSize: 60, minSize: 20, lineHeight: 1.4 };
  const text = "For God so loved the world, that he gave his only begotten Son";

  it("uses the largest size at which the text fits the box", () => {
    const box = { width: 600, height: 400 };
    const fit = fitText(text, box, measure, opts)!;
    expect(fit.size).toBeLessThanOrEqual(60);
    expect(fit.lines.length * fit.size * 1.4).toBeLessThanOrEqual(400);
    // Two sizes up would not have fitted, unless it was already the largest allowed.
    if (fit.size < 60) {
      const bigger = fitText(text, box, measure, { ...opts, minSize: fit.size + 2, maxSize: fit.size + 2 });
      expect(bigger).toBeNull();
    }
    expect(fit.lines.join(" ")).toBe(text);
  });

  it("shrinks as the text gets longer", () => {
    const box = { width: 600, height: 300 };
    const short = fitText("God is love", box, measure, opts)!;
    const long = fitText(text.repeat(2), box, measure, opts)!;
    expect(long.size).toBeLessThan(short.size);
    expect(short.size).toBe(60);
  });

  it("returns null when even the smallest size is too big", () => {
    expect(fitText(text.repeat(30), { width: 400, height: 200 }, measure, opts)).toBeNull();
  });

  it("balances its lines: the last is not much shorter than the rest", () => {
    const box = { width: 600, height: 600 };
    const fit = fitText(text, box, measure, opts)!;
    const widths = fit.lines.map((l) => measure(l, fit.size));
    if (fit.lines.length > 1) expect(widths[widths.length - 1]).toBeGreaterThan(Math.max(...widths) * 0.4);
  });

  it("returns lines that each fit the width at the chosen size", () => {
    const box = { width: 500, height: 500 };
    const fit = fitText(text, box, measure, opts)!;
    for (const line of fit.lines) expect(measure(line, fit.size)).toBeLessThanOrEqual(500);
  });
});

describe("quoted", () => {
  it("wraps text in curly quotes and trims it", () => {
    expect(quoted("  God is love. ")).toBe("“God is love.”");
  });
});

describe("cardFileName", () => {
  it("makes a plain file name from a reference", () => {
    expect(cardFileName("John 3:16")).toBe("John 3-16.png");
    expect(cardFileName("Romans 1:19–20")).toBe("Romans 1-19-20.png");
    expect(cardFileName("1 John 4:9–10")).toBe("1 John 4-9-10.png");
  });

  it("drops anything a file system might refuse", () => {
    expect(cardFileName('Psalm 23:1/2 *?"<>|')).toBe("Psalm 23-12.png");
    expect(cardFileName("")).toBe("verse.png");
    expect(cardFileName(":::")).toBe("---.png");
  });
});
