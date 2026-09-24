import { describe, expect, it } from "vitest";
import { buildQueue, buildSlides, itemAt, screenKey, slideCaption, STANDBY_STATE } from "./presentation";
import type { Passage, PresentationState, QueueEntry, QueuedDeck } from "./presentation";

const john3: Passage = {
  book: 43,
  chapter: 3,
  title: "John",
  verses: [
    { verse: 16, text: "For God so loved the world…" },
    { verse: 17, text: "For God sent not his Son…" },
  ],
};

describe("buildSlides", () => {
  it("makes one slide per verse in verse mode", () => {
    const slides = buildSlides(john3, "verse");
    expect(slides).toHaveLength(2);
    expect(slides[0]).toMatchObject({ verse: 16, verseEnd: 16, reference: "John 3:16", text: john3.verses[0].text });
    expect(slides[1]).toMatchObject({ verse: 17, verseEnd: 17, reference: "John 3:17" });
  });

  it("joins the whole passage into a single slide in whole mode", () => {
    const slides = buildSlides(john3, "whole");
    expect(slides).toHaveLength(1);
    expect(slides[0]).toMatchObject({ verse: 16, verseEnd: 17, reference: "John 3:16–17" });
    expect(slides[0].text).toBe(`${john3.verses[0].text} ${john3.verses[1].text}`);
  });

  it("returns nothing for an empty passage", () => {
    expect(buildSlides({ ...john3, verses: [] }, "verse")).toEqual([]);
    expect(buildSlides({ ...john3, verses: [] }, "whole")).toEqual([]);
  });

  it("carries an optional label onto every slide it produces", () => {
    const withLabel = { ...john3, label: "Call to worship" };
    expect(buildSlides(withLabel, "whole")[0].label).toBe("Call to worship");
    expect(buildSlides(withLabel, "verse").every((s) => s.label === "Call to worship")).toBe(true);
    expect(buildSlides(john3, "whole")[0].label).toBeUndefined();
  });

  it("labels a single-verse passage without a dash", () => {
    const oneVerse: Passage = { book: 1, chapter: 1, title: "Genesis", verses: [{ verse: 1, text: "…" }] };
    expect(buildSlides(oneVerse, "whole")[0].reference).toBe("Genesis 1:1");
  });
});

describe("buildQueue", () => {
  const buildQueueSlides = (entries: QueueEntry[], g: "verse" | "whole") => buildQueue(entries, g).slides;
  const genesis1: Passage = {
    book: 1,
    chapter: 1,
    title: "Genesis",
    verses: [{ verse: 1, text: "In the beginning God created the heaven and the earth." }],
  };
  const john3_18: Passage = { ...john3, chapter: 3, verses: [{ verse: 18, text: "He that believeth…" }] };

  it("flows continuously from one queued passage into the next, across a book boundary", () => {
    const slides = buildQueueSlides([genesis1, john3], "verse");
    expect(slides.map(slideCaption)).toEqual(["Genesis 1:1", "John 3:16", "John 3:17"]);
  });

  it("flows continuously across a chapter boundary within the same book", () => {
    const psalm23: Passage = { book: 19, chapter: 23, title: "Psalm", verses: [{ verse: 1, text: "The LORD is my shepherd…" }] };
    const psalm24: Passage = { book: 19, chapter: 24, title: "Psalm", verses: [{ verse: 1, text: "The earth is the LORD'S…" }] };
    const slides = buildQueueSlides([psalm23, psalm24], "verse");
    expect(slides.map((s) => (s.kind === "verse" ? `${s.chapter}:${s.verse}` : ""))).toEqual(["23:1", "24:1"]);
  });

  it("keeps whole-passage items as single slides in the flow", () => {
    const slides = buildQueueSlides([genesis1, john3, john3_18], "whole");
    expect(slides.map(slideCaption)).toEqual(["Genesis 1:1", "John 3:16–17", "John 3:18"]);
  });

  it("is empty for an empty queue", () => {
    expect(buildQueue([], "verse")).toEqual({ slides: [], items: [] });
  });

  const songs: QueuedDeck = { name: "Songs.png + 2 more", srcs: ["s1", "s2", "s3"] };

  it("expands a deck into one picture slide each, in the flow between passages", () => {
    const { slides } = buildQueue([genesis1, songs, john3], "verse");
    expect(slides.map(slideCaption)).toEqual([
      "Genesis 1:1",
      "Songs.png + 2 more · 1 of 3",
      "Songs.png + 2 more · 2 of 3",
      "Songs.png + 2 more · 3 of 3",
      "John 3:16",
      "John 3:17",
    ]);
    expect(slides[2]).toEqual({ kind: "image", src: "s2", deckName: "Songs.png + 2 more", index: 1, count: 3 });
  });

  it("leaves decks alone whatever the verse granularity", () => {
    expect(buildQueue([songs, john3], "whole").slides.map(slideCaption)).toEqual([
      "Songs.png + 2 more · 1 of 3",
      "Songs.png + 2 more · 2 of 3",
      "Songs.png + 2 more · 3 of 3",
      "John 3:16–17",
    ]);
  });

  it("records where each item starts, keeping a place for items with no slides", () => {
    const { items } = buildQueue([genesis1, songs, null, john3], "verse");
    expect(items).toEqual([
      { start: 0, count: 1 },
      { start: 1, count: 3 },
      { start: 4, count: 0 },
      { start: 4, count: 2 },
    ]);
  });
});

describe("itemAt", () => {
  const items = [
    { start: 0, count: 1 },
    { start: 1, count: 3 },
    { start: 4, count: 0 },
    { start: 4, count: 2 },
  ];

  it("finds the item a slide belongs to, skipping empty items", () => {
    expect([0, 1, 3, 4, 5].map((i) => itemAt(items, i))).toEqual([0, 1, 1, 3, 3]);
  });

  it("is -1 past the end or for an empty queue", () => {
    expect(itemAt(items, 6)).toBe(-1);
    expect(itemAt([], 0)).toBe(-1);
  });
});

describe("screenKey", () => {
  const verse = buildSlides(john3, "verse")[0];
  const picture = buildQueue([{ name: "Songs", srcs: ["s1", "s2"] }], "verse").slides[0];
  const on = (over: Partial<PresentationState>): PresentationState => ({ ...STANDBY_STATE, ...over });

  it("is the same for states that look the same, so nothing fades", () => {
    expect(screenKey(on({ slide: verse, preload: "a" }))).toBe(screenKey(on({ slide: verse, preload: "b" })));
    expect(screenKey(on({ slide: verse, transition: "fade" }))).toBe(screenKey(on({ slide: verse, transition: "cut" })));
    // Blank hides everything, whatever would be under it.
    expect(screenKey(on({ blank: true, slide: verse }))).toBe(screenKey(on({ blank: true, slide: picture })));
    // A picture is shown on black whatever the verse color setting.
    expect(screenKey(on({ slide: picture, theme: "dark" }))).toBe(screenKey(on({ slide: picture, theme: "light" })));
  });

  it("differs whenever the screen would look different", () => {
    const keys = [
      on({}),
      on({ theme: "light" }),
      on({ blank: true }),
      on({ slide: verse }),
      on({ slide: verse, theme: "light" }),
      on({ slide: { ...verse, label: "Call to worship" } }),
      on({ slide: buildSlides(john3, "verse")[1] }),
      on({ slide: picture }),
      on({ slide: buildQueue([{ name: "Songs", srcs: ["s1", "s2"] }], "verse").slides[1] }),
    ].map(screenKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
