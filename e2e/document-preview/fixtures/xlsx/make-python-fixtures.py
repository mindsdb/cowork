"""
Writes the .xlsx fixtures that come from the Python libraries an agent writes
workbooks with, rather than from make-fixtures.mjs:
- openpyxl-total.xlsx and xlsxwriter-total.xlsx hold the same small table
  with a =SUM total, saved as each library saves it. Neither library
  calculates formulas, so openpyxl saves the total with an empty value and
  XlsxWriter saves it as 0.
- openpyxl-report.xlsx and xlsxwriter-report.xlsx hold amounts in Excel's
  built-in currency, accounting and date formats, which both libraries save
  as a format id with no format code, and a worksheet that holds only a
  chart. They hold no formula. The XlsxWriter one also has a sparkline of
  the amounts, which XlsxWriter saves as an <xm:f> after the cells.
Both libraries ask for every workbook they save to be calculated when it
opens, formulas or not.

The bytes depend on the library versions, so install exactly these, then run
from the repository root:
  pip install openpyxl==3.1.5 XlsxWriter==3.3.0
  python3 e2e/document-preview/fixtures/xlsx/make-python-fixtures.py

Every date either library writes is pinned, so the same library versions
write the same bytes with the same Python, zlib and operating system. zlib's
deflate output can differ between its builds, every zip entry records the
system that wrote it, and an entry openpyxl copies from a temporary file
records that file's mode. XlsxWriter already stamps its zip entries with one
fixed date. openpyxl stamps them, and its modified date, with the time of the
save, so this saves through openpyxl's own ExcelWriter, the writer its
save_workbook uses, into a zip that stamps one fixed date instead.
"""
import datetime
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

import openpyxl
import xlsxwriter
from openpyxl.chart import BarChart, Reference
from openpyxl.styles.numbers import BUILTIN_FORMATS
from openpyxl.writer.excel import ExcelWriter

FOLDER = Path(__file__).resolve().parent
SAVED_AT = datetime.datetime(2000, 1, 1)
ROWS = [('Item', 'Amount'), ('Rent', 1200), ('Power', 80), ('Water', 45)]
TOTAL = '=SUM(B2:B4)'
# Each row's label, value and built-in format id. Excel shows the ids from 5
# to 8 and 41 to 44 in the locale's currency, and 27 to 36 as East Asian
# dates; with no locale they read as US dollars and m/d/yy.
OPENPYXL_AMOUNTS = [('Currency', 1234.5, 7), ('Accounting', 1234.5, 44), ('Whole currency', 1234.5, 5), ('Whole accounting', 1234.5, 42)]
XLSXWRITER_AMOUNTS = [('Currency', 1234.5, 7), ('Accounting', 1234.5, 44), ('Date', 45000.25, 31)]


class FixedDateZip(ZipFile):
    """A zip that stamps every entry with SAVED_AT. ZipFile stamps an entry
    written by name with the time of the call, and one copied from a file, as
    openpyxl writes each sheet, with the file's time."""

    def writestr(self, zinfo_or_arcname, data, *args, **kwargs):
        if not isinstance(zinfo_or_arcname, ZipInfo):
            zinfo_or_arcname = ZipInfo(zinfo_or_arcname, SAVED_AT.timetuple()[:6])
            zinfo_or_arcname.compress_type = self.compression
            zinfo_or_arcname.external_attr = 0o600 << 16
        super().writestr(zinfo_or_arcname, data, *args, **kwargs)

    def write(self, filename, arcname=None, *args, **kwargs):
        zinfo = ZipInfo.from_file(filename, arcname)
        zinfo.date_time = SAVED_AT.timetuple()[:6]
        zinfo.compress_type = self.compression
        with open(filename, 'rb') as source:
            super().writestr(zinfo, source.read())


def save_openpyxl(workbook, path):
    workbook.properties.created = SAVED_AT
    workbook.properties.modified = SAVED_AT
    with FixedDateZip(path, 'w', ZIP_DEFLATED, allowZip64=True) as archive:
        ExcelWriter(workbook, archive).save()


def write_openpyxl(path):
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = 'Budget'
    for row in ROWS:
        sheet.append(row)
    sheet.append(('Total', TOTAL))
    save_openpyxl(workbook, path)


def write_xlsxwriter(path):
    workbook = xlsxwriter.Workbook(str(path), {'in_memory': True})
    workbook.set_properties({'created': SAVED_AT})
    sheet = workbook.add_worksheet('Budget')
    for r, row in enumerate(ROWS):
        sheet.write_row(r, 0, row)
    sheet.write_row(len(ROWS), 0, ('Total', TOTAL))
    workbook.close()


def write_openpyxl_report(path):
    """The amounts on the first sheet, which the workbook opens on, then a
    worksheet whose only content is a chart of them, placed with add_chart."""
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = 'Prices'
    sheet.append(('Format', 'Amount'))
    for label, value, format_id in OPENPYXL_AMOUNTS:
        sheet.append((label, value))
        sheet.cell(row=sheet.max_row, column=2).number_format = BUILTIN_FORMATS[format_id]
    chart = BarChart()
    chart.add_data(Reference(sheet, min_col=2, min_row=1, max_row=sheet.max_row), titles_from_data=True)
    workbook.create_sheet('Chart').add_chart(chart, 'A1')
    save_openpyxl(workbook, path)


def write_xlsxwriter_report(path):
    """A worksheet whose only content is a chart of the amounts, placed with
    insert_chart, which the workbook opens on, then the amounts with a
    sparkline of them beside."""
    workbook = xlsxwriter.Workbook(str(path), {'in_memory': True})
    workbook.set_properties({'created': SAVED_AT})
    chart_sheet = workbook.add_worksheet('Chart')
    sheet = workbook.add_worksheet('Prices')
    sheet.write_row(0, 0, ('Format', 'Amount'))
    for r, (label, value, format_id) in enumerate(XLSXWRITER_AMOUNTS, start=1):
        sheet.write_string(r, 0, label)
        sheet.write_number(r, 1, value, workbook.add_format({'num_format': format_id}))
    sheet.add_sparkline('C2', {'range': f'Prices!B2:B{len(XLSXWRITER_AMOUNTS) + 1}'})
    chart = workbook.add_chart({'type': 'column'})
    chart.add_series({'values': f'=Prices!$B$2:$B${len(XLSXWRITER_AMOUNTS) + 1}'})
    chart_sheet.insert_chart('A1', chart)
    workbook.close()


if __name__ == '__main__':
    write_openpyxl(FOLDER / 'openpyxl-total.xlsx')
    write_xlsxwriter(FOLDER / 'xlsxwriter-total.xlsx')
    write_openpyxl_report(FOLDER / 'openpyxl-report.xlsx')
    write_xlsxwriter_report(FOLDER / 'xlsxwriter-report.xlsx')
