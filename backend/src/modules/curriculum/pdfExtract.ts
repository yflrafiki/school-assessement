// Reads a CEPME-style scheme-of-learning PDF and rebuilds its tables from the ruling lines.
// Text order in these PDFs is unreliable, so every cell is located by geometry: horizontal
// rules give the week rows, vertical rules give the columns. The output is the same shape
// the import pipeline validates and stages for review; nothing here decides what is correct.
import { createHash } from 'node:crypto';
import type { ExtractedRow, ImportFlag, Level, WeekKind } from '@school/shared';
import { subjectCodeFor } from './validation.js';

interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PageGeometry {
  text: TextItem[];
  horizontals: { x1: number; x2: number; y: number }[];
  verticals: { x: number; y1: number; y2: number }[];
  frame: { x1: number; y1: number; x2: number; y2: number } | null;
}

export interface ExtractedWeek {
  level: Level;
  weekNumber: number;
  kind: WeekKind;
  label?: string;
}

export interface Extraction {
  checksum: string;
  pageCount: number;
  notes: string[];
  weeks: ExtractedWeek[];
  rows: ExtractedRow[];
}

const LEVEL_BY_NUMBER: Record<string, Level> = { '7': 'BASIC_7', '8': 'BASIC_8', '9': 'BASIC_9' };

/** Spaced capitals such as "E N D O F T E R M E X A M S" collapse to "ENDOFTERMEXAMS". */
const squash = (s: string) => s.replace(/[^A-Za-z]/g, '').toUpperCase();

function clean(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

async function readGeometry(data: Uint8Array): Promise<PageGeometry[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
  });
  const doc = await task.promise;
  const constructPath = pdfjs.OPS.constructPath;
  const pages: PageGeometry[] = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text: TextItem[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      text.push({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        w: item.width,
        h: item.height || 8,
      });
    }
    const ops = await page.getOperatorList();
    const horizontals: PageGeometry['horizontals'] = [];
    const verticals: PageGeometry['verticals'] = [];
    let frame: PageGeometry['frame'] = null;
    ops.fnArray.forEach((fn, i) => {
      if (fn !== constructPath) return;
      const mm = (ops.argsArray[i] as unknown[])[2] as ArrayLike<number> | undefined;
      if (!mm || mm.length < 4) return;
      const [x1, y1, x2, y2] = [mm[0]!, mm[1]!, mm[2]!, mm[3]!];
      if (Math.abs(y2 - y1) < 1.5)
        horizontals.push({ x1: Math.min(x1, x2), x2: Math.max(x1, x2), y: y1 });
      else if (Math.abs(x2 - x1) < 1.5)
        verticals.push({ x: x1, y1: Math.min(y1, y2), y2: Math.max(y1, y2) });
      else if (x2 - x1 > 300 && y2 - y1 > 300) frame = { x1, y1, x2, y2 };
    });
    pages.push({ text, horizontals, verticals, frame });
  }
  await task.destroy();
  return pages;
}

function pageLevel(g: PageGeometry): Level | null {
  const title = g.text.find((t) => /SCHEME OF LEARNING/i.test(t.str) && /BASIC/i.test(t.str));
  const m = title && /BASIC\s*(\d)/i.exec(title.str);
  return m ? (LEVEL_BY_NUMBER[m[1] ?? ''] ?? null) : null;
}

function pageYear(g: PageGeometry): string | null {
  const title = g.text.find((t) => /SCHEME OF LEARNING/i.test(t.str));
  return title ? (/(\d{4})\s*\/\s*(\d{4})/.exec(title.str)?.[0]?.replace(/\s/g, '') ?? null) : null;
}

interface Band {
  top: number;
  bottom: number;
  weeks: number[];
  text: string;
}

interface Grid {
  weekColRight: number;
  columns: { left: number; right: number }[];
  headerBottom: number;
  bands: Band[];
  middle: number;
}

