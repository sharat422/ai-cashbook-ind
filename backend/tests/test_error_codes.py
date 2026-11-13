"""TE3: every error body is {code, detail, params}. A specific code carries the
values its sentence names, so the app can show the REASON in Telugu (from the
reviewed translation for that code) naming the same invoice number, amount or
item as the English — not just "check the details". Kind codes cover the rest.
(The app side — translation by code, English fallback + log for a code it has
no translation for — is src/api/client.test.ts.)"""

import json
import re
from pathlib import Path

from conftest import today_iso
from helpers import add_customer
from test_gst import KA, _gst_owner, _sale
from test_gst_drafts import _edit
from test_recon_rework import _pay
from test_statements import API

ROOT = Path(__file__).resolve().parents[2]
TE = json.loads((ROOT / "src/i18n/locales/te.json").read_text(encoding="utf-8"))
EN = json.loads((ROOT / "src/i18n/locales/en.json").read_text(encoding="utf-8"))


def _as_the_app_shows_it(body: dict, lang: dict) -> str:
    """client.ts apiErrorMessage for a specific code: the translation, values filled in."""
    text = lang[f"errors.code.{body['code']}"]
    for k, v in body["params"].items():
        text = text.replace("{" + k + "}", v)
    assert not re.search(r"\{\w+\}", text), text  # every value the sentence names was sent
    return text


def test_a_locked_invoice_in_telugu_names_the_invoice_number(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    inv = _sale(client, owner.headers, cid, "lock-1", customer_gstin=KA).json()
    r = _edit(client, owner.headers, cid, inv["id"], 5)
    body = r.json()
    assert r.status_code == 422 and body["code"] == "invoice_locked"
    assert body["params"] == {"number": inv["invoice_number"]}
    te, en = _as_the_app_shows_it(body, TE), _as_the_app_shows_it(body, EN)
    assert inv["invoice_number"] in te and inv["invoice_number"] in en  # the same invoice, both languages
    assert te != TE["errors.checkInput"]  # the reason, not just "check the details"


def test_a_duplicate_utr_names_the_earlier_payment_in_every_language(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers, full_name="రమేష్ కిరాణా")["id"]
    _pay(client, owner.headers, cid, 1500, "u1", "791234567890")
    r = client.post(f"{API}/customers/{cid}/ledger", headers=owner.headers, data={
        "type": "payment", "amount": "200", "date": today_iso(), "client_id": "u2",
        "payment_method": "upi", "reference_number": "791234567890"})
    body = r.json()
    assert r.status_code == 409 and body["code"] == "duplicate_utr"
    assert body["params"]["amount"] == "₹1,500.00" and body["params"]["customer"] == "రమేష్ కిరాణా"
    te = _as_the_app_shows_it(body, TE)
    assert "₹1,500.00" in te and "రమేష్ కిరాణా" in te


def test_short_stock_names_the_item_and_quantity(make_user, client):
    from test_schemes import _bill, _item
    owner = make_user()
    oil = _item(client, owner.headers, "Oil", price=100, opening=2)
    cid = add_customer(client, owner.headers)["id"]
    body = _bill(client, owner.headers, cid, [(oil, 3)]).json()
    assert body["code"] == "stock_short_godown"
    assert body["params"] == {"qty": "2.000", "unit": "pcs", "item": "Oil"}
    assert "Oil" in _as_the_app_shows_it(body, TE)


def test_every_specific_code_has_an_english_and_telugu_sentence_with_the_same_values():
    codes = {k.split(".", 2)[2] for k in EN if k.startswith("errors.code.")}
    raised = set(re.findall(r'AppError\(\s*[\w.]+,\s*"(\w+)"', "\n".join(
        p.read_text(encoding="utf-8") for p in (ROOT / "backend/app").rglob("*.py"))))
    raised |= {"stock_short_godown", "stock_short_van"}  # chosen by a condition in stock._short
    assert raised <= codes, raised - codes
    for code in codes:
        en, te = EN[f"errors.code.{code}"], TE.get(f"errors.code.{code}", "")
        assert te and set(re.findall(r"\{(\w+)\}", te)) == set(re.findall(r"\{(\w+)\}", en)), code


def test_no_error_response_lacks_a_code(make_user, client):
    owner = make_user()
    from test_stock import _team
    _, [(_, staff)] = _team(make_user, client, "staff")
    cases = [
        client.get(f"{API}/customers", headers={"Authorization": "Bearer junk"}),   # 401
        client.put(f"{API}/bill-series", headers=staff, json={"prefix": "X"}),      # 403
        client.get(f"{API}/bills/nope", headers=owner.headers),                       # 404
        client.post(f"{API}/customers", headers=owner.headers, json={"oops": 1}),    # 422 (validation)
        client.put(f"{API}/bill-series", headers=owner.headers, json={"prefix": "S-B"}),  # 422 (ours)
        client.post(f"{API}/statements/no-such-link/revoke", headers=owner.headers),  # 404
    ]
    seen = set()
    for r in cases:
        assert r.status_code >= 400, r.text
        body = r.json()
        assert isinstance(body.get("code"), str) and body["code"] and "detail" in body and "params" in body, body
        seen.add((r.status_code, body["code"]))
    assert {(401, "not_signed_in"), (403, "not_allowed"), (404, "not_found"), (422, "check_details")} <= seen
    # 500: an unexpected failure still answers with a code (the app's own handler, called directly).
    import asyncio
    from starlette.requests import Request
    from app.main import app
    crash = asyncio.run(app.exception_handlers[Exception](
        Request({"type": "http", "method": "GET", "path": "/x", "headers": []}), ZeroDivisionError()))
    assert crash.status_code == 500 and json.loads(crash.body)["code"] == "server_error"
    # And nothing in the server builds an error JSON by hand without error_body().
    for path in (ROOT / "backend/app").rglob("*.py"):
        src = path.read_text(encoding="utf-8")
        for m in re.finditer(r"JSONResponse\((.{0,300})", src, re.S):
            if re.search(r"status_code\s*=\s*(4\d\d|5\d\d)", m.group(1)):
                assert "error_body(" in m.group(1), (path.name, m.group(1)[:120])
