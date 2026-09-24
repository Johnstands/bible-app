// A small, valid PDF for the UI tests' "Add slides…" flow: `pages` landscape 16:9 pages, each a solid
// color with "PDF page N" on it, so the drawn slides are easy to tell apart in a screenshot.

export function makePdf(pages = 3) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    null, // the page tree, filled in once the page ids are known
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const kids = [];
  for (let n = 1; n <= pages; n++) {
    const [r, g, b] = [[0.16, 0.29, 0.48], [0.45, 0.2, 0.2], [0.2, 0.4, 0.25]][(n - 1) % 3];
    const content = `${r} ${g} ${b} rg 0 0 960 540 re f 1 1 1 rg BT /F1 96 Tf 250 240 Td (PDF page ${n}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`);
    kids.push(`${objects.length} 0 R`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
