// Reads a timetable PDF laid out as a grid: a title naming the class ("Form 1 Timetable"),
// period times across the top and the days down the left, one page per class. The result is
// the same grid a spreadsheet gives, so the browser applies one set of rules to both (breaks
// skipped, times read, rows editable before anything is saved).

export interface TimetableSheet {
  name: string;
  rows: string[][];
}

export class TooManyTimetablePagesError extends Error {
  constructor(readonly pages: number) {
    super(`Timetable PDF has ${pages} pages`);
  }
}

const MAX_PAGES = 20;
const DAY = /^(mon(day)?|tue(s|sday)?|wed(nesday)?|thu(r|rs|rsday)?|fri(day)?)\.?$/i;
const CLASS_NAME = /\b(form|jhs|basic|class)\s*\d+\s*[a-z]?\b/i;

interface Item {
  text: string;
  x: number;
  y: number;
  width: number;
}

const centre = (i: Item) => i.x + i.width / 2;

/** Joins the lines of one cell: "Scienc" + "e" is one word, "R.M.E /" + "Maths" are two. */
function joinLines(parts: Item[]): string {
  let out = '';
  for (const p of parts.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const t = p.text.trim();
    if (!out) out = t;
    else if (/[a-z]$/i.test(out) && /^[a-z]/.test(t)) out += t;
    else out += ` ${t}`;
  }
  return out.replace(/\s*[–—-]\s*/g, ' – ').trim();
}

export function sheetFromItems(items: Item[], pageNumber: number): TimetableSheet | null {
  const days = items.filter((i) => DAY.test(i.text.trim())).sort((a, b) => a.y - b.y);
  if (!days.length) return null;
  const top = days[0]!.y;
  const left = Math.max(...days.map((d) => d.x + d.width));
  const title = items.find((i) => CLASS_NAME.test(i.text) && i.y < top);
  const name =
    title?.text.match(CLASS_NAME)?.[0].replace(/\s+/g, ' ').trim() ?? `Page ${pageNumber}`;

  // Period headings: text with digits between the title and the first day, right of the days.
  const headerItems = items
    .filter((i) => i.y < top - 4 && (!title || i.y > title.y) && i.x >= left - 4)
    .filter((i) => /\d|[–—-]/.test(i.text))
    .sort((a, b) => centre(a) - centre(b));
  const columns: { centre: number; parts: Item[] }[] = [];
  for (const i of headerItems) {
    const last = columns[columns.length - 1];
    if (last && Math.abs(centre(i) - last.centre) < 25) {
      last.parts.push(i);
      last.centre = last.parts.reduce((s, p) => s + centre(p), 0) / last.parts.length;
    } else columns.push({ centre: centre(i), parts: [i] });
  }
  if (!columns.length) return null;

  const cells = days.map(() => columns.map(() => [] as Item[]));
  for (const i of items) {
    if (i.y < top - 8 || i.x < left - 4 || DAY.test(i.text.trim())) continue;
    let row = -1;
    days.forEach((d, n) => {
      if (i.y >= d.y - 8) row = n;
    });
    if (row < 0) continue;
    let col = 0;
    columns.forEach((c, n) => {
      if (Math.abs(centre(i) - c.centre) < Math.abs(centre(i) - columns[col]!.centre)) col = n;
    });
    cells[row]![col]!.push(i);
  }

  return {
    name,
    rows: [
      ['Day', ...columns.map((c) => joinLines(c.parts))],
      ...days.map((d, r) => [d.text.trim(), ...cells[r]!.map(joinLines)]),
    ],
  };
}

export async function readTimetablePdf(
  data: Uint8Array,
): Promise<{ sheets: TimetableSheet[]; notes: string[] }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data, useSystemFonts: false, disableFontFace: true });
  try {
    const doc = await task.promise;
    if (doc.numPages > MAX_PAGES) throw new TooManyTimetablePagesError(doc.numPages);
    const sheets: TimetableSheet[] = [];
    const notes: string[] = [];
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const height = page.getViewport({ scale: 1 }).height;
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const raw of content.items) {
        if (!('str' in raw) || !raw.str.trim()) continue;
        items.push({
          text: raw.str,
          x: raw.transform[4] as number,
          y: height - (raw.transform[5] as number),
          width: raw.width,
        });
      }
      const sheet = sheetFromItems(items, p);
      if (sheet) sheets.push(sheet);
      else notes.push(`Page ${p} was skipped: no days (Mon to Fri) and period times were found.`);
    }
    return { sheets, notes };
  } finally {
    await task.destroy();
  }
}
