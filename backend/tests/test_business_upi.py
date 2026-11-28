"""The UPI ID lives on the business: the owner sets it once and every member's
phone (staff included) gets it with the business, for payment QRs."""

import re
from pathlib import Path

from app.validation import UPI_ID_RE
from test_stock import _team

API = "/api/v1"
APP_UPI = Path(__file__).resolve().parents[2] / "src" / "features" / "collections" / "domain" / "upi.ts"


def _me(client, headers):
    r = client.get(f"{API}/businesses/me", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_the_owner_sets_it_once_and_a_staff_phone_gets_it(make_user, client):
    owner, [(_, staff)] = _team(make_user, client, "staff")
    assert (_me(client, staff)["upiId"], _me(client, staff)["upiPayeeName"]) == (None, None)

    r = client.patch(f"{API}/businesses/me", headers=owner.headers,
                     json={"upiId": " shop.42@okhdfcbank ", "upiPayeeName": "Gupta Traders"})
    assert r.status_code == 200, r.text
    assert (r.json()["upiId"], r.json()["upiPayeeName"]) == ("shop.42@okhdfcbank", "Gupta Traders")
    staff_view = _me(client, staff)
    assert (staff_view["upiId"], staff_view["upiPayeeName"], staff_view["role"]) == (
        "shop.42@okhdfcbank", "Gupta Traders", "staff")

    # Only the owner changes it; a bad one is refused; "" clears it.
    assert client.patch(f"{API}/businesses/me", headers=staff, json={"upiId": "x@y"}).status_code == 403
    for bad in ("shop", "shop@", "@okhdfcbank", "s@okhdfcbank", "shop@ok1", "shop @okicici"):
        assert client.patch(f"{API}/businesses/me", headers=owner.headers, json={"upiId": bad}).status_code == 422, bad
    assert _me(client, staff)["upiId"] == "shop.42@okhdfcbank"
    r = client.patch(f"{API}/businesses/me", headers=owner.headers, json={"upiId": "", "upiPayeeName": ""})
    assert (r.json()["upiId"], r.json()["upiPayeeName"]) == (None, None)


def test_the_server_checks_the_same_pattern_as_the_app():
    app_re = re.search(r"isValidUpiId[\s\S]*?return /(.+?)/\.test", APP_UPI.read_text(encoding="utf-8")).group(1)
    assert app_re == UPI_ID_RE.pattern
