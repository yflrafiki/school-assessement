# Curriculum extractor

The extractor now lives in the API, so headmasters upload the scheme-of-learning PDF directly
(Curriculum → Upload scheme of learning). It is
[backend/src/modules/curriculum/pdfExtract.ts](../../backend/src/modules/curriculum/pdfExtract.ts),
written in Node with pdfjs-dist, so it needs no Python.

To inspect what it reads from a file without importing anything:

```
pnpm --filter @school/api extract-scheme -- path/to/scheme.pdf --json out.json
```

The CEPME PDF is not committed to the repository. Tests that use it run only when it is supplied:

```
SCHEME_PDF=path/to/scheme.pdf pnpm --filter @school/api test
```
