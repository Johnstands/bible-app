import { describe, expect, it } from "vitest";
import { clampScale, DEFAULT_SETTINGS, sanitizeSettings } from "./userSettings";

describe("sanitizeSettings", () => {
  it("returns the defaults for nothing or nonsense", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings("dark")).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values", () => {
    const s = { theme: "dark", fontFamily: "literata", fontScale: 1.2, verseByVerse: true, pilcrows: true, verseOfTheDay: false, wordHelp: "changed" };
    expect(sanitizeSettings(s)).toEqual(s);
  });

  it("repairs each bad field on its own and keeps the good ones", () => {
    expect(sanitizeSettings({ theme: "neon", fontFamily: "comic", fontScale: "big", verseByVerse: "yes", pilcrows: true })).toEqual({
      ...DEFAULT_SETTINGS,
      pilcrows: true,
    });
    expect(sanitizeSettings({ fontFamily: "toString" }).fontFamily).toBe(DEFAULT_SETTINGS.fontFamily);
  });

  it("falls back to the theme saved before settings existed", () => {
    expect(sanitizeSettings(null, "sepia").theme).toBe("sepia");
    expect(sanitizeSettings({ theme: "dark" }, "sepia").theme).toBe("dark");
    expect(sanitizeSettings(null, "nonsense").theme).toBe("paper");
  });
});

describe("word help level", () => {
  it("defaults to all words and keeps a valid level", () => {
    expect(sanitizeSettings({}).wordHelp).toBe("all");
    for (const level of ["off", "changed", "all"]) expect(sanitizeSettings({ wordHelp: level }).wordHelp).toBe(level);
  });

  it("reads the on/off value saved before there were levels", () => {
    expect(sanitizeSettings({ wordHelp: true }).wordHelp).toBe("all");
    expect(sanitizeSettings({ wordHelp: false }).wordHelp).toBe("off");
  });

  it("falls back for anything else", () => {
    for (const bad of ["most", 2, null, {}, "toString"]) expect(sanitizeSettings({ wordHelp: bad }).wordHelp).toBe("all");
  });
});

describe("clampScale", () => {
  it("snaps to the step and stays in range", () => {
    expect(clampScale(1.02)).toBe(1);
    expect(clampScale(1.23)).toBe(1.25);
    expect(clampScale(0.1)).toBe(0.85);
    expect(clampScale(9)).toBe(1.6);
    expect(sanitizeSettings({ fontScale: Infinity }).fontScale).toBe(1);
    expect(sanitizeSettings({ fontScale: NaN }).fontScale).toBe(1);
  });
});