/** Works out the week column, the six content columns and the week rows of one table page. */
function buildGrid(g: PageGeometry): Grid | null {
  const left = Math.min(...g.horizontals.map((h) => h.x1), g.frame?.x1 ?? Infinity);
  const right = Math.max(...g.horizontals.map((h) => h.x2), g.frame?.x2 ?? -Infinity);
  const width = right - left;
  if (!Number.isFinite(width) || width < 400) return null;

  // Week labels: small integers in the narrow first column.
  const labelCandidates = g.text.filter(
    (t) => /^\s*\d{1,2}\s*\.?\s*$/.test(t.str) && t.x < left + 40,
  );
  const labels = labelCandidates
    .map((t) => ({ week: Number(t.str.replace(/\D/g, '')), y: t.y, h: t.h }))
    .filter((l) => l.week >= 1 && l.week <= 20);
  if (labels.length < 10) return null;

  const xs = [
    ...new Set(g.verticals.filter((v) => v.y2 - v.y1 > 200).map((v) => Math.round(v.x * 10) / 10)),
  ].sort((a, b) => a - b);
  const inner = xs.filter((x) => x > left + 8 && x < right - 8);
  const firstLabelRight = Math.max(...labelCandidates.map((t) => t.x + t.w));
  const weekColRight = inner.find((x) => x >= firstLabelRight - 1) ?? inner[0];
  if (weekColRight === undefined) return null;
  const edges = [weekColRight, ...inner.filter((x) => x > weekColRight + 5), right];
  if (edges.length !== 7) return null;
  const columns = edges.slice(0, -1).map((l, i) => ({ left: l, right: edges[i + 1]! }));

  // Row boundaries: full-width rules, from the one above week 1 down to the bottom of the table.
  const rules = [
    ...new Set(
      g.horizontals.filter((h) => h.x2 - h.x1 > width * 0.8).map((h) => Math.round(h.y * 10) / 10),
    ),
    ...(g.frame ? [Math.round(g.frame.y1 * 10) / 10] : []),
  ].sort((a, b) => b - a);
  const week1 = labels.filter((l) => l.week === 1).sort((a, b) => b.y - a.y)[0];
  if (!week1) return null;
  // The column headers end at the closest rule above the week 1 label.
  const above = rules.filter((y) => y > week1.y + week1.h * 0.5);
  if (!above.length) return null;
  const headerBottom = Math.min(...above);
  const below = [...new Set(rules.filter((y) => y <= headerBottom))].sort((a, b) => b - a);

  const bands: Band[] = [];
  for (let i = 0; i + 1 < below.length; i += 1) {
    const top = below[i]!;
    const bottom = below[i + 1]!;
    if (top - bottom < 6) continue;
    const weeks = labels
      .filter((l) => l.y + l.h * 0.35 < top && l.y + l.h * 0.35 > bottom)
      .map((l) => l.week);
    const inBand = g.text.filter(
      (t) => t.y + t.h * 0.35 < top && t.y + t.h * 0.35 > bottom && t.x > weekColRight - 2,
    );
    bands.push({
      top,
      bottom,
      weeks: [...new Set(weeks)].sort((a, b) => a - b),
      text: inBand.map((t) => t.str).join(' '),
    });
  }

  // Unlabelled bands (an exam or mock row printed without its number) take the next week,
  // never beyond the page's last week. A week that has its own exam or mock band is removed
  // from an earlier merged content band ("13 14" followed by the exam row means 13 is content).
  const lastWeek = Math.max(...labels.map((l) => l.week));
  let previous = 0;
  for (const band of bands) {
    if (!band.weeks.length) band.weeks = [Math.min(previous + 1, lastWeek)];
    previous = Math.max(previous, ...band.weeks);
  }
  bands.forEach((band, i) => {
    if (!bandKind(band)) return;
    for (const earlier of bands.slice(0, i)) {
      if (earlier.weeks.length > 1 && !bandKind(earlier)) {
        earlier.weeks = earlier.weeks.filter((w) => !band.weeks.includes(w));
      }
    }
  });
  return { weekColRight, columns, headerBottom, bands, middle: columns[3]!.left };
}

function cellText(g: PageGeometry, band: Band, col: { left: number; right: number }): string {
  const items = g.text
    .filter((t) => {
      const mid = t.y + t.h * 0.35;
      return mid < band.top && mid > band.bottom && t.x >= col.left - 2 && t.x < col.right - 2;
    })
    .sort((a, b) => (Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x));
  return clean(items.map((t) => t.str).join(' '));
}

