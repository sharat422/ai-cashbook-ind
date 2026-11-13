"""scripts/i18n_review_sheets.py: OK keeps a translation, corrections apply,
`unreviewed` lists unreviewed keys and keys added since the file was built."""

import importlib.util
import json
from pathlib import Path

from openpyxl import load_workbook

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "i18n_review_sheets.py"
spec = importlib.util.spec_from_file_location("review_sheets", SCRIPT)
sheets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sheets)


def test_ok_keeps_corrections_apply_and_check_lists_what_is_left(tmp_path, monkeypatch, capsys):
    locales = tmp_path / "locales"
    locales.mkdir()
    en = {"recon.matched": "Matched", "close.short": "Short by", "deposit.title": "Cash deposit"}
    te = {"recon.matched": "సరిపోలింది", "close.short": "తప్పు", "deposit.title": "నగదు జమ"}
    (locales / "en.json").write_text(json.dumps(en), encoding="utf-8")
    (locales / "te.json").write_text(json.dumps(te, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(sheets, "LOCALES", locales)
    monkeypatch.setattr(sheets, "SERVER_DOCS", tmp_path / "server")

    sheets.build(tmp_path / "review")
    file = tmp_path / "review" / "te.xlsx"
    wb = load_workbook(file)
    ws = wb["1 Reconciliation & payments"]
    rows = {ws.cell(r, 1).value: r for r in range(2, ws.max_row + 1)}
    assert set(rows) == set(en)  # deposit.* is on sheet 1
    ws.cell(rows["recon.matched"], 4).value = "ok"            # OK in Correction
    ws.cell(rows["close.short"], 4).value = "తక్కువ"            # a real correction
    wb.save(file)

    assert sheets.unreviewed(str(file)) == 1
    out = capsys.readouterr().out
    assert "not reviewed: deposit.title" in out          # empty Correction and Notes
    assert "recon.matched" not in out and "close.short" not in out  # OK, and corrected

    ws.cell(rows["deposit.title"], 5).value = "OK"            # OK in Notes
    wb.save(file)
    sheets.apply(file)
    out = json.loads((locales / "te.json").read_text(encoding="utf-8"))
    assert out == {"recon.matched": "సరిపోలింది", "close.short": "తక్కువ", "deposit.title": "నగదు జమ"}

    en["recon.unmatched"] = "Not matched"  # a key added after the file was built
    (locales / "en.json").write_text(json.dumps(en), encoding="utf-8")
    capsys.readouterr()
    assert sheets.unreviewed(str(file)) == 1
    assert "not in file:  recon.unmatched" in capsys.readouterr().out
    del en["recon.unmatched"]
    (locales / "en.json").write_text(json.dumps(en), encoding="utf-8")
    assert sheets.unreviewed(str(file)) == 0


def test_apply_hands_the_server_only_reviewed_document_strings(tmp_path, monkeypatch):
    """ST5: the server renders retailer statements only from reviewed lines."""
    locales, server = tmp_path / "locales", tmp_path / "server"
    locales.mkdir()
    server.mkdir()
    en = {"doc.openingBalance": "Opening balance", "doc.currentBalance": "Current balance", "doc.pageTotal": "Page total"}
    te = {"doc.openingBalance": "ఓపెనింగ్", "doc.currentBalance": "ప్రస్తుత బాకీ", "doc.pageTotal": "పేజీ మొత్తం"}
    (locales / "en.json").write_text(json.dumps(en), encoding="utf-8")
    (locales / "te.json").write_text(json.dumps(te, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(sheets, "LOCALES", locales)
    monkeypatch.setattr(sheets, "SERVER_DOCS", server)
    sheets.build(tmp_path / "review")
    file = tmp_path / "review" / "te.xlsx"
    wb = load_workbook(file)
    ws = wb["6 Statements & documents"]
    rows = {ws.cell(r, 1).value: r for r in range(2, ws.max_row + 1)}
    ws.cell(rows["doc.openingBalance"], 4).value = "ప్రారంభ బాకీ"   # corrected
    ws.cell(rows["doc.currentBalance"], 4).value = "OK"              # passed as is
    wb.save(file)                                                     # doc.pageTotal: not reviewed
    sheets.apply(file)
    out = json.loads((server / "te.json").read_text(encoding="utf-8"))
    assert out == {"doc.currentBalance": {"en": "Current balance", "text": "ప్రస్తుత బాకీ"},
                   "doc.openingBalance": {"en": "Opening balance", "text": "ప్రారంభ బాకీ"}}


def test_apply_hands_the_phone_only_reviewed_hinglish_collection_messages(tmp_path, monkeypatch):
    """TE6: Hinglish collection messages go out only once reviewed."""
    locales, phone = tmp_path / "locales", tmp_path / "reviewed"
    locales.mkdir()
    phone.mkdir()
    en = {"collect.tpl.friendly": "Hi {name}!", "collect.tpl.urgent": "Pay now, {name}."}
    hinglish = {"collect.tpl.friendly": "Hi {name} ji!", "collect.tpl.urgent": "Abhi pay karo, {name}."}
    (locales / "en.json").write_text(json.dumps(en), encoding="utf-8")
    (locales / "hinglish.json").write_text(json.dumps(hinglish), encoding="utf-8")
    monkeypatch.setattr(sheets, "LOCALES", locales)
    monkeypatch.setattr(sheets, "SERVER_DOCS", tmp_path / "server")
    monkeypatch.setattr(sheets, "APP_REVIEWED", phone)
    sheets.build(tmp_path / "review")
    file = tmp_path / "review" / "hinglish.xlsx"
    wb = load_workbook(file)
    ws = wb["7 Messages retailers receive"]
    rows = {ws.cell(r, 1).value: r for r in range(2, ws.max_row + 1)}
    ws.cell(rows["collect.tpl.friendly"], 4).value = "Namaste {name} ji!"   # corrected; urgent: not reviewed
    wb.save(file)
    sheets.apply(file)
    assert json.loads((phone / "hinglish.json").read_text(encoding="utf-8")) == {
        "collect.tpl.friendly": {"en": "Hi {name}!", "text": "Namaste {name} ji!"}}
