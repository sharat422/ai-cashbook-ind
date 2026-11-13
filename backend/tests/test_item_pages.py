"""BL9: a large catalogue is reached by search and pages of 50, never loaded
whole. Search is server-side, by name (any script) or HSN, ignoring case."""

from app.database import SessionLocal
from app.models import Item

API = "/api/v1"


def _catalogue(make_user):
    """300 items: 250 'Atta …' first by name, then 50 '… Soap …' after them."""
    owner = make_user()
    with SessionLocal() as db:  # straight into the table: 300 POSTs would be slow
        bid = owner.business["id"]
        db.add_all([Item(business_id=bid, name=f"Atta {i:03}", type="product", sale_price=10) for i in range(250)]
                   + [Item(business_id=bid, name=f"Lux Soap {i:02}", type="product", sale_price=30) for i in range(48)]
                   + [Item(business_id=bid, name="సబ్బు పెద్దది", type="product", sale_price=40),
                      Item(business_id=bid, name="Soap delivery", type="service", sale_price=5)])
        db.commit()
    return owner


def _page(client, owner, **params):
    r = client.get(f"{API}/items", headers=owner.headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_searching_soap_finds_items_beyond_the_first_hundred(make_user, client):
    owner = _catalogue(make_user)
    first = _page(client, owner, limit=100)
    assert all(i["name"].startswith("Atta") for i in first["items"])  # no soap in the first 100
    found = _page(client, owner, q="SOAP", limit=50, type="product")  # case ignored, server-side
    assert found["total"] == 48 and len(found["items"]) == 48
    assert all("Soap" in i["name"] for i in found["items"]) and found["next_cursor"] is None
    # In the script it was typed in.
    assert [i["name"] for i in _page(client, owner, q="సబ్బు")["items"]] == ["సబ్బు పెద్దది"]
    # The product filter leaves out services.
    assert _page(client, owner, q="soap")["total"] == 49
    # % and _ are searched as themselves, not as wildcards.
    assert _page(client, owner, q="%")["total"] == 0


def test_pages_of_fifty_cover_the_catalogue_and_no_request_gets_it_whole(make_user, client):
    owner = _catalogue(make_user)
    seen, offset = [], 0
    while True:
        page = _page(client, owner, limit=50, offset=offset)
        assert len(page["items"]) <= 50
        seen += [i["id"] for i in page["items"]]
        if page["next_cursor"] is None:
            break
        offset = int(page["next_cursor"])
        assert offset == len(seen)  # the next 50 start where the last ended
    assert len(seen) == len(set(seen)) == 300  # every item, once
    for too_many in (101, 1000):
        r = client.get(f"{API}/items", headers=owner.headers, params={"limit": too_many})
        assert r.status_code == 422


def test_schemes_carry_their_item_names_so_the_app_needs_no_catalogue(make_user, client):
    owner = make_user()
    ids = [client.post(f"{API}/items", headers=owner.headers, json={"name": n, "unit": "pcs", "sale_price": 5}).json()["id"]
           for n in ("Soap A", "Soap B")]
    r = client.post(f"{API}/schemes", headers=owner.headers, json={
        "name": "Soap free", "type": "free_goods", "itemIds": ids, "priority": 1, "validFrom": "2026-01-01",
        "validTo": "2026-12-31", "freeQty": 1, "freeItemId": ids[1], "minQty": 10})
    assert r.status_code == 200, r.text
    assert (r.json()["itemNames"], r.json()["freeItemName"]) == (["Soap A", "Soap B"], "Soap B")
    [listed] = [s for s in client.get(f"{API}/schemes", headers=owner.headers).json() if s["id"] == r.json()["id"]]
    # Each name sits with its id (the list's order isn't fixed).
    assert dict(zip(listed["itemIds"], listed["itemNames"])) == dict(zip(ids, ["Soap A", "Soap B"]))
    assert listed["freeItemName"] == "Soap B"
