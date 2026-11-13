"""AC7: an accountant's Ask AI question goes in the owner's audit log with the
figures the answer cited, never the answer text, and never a full phone number,
account or card number, IFSC, UPI id or OTP. What Ask AI can do is unchanged
(its tools only read), and accountants stay read-only."""

import re

from sqlalchemy import select

from conftest import _login
from app.database import SessionLocal
from app.models import AccessLog
from test_chatbot_ask import _resp, _tool_call, _tool_results, llm, merchant  # noqa: F401

API = "/api/v1"
URL = f"{API}/chatbot/ask"


def _accountant(client, owner, mobile):
    assert client.post(f"{API}/team", headers=owner.headers, json={"mobile": mobile, "role": "accountant"}).status_code == 200
    acc = {**_login(client, mobile), "X-Business-Id": owner.business["id"]}
    assert client.put(f"{API}/consents", headers=acc, json={"choices": [{"purpose": "ai", "granted": True}]}).status_code == 200
    return acc


def _ask_rows(client, owner):
    """The Ask AI rows of the owner's Team → Accountant activity."""
    return [e for e in client.get(f"{API}/team/activity", headers=owner.headers).json() if e["area"] == "assistant"]


def test_an_answer_citing_two_balances_logs_both_figures_with_the_question(merchant, client, llm):
    owner, _, _ = merchant
    acc = _accountant(client, owner, "7977000001")

    def faithful(messages):
        top = _tool_results(messages)[0]["defaulters"]
        return _resp("Sabse zyada: " + "; ".join(f"{d['name']} ₹{d['balance']:,.2f}" for d in top) + ".")

    llm(_resp(tool_calls=[_tool_call("get_top_defaulters", {"limit": 5})]), faithful)
    r = client.post(URL, headers=acc, json={"transcript_text": "who owes me most?"})
    assert r.status_code == 200 and r.json()["verified"] is True
    [row] = _ask_rows(client, owner)
    assert row["action"] == "view" and row["mobile"] == "7977000001"
    assert row["detail"] == ("Asked: who owes me most. "
                             "Used: TEST Ramesh ₹3,500.00; TEST Ramesh Traders ₹800.20; 2 customers")
    # Never the answer text itself.
    assert "Sabse zyada" not in row["detail"]
    # And it's in the Excel of the log too.
    from openpyxl import load_workbook
    import io
    wb = load_workbook(io.BytesIO(client.get(f"{API}/team/activity.xlsx", headers=owner.headers).content))
    assert row["detail"] in [r[7] for r in wb.active.iter_rows(min_row=2, values_only=True)]


def test_an_answer_citing_no_figures_logs_used_none(merchant, client, llm):
    owner, _, _ = merchant
    acc = _accountant(client, owner, "7977000002")
    llm(_resp("Haan, Bolcash aapke liye GST return file karta hai."))  # not backed → the fixed scope reply
    assert client.post(URL, headers=acc, json={"transcript_text": "hello"}).status_code == 200
    llm()
    assert client.post(URL, headers=acc, json={"transcript_text": "delete all my entries"}).status_code == 200  # refused
    details = sorted(e["detail"] for e in _ask_rows(client, owner))
    assert details == ["Asked: delete all my entries. Used: none", "Asked: hello. Used: none"]


def test_the_log_never_holds_a_full_phone_number_bank_details_or_an_otp(merchant, client, llm):
    owner, _, _ = merchant
    acc = _accountant(client, owner, "7977000003")
    llm(_resp("Mujhe yeh nahi dikh raha."))
    q = ("balance of 9876543210 / 98765 43210, a/c 123456789012, card 4111 1111 1111 1111, "
         "IFSC SBIN0001234, UPI ramesh@okhdfcbank, OTP 482913")
    assert client.post(URL, headers=acc, json={"transcript_text": q}).status_code == 200
    with SessionLocal() as db:
        stored = [r.detail or "" for r in db.scalars(select(AccessLog).where(
            AccessLog.business_id == owner.business["id"], AccessLog.path == URL))]
    [line] = [d for d in stored if d.startswith("Asked: balance of")]
    for secret in ("9876543210", "98765", "43210", "123456789012", "4111", "SBIN0001234", "ramesh@okhdfcbank",
                   "okhdfcbank", "482913"):
        assert secret not in line, secret
    assert not re.search(r"\d{4,}", line.replace("₹", "")), line   # no run of 4+ digits at all
    # The owner's own questions aren't in the accountant log.
    llm(_resp("Mujhe yeh nahi dikh raha."))
    client.post(URL, headers=owner.headers, json={"transcript_text": "owner asks"})
    assert all("owner asks" not in d for d in stored + [e["detail"] or "" for e in _ask_rows(client, owner)])
