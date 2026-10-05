"""Sensitive fields are encrypted at rest (application-level), transparently to
the API, and legacy plaintext rows still read correctly during rollout."""

import uuid

from sqlalchemy import text

from app.crypto import EncryptedText, decrypt, encrypt
from app.database import SessionLocal, engine
from app.models import Customer
from helpers import add_customer, add_ledger
from conftest import today_iso


def test_customer_sensitive_fields_are_ciphertext_at_rest(make_user, client):
    u = make_user()
    secret_addr = "12 MG Road, Bengaluru 560001"
    secret_gst = "29ABCDE1234F1Z5"
    c = add_customer(
        client, u.headers, full_name="Ramesh", mobile="7000001234",
        gst_number=secret_gst, address=secret_addr, notes="pays late",
    )

    # API round-trips plaintext (transparent decrypt on read).
    got = client.get(f"/api/v1/customers/{c['id']}", headers=u.headers).json()
    assert got["address"] == secret_addr
    assert got["gst_number"] == secret_gst

    # Raw DB bytes must NOT contain the plaintext.
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT gst_number, address, notes FROM customers WHERE id = :id"),
            {"id": c["id"]},
        ).one()
    raw_gst, raw_addr, raw_notes = row
    assert raw_addr != secret_addr and secret_addr not in raw_addr
    assert raw_gst != secret_gst
    assert "late" not in raw_notes
    # …and it must decrypt back to the original.
    assert decrypt(raw_addr) == secret_addr
    assert decrypt(raw_gst) == secret_gst


def test_ledger_reference_and_notes_are_encrypted(make_user, client):
    u = make_user()
    c = add_customer(client, u.headers, full_name="Sita", mobile="7000005678")
    add_ledger(
        client, u.headers, c["id"], type="payment", amount=500, date=today_iso(),
        client_id="enc-1", reference_number="UTR-SECRET-9911", payment_method="upi",
        notes="cash-back adjustment",
    )
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT reference_number, payment_method, notes FROM ledger_entries")
        ).all()
    blob = " ".join(str(v) for r in rows for v in r)
    assert "UTR-SECRET-9911" not in blob
    assert "cash-back adjustment" not in blob
    # API still shows the real values.
    led = client.get(f"/api/v1/customers/{c['id']}/ledger", headers=u.headers).json()
    assert led[0]["reference_number"] == "UTR-SECRET-9911"


def test_roundtrip_and_legacy_plaintext_passthrough():
    # encrypt→decrypt is identity.
    assert decrypt(encrypt("hello ₹500")) == "hello ₹500"
    # A value that isn't a valid token (a row written before encryption) is
    # returned unchanged instead of raising.
    assert decrypt("plain-legacy-text") == "plain-legacy-text"


def test_legacy_plaintext_row_reads_through_orm():
    # Simulate a pre-encryption row by writing raw plaintext straight to the DB,
    # then reading it back through the ORM (which runs the decrypt path).
    cid = uuid.uuid4().hex
    with SessionLocal() as s:
        s.execute(
            text(
                "INSERT INTO customers (id, business_id, full_name, mobile, "
                "address, outstanding_amount, is_overdue, created_at, updated_at, "
                "version) VALUES (:id, 'b-legacy', 'Legacy', '7000009999', :addr, "
                "0, 0, '2026-01-01', '2026-01-01', 1)"
            ),
            {"id": cid, "addr": "Legacy Plain Address"},
        )
        s.commit()
        got = s.get(Customer, cid)
        assert got.address == "Legacy Plain Address"  # read as-is, no crash


def test_encrypted_text_type_maps_to_text():
    assert isinstance(Customer.__table__.c.address.type, EncryptedText)
