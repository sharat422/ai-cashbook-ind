"""G5: the app pre-fills a GST sale's amount from the item's sale price ×
quantity. The server's side: it stores the amount as sent (an edited price
is never replaced by the item's), keeps the item's sale price for the
picker, and refuses a sale with no amount."""

from conftest import today_iso
from helpers import add_customer
from test_gst import API, _gst_owner, _sale
from test_items import _make_item


def test_the_item_keeps_its_sale_price_for_the_picker(make_user, client):
    owner = _gst_owner(make_user, client)
    _make_item(client, owner.headers, name="Rice bag", sale_price=120, hsn_sac="1006", gst_rate=5, unit="bag")
    _make_item(client, owner.headers, name="Sample", sale_price=0, hsn_sac="1006", gst_rate=5)
    items = {i["name"]: i for i in client.get(f"{API}/items", headers=owner.headers).json()["items"]}
    assert items["Rice bag"]["sale_price"] == 120  # ₹120 × 10 = ₹1,200 on the phone
    assert items["Sample"]["sale_price"] == 0       # none stored: the phone leaves the amount blank


def test_an_edited_amount_is_saved_and_reopened_as_typed(make_user, client):
    owner = _gst_owner(make_user, client)
    _make_item(client, owner.headers, name="Rice bag", sale_price=120, hsn_sac="1006", gst_rate=5, unit="bag")
    cid = add_customer(client, owner.headers)["id"]
    r = _sale(client, owner.headers, cid, "g1", amount=1150, rate="5", quantity="10", hsn_code="1006")
    assert r.status_code == 200, r.text
    reopened = client.get(f"{API}/customers/{cid}/ledger", headers=owner.headers).json()
    entries = reopened["items"] if isinstance(reopened, dict) else reopened
    [entry] = [e for e in entries if e["id"] == r.json()["id"]]
    # The typed ₹1,150 is the taxable value (price before GST), not ₹1,200;
    # the entry's amount is the invoice total with 5% on top.
    assert float(entry["gst"]["taxable_value"]) == 1150
    assert float(entry["amount"]) == 1207.5


def test_a_sale_with_no_amount_is_refused(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    for amount in ("", "0"):
        r = client.post(f"{API}/customers/{cid}/ledger", headers=owner.headers, data={
            "type": "credit", "amount": amount, "date": today_iso(), "client_id": f"x{amount}",
            "gst_rate": "5", "hsn_code": "1006", "quantity": "10", "uqc": "BAG"})
        assert r.status_code == 422, (amount, r.text)
