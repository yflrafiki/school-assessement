# Curriculum extractor (not built yet)

This tool turns the CEPME first-term scheme-of-learning PDF into the JSON described in
[docs/curriculum-import.md](../../docs/curriculum-import.md).

It has not been written yet because the PDF has not been supplied to this workspace, and the
extraction has to be built and checked against the real file. The table rows must be rebuilt
from cell geometry, because strand and standard cells are merged across weeks.

Note: Python is not installed on the development machine. The plan's pdfplumber approach would
need Python 3.11+, or the tool can be written in Node with pdfjs-dist instead.
