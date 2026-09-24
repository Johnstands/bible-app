import { describe, expect, it } from "vitest";
import { baseName, encodeFrames, fitPage, isOffice, isPdf } from "./slideImport";

describe("encodeFrames", () => {
  it("prefixes each part with its little-endian length", () => {
    const out = encodeFrames([new Uint8Array([7, 8]), new Uint8Array([]), new Uint8Array([9])]);
    expect([...out]).toEqual([2, 0, 0, 0, 7, 8, 0, 0, 0, 0, 1, 0, 0, 0, 9]);
  });

  it("writes lengths past one byte correctly", () => {
    const out = encodeFrames([new Uint8Array(300)]);
    expect([...out.slice(0, 4)]).toEqual([44, 1, 0, 0]);
    expect(out.length).toBe(304);
  });

  it("is empty for no parts", () => {
    expect(encodeFrames([]).length).toBe(0);
  });
});

describe("fitPage", () => {
  it("fills 1080p exactly with a 16:9 slide", () => {
    expect(fitPage(960, 540)).toEqual({ scale: 2, width: 1920, height: 1080 });
  });

  it("fits a 4:3 slide or a portrait page by height, without cropping", () => {
    expect(fitPage(720, 540)).toEqual({ scale: 2, width: 1440, height: 1080 });
    const letter = fitPage(612, 792);
    expect(letter.height).toBe(1080);
    expect(letter.width).toBeLessThan(1920);
  });
});

describe("file names", () => {
  it("recognizes PDFs whatever the case", () => {
    expect(["a.pdf", "B.PDF", "c.Pdf"].every(isPdf)).toBe(true);
    expect(["a.png", "pdf", "a.pdf.png"].some(isPdf)).toBe(false);
  });

  it("recognizes presentation files that need converting", () => {
    expect(["a.pptx", "B.PPT", "c.odp", "d.key", "C:\\x\\e.ppsx"].every(isOffice)).toBe(true);
    expect(["a.pdf", "b.png", "pptx", "c.pptx.txt", "/a.pptx/b.png"].some(isOffice)).toBe(false);
  });

  it("takes the file name from Windows or Unix paths", () => {
    expect(baseName("/home/me/Sunday.pdf")).toBe("Sunday.pdf");
    expect(baseName("C:\\Users\\me\\Sunday.pdf")).toBe("Sunday.pdf");
    expect(baseName("Sunday.pdf")).toBe("Sunday.pdf");
  });
});
