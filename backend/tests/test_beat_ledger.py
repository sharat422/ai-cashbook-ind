"""One ledger per beat: GET /ledger?beat_id=. Staff only ever read their own
beat's entries (403 for anyone else's), owners and accountants read all."""

from conftest import today_iso
from helpers import add_customer, add_ledger
from test_beats import _beat, _team


def _entries(client, headers, **params):
    return client.get("/api/v1/ledger", headers=headers, params=params)


def test_beat_ledger_and_staff_isolation(make_user, client):
    owner, [(a_id, staff_a), (b_id, _), (_, accountant)] = _team(make_user, client, "staff", "staff", "accountant")
    shop = add_customer(client, owner.headers, full_name="Gupta Stores")
    other = add_customer(client, owner.headers, full_name="Rao Kirana")
    beat_a = _beat(client, owner, "North", user_id=a_id, customers=[shop["id"]])
    beat_b = _beat(client, owner, "South", user_id=b_id, customers=[other["id"]])

    # Staff A records on their beat; the entry stores the beat.
    mine = add_ledger(client, staff_a, shop["id"], type="payment", amount=1500, date=today_iso(),
                      client_id="bl-1", payment_method="cash", beat_id=beat_a["id"])
    assert mine["beat_id"] == beat_a["id"]
    add_ledger(client, owner.headers, other["id"], type="credit", amount=900, date=today_iso(),
               client_id="bl-2", invoice_number="INV-7", beat_id=beat_b["id"])
    add_ledger(client, owner.headers, shop["id"], type="credit", amount=50, date=today_iso(), client_id="bl-3")

    # Filtered by beat: only that beat's entries, with what the beat ledger shows.
    a = _entries(client, owner.headers, beat_id=beat_a["id"]).json()
    assert [(e["id"], e["customer_name"], e["amount"], e["payment_method"]) for e in a] == [
        (mine["id"], "Gupta Stores", 1500.0, "cash")]
    b = _entries(client, owner.headers, beat_id=beat_b["id"]).json()
    assert [(e["customer_name"], e["invoice_number"], e["date"]) for e in b] == [("Rao Kirana", "INV-7", today_iso())]

    # Staff: their own beat yes; another beat, or no beat named (= everything), 403.
    assert [e["id"] for e in _entries(client, staff_a, beat_id=beat_a["id"]).json()] == [mine["id"]]
    assert _entries(client, staff_a, beat_id=beat_b["id"]).status_code == 403
    assert _entries(client, staff_a).status_code == 403
    # ...and can't write an entry on someone else's beat.
    r = client.post(f"/api/v1/customers/{other['id']}/ledger", headers=staff_a, data={
        "type": "payment", "amount": "10", "date": today_iso(), "client_id": "bl-4",
        "payment_method": "cash", "beat_id": beat_b["id"]})
    assert r.status_code == 403

    # Owner and accountant: every beat and every entry.
    for headers in (owner.headers, accountant):
        assert {x["id"] for x in client.get("/api/v1/beats", headers=headers).json()} == {beat_a["id"], beat_b["id"]}
        assert len(_entries(client, headers).json()) == 3
