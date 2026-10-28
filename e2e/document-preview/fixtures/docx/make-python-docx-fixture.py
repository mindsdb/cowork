"""Writes python-docx-report.docx, which fixtures.yaml lists.

The agent writes Word files with python-docx, so this fixture comes from
python-docx itself rather than from hand-built XML: a heading, a paragraph, a
table in the Table Grid style and an inline picture, on python-docx's default
template. That template brings its own styles, theme, numbering, settings and
font table, as every python-docx document has.

python-docx stamps no date into the parts below, but zipfile stamps the time
of the run on every entry. So the package is written again with one fixed
date on every entry, and the same python-docx and zlib always write the same
bytes. It was last run with python-docx 1.2.0.

Rewrite the file from the repository root, with python-docx installed, with:
  python3 e2e/document-preview/fixtures/docx/make-python-docx-fixture.py
"""

import base64
import io
import zipfile
from pathlib import Path

import docx
from docx.shared import Inches

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "python-docx-report.docx"

# The date every zip entry carries, the same one make-fixtures.mjs uses.
ENTRY_DATE = (2000, 1, 1, 0, 0, 0)

# An 8 by 8 PNG of one blue, the picture make-fixtures.mjs uses too.
BLUE_SQUARE_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mOQ96vEihiGlgQAYZI5gdeoGqEAAAAASUVORK5CYII="
)


def report() -> bytes:
    """The document as python-docx saves it."""
    document = docx.Document()
    document.add_heading("Regional sales", level=1)
    document.add_paragraph("Totals for each region this quarter.")
    table = document.add_table(rows=1, cols=2)
    table.style = "Table Grid"
    header_cells = table.rows[0].cells
    header_cells[0].text = "Region"
    header_cells[1].text = "Total"
    for region, total in (("East", "140"), ("West", "85")):
        cells = table.add_row().cells
        cells[0].text = region
        cells[1].text = total
    document.add_picture(io.BytesIO(BLUE_SQUARE_PNG), width=Inches(1))
    saved = io.BytesIO()
    document.save(saved)
    return saved.getvalue()


def with_fixed_dates(package: bytes) -> bytes:
    """The same zip entries, in the same order, each dated ENTRY_DATE."""
    written = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(package)) as source, zipfile.ZipFile(written, "w") as target:
        for entry in source.infolist():
            fixed = zipfile.ZipInfo(entry.filename, date_time=ENTRY_DATE)
            fixed.compress_type = zipfile.ZIP_DEFLATED
            target.writestr(fixed, source.read(entry.filename), compresslevel=9)
    return written.getvalue()


if __name__ == "__main__":
    data = with_fixed_dates(report())
    FIXTURE.write_bytes(data)
    print(f"{FIXTURE.name}: {len(data)} bytes")
