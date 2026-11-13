"""G11: CA test results kept on the server. A record only: saving one
changes no export. Owner writes; staff and accountants can't."""

import io
import zipfile

from conftest import today_iso
from helpers import add_customer
from test_accountant import _invite
from test_beats import _login, _team
from test_gst import API, KA, _gst_owner, _sale


def _save(client, headers, **over):
    body = {"testedMonth": "2026-10", "caName": "Rao & Co", "tallyVersion": "TallyPrime 5.1",
            "offlineToolVersion": "3.2.1", "recordsExported": 40, "recordsImported": 40,
            "fieldsRetyped": 2, "offlineToolErrors": 1,
            "discrepancyNote": "Place of supply typed for 2 invoices: column empty in the Tally CSV.", **over}
    return client.post(f"{API}/gst/ca-tests", headers=headers, json=body)


def test_a_result_is_saved_and_listed_newest_first(make_user, client):
    owner = _gst_owner(make_user, client)
    first = _save(client, owner.headers)
    assert first.status_code == 200, first.text
    r = first.json()
    assert (r["testedMonth"], r["caName"], r["tallyVersion"], r["fieldsRetyped"], r["offlineToolErrors"]) == (
        "2026-10", "Rao & Co", "TallyPrime 5.1", 2, 1)
    assert r["discrepancyNote"].startswith("Place of supply typed") and r["testedAt"].endswith("+05:30")  # IST
    second = _save(client, owner.headers, testedMonth="2026-11", fieldsRetyped=0, discrepancyNote="None").json()
    listed = client.get(f"{API}/gst/ca-tests", headers=owner.headers).json()
    assert [x["id"] for x in listed] == [second["id"], r["id"]]  # newest first
    assert _save(client, owner.headers, testedMonth="Oct 2026").status_code == 422
    assert _save(client, owner.headers, fieldsRetyped=-1).status_code == 422


def test_staff_and_accountants_cannot_save_a_result(make_user, client):
    owner, [(_sid, staff)] = _team(make_user, client, "staff")
    _invite(client, owner, "9123400002")
    accountant = _login(client, "9123400002")
    assert _save(client, staff).status_code == 403
    assert _save(client, accountant).status_code == 403
    assert client.get(f"{API}/gst/ca-tests", headers=accountant).status_code == 200  # read-only
    assert client.get(f"{API}/gst/ca-tests", headers=staff).status_code == 403


def _content(data: bytes, name: str):
    """A file's content: CSV bytes as they are; an xlsx without docProps, the
    part where openpyxl stamps the time the file was made."""
    if name.endswith(".csv"):
        return data
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return {n: z.read(n) for n in z.namelist() if not n.startswith("docProps/")}


def test_saving_a_result_changes_no_export(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    _sale(client, owner.headers, cid, "s1", customer_gstin=KA)
    _sale(client, owner.headers, cid, "s2")
    files = ("gstr1.xlsx", "gstr3b-summary.xlsx", "tally-export.xlsx", "tally-export.csv", "itc-review.xlsx")

    def exports():
        out = {}
        for f in files:
            r = client.get(f"{API}/reports/{f}", headers=owner.headers, params={"from": today_iso(), "to": today_iso()})
            assert r.status_code == 200, (f, r.text)
            out[f] = _content(r.content, f)
        return out

    before = exports()
    assert _save(client, owner.headers).status_code == 200
    assert exports() == before
