"""Scheme claims: assembled from the scheme log for one scheme and period (the
Scheme Report's figures, net of returns), tracked through the supplier's answer,
and exported as PDF and Excel with the same figures."""

import io

from openpyxl import load_workbook

from conftest import days_ago_iso, today_iso
from helpers import add_customer
from test_schemes import API, _bill, _item, _scheme, _team

MONTH = (days_ago_iso(30), today_iso())


def _report(client, headers, scheme_id):
    return client.get(f"{API}/schemes/report", headers=headers,
                      params={"from": MONTH[0], "to": MONTH[1], "schemeId": scheme_id}).json()


def _file(client, headers, scheme_id, period=MONTH):
    return client.post(f"{API}/schemes/claims", headers=headers,
                       json={"schemeId": scheme_id, "from": period[0], "to": period[1]})


def _setup(make_user, client):
    owner, _, staff = _team(make_user, client)
    soap = _item(client, owner.headers, "Soap", price=25)
    oil = _item(client, owner.headers, "Oil", price=100)
    sid = _scheme(client, owner.headers, "Soap 10+1", [soap], buyQty=10, freeQty=1).json()["id"]
    other = _scheme(client, owner.headers, "Oil 5%", [oil], kind="percent", percent=5, priority=2).json()["id"]
    cid = add_customer(client, owner.headers)["id"]
    for n, qty in enumerate((20, 10, 30)):  # 2 + 1 + 3 free Soap = 6 × ₹25 = ₹150
        assert _bill(client, owner.headers, cid, [(soap, qty), (oil, 2)], cid_key=f"b{n}").status_code == 200
    return owner, staff, sid, other


def test_a_claim_from_the_log_has_the_reports_figures_and_exports_them(make_user, client):
    owner, staff, sid, _ = _setup(make_user, client)
    report = _report(client, owner.headers, sid)
    r = _file(client, owner.headers, sid)
    assert r.status_code == 200, r.text
    claim = r.json()
    assert (claim["status"], claim["schemeName"], claim["bills"], claim["value"], claim["freeQty"]) == (
        "draft", "Soap 10+1", 3, report["totalValue"], report["totalFreeQty"])
    assert claim["value"] == "150.00" and [ln["itemName"] for ln in claim["lines"]] == ["Soap"]  # only this scheme
    assert [c["id"] for c in client.get(f"{API}/schemes/claims", headers=owner.headers).json()] == [claim["id"]]

    x = client.get(f"{API}/schemes/claims/{claim['id']}.xlsx", headers=owner.headers)
    assert x.status_code == 200
    rows = [list(r) for r in load_workbook(io.BytesIO(x.content))["Claim"].iter_rows(values_only=True)]
    assert rows[0][0] == "Scheme claim: Soap 10+1"
    soap_row = next(r for r in rows if r[0] == "Soap")
    total = next(r for r in rows if r[0] == "Total")
    assert soap_row[1:] == [3, 60.0, 6.0, 0.0, 150.0] and total[1:] == [3, 60.0, 6.0, 0.0, 150.0]
    p = client.get(f"{API}/schemes/claims/{claim['id']}.pdf", headers=owner.headers)
    assert p.status_code == 200 and p.content[:4] == b"%PDF"


def test_status_and_the_suppliers_answer_and_one_live_claim_per_period(make_user, client):
    owner, staff, sid, other = _setup(make_user, client)
    claim = _file(client, owner.headers, sid).json()
    r = _file(client, owner.headers, sid, (days_ago_iso(5), today_iso()))  # overlaps the first
    assert (r.status_code, r.json()["code"]) == (409, "claim_exists")

    r = client.patch(f"{API}/schemes/claims/{claim['id']}", headers=owner.headers, json={"status": "filed"})
    assert (r.json()["status"], bool(r.json()["filedAt"])) == ("filed", True)
    r = client.patch(f"{API}/schemes/claims/{claim['id']}", headers=owner.headers,
                     json={"status": "rejected", "note": "HUL: send the bills with it"})
    assert (r.json()["status"], r.json()["note"]) == ("rejected", "HUL: send the bills with it")
    assert _file(client, owner.headers, sid).status_code == 200  # rejected: claim again
    assert client.patch(f"{API}/schemes/claims/{claim['id']}", headers=owner.headers,
                        json={"status": "lost"}).status_code == 422

    # Staff can't make or change claims, or see them.
    assert _file(client, staff, other).status_code == 403
    assert client.get(f"{API}/schemes/claims", headers=staff).status_code == 403


def test_nothing_given_away_nothing_to_claim(make_user, client):
    owner, _, sid, _ = _setup(make_user, client)
    r = _file(client, owner.headers, sid, ("2020-01-01", "2020-01-31"))
    assert (r.status_code, r.json()["code"]) == (422, "claim_empty")
