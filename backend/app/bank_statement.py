"""Read a bank statement export (CSV, .xlsx or old .xls) into money-in lines.

Old .xls comes two ways: a real Excel 97-2003 (BIFF) file, or an HTML table
saved as .xls (several Indian banks). The first bytes decide, never the
extension. PDFs are refused by design: per-bank layouts plus OCR are a
project of their own; the bank's CSV/.xlsx download is the way in.

Banks lay these out differently (preamble rows, Deposit/Withdrawal columns or a
single Amount with Dr/Cr, Indian digit grouping), so the header row and columns
are found by name. Amounts are parsed to exact Decimal; a row whose amount or
date can't be read is REJECTED with its row number, never guessed.
"""

import csv
import io
import re
from html.parser import HTMLParser
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

MAX_ROWS = 10_000


class StatementError(ValueError):
    """The file as a whole can't be read (wrong format, no header row)."""


@dataclass
class Line:
    row: int
    date: str  # YYYY-MM-DD
    amount: Decimal  # money in, > 0, 2 decimals
    utr: str | None
    narration: str | None


@dataclass
class ParsedStatement:
    lines: list[Line] = field(default_factory=list)
    rejected: list[dict] = field(default_factory=list)  # {"row", "reason"}
    skipped: int = 0  # money-out rows


# Header names, normalized to lowercase alphanumerics. Earlier entries win.
_DATE = ("txndate", "transactiondate", "trandate", "date", "postdate", "valuedate", "valuedt")
_CREDIT = ("deposit", "credit", "cramount", "paidin")
_DEBIT = ("withdrawal", "debit", "dramount", "paidout")
_AMOUNT = ("amount", "txnamount", "transactionamount")
_DRCR = ("drcr", "crdr", "creditdebit", "debitcredit", "type", "transactiontype")
_UTR = ("utr", "rrn", "refno", "referenceno", "referencenumber", "reference",
        "chqrefno", "chequerefno", "refnochequeno", "chqno", "transactionid")
_NARRATION = ("narration", "description", "particulars", "remarks", "transactiondetails", "details")

_DMY = ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y", "%d-%m-%y",
        "%d-%b-%Y", "%d %b %Y", "%d-%b-%y", "%d %b %y", "%d/%b/%Y", "%d-%B-%Y", "%d %B %Y")
_MDY = ("%m/%d/%Y", "%m-%d-%Y", "%m.%d.%Y", "%m/%d/%y", "%m-%d-%y",
        "%b %d %Y", "%b %d, %Y", "%B %d %Y", "%B %d, %Y", "%b-%d-%Y")
_YMD = ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d")
# "auto" is Indian day-first plus ISO; a US-style export needs "MDY" picked.
DATE_FORMATS = {"auto": _DMY + ("%Y-%m-%d",), "DMY": _DMY, "MDY": _MDY, "YMD": _YMD}
_DATE_FORMATS = DATE_FORMATS["auto"]
COLUMNS = ("date", "credit", "debit", "amount", "drcr", "utr", "narration")
_AMOUNT_RE = re.compile(r"^-?\d+(\.\d{1,2})?$")
_RRN_RE = re.compile(r"(?<!\d)\d{12}(?!\d)")  # UPI reference number in a narration


def _norm(header) -> str:
    return re.sub(r"[^a-z0-9]", "", str(header or "").lower())


def _find(headers: list[str], names: tuple[str, ...], exact: bool = False) -> int | None:
    for name in names:
        for i, h in enumerate(headers):
            if h == name or (not exact and h.startswith(name)):
                return i
    return None


def parse_amount(cell) -> Decimal | None:
    """Exact amount, None for a blank cell. Raises ValueError if unreadable."""
    if cell is None:
        return None
    if isinstance(cell, bool):
        raise ValueError(cell)
    if isinstance(cell, (int, float, Decimal)):
        text = str(cell)
    else:
        text = str(cell).strip()
    if text in ("", "-", "--"):
        return None
    sign = 1
    upper = text.upper()
    for suffix, s in (("CR", 1), ("DR", -1)):
        if upper.endswith(suffix):
            upper, sign = upper[: -len(suffix)].strip(" ."), s
            break
    if upper.startswith("(") and upper.endswith(")"):
        upper, sign = upper[1:-1], -sign
    for junk in ("₹", "INR", "RS.", "RS", ",", " "):
        upper = upper.replace(junk, "")
    if not _AMOUNT_RE.match(upper):
        raise ValueError(text)
    try:
        return Decimal(upper) * sign
    except InvalidOperation as err:
        raise ValueError(text) from err


