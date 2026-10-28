// Server-side checks on extracted curriculum rows (import pipeline step 3 and 4).
import { createHash } from 'node:crypto';
import type { ExtractedRow, ImportFlag, Level } from '@school/shared';

const LEVEL_NUMBER: Record<Level, string> = { BASIC_7: '7', BASIC_8: '8', BASIC_9: '9' };

/** Collapses whitespace and case so near-identical text matches. Raw text is always kept. */
export function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Subject names as printed in the PDF, mapped to national catalogue codes. */
const SUBJECT_ALIASES: Record<string, string> = {
  'english language': 'ENG',
  english: 'ENG',
  computing: 'COMP',
  'social studies': 'SOC',
  science: 'SCI',
  'religious and moral education': 'RME',
  rme: 'RME',
  mathematics: 'MATH',
  'creative arts and design': 'CAD',
  'creative arts and disign': 'CAD',
  'creative arts & design': 'CAD',
  'career technology': 'CT',
  french: 'FRE',
  'ghanaian language': 'GHL',
  'ghanaian languages': 'GHL',
};

export function subjectCodeFor(name: string): string | null {
  return (
    SUBJECT_ALIASES[
      normalise(name)
        .replace(/[^a-z& ]/g, '')
        .trim()
    ] ?? null
  );
}

const TRUNCATION = /(\.{4,}|…)/;
const CODE = /\bB\s?(\d)(?=[.\d])[\d.]*/g;
const NOISE = /[a-z][A-Z]{2,}|\b[A-Za-z]{25,}\b/;

export function rowFlags(row: ExtractedRow): ImportFlag[] {
  const flags = new Set<ImportFlag>(row.flags);
  const text = `${row.contentStandard} ${row.indicator}`;
  if (TRUNCATION.test(text)) flags.add('TRUNCATED');
  if (!row.indicator.trim() && !row.contentStandard.trim()) flags.add('UNREADABLE');
  for (const m of text.matchAll(CODE)) {
    if (m[1] !== LEVEL_NUMBER[row.level]) flags.add('CODE_LEVEL_MISMATCH');
  }
  if (NOISE.test(text)) flags.add('OCR_OR_SPACING_NOISE');
  return [...flags];
}

export function naturalKey(
  level: Level,
  subjectId: string,
  weekNumber: number,
  r: { strand: string; subStrand: string; indicator: string; contentStandard: string },
) {
  return createHash('sha256')
    .update(
      [
        level,
        subjectId,
        weekNumber,
        normalise(r.strand),
        normalise(r.subStrand),
        normalise(r.contentStandard),
        normalise(r.indicator),
      ].join('|'),
    )
    .digest('hex');
}

export interface BatchWarnings {
  warnings: string[];
}

/** Structure checks over a whole extraction: subjects per level, week coverage, strand counts. */
export function validateBatch(
  rows: ExtractedRow[],
  weeks: { level: Level; weekNumber: number; kind: string }[],
): BatchWarnings {
  const warnings: string[] = [];
  const levels: Level[] = ['BASIC_7', 'BASIC_8', 'BASIC_9'];
  for (const level of levels) {
    const levelRows = rows.filter((r) => r.level === level);
    if (!levelRows.length) {
      warnings.push(`${level}: no rows extracted`);
      continue;
    }
    const subjects = new Set(levelRows.map((r) => subjectCodeFor(r.subject) ?? `?${r.subject}`));
    if (subjects.size !== 10)
      warnings.push(`${level}: ${subjects.size} subjects found, expected 10`);
    for (const s of subjects)
      if (s.startsWith('?')) warnings.push(`${level}: unknown subject "${s.slice(1)}"`);

    const levelWeeks = weeks.filter((w) => w.level === level);
    const required = levelWeeks.filter((w) => w.kind === 'TEACHING').map((w) => w.weekNumber);
    if (levelWeeks.length !== 14)
      warnings.push(`${level}: ${levelWeeks.length} weeks defined, expected 14`);

    for (const code of subjects) {
      const subjectRows = levelRows.filter(
        (r) => (subjectCodeFor(r.subject) ?? `?${r.subject}`) === code,
      );
      const covered = new Set(subjectRows.map((r) => r.weekNumber));
      const missing = required.filter((w) => !covered.has(w));
      if (missing.length)
        warnings.push(`${level} ${code}: no entries for teaching weeks ${missing.join(', ')}`);
      const nonTeaching = subjectRows
        .filter((r) => !required.includes(r.weekNumber))
        .map((r) => r.weekNumber);
      if (nonTeaching.length) {
        warnings.push(
          `${level} ${code}: entries in non-teaching weeks ${[...new Set(nonTeaching)].join(', ')}`,
        );
      }
      const strands = new Set(subjectRows.map((r) => normalise(r.strand)).filter(Boolean));
      if (code === 'ENG' && strands.size !== 5)
        warnings.push(`${level} English: ${strands.size} strands, expected 5`);
      if (code === 'GHL' && strands.size !== 6)
        warnings.push(`${level} Ghanaian Language: ${strands.size} strands, expected 6`);
    }
  }
  return { warnings };
}
