// Developer tool: runs the PDF extractor on a file and prints a summary, or the full JSON.
// Usage: pnpm --filter @school/api extract-scheme -- path/to/scheme.pdf [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { extractSchemePdf } from '../modules/curriculum/pdfExtract.js';

const [file, flag, out] = process.argv.slice(2).filter((a) => a !== '--');
if (!file) {
  console.error('Usage: extract-scheme <file.pdf> [--json out.json]');
  process.exit(1);
}
const result = await extractSchemePdf(new Uint8Array(readFileSync(file)));
if (flag === '--json' && out) {
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(`Wrote ${result.rows.length} rows to ${out}`);
}
console.log(
  `pages: ${result.pageCount}, rows: ${result.rows.length}, checksum: ${result.checksum}`,
);
for (const n of result.notes) console.log(`note: ${n}`);
const byLevelSubject = new Map<string, number>();
for (const r of result.rows) {
  const k = `${r.level} ${r.subject}`;
  byLevelSubject.set(k, (byLevelSubject.get(k) ?? 0) + 1);
}
for (const [k, n] of [...byLevelSubject].sort()) console.log(`  ${k}: ${n}`);
for (const level of ['BASIC_7', 'BASIC_8', 'BASIC_9']) {
  const kinds = result.weeks
    .filter((w) => w.level === level)
    .map((w) => `${w.weekNumber}${w.kind === 'TEACHING' ? '' : `=${w.kind}`}`)
    .join(' ');
  console.log(`${level} weeks: ${kinds}`);
}
