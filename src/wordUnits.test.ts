import { describe, expect, it } from "vitest";
import type { WordTag } from "./api";
import type { GlossaryEntry, Segment } from "./glossary";
import { buildUnits } from "./wordUnits";

const entry = (kind: GlossaryEntry["kind"], meaning: string): GlossaryEntry => ({ forms: [], kind, meaning, today: null, only: null, except: null }) as unknown as GlossaryEntry;
const PREVENT = entry("changed", "go before");
const THEE = entry("archaic", "you");
const always = () => true;
const join = (units: { text: string }[]) => units.map((u) => u.text).join("");

const TEXT = "I prevented thee, O God";
const tag = (word: string, num: string, from = 0): WordTag => {
  const start = TEXT.indexOf(word, from);
  return { start, end: start + word.length, num };
};

describe("buildUnits", () => {
  it("is plain text when there is nothing to attach", () => {
    expect(buildUnits(TEXT, null, null, always)).toEqual([{ text: TEXT }]);
    expect(buildUnits(TEXT, [{ text: TEXT }], [], always)).toEqual([{ text: TEXT }]);
  });

  it("makes glossary words units of their own, as before Strong's", () => {
    const segments: Segment[] = [{ text: "I " }, { text: "prevented", entry: PREVENT }, { text: " thee, O God" }];
    expect(buildUnits(TEXT, segments, null, always)).toEqual([
      { text: "I " },
      { text: "prevented", entry: PREVENT },
      { text: " thee, O God" },
    ]);
  });

  it("applies the caller's filter to glossary entries", () => {
    const segments: Segment[] = [{ text: "I " }, { text: "prevented", entry: PREVENT }, { text: " " }, { text: "thee", entry: THEE }, { text: ", O God" }];
    const onlyChanged = (e: GlossaryEntry) => e.kind === "changed";
    const units = buildUnits(TEXT, segments, null, onlyChanged);
    expect(units.filter((u) => u.entry).map((u) => u.text)).toEqual(["prevented"]);
    expect(join(units)).toBe(TEXT);
  });

  it("turns tagged phrases into clickable units", () => {
    const tags = [tag("prevented", "G5348"), tag("God", "G2316")];
    expect(buildUnits(TEXT, null, tags, always)).toEqual([
      { text: "I " },
      { text: "prevented", nums: ["G5348"] },
      { text: " thee, O " },
      { text: "God", nums: ["G2316"] },
    ]);
  });

  it("gives a tagged glossary word both, so one click shows the meaning and the original", () => {
    const segments: Segment[] = [{ text: "I " }, { text: "prevented", entry: PREVENT }, { text: " thee, O God" }];
    const units = buildUnits(TEXT, segments, [tag("prevented", "G5348")], always);
    expect(units[1]).toEqual({ text: "prevented", entry: PREVENT, nums: ["G5348"] });
    expect(join(units)).toBe(TEXT);
  });

  it("keeps an untagged glossary word clickable next to tagged ones", () => {
    const segments: Segment[] = [{ text: "I prevented " }, { text: "thee", entry: THEE }, { text: ", O God" }];
    const units = buildUnits(TEXT, segments, [tag("God", "G2316")], always);
    expect(units.map((u) => [u.text, !!u.entry, !!u.nums])).toEqual([
      ["I prevented ", false, false],
      ["thee", true, false],
      [", O ", false, false],
      ["God", false, true],
    ]);
  });

  it("attaches a glossary phrase to every tagged word it covers, and remembers the phrase", () => {
    const phrase = entry("archaic", "please");
    const text = "I pray thee, help";
    const segments: Segment[] = [{ text: "I " }, { text: "pray thee", entry: phrase }, { text: ", help" }];
    const tags: WordTag[] = [
      { start: 2, end: 6, num: "H4994" },
      { start: 7, end: 11, num: "H4994" },
    ];
    const units = buildUnits(text, segments, tags, always);
    expect(units.filter((u) => u.entry).map((u) => [u.text, u.helpWord])).toEqual([
      ["pray", "pray thee"],
      ["thee", "pray thee"],
    ]);
    expect(join(units)).toBe(text);
  });

  it("ignores tags that don't fit the text or overlap", () => {
    const tags: WordTag[] = [
      { start: 2, end: 11, num: "G1" }, // prevented
      { start: 5, end: 8, num: "G2" }, // overlaps the one before
      { start: 40, end: 50, num: "G3" }, // past the end
      { start: 9, end: 9, num: "G4" }, // empty
    ];
    const units = buildUnits(TEXT, null, tags, always);
    expect(units.filter((u) => u.nums).map((u) => u.nums)).toEqual([["G1"]]);
    expect(join(units)).toBe(TEXT);
  });

  it("always joins back into the verse", () => {
    const segments: Segment[] = [{ text: "I " }, { text: "prevented", entry: PREVENT }, { text: " thee, O God" }];
    const tags = [tag("I", "G1473"), tag("prevented", "G5348"), tag("thee", "G4771"), tag("God", "G2316")];
    expect(join(buildUnits(TEXT, segments, tags, always))).toBe(TEXT);
    expect(join(buildUnits(TEXT, null, tags.slice().reverse(), always))).toBe(TEXT);
  });
});
