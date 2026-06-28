"""End-to-end smoke test against the in-process app (no server needed)."""
import os

os.environ["DATABASE_URL"] = "sqlite:///./smoke.db"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

c = TestClient(app)


def main() -> None:
    assert c.get("/health").json() == {"status": "ok"}

    # Auth
    r = c.post("/api/v1/auth/otp/request", json={"mobile": "9999999999"})
    vid = r.json()["verificationId"]
    r = c.post("/api/v1/auth/otp/verify", json={
        "verificationId": vid, "mobile": "9999999999", "otp": "123456"})
    token = r.json()["token"]
    h = {"Authorization": f"Bearer {token}"}

    # Business
    r = c.post("/api/v1/businesses", headers=h, json={
        "businessName": "Test Traders", "ownerName": "Ravi",
        "businessType": "Retail", "state": "Karnataka", "gstRegistered": True})
    assert r.json()["businessName"] == "Test Traders", r.json()

    # Income (multipart)
    r = c.post("/api/v1/incomes", headers=h, data={
        "amount": "5000", "category": "Sales", "date": "2026-06-17",
        "client_id": "c1", "notes": "Counter sale"})
    assert r.json()["amount"] == 5000, r.json()
    # Idempotency
    r2 = c.post("/api/v1/incomes", headers=h, data={
        "amount": "5000", "category": "Sales", "date": "2026-06-17", "client_id": "c1"})
    assert r2.json()["id"] == r.json()["id"], "idempotency failed"

    # Expense
    c.post("/api/v1/expenses", headers=h, data={
        "amount": "1200", "category": "Fuel", "vendor": "HP Petrol",
        "date": "2026-06-17", "client_id": "e1"})

    # Customer + ledger
    r = c.post("/api/v1/customers", headers=h, json={
        "full_name": "Ramesh Traders", "mobile": "8888888888"})
    cid = r.json()["id"]
    c.post(f"/api/v1/customers/{cid}/ledger", headers=h, data={
        "type": "credit", "amount": "3000", "date": "2026-06-17", "client_id": "l1"})
    r = c.get(f"/api/v1/customers/{cid}", headers=h)
    assert r.json()["outstanding_amount"] == 3000, r.json()

    # Aggregates
    assert c.get("/api/v1/dashboard/summary", headers=h).json()["today_income"] == 5000
    assert c.get("/api/v1/transactions?limit=10", headers=h).json()["total"] == 2
    assert c.get("/api/v1/summary/daily?date=2026-06-17", headers=h).json()["profit"] == 3800
    ks = c.get("/api/v1/khata/summary?from=2026-06-01&to=2026-06-30", headers=h).json()
    assert ks["total_receivable"] == 3000, ks

    # AI (fallback paths, no keys)
    cat = c.post("/api/v1/categorize", headers=h, json={"text": "Petrol at HP pump"}).json()
    assert cat["category"] == "Fuel", cat
    ins = c.get("/api/v1/khata/insights", headers=h).json()
    assert isinstance(ins["insights"], list) and ins["insights"], ins

    print("ALL_SMOKE_TESTS_PASSED")


if __name__ == "__main__":
    main()
