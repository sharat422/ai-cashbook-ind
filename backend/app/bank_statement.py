"""Read a bank statement export (CSV or .xlsx) into money-in lines.

Banks lay these out differently (preamble rows, Deposit/Withdrawal columns or a
single Amount with Dr/Cr, Indian digit grouping), so the header row and columns
are found by name. Amounts are parsed to exact Decimal; a row whose amount or
date can't be read is REJECTED with its row number, never guessed.
"""

import csv
import io
import re
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

_DATE_FORMATS = ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y", "%d-%m-%y", "%Y-%m-%d",
                 "%d-%b-%Y", "%d %b %Y", "%d-%b-%y", "%d %b %y", "%d/%b/%Y", "%d-%B-%Y", "%d %B %Y")
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


def parse_date(cell) -> str:
    if isinstance(cell, datetime):
        return cell.date().isoformat()
    if isinstance(cell, date):
        return cell.isoformat()
    text = str(cell or "").strip()
    for candidate in (text, text.split(" ")[0]):
        for fmt in _DATE_FORMATS:
            try:
                return datetime.strptime(candidate, fmt).date().isoformat()
            except ValueError:
                continue
    raise ValueError(text)


def _rows(data: bytes, filename: str) -> list[list]:
    name = (filename or "").lower()
    if name.endswith(".xls"):
        raise StatementError("Old .xls files aren't supported. Save it as .xlsx or .csv and try again.")
    if name.endswith(".xlsx") or data[:2] == b"PK":
        from openpyxl import load_workbook

        try:
            sheet = load_workbook(io.BytesIO(data), read_only=True, data_only=True).worksheets[0]
        except Exception as err:  # noqa: BLE001 — any corrupt workbook
            raise StatementError("Couldn't open this Excel file.") from err
        return [list(r) for r in sheet.iter_rows(values_only=True, max_row=MAX_ROWS + 50)]
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    return list(csv.reader(io.StringIO(text), dialect))[: MAX_ROWS + 50]


def parse_statement(data: bytes, filename: str) -> ParsedStatement:
    rows = _rows(data, filename)
    header_at = cols = None
    for i, row in enumerate(rows[:40]):
        headers = [_norm(c) for c in row]
        d = _find(headers, _DATE)
        credit = _find(headers, _CREDIT)
        amount = _find(headers, _AMOUNT)
        if d is not None and (credit is not None or amount is not None):
            header_at = i
            cols = {
                "date": d, "credit": credit, "debit": _find(headers, _DEBIT),
                "amount": amount, "drcr": _find(headers, _DRCR, exact=True),
                "utr": _find(headers, _UTR), "narration": _find(headers, _NARRATION),
            }
            break
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
                    parse_date(raw_date)
                except ValueError:
                    continue
                out.rejected.append({"row": n, "reason": "No amount"})
            continue
        if amount < 0:
            out.skipped += 1
            continue
        try:
            when = parse_date(raw_date)
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
