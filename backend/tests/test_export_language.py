"""TE5: the owner's own files (the balances PDF and the Excel workbook) come
out in the owner's language, which the app sends as `?lang=`. They use REVIEWED
strings only; English where a string has none, and that is logged. Amounts keep
Indian grouping, dates read "13 <month> 2026" in IST, names stay as typed."""

import io
import json
import logging

import pytest
from openpyxl import load_workbook

from app import doc_i18n
from conftest import today_iso
from helpers import add_customer, add_ledger
from test_statement_language import MONTHS_TE, _pdf_text

API = "/api/v1"
# What a native reviewer passed (test fixtures, not shipped translations).
REVIEWED_TE = {
    "doc.balancesAsOn": "{date} నాటికి కస్టమర్ బాకీలు",
    "doc.col.customer": "కస్టమర్",
    "doc.col.mobile": "మొబైల్",
    "doc.col.balance": "బాకీ",
    "doc.balancesTotal": "మొత్తం ({count} కస్టమర్లు)",
    "doc.sheet.customers": "కస్టమర్లు",
    "doc.sheet.ledger": "లెడ్జర్",
    "doc.col.name": "పేరు",
    "doc.col.outstanding": "బాకీ మొత్తం",
    "doc.col.date": "తేదీ",
    "doc.col.type": "రకం",
    "doc.col.amount": "మొత్తం",
    "doc.saleCredit": "అమ్మకం (అప్పు)",
    "doc.payment": "చెల్లింపు",
    **{f"doc.month.{i}": m for i, m in enumerate(MONTHS_TE, start=1)},
}


@pytest.fixture
def reviewed_te(tmp_path, monkeypatch):
    en = json.loads((doc_i18n.DIR / "en.json").read_text(encoding="utf-8"))
    (tmp_path / "en.json").write_text(json.dumps(en, ensure_ascii=False), encoding="utf-8")
    te = {k: {"en": en[k], "text": v} for k, v in REVIEWED_TE.items()}
    (tmp_path / "te.json").write_text(json.dumps(te, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(doc_i18n, "DIR", tmp_path)
    monkeypatch.setattr(doc_i18n, "_logged", set())
    doc_i18n.english.cache_clear()
    doc_i18n.reviewed.cache_clear()
    yield
    doc_i18n.english.cache_clear()
    doc_i18n.reviewed.cache_clear()


def _owner_with_a_big_balance(make_user, client):
    owner = make_user(business_name="Sri Lakshmi Agencies")
    cid = add_customer(client, owner.headers, full_name="రమేష్ కిరాణా")["id"]
    add_ledger(client, owner.headers, cid, type="credit", amount=123456.7, date=today_iso(), client_id=f"te5-{cid}")
    return owner


def _today_te() -> str:
    y, m, d = today_iso().split("-")
    return f"{int(d)} {MONTHS_TE[int(m) - 1]} {y}"


def test_a_telugu_owners_balances_pdf_has_telugu_headings_and_right_amounts_and_dates(
        reviewed_te, make_user, client):
    owner = _owner_with_a_big_balance(make_user, client)
    r = client.get(f"{API}/account/balances.pdf?lang=te", headers=owner.headers)
    assert r.status_code == 200, r.text
    text = _pdf_text(r.content)
    assert f"{_today_te()} నాటికి కస్టమర్ బాకీలు" in text   # the heading, the month in Telugu (IST day)
    assert "కస్టమర్" in text and "మొబైల్" in text and "బాకీ" in text
    # (Text extraction turns the joined letters of "ర్లు" into a control code before ")"; how they look is
    # a manual check, as in ST5.)
    assert "మొత్తం (1 కస్టమర్లు" in text
    assert "రమేష్ కిరాణా" in text and "₹1,23,456.70" in text  # name as typed, Indian grouping
    assert "Customer balances" not in text


def test_a_telugu_owners_excel_has_telugu_column_headings(reviewed_te, make_user, client):
    owner = _owner_with_a_big_balance(make_user, client)
    r = client.get(f"{API}/account/export.xlsx?lang=te", headers=owner.headers)
    assert r.status_code == 200, r.text
    wb = load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames[:2] == ["కస్టమర్లు", "లెడ్జర్"]
    customers = [list(x) for x in wb["కస్టమర్లు"].iter_rows(values_only=True)]
    assert customers[0][0] == "పేరు" and customers[0][4] == "బాకీ మొత్తం"
    assert customers[1][0] == "రమేష్ కిరాణా" and float(customers[1][4]) == 123456.7
    ledger = [list(x) for x in wb["లెడ్జర్"].iter_rows(values_only=True)]
    assert ledger[0][:4] == ["తేదీ", "కస్టమర్", "రకం", "మొత్తం"]
    assert ledger[1][2] == "అమ్మకం (అప్పు)"
    # Not reviewed yet: English, as before.
    assert "Expenses" in wb.sheetnames and wb["Expenses"]["C1"].value == "Paid to"


def test_a_string_with_no_reviewed_translation_falls_back_to_english_and_is_logged(
        reviewed_te, make_user, client, caplog):
    owner = _owner_with_a_big_balance(make_user, client)
    with caplog.at_level(logging.WARNING, logger="cashbook.i18n"):
        text = _pdf_text(client.get(f"{API}/account/balances.pdf?lang=te", headers=owner.headers).content)
        client.get(f"{API}/account/balances.pdf?lang=te", headers=owner.headers)
    assert f"Exported from Bolcash on {_today_te()}" in text  # doc.balancesFooter: never reviewed
    logs = [x.getMessage() for x in caplog.records]
    assert "doc i18n: no reviewed te translation for doc.balancesFooter; using English" in logs
    assert sum("doc.balancesFooter" in x for x in logs) == 1   # once, not on every download


def test_an_older_app_or_an_unknown_language_gets_english(reviewed_te, make_user, client):
    owner = _owner_with_a_big_balance(make_user, client)
    for q in ("", "?lang=xx"):
        text = _pdf_text(client.get(f"{API}/account/balances.pdf{q}", headers=owner.headers).content)
        assert "Customer balances as on" in text and "Total (1 customers)" in text
        wb = load_workbook(io.BytesIO(client.get(f"{API}/account/export.xlsx{q}", headers=owner.headers).content))
        assert wb.sheetnames[:2] == ["Customers", "Ledger"]
