"""Retailer statements: browser link + PDF without the app, scoped links,
opt-in WhatsApp with opt-out, and a printable ledger whose totals match."""

import html
import io
import re
from decimal import Decimal

from pypdf import PdfReader

from conftest import days_ago_iso, today_iso
from helpers import add_customer, add_ledger
from app import statements as svc
from app.database import SessionLocal
from app.models import StatementEvent, StatementLink

API = "/api/v1"
D = Decimal


def _text(pdf: bytes) -> str:
    return "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)


def _token(url: str) -> str:
    return url.rsplit("/s/", 1)[1]


def _shop(client, owner, name, entries):
    cid = add_customer(client, owner.headers, full_name=name)["id"]
    for i, (kind, amount, ago) in enumerate(entries):
        extra = {"payment_method": "cash"} if kind == "payment" else {"invoice_number": f"INV-{i}"}
        add_ledger(client, owner.headers, cid, type=kind, amount=amount, date=days_ago_iso(ago),
                   client_id=f"{name}-{i}", **extra)
    return cid


def _link(client, owner, cid, **body):
    r = client.post(f"{API}/customers/{cid}/statement-link", headers=owner.headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()["url"]


# --- 1. Opens in a browser, no app, no login ------------------------------------------

def test_retailer_opens_statement_and_pdf_without_the_app(make_user, client):
    owner = make_user(business_name="Sri Balaji Distributors")
    cid = _shop(client, owner, "रमेश ट्रेडर्स", [("credit", 1000, 100), ("credit", 2500.5, 40),
                                                ("payment", 800, 10), ("credit", 300, 0)])
    token = _token(_link(client, owner, cid))

    page = client.get(f"/s/{token}")  # no Authorization header: a plain browser
    assert page.status_code == 200 and page.headers["content-type"].startswith("text/html")
    assert "रमेश ट्रेडर्स" in page.text and "Sri Balaji Distributors" in page.text
    assert "₹3,000.50" in page.text  # current balance
    assert page.headers["cache-control"] == "no-store"
    assert page.headers["referrer-policy"] == "no-referrer"
    assert "Notes" not in page.text  # the owner's private notes never show

    pdf = client.get(f"/s/{token}/statement.pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")
    text = _text(pdf.content)
    for expected in ("Sri Balaji Distributors", "रमेश ट्रेडर्स", "Opening balance", "Current balance",
                     "₹3,000.50", "Over 90 days", "Not yet due", "INV-1"):
        assert expected in text, expected
    # Ageing: ₹200 of the oldest bill is unpaid (>90 days), the 40-day bill in 31–60.
    assert D(str(sum(svc.ageing([]).values()))) == 0
    with SessionLocal() as db:
        events = db.query(StatementEvent).filter_by(customer_id=cid).all()
        assert sorted(e.kind for e in events) == ["link_created", "viewed"]  # first view logged once


# --- 2. A link shows only its own retailer --------------------------------------------

def test_a_link_for_retailer_a_never_shows_retailer_b(make_user, client):
    owner = make_user()
    a = _shop(client, owner, "Annapurna Stores", [("credit", 1111, 3)])
    b = _shop(client, owner, "Bharat Kirana", [("credit", 2222, 3)])
    token_a, token_b = _token(_link(client, owner, a)), _token(_link(client, owner, b))

    for path in (f"/s/{token_a}", f"/s/{token_a}?customer_id={b}", f"/s/{token_a}?customerId={b}"):
        text = client.get(path).text
        assert "Annapurna Stores" in text and "Bharat Kirana" not in text and "2,222" not in text
    pdf = _text(client.get(f"/s/{token_a}/statement.pdf", params={"customer": b}).content)
    assert "Annapurna Stores" in pdf and "Bharat Kirana" not in pdf
    assert "Bharat Kirana" in client.get(f"/s/{token_b}").text

    # A changed, guessed or another business's token gets nothing.
    other = make_user()
    c = _shop(client, other, "Chennai Mart", [("credit", 3333, 1)])
    token_c = _token(_link(client, other, c))
    assert "Annapurna" not in client.get(f"/s/{token_c}").text
    for bad in (token_a[:-1] + ("A" if token_a[-1] != "A" else "B"), "x" * 32, b):
        r = client.get(f"/s/{bad}")
        assert r.status_code == 404 and "Annapurna" not in r.text
    # An owner can't make a link to another business's retailer.
    assert client.post(f"{API}/customers/{c}/statement-link", headers=owner.headers, json={}).status_code == 404
    # Only a hash is stored; expired links stop working.
    with SessionLocal() as db:
        link = db.query(StatementLink).filter_by(customer_id=a).one()
        assert token_a not in link.token_hash and len(link.token_hash) == 64
        link.expires_at = "2000-01-01T00:00:00+00:00"
        db.commit()
    assert client.get(f"/s/{token_a}").status_code == 410


# --- 3. Opt-in only; after opt-out, nothing more is sent ------------------------------

def test_whatsapp_needs_opt_in_and_stops_after_opt_out(make_user, client, monkeypatch):
    sent = []
    monkeypatch.setattr("app.routers.statements.send_whatsapp_text", lambda to, msg: sent.append((to, msg)))
    owner = make_user()
    cid = _shop(client, owner, "Ganesh Traders", [("credit", 500, 2)])
    share = lambda via="server": client.post(  # noqa: E731
        f"{API}/customers/{cid}/statement-whatsapp", headers=owner.headers, json={"via": via})

    # Trading together is not consent.
    assert share().status_code == 409 and sent == []
    assert client.post(f"{API}/customers/{cid}/statement-consent", headers=owner.headers,
                       json={"status": "opted_in"}).status_code == 422  # must be confirmed
    r = client.post(f"{API}/customers/{cid}/statement-consent", headers=owner.headers,
                    json={"status": "opted_in", "confirm": True, "note": "Agreed at the shop"})
    assert r.json()["status"] == "opted_in"

    r = share()
    assert r.status_code == 200 and len(sent) == 1
    assert "/s/" in sent[0][1] and "Stop" in sent[0][1]
    assert share("phone").json()["status"] == "ready"  # the phone path is gated the same way

    # The retailer opts out from their own link: it applies immediately.
    token = _token(sent[0][1].split("here (no app needed): ")[1].split()[0])
    r = client.post(f"/s/{token}/opt-out", follow_redirects=False)
    assert r.status_code == 303
    assert "won't get statements" in html.unescape(client.get(r.headers["location"]).text)
    for via in ("server", "phone"):
        assert share(via).status_code == 409
    assert len(sent) == 1  # nothing more went out

    with SessionLocal() as db:
        kinds = [e.kind for e in db.query(StatementEvent).filter_by(customer_id=cid)
                 .order_by(StatementEvent.created_at, StatementEvent.id)]
        assert kinds.count("opt_out") == 1 and kinds.count("blocked") == 3 and kinds.count("sent") == 2
        out = db.query(StatementEvent).filter_by(customer_id=cid, kind="opt_out").one()
        assert out.source == "retailer"
    consent = client.get(f"{API}/customers/{cid}/statement-consent", headers=owner.headers).json()
    assert consent["status"] == "opted_out" and consent["history"][0]["kind"] == "blocked"

    # Consent is per distributor: another business trading with the same shop has none.
    other = make_user()
    cid2 = add_customer(client, other.headers, full_name="Ganesh Traders")["id"]
    assert client.post(f"{API}/customers/{cid2}/statement-whatsapp", headers=other.headers,
                       json={"via": "phone"}).status_code == 409


# --- 4. Printed ledger totals = on-screen totals ----------------------------------------

def _on_screen(entries: list[dict], start: str, end: str) -> dict:
    """The app's statement rules (customerStatement.buildStatement), from the API ledger."""
    asc = sorted(entries, key=lambda e: (e["date"], e["created_at"]))
    signed = lambda e: D(str(e["amount"])) * (1 if e["type"] == "credit" else -1)  # noqa: E731
    opening = sum((signed(e) for e in asc if e["date"] < start), D(0))
    rows = [e for e in asc if start <= e["date"] <= end]
    credit = sum((D(str(e["amount"])) for e in rows if e["type"] == "credit"), D(0))
    paid = sum((D(str(e["amount"])) for e in rows if e["type"] == "payment"), D(0))
    return {"opening": opening, "credit": credit, "paid": paid, "closing": opening + credit - paid}


def test_printed_ledger_totals_match_the_screen(make_user, client):
    owner = make_user(business_name="Laxmi Agencies")
    entries = [("credit" if i % 3 else "payment", round(100 + i * 17.35, 2), 90 - i) for i in range(75)]
    cid = _shop(client, owner, "Mahadev Stores", entries)
    start, end = days_ago_iso(70), days_ago_iso(5)

    r = client.get(f"{API}/customers/{cid}/ledger.pdf", headers=owner.headers,
                   params={"from": start, "to": end})
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    reader = PdfReader(io.BytesIO(r.content))
    text = "\n".join(p.extract_text() for p in reader.pages)
    assert "Laxmi Agencies" in text and "Customer ledger" in text
    y, m, d = start.split("-")
    assert f"Period: {d}-{m}-{y} to" in text
    assert f"Page 1 of {len(reader.pages)}" in text and len(reader.pages) >= 2  # 55 rows, 30 a page

    screen = _on_screen(client.get(f"{API}/customers/{cid}/ledger", headers=owner.headers).json(), start, end)
    money = lambda s: D(s.replace("₹", "").replace(",", "").replace("−", "-"))  # noqa: E731
    [period] = re.findall(r"Period total\s*(\S+)\s*(\S+)\s*(\S+)", text)
    assert (money(period[0]), money(period[1]), money(period[2])) == (
        screen["credit"], screen["paid"], screen["closing"])
    first_bf = re.search(r"Brought forward\s*(\S+)", text).group(1)
    assert money(first_bf) == screen["opening"]
    pages = re.findall(r"Page total\s*(\S+)\s*(\S+)\s*(\S+)", text)
    assert len(pages) == len(reader.pages)
    assert sum(money(p[0]) for p in pages) == screen["credit"]
    assert sum(money(p[1]) for p in pages) == screen["paid"]
    assert money(pages[-1][2]) == screen["closing"]

    # Full ledger (no dates) and the retailer statement agree with each other too.
    full = svc.build
    with SessionLocal() as db:
        from app.models import Customer
        st = full(db, db.get(Customer, cid), None)
        assert st.closing == st.current and st.opening == 0
        assert sum(st.ageing.values()) == st.current
    assert client.get(f"{API}/customers/{cid}/ledger.pdf", headers=owner.headers,
                      params={"from": end, "to": start}).status_code == 422
