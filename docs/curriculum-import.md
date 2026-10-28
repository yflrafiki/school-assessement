# Curriculum import

The scheme of learning is not "imported" just because text came out of the PDF. Every flagged row is reviewed by a person before anything reaches teachers.

## Steps

1. **Extract** (offline tool, `tools/curriculum-extract`). Rebuild each table row from word positions and cell geometry, because strand and standard cells are merged across weeks. Output one JSON file in the format below. _Status: not built yet. It needs the CEPME scheme-of-learning PDF, which has not been supplied to this workspace._
2. **Upload.** Headmaster or school admin, Curriculum page, _Upload extraction_, for a chosen term. The API stores a staged batch. Uploading the same file (same checksum) for the same term again returns the existing batch.
3. **Validate and flag.** The API re-checks every row and adds flags: `TRUNCATED` (text cut off with "....." in the source), `CODE_LEVEL_MISMATCH` (for example a B8 code on a Basic 9 page), `OCR_OR_SPACING_NOISE`, `UNREADABLE`. It keeps any `MERGED_CELL_INHERITED` flags set by the extractor. Structure checks are listed in the import report: 10 subjects per level, 14 weeks, teaching weeks covered, English with 5 strands, Ghanaian Language with 6.
4. **Review.** Every flagged row needs a decision: approve (truncated text is approved as truncated, never completed by guesswork), correct (needs a note), or reject.
5. **Approve.** One transaction creates a draft scheme version with its weeks and entries. Duplicates are skipped by a natural key. The report records imported, rejected, duplicate and corrected counts.
6. **Publish.** A separate, audited step. The previous published version for the term is archived and its entries are retired (kept for records that reference them). Every class subject is re-paced.

## File format

`POST /api/v1/curriculum/imports` accepts this JSON. The web page adds `termId`.

```json
{
  "fileName": "CEPME_SoL_2026-2027_Term1.pdf",
  "checksum": "<sha256 of the PDF, 64 hex characters>",
  "notes": ["Some page headers say 2025/2026; cover and filename say 2026/2027."],
  "weeks": [
    { "level": "BASIC_7", "weekNumber": 13, "kind": "REVISION", "label": "REVISION" },
    { "level": "BASIC_9", "weekNumber": 11, "kind": "MOCK", "label": "FIRST MOCK EXAMINATION" }
  ],
  "rows": [
    {
      "level": "BASIC_7",
      "subject": "Mathematics",
      "weekNumber": 1,
      "strand": "Number",
      "subStrand": "Number and numeration systems",
      "contentStandard": "B7.1.1.1 Demonstrate understanding .......",
      "indicator": "B7.1.1.1.1 Model number quantities up to 1,000,000,000 ...",
      "sourcePage": 8,
      "flags": ["MERGED_CELL_INHERITED"]
    }
  ]
}
```

- `weeks` must list all 14 weeks per level with their kind: TEACHING, REVISION, MOCK or EXAMINATION. From the plan: Basic 7 and 8 have weeks 1 to 12 TEACHING, 13 REVISION and 14 EXAMINATION. Basic 9 has 1 to 10 TEACHING, 11 MOCK, 12 and 13 TEACHING and 14 EXAMINATION.
- `subject` uses the names printed in the PDF. Known spellings, including "Creative Arts and Disign", map to the national catalogue (`backend/src/modules/curriculum/validation.ts`). Unknown names block approval until the rows are rejected or the extraction is fixed.
- Ghanaian Language rows go to the generic framework subject. Language subjects added by a school fall back to them until language-specific topics are imported.
- Keep text verbatim. Normalisation happens only for matching.
