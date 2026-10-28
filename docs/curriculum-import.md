# Curriculum import

Whatever the headmaster uploads is what the school teaches: the PDF is accepted as printed and published at once, and any topic can be corrected afterwards.

## Steps

1. **Upload.** Headmaster or school admin, Curriculum page, choose the term, then _Upload scheme of learning (PDF)_. Uploading the same file (same checksum) for the same term again returns the existing import.
2. **Extract.** The API reads the PDF (backend/src/modules/curriculum/pdfExtract.ts) and rebuilds each table from its ruling lines: horizontal rules give the week rows, vertical rules give the week column and the two subject blocks (strand or sub-strand, content standard, indicator). Week numbers come from the labels inside each row. Rows reading REVISION, FIRST MOCK EXAMINATION or END OF TERM EXAMS set the week type for the level. Cells holding several indicators are split at each indicator code, and each indicator is paired with its own content standard. Bands carrying two week numbers are applied to both weeks and flagged MERGED_CELL_INHERITED. On the supplied 2026/2027 file it reads 807 topics across all 30 level-subject tables, and Basic 9 week 11 comes out as the mock week.
3. **Validate and flag.** The API re-checks every row and adds flags: `TRUNCATED` (text cut off with "....." in the source), `CODE_LEVEL_MISMATCH` (for example a B8 code on a Basic 9 page), `OCR_OR_SPACING_NOISE`, `UNREADABLE`. It keeps any `MERGED_CELL_INHERITED` flags set by the extractor. Structure checks are listed in the import report: 10 subjects per level, 14 weeks, teaching weeks covered, English with 5 strands, Ghanaian Language with 6.
4. **Accept.** In the same request every row is accepted as printed (cut-off text stays cut off and is marked "Cut off in source"; nothing is guessed). Rows for subjects the system does not know are left out and counted in the report. Flags stay on the import rows for reference (Imports, Details). Duplicates are skipped by a natural key.
5. **Publish.** In the same transaction, when the uploader is the headmaster: the previous published version for the term is archived and its entries are retired (kept for records that reference them), and every class subject is re-paced. A school admin's upload stays a draft that the headmaster publishes from the Schemes list.
6. **Correct.** Curriculum page, Topics: filter by level, subject and week, then Edit. `PATCH /api/v1/curriculum/entries/:id` (headmaster only) changes strand, sub-strand, content standard, indicator or week; it is audited as `curriculum.topic_edited` with the before and after text. Records already made against the topic show the corrected wording. A topic with recorded lessons cannot move to another week.

The JSON route `POST /api/v1/curriculum/imports` (for the extractor tool) still stages rows for the older row-by-row review, bulk approval and separate approve and publish steps.

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
