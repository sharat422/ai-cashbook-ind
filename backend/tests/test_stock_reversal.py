"""S4: a stock entry is corrected by a reversal, never edited. The mirror row
undoes it, the original stays in history marked reversed."""

from test_stock import API, _item, _levels, _move, _team, _transfer


def _reverse(client, headers, move_id):
    return client.post(f"{API}/stock/moves/{move_id}/reverse", headers=headers)


def _history(client, headers, item):
    return client.get(f"{API}/stock/moves", headers=headers, params={"itemId": item}).json()


def test_reversing_a_purchase_of_ten_takes_it_back_out(make_user, client):
    owner, _ = _team(make_user, client)
    item = _item(client, owner.headers, opening=5)
    [buy] = _move(client, owner.headers, item, "purchase", 10).json()
    assert _levels(client, owner.headers, item)["godown"] == "15.000"

    r = _reverse(client, owner.headers, buy["id"])
    assert r.status_code == 200, r.text
    [mirror] = r.json()
    assert (mirror["quantity"], mirror["location"], mirror["reversesId"]) == ("-10.000", "godown", buy["id"])
    assert _levels(client, owner.headers, item)["godown"] == "5.000"  # −10 net
    history = {m["id"]: m for m in _history(client, owner.headers, item)}
    assert history[buy["id"]]["reversed"] is True and history[buy["id"]]["quantity"] == "10.000"  # kept
    assert mirror["id"] in history                                                              # both rows


def test_an_entry_can_be_reversed_once_and_counts_or_reversals_not_at_all(make_user, client):
    owner, _ = _team(make_user, client)
    item = _item(client, owner.headers, opening=5)
    [buy] = _move(client, owner.headers, item, "purchase", 10).json()
    [mirror] = _reverse(client, owner.headers, buy["id"]).json()
    again = _reverse(client, owner.headers, buy["id"])
    assert again.status_code == 422 and "already" in again.json()["detail"]
    assert _reverse(client, owner.headers, mirror["id"]).status_code == 422  # a reversal isn't reversed
    count = client.post(f"{API}/stock/counts", headers=owner.headers, json={
        "location": "godown", "date": mirror["date"], "lines": [{"itemId": item, "counted": "4"}]})
    assert count.status_code == 200, count.text
    count_move = next(m for m in _history(client, owner.headers, item) if m["kind"] == "count")
    assert _reverse(client, owner.headers, count_move["id"]).status_code == 422
    assert _levels(client, owner.headers, item)["godown"] == "4.000"


def test_a_reversal_that_would_go_below_zero_is_refused(make_user, client):
    owner, [(a_id, staff_a)] = _team(make_user, client, "staff")
    item = _item(client, owner.headers)  # 0 in the godown
    [buy] = _move(client, owner.headers, item, "purchase", 10).json()
    assert _move(client, owner.headers, item, "sale", 8).status_code == 200  # sold since
    r = _reverse(client, owner.headers, buy["id"])
    assert r.status_code == 422, r.text
    assert _levels(client, owner.headers, item)["godown"] == "2.000"  # nothing changed
    assert not next(m for m in _history(client, owner.headers, item) if m["id"] == buy["id"])["reversed"]


def test_transfers_reverse_as_a_pair_and_staff_only_on_their_own_van(make_user, client):
    owner, [(a_id, staff_a), (b_id, staff_b)] = _team(make_user, client, "staff", "staff")
    item = _item(client, owner.headers, opening=20)
    load = _transfer(client, owner.headers, item, 6, a_id).json()
    [sale] = _move(client, staff_a, item, "sale", 1, location="van").json()
    assert _reverse(client, staff_b, sale["id"]).status_code == 403  # not B's van
    assert _reverse(client, staff_a, sale["id"]).status_code == 200  # A's own van: the 1 is back
    assert _reverse(client, staff_a, load[0]["id"]).status_code == 403  # the godown side is the owner's
    r = _reverse(client, owner.headers, load[1]["id"])  # either row reverses the whole transfer
    assert r.status_code == 200 and len(r.json()) == 2
    lv = _levels(client, owner.headers, item)
    assert (lv["godown"], lv["vans"].get(a_id, "0.000"), lv["total"]) == ("20.000", "0.000", "20.000")
