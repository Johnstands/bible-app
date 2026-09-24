import { describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_PREFS, sanitizePresentationPrefs } from "./presentationSettings";

describe("sanitizePresentationPrefs", () => {
  it("fades between slides unless told otherwise", () => {
    expect(DEFAULT_PRESENTATION_PREFS.transition).toBe("fade");
    // Preferences saved before transitions existed get the default.
    expect(sanitizePresentationPrefs({ theme: "light", granularity: "whole" })).toEqual({ theme: "light", granularity: "whole", transition: "fade" });
  });

  it("keeps a saved cut, and replaces anything that isn't a known transition", () => {
    expect(sanitizePresentationPrefs({ transition: "cut" }).transition).toBe("cut");
    expect(sanitizePresentationPrefs({ transition: "wipe" }).transition).toBe("fade");
    expect(sanitizePresentationPrefs(null)).toEqual(DEFAULT_PRESENTATION_PREFS);
  });
});
