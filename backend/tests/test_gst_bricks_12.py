"""12% stays after 22 Sep 2025 for building bricks, fly ash bricks/blocks/
aggregates and earthen/roofing tiles (Notification 14/2025-Central Tax (Rate)):
HSN 6815, 6901 00 10, 6904 10 00, 6905 10 00. Everything else keeps 12% only on
invoices dated before 22 Sep 2025."""

from decimal import Decimal as D

import pytest

from conftest import today_iso
from helpers import add_customer
from app import gst
from test_gst import _gst_owner, _sale

API = "/api/v1"


@pytest.mark.parametrize("hsn", ["6815", "68151090", "69010010", "69041000", "69051000", "6904", "690410"])
def test_bricks_and_tiles_keep_12_percent_today(hsn):
    assert D("12") in gst.rates_on(today_iso(), hsn)
    assert gst.clean_rate("12", today_iso(), hsn) == D("12")


@pytest.mark.parametrize("hsn", ["1006", "6907", "69049000", "69059000", "690590", ""])
def test_other_goods_dont(hsn):
    assert D("12") not in gst.rates_on(today_iso(), hsn)
    with pytest.raises(Exception) as e:
        gst.clean_rate("12", today_iso(), hsn)
    assert "bricks and tiles" in str(e.value.detail)


def test_a_brick_invoice_at_12_percent_is_saved_and_rice_is_refused(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    r = _sale(client, owner.headers, cid, "brick12", amount=10000, rate="12", hsn_code="69041000", uqc="NOS")
    assert r.status_code == 200, r.text
    tax = r.json()["gst"]
    assert tax["rate"] == "12" and D(tax["cgst"]) + D(tax["sgst"]) == D("1200.00")
    rice = _sale(client, owner.headers, cid, "rice12", rate="12", hsn_code="1006")
    assert rice.status_code == 422 and "bricks and tiles" in rice.json()["detail"]
    # A preview (no HSN yet) doesn't refuse 12%: the save checks it with the HSN.
    assert D("12") in gst.rates_on(today_iso(), None)


def test_an_item_can_carry_12_percent_only_with_a_brick_or_tile_hsn(make_user, client):
    owner = make_user()
    body = {"name": "Red bricks", "unit": "nos", "purchase_price": 6, "sale_price": 8, "gst_rate": 12}
    assert client.post(f"{API}/items", headers=owner.headers, json={**body, "hsn_sac": "69041000"}).status_code == 200
    r = client.post(f"{API}/items", headers=owner.headers, json={**body, "name": "Rice", "hsn_sac": "1006"})
    assert r.status_code == 422
    assert client.post(f"{API}/items", headers=owner.headers, json={**body, "name": "No HSN"}).status_code == 422
