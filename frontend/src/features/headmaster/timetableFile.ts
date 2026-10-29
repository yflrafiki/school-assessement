// Turns an uploaded timetable (Excel or CSV) into lesson slots. Pure functions, so every
// layout rule is unit-tested. Two layouts are understood:
//  - grid: one row per class and day, a column per period headed by its times ("8:00-8:40"),
//    the subject in each cell. Breaks, worship and empty cells are skipped.
//  - list: one row per lesson with Class, Subject, Day, Start and End columns.
// A sheet without a Class column takes the class from the sheet's name (one sheet per class).

export interface DraftRow {
  className: string;
  subject: string;
  weekday: number | null;
  startTime: string;
  endTime: string;
}

export interface SheetGrid {
  name: string;
  rows: string[][];
}

const DAYS: Record<string, number> = {
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
};

export function parseDay(value: string): number | null {
  const v = value.trim().toLowerCase().replace(/\.$/, '');
  if (/^[1-5]$/.test(v)) return Number(v);
  return DAYS[v] ?? null;
}

/**
 * "8:00", "08.00", "8", "8:00am", "1:30 PM" and "13:30" all become "HH:MM". Without am or
 * pm, 1 to 5 o'clock is the afternoon: no school lesson starts at 1 in the morning.
 */
export function parseTime(value: string): string | null {
  const m = value
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? '0');
  const half = m[3]?.replace(/\./g, '');
  if (half === 'pm' && h < 12) h += 12;
  if (half === 'am' && h === 12) h = 0;
  if (!half && h >= 1 && h <= 5) h += 12;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** A period heading such as "8:00 - 8:40" or "8.00–8.40am". */
export function parseRange(value: string): [string, string] | null {
  const parts = value.split(/\s*(?:-|–|—|to)\s*/i).filter(Boolean);
  if (parts.length !== 2) return null;
  const suffix = parts[1]!.match(/(am|pm)$/i)?.[1] ?? '';
  const start = parseTime(/(am|pm)$/i.test(parts[0]!) ? parts[0]! : `${parts[0]}${suffix}`);
  const end = parseTime(parts[1]!);
  if (!start || !end) return null;
  return start < end ? [start, end] : null;
}

/** Excel stores times as fractions of a day; read-excel-file gives dates for time cells. */
export function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) {
    return `${String(cell.getUTCHours()).padStart(2, '0')}:${String(cell.getUTCMinutes()).padStart(2, '0')}`;
  }
  if (typeof cell === 'number' && cell > 0 && cell < 1) {
    const minutes = Math.round(cell * 24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  return String(cell).trim();
}

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, commas or semicolons. */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^\uFEFF/, '');
  const firstLine = body.split(/\r?\n/, 1)[0] ?? '';
  const sep =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i]!;
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && body[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((f) => f.trim()));
}

const NOT_A_LESSON =
  /^(-+|break|snack break|short break|long break|lunch|lunch break|worship|assembly|games|sports|recess|closing|prep|free|club|clubs|pta|devotion|cleaning)$/i;

const heading = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

function findColumn(header: string[], names: string[]) {
  return header.findIndex((h) => names.includes(heading(h)));
}

/** Reads every sheet. Returns the slots and plain-language notes about anything skipped. */
export function rowsFromSheets(sheets: SheetGrid[]): { rows: DraftRow[]; notes: string[] } {
  const rows: DraftRow[] = [];
  const notes: string[] = [];
  for (const sheet of sheets) {
    const headerAt = sheet.rows.findIndex((r) => r.some((c) => heading(c) === 'day'));
    if (headerAt < 0) {
      if (sheet.rows.some((r) => r.some(Boolean)))
        notes.push(`Sheet "${sheet.name}" was skipped: it has no "Day" column.`);
      continue;
    }
    const header = sheet.rows[headerAt]!;
    const dayCol = findColumn(header, ['day']);
    const classCol = findColumn(header, ['class', 'classname', 'form']);
    const subjectCol = findColumn(header, ['subject', 'lesson']);
    const startCol = findColumn(header, ['start', 'starttime', 'from', 'begin']);
    const endCol = findColumn(header, ['end', 'endtime', 'to', 'finish']);
    const timeCol = findColumn(header, ['time', 'period', 'periods']);
    const periods = header
      .map((h, i) => ({ i, range: parseRange(h) }))
      .filter((p): p is { i: number; range: [string, string] } => p.range !== null);

    let day: number | null = null;
    let className = classCol < 0 ? sheet.name.trim() : '';
    for (const r of sheet.rows.slice(headerAt + 1)) {
      if (!r.some(Boolean)) continue;
      // Merged cells arrive empty after the first row, so the day and class carry forward.
      if (r[dayCol]) day = parseDay(r[dayCol]!);
      if (classCol >= 0 && r[classCol]) className = r[classCol]!;
      if (subjectCol >= 0) {
        const subject = (r[subjectCol] ?? '').trim();
        if (!subject || NOT_A_LESSON.test(subject)) continue;
        const range = timeCol >= 0 ? parseRange(r[timeCol] ?? '') : null;
        rows.push({
          className,
          subject,
          weekday: day,
          startTime: range?.[0] ?? parseTime(r[startCol] ?? '') ?? '',
          endTime: range?.[1] ?? parseTime(r[endCol] ?? '') ?? '',
        });
      } else {
        for (const p of periods) {
          const subject = (r[p.i] ?? '').replace(/\(.*?\)/g, '').trim();
          if (!subject || NOT_A_LESSON.test(subject)) continue;
          rows.push({
            className,
            subject,
            weekday: day,
            startTime: p.range[0],
            endTime: p.range[1],
          });
        }
      }
    }
    if (subjectCol < 0 && !periods.length) {
      notes.push(
        `Sheet "${sheet.name}" was skipped: no Subject column and no period times such as "8:00-8:40" in the heading row.`,
      );
    }
  }
  return { rows, notes };
}

export async function readTimetableFile(file: File): Promise<SheetGrid[]> {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
    return [{ name: file.name.replace(/\.csv$/i, ''), rows: parseCsv(await file.text()) }];
  }
  if (/\.xlsx$/i.test(file.name)) {
    // Loaded only when an Excel file is chosen, so the main bundle stays small.
    const { default: readXlsxFile } = await import('read-excel-file/browser');
    const sheets = await readXlsxFile(file);
    return sheets.map((s) => ({ name: s.sheet, rows: s.data.map((r) => r.map(cellText)) }));
  }
  throw new Error(
    'Upload the timetable as an Excel file (.xlsx) or CSV. An older .xls file can be saved as .xlsx from Excel.',
  );
}

/** A blank grid for the school's classes, ready to fill in Excel. */
export function templateCsv(classNames: string[]): string {
  const periods = [
    '8:00-8:40',
    '8:40-9:20',
    '9:20-10:00',
    '10:30-11:10',
    '11:10-11:50',
    '11:50-12:30',
    '1:30-2:10',
    '2:10-2:50',
  ];
  const lines = [['Class', 'Day', ...periods].join(',')];
  for (const c of classNames.length ? classNames : ['B7A']) {
    for (const d of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      lines.push([`"${c.replace(/"/g, '""')}"`, d, ...periods.map(() => '')].join(','));
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}
