"""Old .xls bank statements: real Excel 97-2003 (BIFF) and HTML tables saved
as .xls. The first bytes decide, not the name. PDFs stay refused by design."""

import io
from datetime import datetime

import openpyxl
import pytest
import xlwt

from app.bank_statement import StatementError, parse_statement

API = "/api/v1"
ROWS = [
    ["Statement of account", None, None, None, None],
    ["Txn Date", "Description", "Ref No", "Deposit", "Withdrawal"],
    [datetime(2026, 11, 2), "UPI/RAVI KIRANA", "321098765432", 1250.5, None],
    [datetime(2026, 11, 3), "NEFT SURESH", "N123456789", 9000, None],
    [datetime(2026, 11, 3), "RENT", None, None, 9000],
]
HTML_XLS = """<html><head><meta charset="utf-8"></head><body>
<table><tr><td>Account No</td><td>XXXX1234</td></tr></table>
<table border="1">
<tr><th>Txn Date</th><th>Description</th><th>Ref No</th><th>Deposit</th><th>Withdrawal</th></tr>
<tr><td>02/11/2026</td><td>UPI/RAVI<br>KIRANA</td><td>321098765432</td><td>1,250.50</td><td></td></tr>
<tr><td>03/11/2026</td><td>NEFT SURESH &amp; SONS</td><td>N123456789</td><td>9,000.00</td><td></td></tr>
<tr><td>03/11/2026</td><td>RENT</td><td></td><td></td><td>9,000.00</td></tr>
</table></body></html>""".encode()


def _xls(rows=ROWS) -> bytes:
    book = xlwt.Workbook()
    sheet = book.add_sheet("Statement")
    dated = xlwt.easyxf(num_format_str="DD/MM/YYYY")
    for r, row in enumerate(rows):
        for c, value in enumerate(row):
            if isinstance(value, datetime):
                sheet.write(r, c, value, dated)
            elif value is not None:
                sheet.write(r, c, value)
    buf = io.BytesIO()
    book.save(buf)
    return buf.getvalue()


def _xlsx(rows=ROWS) -> bytes:
    wb = openpyxl.Workbook()
    for row in rows:
        wb.active.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _lines(parsed):
    return [(l.date, l.amount, l.utr, l.narration) for l in parsed.lines]


def test_a_biff_xls_reads_the_same_lines_as_its_xlsx_twin():
    xls, xlsx = parse_statement(_xls(), "statement.xls"), parse_statement(_xlsx(), "statement.xlsx")
    assert _lines(xls) == _lines(xlsx) and len(xls.lines) == 2
    assert xls.lines[0].date == "2026-11-02" and str(xls.lines[0].amount) == "1250.50"
    # The bytes decide: the same file with the "wrong" name still reads.
    assert _lines(parse_statement(_xls(), "statement.csv")) == _lines(xlsx)


def test_an_html_xls_reads_like_a_table():
    parsed = parse_statement(HTML_XLS, "AccountStatement.xls", date_format="DMY")
    assert [(l.date, str(l.amount), l.utr, l.narration) for l in parsed.lines] == [
        ("2026-11-02", "1250.50", "321098765432", "UPI/RAVI KIRANA"),
        ("2026-11-03", "9000.00", "N123456789", "NEFT SURESH & SONS")]


def test_html_xls_imports_and_the_mapping_screen_shows_its_columns(make_user, client):
    owner = make_user()
    r = client.post(f"{API}/reconciliation/preview", headers=owner.headers,
                    files={"file": ("AccountStatement.xls", HTML_XLS, "application/vnd.ms-excel")})
    assert r.status_code == 200, r.text
    assert r.json()["headers"] == ["Txn Date", "Description", "Ref No", "Deposit", "Withdrawal"]
    r = client.post(f"{API}/reconciliation/import", headers=owner.headers, data={"dateFormat": "DMY"},
                    files={"file": ("AccountStatement.xls", HTML_XLS, "application/vnd.ms-excel")})
    assert r.status_code == 200 and r.json()["imported"] == 2, r.text


def test_the_same_xls_twice_adds_nothing(make_user, client):
    owner = make_user()
    send = lambda name, data: client.post(f"{API}/reconciliation/import", headers=owner.headers,  # noqa: E731
                                          files={"file": (name, data, "application/vnd.ms-excel")}).json()
    assert send("nov.xls", _xls())["imported"] == 2
    again = send("nov.xls", _xls())
    assert again["imported"] == 0 and again["alreadyImported"]
    # Its .xlsx twin is a different file, but its lines are already in: UTR dedup.
    twin = send("nov.xlsx", _xlsx())
    assert twin["imported"] == 0 and twin["duplicates"] == 2


def test_a_pdf_is_still_refused_with_save_as(make_user, client):
    owner = make_user()
    for name in ("statement.pdf", "statement.xls"):
        r = client.post(f"{API}/reconciliation/import", headers=owner.headers,
                        files={"file": (name, b"%PDF-1.7\n1 0 obj<<>>endobj\n", "application/pdf")})
        assert r.status_code == 422 and "save it as .xlsx or .csv" in r.json()["detail"], r.text


def test_anything_else_named_xls_is_refused():
    for junk in (b"Txn Date,Amount\n02/11/2026,10\n", b"\x00\x01binary"):
        with pytest.raises(StatementError, match="Save it as .xlsx or .csv"):
            parse_statement(junk, "statement.xls")
