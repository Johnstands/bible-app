// Turning picked files into presentation slides. Pictures go to the Rust side as file paths and are
// copied as they are; a PDF is drawn page by page here with pdf.js (loaded only when a PDF is actually
// imported, so it costs nothing otherwise) and the pages are sent back as PNGs in one body. A
// presentation file (.pptx and the like) is first turned into a PDF by an office suite installed on
// the computer (see src-tauri/src/convert.rs), then drawn the same way.

/** The most slides one deck may have; must match `decks::MAX_SLIDES` in the Rust backend. */
export const MAX_SLIDES = 500;

/** Each page is drawn to fit this box: 1080p, what projectors show. */
const PAGE_BOX = { width: 1920, height: 1080 };

/** Presentation files converted to PDF first; must match `OFFICE_EXTENSIONS` in src-tauri/src/convert.rs. */
export const OFFICE_EXTENSIONS = ["pptx", "ppt", "pptm", "ppsx", "pps", "odp", "key"];

const extension = (path: string) => /\.([^./\\]+)$/.exec(path)?.[1].toLowerCase() ?? "";
export const isPdf = (path: string) => extension(path) === "pdf";
export const isOffice = (path: string) => OFFICE_EXTENSIONS.includes(extension(path));

/** The file name at the end of a path, with either separator. */
export const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

/**
 * Frames byte chunks the way the Rust side's `decks::split_frames` reads them back: each one a
 * little-endian u32 byte count followed by that many bytes.
 */
export function encodeFrames(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + 4 + p.length, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const p of parts) {
    view.setUint32(at, p.length, true);
    out.set(p, at + 4);
    at += 4 + p.length;
  }
  return out;
}

/** The size to draw a page at so it fills as much of `PAGE_BOX` as it can without cropping. */
export function fitPage(width: number, height: number): { scale: number; width: number; height: number } {
  const scale = Math.min(PAGE_BOX.width / width, PAGE_BOX.height / height);
  return { scale, width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Draws every page of a PDF to a PNG, in order. `name` is only for error messages; `onPage` is told
 * after each page, for progress.
 */
export async function renderPdfPages(
  data: ArrayBuffer,
  name: string,
  onPage?: (done: number, total: number) => void,
): Promise<Uint8Array[]> {
  // The legacy build supports older WebKit (the app's webview on macOS and Linux), not just current browsers.
  const [pdfjs, { default: workerSrc }] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const loading = pdfjs.getDocument({ data: new Uint8Array(data), enableXfa: false });
  let doc;
  try {
    doc = await loading.promise;
  } catch (e) {
    void loading.destroy();
    const why = e instanceof Error ? e : new Error(String(e));
    if (why.name === "PasswordException") throw new Error(`${name} is password-protected. Save a copy without the password and add that.`);
    throw new Error(`${name} couldn’t be opened as a PDF (${why.message}).`);
  }
  try {
    if (doc.numPages > MAX_SLIDES) throw new Error(`${name} has ${doc.numPages} pages; a set can have at most ${MAX_SLIDES}.`);
    const pages: Uint8Array[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const natural = page.getViewport({ scale: 1 });
      const size = fitPage(natural.width, natural.height);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      await page.render({ canvas, viewport: page.getViewport({ scale: size.scale }) }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error(`Page ${n} of ${name} couldn’t be drawn.`);
      pages.push(new Uint8Array(await blob.arrayBuffer()));
      page.cleanup();
      onPage?.(n, doc.numPages);
    }
    return pages;
  } finally {
    await loading.destroy();
  }
}
