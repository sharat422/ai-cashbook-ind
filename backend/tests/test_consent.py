"""Per-purpose consent: each purpose is stored separately with its own timestamp
and policy version; required consent can't be withdrawn; optional consent can be
granted and later withdrawn independently."""

from app.consent import CURRENT_POLICY_VERSION


def _consents(client, headers) -> dict:
    r = client.get("/api/v1/consents", headers=headers)
    assert r.status_code == 200, r.text
    return {c["purpose"]: c for c in r.json()["consents"]}


def test_new_user_has_all_purposes_ungranted(make_user, client):
    u = make_user(with_business=False)
    snap = client.get("/api/v1/consents", headers=u.headers).json()
    assert snap["policy_version"] == CURRENT_POLICY_VERSION
    assert snap["required"] == ["core"]
    assert set(snap["optional"]) == {"marketing", "ai"}
    by = {c["purpose"]: c for c in snap["consents"]}
    assert {"core", "marketing", "ai"} <= set(by)
    for c in by.values():
        assert c["granted"] is False
        assert c["updated_at"] is None  # nothing decided yet


def test_choices_are_stored_separately_with_version_and_timestamp(make_user, client):
    u = make_user(with_business=False)
    r = client.put(
        "/api/v1/consents",
        headers=u.headers,
        json={"choices": [
            {"purpose": "core", "granted": True},
            {"purpose": "marketing", "granted": False},
            {"purpose": "ai", "granted": True},
        ]},
    )
    assert r.status_code == 200, r.text
    by = {c["purpose"]: c for c in r.json()["consents"]}
    assert by["core"]["granted"] is True and by["core"]["required"] is True
    assert by["marketing"]["granted"] is False
    assert by["ai"]["granted"] is True
    # Each decided purpose carries its own version + timestamp (not one combined flag).
    for p in ("core", "marketing", "ai"):
        assert by[p]["policy_version"] == CURRENT_POLICY_VERSION
        assert by[p]["updated_at"] is not None


def test_required_consent_cannot_be_withdrawn(make_user, client):
    u = make_user(with_business=False)
    client.put("/api/v1/consents", headers=u.headers,
               json={"choices": [{"purpose": "core", "granted": True}]})
    r = client.put("/api/v1/consents", headers=u.headers,
                   json={"choices": [{"purpose": "core", "granted": False}]})
    assert r.status_code == 422
    assert "required" in r.json()["detail"].lower()
    assert _consents(client, u.headers)["core"]["granted"] is True  # unchanged


def test_optional_consent_can_be_granted_then_withdrawn_independently(make_user, client):
    u = make_user(with_business=False)
    # Grant AI + marketing.
    client.put("/api/v1/consents", headers=u.headers, json={"choices": [
        {"purpose": "ai", "granted": True},
        {"purpose": "marketing", "granted": True},
    ]})
    granted = _consents(client, u.headers)
    assert granted["ai"]["granted"] and granted["marketing"]["granted"]

    # Withdraw ONLY marketing — AI must be unaffected.
    r = client.put("/api/v1/consents", headers=u.headers,
                   json={"choices": [{"purpose": "marketing", "granted": False}]})
    assert r.status_code == 200
    after = {c["purpose"]: c for c in r.json()["consents"]}
    assert after["marketing"]["granted"] is False
    assert after["ai"]["granted"] is True


def test_unknown_purpose_and_empty_payload_rejected(make_user, client):
    u = make_user(with_business=False)
    assert client.put("/api/v1/consents", headers=u.headers,
                      json={"choices": [{"purpose": "tracking", "granted": True}]}).status_code == 422
    assert client.put("/api/v1/consents", headers=u.headers,
                      json={"choices": []}).status_code == 422


def test_consents_are_isolated_per_user(make_user, client):
    a = make_user(with_business=False)
    b = make_user(with_business=False)
    client.put("/api/v1/consents", headers=a.headers,
               json={"choices": [{"purpose": "marketing", "granted": True}]})
    # B never granted marketing → still false.
    assert _consents(client, b.headers)["marketing"]["granted"] is False


def test_consent_available_before_onboarding(make_user, client):
    # A user with no business yet can still read + record consent (signup flow).
    u = make_user(with_business=False)
    assert client.get("/api/v1/consents", headers=u.headers).status_code == 200
    assert client.put("/api/v1/consents", headers=u.headers,
                      json={"choices": [{"purpose": "core", "granted": True}]}).status_code == 200