function bandKind(band: Band): WeekKind | null {
  const s = squash(band.text);
  if (s.includes('MOCKEXAMINATION') || s.includes('FIRSTMOCK')) return 'MOCK';
  if (s.includes('ENDOFTERMEXAM')) return 'EXAMINATION';
  // A revision row repeats REVISION across its columns; a few words overflowing from the
  // week above (common in this PDF) must not hide it.
  if ((s.match(/REVISION/g) ?? []).length >= 2) return 'REVISION';
  if (s.includes('REVISION') && s.replace(/REVISION/g, '').length < 4) return 'REVISION';
  return null;
}

/** Header titles above the table: subject names and, for English and Ghanaian Language, strand titles. */
function blockHeaders(g: PageGeometry, grid: Grid) {
  const header = g.text.filter(
    (t) => t.y > grid.headerBottom + 1 && !/SCHEME OF LEARNING/i.test(t.str),
  );
  const subjects: { name: string; x: number }[] = [];
  const strands: { name: string; x: number }[] = [];
  for (const t of header) {
    const s = clean(t.str);
    if (subjectCodeFor(s)) subjects.push({ name: s, x: t.x + t.w / 2 });
    else if (/^STRAND\s*\d/i.test(s)) strands.push({ name: s, x: t.x });
  }
  const side = (x: number) => (x < grid.middle ? 0 : 1);
  const subjectFor = (block: 0 | 1) => {
    const own = subjects.find((s) => side(s.x) === block && Math.abs(s.x - grid.middle) > 40);
    // A single centred title (English, Ghanaian Language) covers both blocks.
    return own?.name ?? (subjects.length === 1 ? subjects[0]!.name : null);
  };
  const strandFor = (block: 0 | 1) => strands.find((s) => side(s.x) === block)?.name ?? null;
  return { subjectFor, strandFor };
}

/** Indicator codes have five numeric parts (B7.1.1.1.1); content standards have four. */
const INDICATOR_CODE = /B\s?\d\s?\.?\s?\d+\.\s?\d+\.\s?\d+\.\s?\d+\s?[.:]?/g;

function splitIndicators(text: string): string[] {
  const starts = [...text.matchAll(INDICATOR_CODE)].map((m) => m.index ?? 0);
  if (starts.length <= 1) return [text];
  const parts = starts.map((s, i) => clean(text.slice(s, starts[i + 1] ?? text.length)));
  const lead = clean(text.slice(0, starts[0]));
  if (lead) parts[0] = `${lead} ${parts[0]}`;
  return parts.filter(Boolean);
}

/** Content standard codes have four numeric parts (B7.1.1.1), not followed by a fifth. */
const STANDARD_CODE = /B\s?\.?\s?\d\s?\.\s?\d+\.\s?\d+\.\s?\d+(?!\s?\.\s?\d)\s?[.:]?/g;

const codeDigits = (s: string) => s.replace(/\D/g, '');

/**
 * A cell can hold two content standards ("B7.3.1.1 ... B7.3.2.1 ..."). Each indicator is paired
 * with the standard its own code starts with; when that is unclear it keeps the whole cell.
 */
function standardFor(standardCell: string, indicator: string): string {
  const starts = [...standardCell.matchAll(STANDARD_CODE)].map((m) => m.index ?? 0);
  if (starts.length <= 1) return standardCell;
  const parts = starts.map((st, i) =>
    clean(standardCell.slice(st, starts[i + 1] ?? standardCell.length)),
  );
  const indicatorCode = /B[\s.\d]+/.exec(indicator)?.[0];
  if (!indicatorCode) return standardCell;
  const digits = codeDigits(indicatorCode);
  const match = parts.find((p) => {
    const code = /B[\s.\d]+/.exec(p)?.[0];
    return code ? digits.startsWith(codeDigits(code).slice(0, 4)) : false;
  });
  return match ?? standardCell;
}

