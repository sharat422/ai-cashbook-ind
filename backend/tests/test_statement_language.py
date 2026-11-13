"""ST5: the server statement (link page, PDF) and the printed ledger render in
the retailer's language from REVIEWED strings only; English where a string
has none (logged). Amounts keep Indian grouping, dates read "11 <month> 2026"
with the month in that language, names stay as typed."""

import html
import io
import json
import logging
from pathlib import Path

import pytest
from pypdf import PdfReader

from app import doc_i18n
from conftest import today_iso
from helpers import add_ledger
from test_statements import API, _shop, _token

ROOT = Path(__file__).resolve().parents[2]
MONTHS_TE = ["జన", "ఫిబ్ర", "మార్చి", "ఏప్రి", "మే", "జూన్", "జులై", "ఆగ", "సెప్టెం", "అక్టో", "నవం", "డిసెం"]
# What a native reviewer passed (test fixtures, not shipped translations).
REVIEWED_TE = {
    "doc.statementFor": "{name} ఖాతా వివరణ",
    "doc.currentBalance": "ప్రస్తుత బాకీ",
    "doc.openingBalance": "ప్రారంభ బాకీ",
    "doc.statementOfAccount": "ఖాతా వివరణ",
    "doc.customerLedger": "కస్టమర్ లెడ్జర్",
    **{f"doc.month.{i}": m for i, m in enumerate(MONTHS_TE, start=1)},
}


@pytest.fixture
def reviewed_te(tmp_path, monkeypatch):
    en = json.loads((doc_i18n.DIR / "en.json").read_text(encoding="utf-8"))
    (tmp_path / "en.json").write_text(json.dumps(en, ensure_ascii=False), encoding="utf-8")
    te = {k: {"en": en[k], "text": v} for k, v in REVIEWED_TE.items()}
    te["doc.salesInPeriod"] = {"en": "Sales this month", "text": "ఈ నెల అమ్మకాలు"}  # English changed since review
    (tmp_path / "te.json").write_text(json.dumps(te, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(doc_i18n, "DIR", tmp_path)
    monkeypatch.setattr(doc_i18n, "_logged", set())
    doc_i18n.english.cache_clear()
    doc_i18n.reviewed.cache_clear()
    yield
    doc_i18n.english.cache_clear()
    doc_i18n.reviewed.cache_clear()


def _pdf_text(pdf: bytes) -> str:
    return "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)


def _telugu_retailer(make_user, client):
    owner = make_user(business_name="Sri Lakshmi Agencies")
    cid = _shop(client, owner, "రమేష్ కిరాణా", [])
    add_ledger(client, owner.headers, cid, type="credit", amount=123456.7, date=today_iso(), client_id=f"big-{cid}")
    r = client.put(f"{API}/customers/{cid}/statement-language", headers=owner.headers, json={"language": "te"})
    assert r.status_code == 200 and r.json() == {"language": "te", "effective": "te"}
    link = client.post(f"{API}/customers/{cid}/statement-link", headers=owner.headers, json={}).json()["url"]
    return owner, cid, _token(link)


def test_a_telugu_retailers_statement_has_telugu_headings_and_right_amounts_and_dates(
        reviewed_te, make_user, client):
    owner, cid, token = _telugu_retailer(make_user, client)
    page = html.unescape(client.get(f"/s/{token}").text)
    assert "రమేష్ కిరాణా ఖాతా వివరణ" in page          # the heading, with the name as typed
    assert "ప్రస్తుత బాకీ" in page and "ప్రారంభ బాకీ" in page
    assert "₹1,23,456.70" in page                    # Indian grouping
    y, m, d = today_iso().split("-")
    assert f"{int(d)} {MONTHS_TE[int(m) - 1]} {y}" in page  # the month in Telugu
    assert "<html lang=te>" in page
    pdf = client.get(f"/s/{token}/statement.pdf")
    text = _pdf_text(pdf.content)
    assert "ఖాతా వివరణ · రమేష్ కిరాణా" in text and "₹1,23,456.70" in text
    assert f"{int(d)} {MONTHS_TE[int(m) - 1]} {y}" in text
    # (Text extraction can't map every joined Telugu letter, e.g. ప్రా; how they look is a manual check.)
    # The English line after a Telugu one keeps its letters (an fpdf fallback-font bug, fixed in _Pdf).
    assert "Page 1 of 1" in text
    # The printed ledger comes out in the same language.
    share = client.post(f"{API}/customers/{cid}/pdf-share", headers=owner.headers,
                        json={"document": "ledger", "channel": "save"}).json()
    ledger = client.get(f"{API}{share['pdfUrl']}", headers=owner.headers)
    assert ledger.status_code == 200 and "కస్టమర్ లెడ్జర్ · రమేష్ కిరాణా" in _pdf_text(ledger.content)


def test_a_string_without_a_reviewed_translation_falls_back_to_english_and_is_logged(
        reviewed_te, make_user, client, caplog):
    owner, cid, token = _telugu_retailer(make_user, client)
    with caplog.at_level(logging.WARNING, logger="cashbook.i18n"):
        page = html.unescape(client.get(f"/s/{token}").text)
        client.get(f"/s/{token}")  # logged once, not on every view
    assert "Download PDF" in page                    # doc.downloadPdf: never reviewed
    assert "Sales in period" in page                 # reviewed against older English: not used
    assert "ఈ నెల అమ్మకాలు" not in page
    logs = [r.getMessage() for r in caplog.records]
    assert "doc i18n: no reviewed te translation for doc.downloadPdf; using English" in logs
    assert any("doc.salesInPeriod (the English changed since review)" in x for x in logs)
    assert sum("doc.downloadPdf" in x for x in logs) == 1


def test_the_language_comes_from_the_retailer_else_the_business_default(make_user, client):
    owner = make_user()
    cid = _shop(client, owner, "Ravi Stores", [("credit", 500, 2)])
    consent = client.get(f"{API}/customers/{cid}/statement-consent", headers=owner.headers).json()
    assert (consent["language"], consent["defaultLanguage"]) == (None, "te")  # Telugu first
    assert client.put(f"{API}/statement-language", headers=owner.headers, json={"language": "hi"}).json() == \
        {"language": "hi"}
    r = client.put(f"{API}/customers/{cid}/statement-language", headers=owner.headers, json={"language": None})
    assert r.json() == {"language": None, "effective": "hi"}
    assert client.put(f"{API}/customers/{cid}/statement-language", headers=owner.headers,
                      json={"language": "xx"}).status_code == 422


def test_server_strings_match_the_apps_and_only_reviewed_ones_ship():
    app_en = json.loads((ROOT / "src/i18n/locales/en.json").read_text(encoding="utf-8"))
    server_en = doc_i18n.english()
    assert server_en == {k: v for k, v in app_en.items() if k.startswith("doc.")}
    for path in doc_i18n.DIR.glob("*.json"):
        if path.stem != "en":
            for key, entry in json.loads(path.read_text(encoding="utf-8")).items():
                assert key in server_en and set(entry) == {"en", "text"}, (path.name, key)