def parse_date(cell, date_format: str | None = None) -> str:
    if isinstance(cell, datetime):
        return cell.date().isoformat()
    if isinstance(cell, date):
        return cell.isoformat()
    text = str(cell or "").strip()
    formats = DATE_FORMATS.get(date_format or "auto", _DATE_FORMATS)
    for candidate in (text, text.split(" ")[0]):
        for fmt in formats:
            try:
                return datetime.strptime(candidate, fmt).date().isoformat()
            except ValueError:
                continue
    raise ValueError(text)


SAVE_AS = "This file can't be read. Save it as .xlsx or .csv and try again."
BIFF = b"\xd0\xcf\x11\xe0"  # Excel 97-2003 (an OLE2 container)


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def _looks_html(data: bytes) -> bool:
    return data.lstrip(b"\xef\xbb\xbf \t\r\n")[:1] == b"<"


def _biff_rows(data: bytes) -> list[list]:
    import xlrd

    try:
        book = xlrd.open_workbook(file_contents=data, on_demand=True)
        sheet = book.sheet_by_index(0)
    except Exception as err:  # noqa: BLE001 — corrupt, or an encrypted .xlsx in OLE2
        raise StatementError("Couldn't open this Excel file. Save it as .xlsx or .csv and try again.") from err
    out = []
    for r in range(min(sheet.nrows, MAX_ROWS + 50)):
        row = []
        for c in sheet.row(r):
            if c.ctype == xlrd.XL_CELL_DATE:
                row.append(xlrd.xldate_as_datetime(c.value, book.datemode))
            elif c.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
                row.append(None)
            else:
                row.append(c.value)
        out.append(row)
    return out


class _Table(HTMLParser):
    """Every <tr> of every table, cells as text (bank exports nest a header
    table above the transactions; the header row is found later by name)."""

    def __init__(self):
        super().__init__()
        self.rows: list[list] = []
        self._row: list | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []
        elif tag == "br" and self._cell is not None:
            self._cell.append(" ")

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append(" ".join("".join(self._cell).split()) or None)
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if any(self._row):
                self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def _html_rows(data: bytes) -> list[list]:
    table = _Table()
    table.feed(_decode(data))
    table.close()
    if not table.rows:
        raise StatementError(SAVE_AS)
    return table.rows[: MAX_ROWS + 50]


def _rows(data: bytes, filename: str) -> list[list]:
    name = (filename or "").lower()
    if data[:4] == BIFF:
        return _biff_rows(data)
    if data[:4] == b"%PDF" or name.endswith(".pdf"):
        raise StatementError("PDF statements can't be read. Download the statement from your bank and save it as .xlsx or .csv, then try again.")
    if name.endswith(".xls") or (_looks_html(data) and not name.endswith(".csv")):
        if _looks_html(data):
            return _html_rows(data)
        raise StatementError(SAVE_AS)
    if name.endswith(".xlsx") or data[:2] == b"PK":
        from openpyxl import load_workbook

        try:
            sheet = load_workbook(io.BytesIO(data), read_only=True, data_only=True).worksheets[0]
        except Exception as err:  # noqa: BLE001 — any corrupt workbook
            raise StatementError("Couldn't open this Excel file.") from err
        return [list(r) for r in sheet.iter_rows(values_only=True, max_row=MAX_ROWS + 50)]
    text = _decode(data)
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    return list(csv.reader(io.StringIO(text), dialect))[: MAX_ROWS + 50]


def _detect(rows: list[list]) -> tuple[int | None, dict | None]:
    """Header row and columns found by their names (the usual case)."""
    for i, row in enumerate(rows[:40]):
        headers = [_norm(c) for c in row]
        d = _find(headers, _DATE)
        credit = _find(headers, _CREDIT)
        amount = _find(headers, _AMOUNT)
        if d is not None and (credit is not None or amount is not None):
            return i, {
                "date": d, "credit": credit, "debit": _find(headers, _DEBIT),
                "amount": amount, "drcr": _find(headers, _DRCR, exact=True),
                "utr": _find(headers, _UTR), "narration": _find(headers, _NARRATION),
            }
    return None, None


