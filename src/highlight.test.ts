import { describe, expect, it } from "vitest";
import { splitMarks } from "./highlight";

describe("splitMarks", () => {
  it("separates matched words from the text around them", () => {
    expect(splitMarks("The \u0001LORD\u0002 is my \u0001shepherd\u0002; I shall not want.")).toEqual([
      { text: "The ", match: false },
      { text: "LORD", match: true },
      { text: " is my ", match: false },
      { text: "shepherd", match: true },
      { text: "; I shall not want.", match: false },
    ]);
  });

  it("handles text with no matches, adjacent matches and edges", () => {
    expect(splitMarks("plain")).toEqual([{ text: "plain", match: false }]);
    expect(splitMarks("\u0001a\u0002\u0001b\u0002")).toEqual([
      { text: "a", match: true },
      { text: "b", match: true },
    ]);
    expect(splitMarks("…\u0001love\u0002…")).toEqual([
      { text: "…", match: false },
      { text: "love", match: true },
      { text: "…", match: false },
    ]);
    expect(splitMarks("")).toEqual([]);
  });

  it("treats HTML in the text as plain text", () => {
    expect(splitMarks("<b>\u0001x\u0002</b>")).toEqual([
      { text: "<b>", match: false },
      { text: "x", match: true },
      { text: "</b>", match: false },
    ]);
  });
});
