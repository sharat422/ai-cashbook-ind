"""SC6: the bill PDF and its WhatsApp share, through the statement's consent
check and log (§6). The PDF is only handed out by the consent-checked share,
so a plain download can't be passed on to WhatsApp unchecked (ST3)."""

import io

from pypdf import PdfReader
from sqlalchemy import select

from app.database import SessionLocal
from app.models import StatementEvent
from helpers import add_customer
from test_schemes import API, _bill, _item, _scheme


def _text(pdf: bytes) -> str:
    return "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)


def _consent(client, headers, cid, status):
    r = client.post(f"{API}/customers/{cid}/statement-consent", headers=headers,
                    json={"status": status, "confirm": status == "opted_in"})
    assert r.status_code == 200, r.text


def _events(cid):
    with SessionLocal() as db:
        return [(e.kind, e.channel, e.note) for e in db.scalars(
            select(StatementEvent).where(StatementEvent.customer_id == cid).order_by(StatementEvent.created_at))]


def _setup(make_user, client):
    owner = make_user()
    soap = _item(client, owner.headers, "Soap", price=25)
    _scheme(client, owner.headers, "Soap 10+1", [soap], buyQty=10, freeQty=1)
    cid = add_customer(client, owner.headers, full_name="Ravi Stores", mobile="9876543210")["id"]
    client.post(f"{API}/customers/{cid}/ledger", headers=owner.headers, data={
        "type": "credit", "amount": "100", "date": "2026-01-02", "client_id": "older"})  # owed before
    bill = _bill(client, owner.headers, cid, [(soap, 20)]).json()
    return owner, cid, bill


def test_the_bill_pdf_has_lines_schemes_total_and_balance_after(make_user, client):
    owner, cid, bill = _setup(make_user, client)
    _consent(client, owner.headers, cid, "opted_in")
    share = client.post(f"{API}/bills/{bill['id']}/share", headers=owner.headers, json={"channel": "whatsapp"})
    assert share.status_code == 200, share.text
    r = client.get(f"{API}{share.json()['pdfUrl']}", headers=owner.headers)
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    text = _text(r.content)
    for part in (f"Bill {bill['billNumber']}", "Ravi Stores", "Soap", "20 pcs", "₹500.00",  # the line
                 "Soap 10+1", "2 Soap free",                                               # the scheme line
                 "Total", "Balance after this bill", "₹600.00"):                           # 100 + 500
        assert part in text, (part, text)


def test_an_opted_out_retailer_is_refused_and_logged_and_opted_in_is_a_send(make_user, client):
    owner, cid, bill = _setup(make_user, client)
    _consent(client, owner.headers, cid, "opted_out")
    r = client.post(f"{API}/bills/{bill['id']}/share", headers=owner.headers, json={"channel": "whatsapp"})
    assert r.status_code == 409
    assert ("blocked", "pdf_whatsapp", f"Bill {bill['billNumber']}: No consent — ask the retailer to opt in.") in _events(cid)
    _consent(client, owner.headers, cid, "opted_in")
    r = client.post(f"{API}/bills/{bill['id']}/share", headers=owner.headers, json={"channel": "whatsapp"})
    assert r.status_code == 200 and r.json()["mobile"].endswith("9876543210")
    assert ("shared", "pdf_whatsapp", f"Bill {bill['billNumber']}") in _events(cid)


def test_the_plain_pdf_cannot_skip_the_consent_check(make_user, client):
    owner, cid, bill = _setup(make_user, client)
    plain = client.get(f"{API}/bills/{bill['id']}.pdf", headers=owner.headers)
    assert plain.status_code == 403
    forged = client.get(f"{API}/bills/{bill['id']}.pdf", headers=owner.headers, params={"share": "9999999999.abc"})
    assert forged.status_code == 403
    assert sum(1 for k, ch, _ in _events(cid) if k == "blocked" and ch == "bill_pdf") == 2
    # A link issued for one bill doesn't open another.
    _consent(client, owner.headers, cid, "opted_in")
    url = client.post(f"{API}/bills/{bill['id']}/share", headers=owner.headers, json={"channel": "whatsapp"}).json()["pdfUrl"]
    other = _bill(client, owner.headers, cid, [(_item(client, owner.headers, "Oil", price=10), 1)]).json()
    assert client.get(f"{API}{url.replace(bill['id'], other['id'])}", headers=owner.headers).status_code == 403