def _mapped(rows: list[list], mapping: dict) -> tuple[int, dict]:
    """Columns the person picked on the mapping screen."""
    h = mapping.get("headerRow")
    if not isinstance(h, int) or isinstance(h, bool) or not 0 <= h < min(len(rows), 40):
        raise StatementError("Pick the row that has the column names.")
    width = max((len(r) for r in rows[h:h + 50]), default=0)
    cols = {}
    for key in COLUMNS:
        v = mapping.get(key)
        if v is None:
            cols[key] = None
        elif isinstance(v, int) and not isinstance(v, bool) and 0 <= v < width:
            cols[key] = v
        else:
            raise StatementError(f"The '{key}' column isn't in the file.")
    if cols["date"] is None or (cols["credit"] is None and cols["amount"] is None):
        raise StatementError("Pick the Date column and a Credit/Deposit or Amount column.")
    return h, cols


def parse_statement(data: bytes, filename: str, mapping: dict | None = None,
                    date_format: str | None = None) -> ParsedStatement:
    if date_format not in (None, *DATE_FORMATS):
        raise StatementError("Unknown date format.")
    rows = _rows(data, filename)
    if mapping:
        header_at, cols = _mapped(rows, mapping)
    else:
        header_at, cols = _detect(rows)
    if cols is None:
        raise StatementError(
            "Couldn't find the header row. The file needs a Date column and a "
            "Credit/Deposit or Amount column."
        )

    out = ParsedStatement()

    def cell(row, key):
        i = cols[key]
        return row[i] if i is not None and i < len(row) else None

    for n, row in enumerate(rows[header_at + 1:], start=header_at + 2):
        if not any(str(c or "").strip() for c in row):
            continue
        try:
            if cols["credit"] is not None:
                amount = parse_amount(cell(row, "credit"))
                if amount is None or amount == 0:
                    debit = parse_amount(cell(row, "debit"))
                    if debit:
                        out.skipped += 1
                        continue
                    amount = None
            else:
                amount = parse_amount(cell(row, "amount"))
                if amount is not None and _norm(cell(row, "drcr")).startswith("d"):
                    amount = -abs(amount)
        except ValueError:
            out.rejected.append({"row": n, "reason": f"Amount not readable: {cell(row, 'credit' if cols['credit'] is not None else 'amount')}"})
            continue
        raw_date = cell(row, "date")
        if amount is None:
            # No amount: a footer / balance / note row, not a transaction.
            if str(raw_date or "").strip():
                try:
                    parse_date(raw_date, date_format)
                except ValueError:
                    continue
                out.rejected.append({"row": n, "reason": "No amount"})
            continue
        if amount < 0:
            out.skipped += 1
            continue
        try:
            when = parse_date(raw_date, date_format)
        except ValueError:
            out.rejected.append({"row": n, "reason": f"Date not readable: {raw_date}"})
            continue
        narration = str(cell(row, "narration") or "").strip() or None
        utr = str(cell(row, "utr") or "").strip().lstrip("'") or None
        if utr is not None and (set(utr) <= {"0", "-"} or len(utr) > 64):
            utr = None
        if utr is None and narration:
            m = _RRN_RE.search(narration)
            utr = m.group(0) if m else None
        out.lines.append(Line(n, when, amount.quantize(Decimal("0.01")), utr, narration and narration[:500]))
        if len(out.lines) > MAX_ROWS:
            raise StatementError(f"Too many rows. Split the statement into files of {MAX_ROWS} rows or fewer.")
    return out


def preview_statement(data: bytes, filename: str, mapping: dict | None = None,
                      date_format: str | None = None) -> dict:
    """What the mapping screen shows: the column names, the columns we'd use,
    and the first lines as they'd be read. Saves nothing."""
    rows = _rows(data, filename)
    header_at, cols = _detect(rows)
    if mapping:
        header_at, cols = _mapped(rows, mapping)
    if header_at is None:
        header_at = next((i for i, r in enumerate(rows[:40]) if any(str(c or "").strip() for c in r)), 0)
    headers = [str(c or "").strip() for c in (rows[header_at] if rows else [])]
    out = {"headerRow": header_at, "headers": headers,
           "rows": [[str(c or "") for c in r] for r in rows[:min(len(rows), 40)]][:12],
           "mapping": None if cols is None else {"headerRow": header_at, **cols},
           "dateFormat": date_format or "auto", "needsMapping": cols is None}
    if cols is not None:
        parsed = parse_statement(data, filename, {"headerRow": header_at, **cols}, date_format)
        out.update(lines=len(parsed.lines), skipped=parsed.skipped, rejected=parsed.rejected[:20],
                   rejectedCount=len(parsed.rejected),
                   sample=[{"row": l.row, "date": l.date, "amount": f"{l.amount:.2f}", "utr": l.utr,
                            "narration": l.narration} for l in parsed.lines[:5]])
    return out
