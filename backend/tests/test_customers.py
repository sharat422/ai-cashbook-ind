"""Customer uniqueness — a mobile number identifies one customer per business."""


def _create(client, headers, **body):
    return client.post("/api/v1/customers", headers=headers, json=body)


def test_duplicate_mobile_rejected_even_with_different_business_name(user, client):
    assert _create(client, user.headers, full_name="Ramesh", mobile="9876500000",
                   business_name="Shop A").status_code == 200
    # Same number, different name + business name → still rejected.
    r = _create(client, user.headers, full_name="Ramesh", mobile="9876500000",
                business_name="Shop B")
    assert r.status_code == 422, r.text
    assert "mobile number already exists" in r.json()["detail"].lower()


def test_duplicate_mobile_detected_across_formats(user, client):
    assert _create(client, user.headers, full_name="A", mobile="9876500001").status_code == 200
    # +91 / spaces / dashes normalize to the same 10 digits → rejected.
    r = _create(client, user.headers, full_name="B", mobile="+91 98765-00001")
    assert r.status_code == 422, r.text


def test_empty_mobile_allowed_multiple_times(user, client):
    # Party-by-name (no mobile) has no uniqueness constraint.
    assert _create(client, user.headers, full_name="Walk-in 1", mobile="").status_code == 200
    assert _create(client, user.headers, full_name="Walk-in 2", mobile="").status_code == 200


def test_same_mobile_allowed_in_different_businesses(make_user, client):
    a = make_user()
    b = make_user()
    assert _create(client, a.headers, full_name="X", mobile="9876500002").status_code == 200
    # A different business may have a customer with the same number.
    assert _create(client, b.headers, full_name="Y", mobile="9876500002").status_code == 200


def test_update_to_existing_mobile_rejected_but_own_kept(user, client):
    _create(client, user.headers, full_name="One", mobile="9876500003")
    two = _create(client, user.headers, full_name="Two", mobile="9876500004").json()

    # Re-saving Two with its own mobile is fine (no false self-collision).
    r = client.patch(f"/api/v1/customers/{two['id']}", headers=user.headers,
                     json={"full_name": "Two", "mobile": "9876500004"})
    assert r.status_code == 200, r.text

    # Changing Two's mobile to One's is rejected.
    r = client.patch(f"/api/v1/customers/{two['id']}", headers=user.headers,
                     json={"full_name": "Two", "mobile": "9876500003"})
    assert r.status_code == 422, r.text
