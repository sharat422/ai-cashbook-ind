"""Native-speaker review of machine translations, one Excel file per language.

  python scripts/i18n_review_sheets.py build [out_dir]   # review/<lang>.xlsx
  python scripts/i18n_review_sheets.py apply <file.xlsx>   # copy corrections into the locale
  python scripts/i18n_review_sheets.py unreviewed <lang>   # keys not reviewed yet (review/<lang>.xlsx)

Each file has one sheet per area, in review order (reconciliation and payments
first, then GST, stock, beats): key, English, current translation, and an empty
"Correction" column for the reviewer. A reviewer who finds a line right writes
OK in Correction (or in Notes); `apply` keeps that translation and writes every
other filled-in correction into src/i18n/locales/<lang>.json. `unreviewed` lists, per
sheet, keys with neither a correction nor OK, and keys added to en.json since
the file was built (rebuild and carry the work over); it exits 1 if any. A
language is done when the list is empty. The translation tool only re-translates a key
when its English changes, so applied corrections stay.

Run with the backend's Python (it has openpyxl):  backend/.venv/Scripts/python.exe
"""
import json
import sys
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill

ROOT = Path(__file__).resolve().parents[1]
LOCALES = ROOT / "src/i18n/locales"
AREAS = [  # sheet name, key prefixes — in the order reviewers should go
    ("1 Reconciliation & payments", ("recon.", "close.", "payments.", "bankImport.", "bankMatch.", "pay.", "deposit.")),
    ("2 GST", ("gst.",)),
    ("3 Stock", ("stock.",)),
    ("4 Beats & visits", ("beats.", "visits.")),
]
HEAD = ["Key", "English", "Current translation", "Correction (leave empty if right)", "Notes"]


def _load(lang: str) -> dict:
    return json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))


def build(out_dir: Path) -> None:
    en = _load("en")
    out_dir.mkdir(parents=True, exist_ok=True)
    for path in sorted(LOCALES.glob("*.json")):
        lang = path.stem
        if lang == "en" or lang.startswith("."):
            continue
        loc = _load(lang)
        wb = Workbook()
        wb.remove(wb.active)
        for title, prefixes in AREAS:
            ws = wb.create_sheet(title)
            ws.append(HEAD)
            for c in ws[1]:
                c.font = Font(bold=True)
                c.fill = PatternFill("solid", fgColor="FFF2CC")
            for key in en:
                if key.startswith(prefixes):
                    ws.append([key, en[key], loc.get(key, ""), "", ""])
            for col, width in zip("ABCDE", (34, 60, 60, 60, 30)):
                ws.column_dimensions[col].width = width
            for row in ws.iter_rows(min_row=2):
                for c in row:
                    c.alignment = Alignment(wrap_text=True, vertical="top")
            ws.freeze_panes = "B2"
        target = out_dir / f"{lang}.xlsx"
        wb.save(target)
        print(target)


def _text(value) -> str:
    return str(value).strip() if value is not None else ""


def _ok(text: str) -> bool:
    return text.upper() == "OK"


def _rows(ws):
    """(key, correction, notes) for each row of a sheet."""
    for row in ws.iter_rows(min_row=2, values_only=True):
        key, _en, _cur, fix, notes = (list(row) + [None] * 5)[:5]
        if key:
            yield key, _text(fix), _text(notes)


def apply(file: Path) -> None:
    lang = file.stem
    loc_path = LOCALES / f"{lang}.json"
    loc = _load(lang)
    en = _load("en")
    changed = kept = 0
    for ws in load_workbook(file).worksheets:
        for key, fix, notes in _rows(ws):
            if key not in en:
                continue
            if _ok(fix) or (not fix and _ok(notes)):
                kept += 1  # reviewed and right as it is
            elif fix:
                loc[key] = fix
                changed += 1
    loc_path.write_text(json.dumps(loc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{lang}: {changed} corrections applied, {kept} marked OK")


def unreviewed(lang: str) -> int:
    """Print what's left to review in review/<lang>.xlsx (or a path to a
    filled-in file); 1 if anything is."""
    file = Path(lang) if lang.endswith(".xlsx") else ROOT / "review" / f"{lang}.xlsx"
    en = _load("en")
    wb = load_workbook(file)
    left = 0
    for title, prefixes in AREAS:
        rows = list(_rows(wb[title])) if title in wb.sheetnames else []
        in_file = {k for k, _fix, _notes in rows}
        open_keys = [k for k, fix, notes in rows if k in en and not fix and not _ok(notes)]
        new_keys = [k for k in en if k.startswith(prefixes) and k not in in_file]
        left += len(open_keys) + len(new_keys)
        print(f"{title}: {len(rows) - len(open_keys)}/{len(rows)} reviewed"
              + (f", {len(new_keys)} new since the file was built" if new_keys else ""))
        for k in open_keys:
            print(f"  not reviewed: {k}")
        for k in new_keys:
            print(f"  not in file:  {k}")
    return 1 if left else 0


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "build":
        build(Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "review")
    elif len(sys.argv) == 3 and sys.argv[1] == "apply":
        apply(Path(sys.argv[2]))
    elif len(sys.argv) == 3 and sys.argv[1] == "unreviewed":
        sys.exit(unreviewed(sys.argv[2]))
    else:
        print(__doc__)
