"""Feedback / bug reports."""

import json


def test_submit_feedback_stores_message_and_diagnostics(user, client):
    r = client.post(
        "/api/v1/feedback",
        headers=user.headers,
        json={
            "kind": "bug",
            "message": "Voice entry didn't hear my Telugu",
            "diagnostics": {"appVersion": "1.0.0", "platform": "android"},
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True

    from app.database import SessionLocal
    from app.models import Feedback

    with SessionLocal() as s:
        row = s.query(Feedback).filter_by(id=r.json()["id"]).one()
    assert row.kind == "bug"
    assert "Telugu" in row.message
    assert json.loads(row.diagnostics)["platform"] == "android"


def test_empty_message_is_rejected(user, client):
    r = client.post(
        "/api/v1/feedback", headers=user.headers, json={"message": "   "}
    )
    assert r.status_code == 422


def test_feedback_defaults_to_kind_feedback(user, client):
    r = client.post(
        "/api/v1/feedback", headers=user.headers, json={"message": "Love the app!"}
    )
    assert r.status_code == 200

    from app.database import SessionLocal
    from app.models import Feedback

    with SessionLocal() as s:
        row = s.query(Feedback).filter_by(id=r.json()["id"]).one()
    assert row.kind == "feedback"


def test_feedback_requires_auth(client):
    r = client.post("/api/v1/feedback", json={"message": "hi"})
    assert r.status_code in (401, 403)
