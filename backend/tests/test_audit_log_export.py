"""AC4: the accountant audit log gains a date filter (IST days) and an Excel
export of the same rows; an accountant's export raises a notice on the owner's
home screen that clears when opened. Retention is unchanged: nothing is deleted."""

import io
from datetime import datetime, timedelta, timezone

from openpyxl import load_workbook

from conftest import _login, days_ago_iso, today_iso
from app.calc import IST
from app.database import SessionLocal
from app.models import AccessLog

API = "/api/v1"


def _setup(make_user, client, mobile):
    owner = make_user()
    r = client.post(f"{API}/team", headers=owner.headers, json={"mobile": mobile, "role": "accountant"})
    assert r.status_code == 200, r.text
    return owner, r.json()["user_id"], _login(client, mobile)


def _row(owner, user_id, mobile, ist_day: str, hour: int, action="view", path="/api/v1/customers"):
    """A log row at that IST day and hour (as the accountant's request would have written it)."""
    at = datetime.fromisoformat(ist_day).replace(hour=hour, tzinfo=IST).astimezone(timezone.utc).isoformat()
    with SessionLocal() as db:
        db.add(AccessLog(business_id=owner.business["id"], user_id=user_id, mobile=mobile, action=action,
                         method="GET", path=path, created_at=at))
        db.commit()


def test_a_date_range_returns_only_that_range_and_the_excel_has_the_same_rows(make_user, client):
    owner, uid, _ = _setup(make_user, client, "7966000001")
    m = "7966000001"
    old = days_ago_iso(30)
    _row(owner, uid, m, days_ago_iso(40), 12)             # before the range
    _row(owner, uid, m, old, 0)                           # 00:xx IST on the first day: in (it's the day before in UTC)
    _row(owner, uid, m, days_ago_iso(25), 15, "export", "/api/v1/reports/tally-export.csv")
    _row(owner, uid, m, days_ago_iso(20), 23)             # 23:xx IST on the last day: in
    _row(owner, uid, m, days_ago_iso(19), 1)              # after the range
    q = f"from={old}&to={days_ago_iso(20)}"
    rows = client.get(f"{API}/team/activity?{q}", headers=owner.headers).json()
    assert [r["at"][:10] for r in rows] and len(rows) == 3
    days = {datetime.fromisoformat(r["at"]).astimezone(IST).date().isoformat() for r in rows}
    assert days == {old, days_ago_iso(25), days_ago_iso(20)}

    x = client.get(f"{API}/team/activity.xlsx?{q}", headers=owner.headers)
    assert x.status_code == 200 and x.headers["content-type"].startswith("application/vnd.openxmlformats")
    sheet = list(load_workbook(io.BytesIO(x.content)).active.iter_rows(values_only=True))
    assert sheet[0] == ("Date and time (IST)", "Person", "Mobile", "Action", "What", "Customer", "Business", "Detail")
    assert [(r[0], r[2], r[3]) for r in sheet[1:]] == [(r["atIst"], r["mobile"], r["action"]) for r in rows]
    assert {r[6] for r in sheet[1:]} == {"Test Traders"}


def test_an_accountants_export_alerts_the_owner_until_opened(make_user, client):
    owner, _, acc = _setup(make_user, client, "7966000002")
    ctx = {**acc, "X-Business-Id": owner.business["id"]}
    r = client.get(f"{API}/reports/tally-export.csv?from={days_ago_iso(9)}&to={today_iso()}", headers=ctx)
    assert r.status_code == 200, r.text
    alerts = client.get(f"{API}/team/export-alerts", headers=owner.headers).json()
    assert [(a["mobile"], a["what"]) for a in alerts] == [("7966000002", "tally")]
    # Opening it clears it; the log row stays.
    assert client.post(f"{API}/team/export-alerts/seen", headers=owner.headers).json() == {"cleared": 1}
    assert client.get(f"{API}/team/export-alerts", headers=owner.headers).json() == []
    log = client.get(f"{API}/team/activity", headers=owner.headers).json()
    assert any(e["action"] == "export" and e["mobile"] == "7966000002" for e in log)
    # A view isn't an export: no alert. The accountant can't see or clear alerts.
    client.get(f"{API}/customers", headers=ctx)
    assert client.get(f"{API}/team/export-alerts", headers=owner.headers).json() == []
    assert client.get(f"{API}/team/export-alerts", headers=ctx).status_code == 403


def test_the_log_still_holds_entries_older_than_a_year(make_user, client):
    owner, uid, _ = _setup(make_user, client, "7966000003")
    ancient = (datetime.now(IST) - timedelta(days=500)).date().isoformat()
    _row(owner, uid, "7966000003", ancient, 10, "export", "/api/v1/account/export.xlsx")
    rows = client.get(f"{API}/team/activity?from={ancient}&to={ancient}", headers=owner.headers).json()
    assert len(rows) == 1 and rows[0]["action"] == "export"
    # The default view (newest 300) shows it too: nothing is ever deleted for age.
    assert len(client.get(f"{API}/team/activity", headers=owner.headers).json()) == 1