/** "STRAND 1: Diversity of Matter SS 1 : Materials" -> strand and sub-strand. */
function splitStrandCell(text: string): { strand: string | null; subStrand: string } {
  const m = /^(STRAND\s*\d+\s*:?.*?)(\bSS\s*\d.*)?$/is.exec(text);
  if (m && /^STRAND/i.test(text))
    return { strand: clean(m[1] ?? ''), subStrand: clean(m[2] ?? '') };
  return { strand: null, subStrand: text };
}

export async function extractSchemePdf(data: Uint8Array): Promise<Extraction> {
  const checksum = createHash('sha256').update(data).digest('hex');
  const pages = await readGeometry(data);
  const notes: string[] = [];
  const rows: ExtractedRow[] = [];
  const kindVotes = new Map<string, Map<WeekKind, number>>();
  const years = new Set<string>();

  pages.forEach((g, index) => {
    const pageNo = index + 1;
    const level = pageLevel(g);
    if (!level) return;
    const year = pageYear(g);
    if (year) years.add(year);
    const grid = buildGrid(g);
    if (!grid) {
      notes.push(`Page ${pageNo}: could not find the table grid; check this page by hand.`);
      return;
    }
    const headers = blockHeaders(g, grid);

    for (const block of [0, 1] as const) {
      const subject = headers.subjectFor(block);
      const [cStrand, cStandard, cIndicator] = grid.columns.slice(block * 3, block * 3 + 3) as [
        Grid['columns'][number],
        Grid['columns'][number],
        Grid['columns'][number],
      ];
      let strand = headers.strandFor(block) ?? '';
      let lastSubStrand = '';
      let blockRows = 0;

      for (const band of grid.bands) {
        const kind = bandKind(band);
        const weeks = band.weeks;
        for (const w of weeks) {
          const key = `${level}|${w}`;
          const votes = kindVotes.get(key) ?? new Map<WeekKind, number>();
          const k = kind ?? 'TEACHING';
          votes.set(k, (votes.get(k) ?? 0) + 1);
          kindVotes.set(key, votes);
        }
        if (kind || !subject) continue;

        const strandCell = cellText(g, band, cStrand);
        const standard = cellText(g, band, cStandard);
        const indicatorCell = cellText(g, band, cIndicator);
        if (!strandCell && !standard && !indicatorCell) continue;

        const parsed = splitStrandCell(strandCell);
        if (parsed.strand) strand = parsed.strand;
        const flags: ImportFlag[] = [];
        let subStrand = parsed.subStrand;
        if (!subStrand && lastSubStrand && (standard || indicatorCell)) {
          subStrand = lastSubStrand;
          flags.push('MERGED_CELL_INHERITED');
        }
        lastSubStrand = subStrand || lastSubStrand;
        if (weeks.length > 1) flags.push('MERGED_CELL_INHERITED');

        const indicators = indicatorCell ? splitIndicators(indicatorCell) : [''];
        for (const w of weeks) {
          for (const indicator of indicators) {
            rows.push({
              level,
              subject,
              weekNumber: w,
              strand: strand || '(strand not printed)',
              subStrand,
              contentStandard: standardFor(standard, indicator),
              indicator,
              sourcePage: pageNo,
              flags: [...new Set(flags)],
            });
            blockRows += 1;
          }
        }
      }
      // English Literature pages leave the right-hand half empty by design.
      if (subject && blockRows === 0 && headers.strandFor(block))
        notes.push(`Page ${pageNo}: no rows found for ${subject} (block ${block + 1}).`);
    }
  });

  // Week kinds per level by majority over that level's pages.
  const weeks: ExtractedWeek[] = [];
  for (const [key, votes] of kindVotes) {
    const [level, w] = key.split('|') as [Level, string];
    const kind = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    weeks.push({
      level,
      weekNumber: Number(w),
      kind,
      label: kind === 'TEACHING' ? undefined : kind,
    });
  }
  weeks.sort((a, b) =>
    a.level === b.level ? a.weekNumber - b.weekNumber : a.level < b.level ? -1 : 1,
  );

  if (years.size > 1) {
    notes.push(
      `Page headers show more than one academic year (${[...years].join(', ')}). Treat the cover's year as authoritative.`,
    );
  }
  return { checksum, pageCount: pages.length, notes, weeks, rows };
}
