"""SC6: a bill PDF from the statement PDF builder, shared on WhatsApp only
through the statement consent gate and logged the same way."""

import io
import re
from decimal import Decimal

from pypdf import PdfReader

from conftest import days_ago_iso, today_iso
from helpers import add_customer, add_ledger
from app.database import SessionLocal
from app.main import app
from app.models import StatementEvent

API = "/api/v1"
D = Decimal


def _text(pdf: bytes) -> str:
    return "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)


def _money(s: str) -> D:
    return D(s.replace("₹", "").replace(",", "").replace("−", "-"))


def _item(client, headers, name, price):
    r = client.post(f"{API}/items", headers=headers, json={
        "name": name, "unit": "pcs", "sale_price": price, "track_stock": True, "stock_qty": 1000})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _scheme(client, headers, name, items, kind="buy_get", priority=1, **cfg):
    r = client.post(f"{API}/schemes", headers=headers, json={
        "name": name, "type": kind, "itemIds": items, "priority": priority,
        "validFrom": days_ago_iso(30), "validTo": today_iso(), **cfg})
    assert r.status_code == 200, r.text


def _bill(client, headers, cid, lines, day=None):
    r = client.post(f"{API}/bills", headers=headers, json={
        "customerId": cid, "date": day or today_iso(), "location": "godown",
        "lines": [{"itemId": i, "quantity": q} for i, q in lines]})
    assert r.status_code == 200, r.text
    return r.json()


def _consent(client, owner, cid, status):
    r = client.post(f"{API}/customers/{cid}/statement-consent", headers=owner.headers,
                    json={"status": status, "confirm": True})
    assert r.status_code == 200, r.text


def _events(cid):
    with SessionLocal() as db:
        return [(e.kind, e.channel, e.note) for e in db.query(StatementEvent)
                .filter_by(customer_id=cid).order_by(StatementEvent.created_at, StatementEvent.id)]


# --- 1. The PDF has the lines, scheme lines, total and balance after the bill ----------

def test_bill_pdf_has_lines_scheme_lines_total_and_balance_after(make_user, client):
    owner = make_user(business_name="Sri Balaji Distributors")
    soap = _item(client, owner.headers, "Soap", 25)
    oil = _item(client, owner.headers, "Oil", 150)
    _scheme(client, owner.headers, "Soap 10+1", [soap], buyQty=10, freeQty=1)
    _scheme(client, owner.headers, "Oil 5% off", [oil], kind="percent", percent=5, priority=2)
    cid = add_customer(client, owner.headers, full_name="रमेश ट्रेडर्स")["id"]
    # Earlier dues: ₹1,000 credit, ₹300 paid -> ₹700 before the bill.
    add_ledger(client, owner.headers, cid, type="credit", amount=1000, date=days_ago_iso(10),
               client_id="old-1")
    add_ledger(client, owner.headers, cid, type="payment", amount=300, date=days_ago_iso(5),
               client_id="old-2", payment_method="cash")
    bill = _bill(client, owner.headers, cid, [(soap, 20), (oil, 4)], day=days_ago_iso(2))
    assert (bill["subtotal"], bill["discount"], bill["total"]) == ("1100.00", "30.00", "1070.00")
    # A payment after the bill must not change what this bill says.
    add_ledger(client, owner.headers, cid, type="payment", amount=500, date=today_iso(),
               client_id="later", payment_method="upi")
    _consent(client, owner, cid, "opted_in")

    r = client.get(f"{API}/bills/{bill['id']}.pdf", headers=owner.headers)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
    text = _text(r.content)
    y, m, d = days_ago_iso(2).split("-")
    for expected in ("Sri Balaji Distributors", "रमेश ट्रेडर्स", f"Bill {bill['billNumber']}",
                     f"{d}-{m}-{y}", "Soap", "20 pcs", "₹500.00", "Oil", "4 pcs", "₹600.00",
                     "Soap 10+1", "2 Soap free", "Oil 5% off", "−₹30.00"):
        assert expected in text, expected
    assert _money(re.search(r"Bill total\s*(\S+)", text).group(1)) == D("1070.00")
    assert _money(re.search(r"Balance after this bill\s*(\S+)", text).group(1)) == D("1770.00")
    # The owner's private ledger notes never reach the retailer.
    assert "item(s)" not in text


# --- 2. Opted-out is refused and logged; opted-in is logged as a send -----------------

def test_share_needs_opt_in_and_every_attempt_is_logged(make_user, client):
    owner = make_user()
    soap = _item(client, owner.headers, "Soap", 25)
    cid = add_customer(client, owner.headers, full_name="Ganesh Traders")["id"]
    bill = _bill(client, owner.headers, cid, [(soap, 4)])
    url = f"{API}/bills/{bill['id']}.pdf"

    # Trading together is not consent: no row means no.
    r = client.get(url, headers=owner.headers)
    assert r.status_code == 409 and not r.content.startswith(b"%PDF")
    assert "Ganesh Traders" in r.json()["detail"]

    _consent(client, owner, cid, "opted_in")
    r = client.get(url, headers=owner.headers)
    assert r.status_code == 200 and r.content.startswith(b"%PDF")

    _consent(client, owner, cid, "opted_out")
    r = client.get(url, headers=owner.headers)
    assert r.status_code == 409 and not r.content.startswith(b"%PDF")

    note = f"Bill {bill['billNumber']}"
    shares = [e for e in _events(cid) if e[0] in ("sent", "blocked")]
    assert [(k, ch) for k, ch, _ in shares] == [
        ("blocked", "whatsapp_phone"), ("sent", "whatsapp_phone"), ("blocked", "whatsapp_phone")]
    assert all(n.startswith(note) for _, _, n in shares)
    # The owner sees bill shares in the same history as statements.
    history = client.get(f"{API}/customers/{cid}/statement-consent", headers=owner.headers).json()
    assert history["status"] == "opted_out" and history["history"][0]["kind"] == "blocked"

    # Another business can't fetch this bill, consent or not.
    other = make_user()
    assert client.get(url, headers=other.headers).status_code == 404


# --- 3. The plain share sheet can't bypass the check (ST3) ---------------------------

def test_plain_share_sheet_cannot_bypass_consent(make_user, client):
    owner = make_user()
    soap = _item(client, owner.headers, "Soap", 25)
    cid = add_customer(client, owner.headers, full_name="Annapurna Stores")["id"]
    bill = _bill(client, owner.headers, cid, [(soap, 4)])

    # The only bill PDF route is the consent-gated one; no other path renders a bill.
    pdf_routes = [r.path for r in app.routes
                  if "bill" in getattr(r, "path", "") and "pdf" in getattr(r, "path", "")]
    assert pdf_routes == [f"{API}/bills/{{bill_id}}.pdf"]

    # Whatever the app claims it will do with the file (plain share sheet, print,
    # download), without opt-in there is no PDF — and each try is logged.
    for params in ({}, {"via": "share_sheet"}, {"via": "print"}, {"download": "1"}):
        r = client.get(f"{API}/bills/{bill['id']}.pdf", headers=owner.headers, params=params)
        assert r.status_code == 409 and b"%PDF" not in r.content, params
    assert client.get(f"{API}/bills/{bill['id']}.pdf",
                      headers={**owner.headers, "Accept": "application/pdf"}).status_code == 409
    # The bill's JSON carries no file or link a share sheet could pass on.
    body = client.get(f"{API}/bills/{bill['id']}", headers=owner.headers).text
    assert "%PDF" not in body and ".pdf" not in body
    assert [k for k, *_ in _events(cid)].count("blocked") == 5
    assert "sent" not in [k for k, *_ in _events(cid)]
