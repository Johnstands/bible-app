import { describe, expect, it } from "vitest";
import { isMac, shortcutLabel } from "./platform";

describe("platform shortcuts", () => {
  it("recognises a Mac from navigator.platform", () => {
    expect(isMac("MacIntel")).toBe(true);
    expect(isMac("Linux x86_64")).toBe(false);
    expect(isMac("Win32")).toBe(false);
    expect(isMac(undefined)).toBe(false);
  });

  it("writes ⌘ on a Mac and Ctrl elsewhere", () => {
    expect(shortcutLabel("F", true)).toBe("⌘F");
    expect(shortcutLabel(",", true)).toBe("⌘,");
    expect(shortcutLabel("F", false)).toBe("Ctrl+F");
    expect(shortcutLabel("Enter", false)).toBe("Ctrl+Enter");
  });
});
