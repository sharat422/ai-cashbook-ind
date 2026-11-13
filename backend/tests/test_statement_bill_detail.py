"""ST6: a sale row on the retailer statement carries its bill's lines and
scheme lines — collapsed ("3 item(s)") and expandable in the link, printed in
full on a "detailed" PDF, left out of a "summary" one. Detail, never a new
total. A cancelled bill's lines say Cancelled."""

import html
import io
import re

from pypdf import PdfReader

from helpers import add_customer
from test_schemes import _bill, _item, _scheme
from test_statements import API, _token


def _pdf_text(pdf: bytes) -> str:
    return "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)


def _retailer_with_a_three_line_bill(make_user, client):
    owner = make_user()
    client.put(f"{API}/statement-language", headers=owner.headers, json={"language": "en"})
    soap, oil, tea = (_item(client, owner.headers, n, price=p) for n, p in (("Soap", 25), ("Oil", 100), ("Tea", 40)))
    _scheme(client, owner.headers, "Soap 10+1", [soap], buyQty=10, freeQty=1)
    cid = add_customer(client, owner.headers, full_name="Ravi Stores")["id"]
    bill = _bill(client, owner.headers, cid, [(soap, 20), (oil, 2), (tea, 5)]).json()
    return owner, cid, bill


def _link(client, owner, cid, detailed=False):
    r = client.post(f"{API}/customers/{cid}/statement-link", headers=owner.headers, json={"detailed": detailed})
    return _token(r.json()["url"])


def test_a_three_line_bill_shows_its_lines_on_expand_and_in_a_detailed_pdf(make_user, client):
    owner, cid, bill = _retailer_with_a_three_line_bill(make_user, client)
    page = html.unescape(client.get(f"/s/{_link(client, owner, cid)}").text)
    block = re.search(r"<details>(.*?)</details>", page, re.S).group(1)  # collapsed until tapped
    assert "<summary>3 item(s)</summary>" in block
    for line in ("Soap · 20 pcs · ₹500.00", "Oil · 2 pcs · ₹200.00", "Tea · 5 pcs · ₹200.00",
                 "• Soap 10+1: 2 Soap free"):
        assert line in block, line
    detailed = _pdf_text(client.get(f"/s/{_link(client, owner, cid, detailed=True)}/statement.pdf").content)
    summary = _pdf_text(client.get(f"/s/{_link(client, owner, cid)}/statement.pdf").content)
    for line in ("Soap · 20 pcs · ₹500.00", "Oil · 2 pcs · ₹200.00", "Tea · 5 pcs · ₹200.00",
                 "• Soap 10+1: 2 Soap free"):
        assert line in detailed and line not in summary, line
    assert f"Sale · {bill['billNumber']}" in summary  # the summary has the sale, numbers only
    # The printable ledger takes the same choice.
    share = client.post(f"{API}/customers/{cid}/pdf-share", headers=owner.headers,
                        json={"document": "ledger", "channel": "save", "detailed": True}).json()
    assert "Oil · 2 pcs · ₹200.00" in _pdf_text(client.get(f"{API}{share['pdfUrl']}", headers=owner.headers).content)


def test_the_statement_total_does_not_change_with_the_detail(make_user, client):
    owner, cid, bill = _retailer_with_a_three_line_bill(make_user, client)
    total = r"Period total\s*(\S+)\s*(\S+)\s*(\S+)"
    detailed = _pdf_text(client.get(f"/s/{_link(client, owner, cid, detailed=True)}/statement.pdf").content)
    summary = _pdf_text(client.get(f"/s/{_link(client, owner, cid)}/statement.pdf").content)
    assert re.findall(total, detailed) == re.findall(total, summary) == [("₹900.00", "₹0.00", "₹900.00")]
    assert "₹900.00" in html.unescape(client.get(f"/s/{_link(client, owner, cid)}").text)


def test_a_cancelled_bills_lines_show_as_cancelled_not_as_a_sale(make_user, client):
    owner, cid, bill = _retailer_with_a_three_line_bill(make_user, client)
    assert client.post(f"{API}/bills/{bill['id']}/cancel", headers=owner.headers, json={"itemIds": []}).status_code == 200
    page = html.unescape(client.get(f"/s/{_link(client, owner, cid)}").text)
    block = re.search(r"<details class=x>(.*?)</details>", page, re.S).group(1)
    assert "<summary>3 item(s) · Cancelled</summary>" in block
    assert "Soap · 20 pcs · ₹500.00 (Cancelled)" in block and "Oil · 2 pcs · ₹200.00 (Cancelled)" in block
    assert "Bill return ·" in page  # the return is its own row, and the balance is back to 0
    detailed = _pdf_text(client.get(f"/s/{_link(client, owner, cid, detailed=True)}/statement.pdf").content)
    assert "Tea · 5 pcs · ₹200.00 (Cancelled)" in detailed


def test_the_line_labels_follow_the_statement_language(make_user, client, monkeypatch):
    from app import doc_i18n
    reviewed = {"doc.items": {"en": "{count} item(s)", "text": "{count} వస్తువులు"},
                "doc.cancelled": {"en": "Cancelled", "text": "రద్దు"}}
    monkeypatch.setattr(doc_i18n, "reviewed", lambda lang: reviewed if lang == "te" else {})
    owner, cid, bill = _retailer_with_a_three_line_bill(make_user, client)
    client.put(f"{API}/customers/{cid}/statement-language", headers=owner.headers, json={"language": "te"})
    client.post(f"{API}/bills/{bill['id']}/cancel", headers=owner.headers, json={"itemIds": []})
    page = html.unescape(client.get(f"/s/{_link(client, owner, cid)}").text)
    assert "<summary>3 వస్తువులు · రద్దు</summary>" in page and "Soap · 20 pcs · ₹500.00 (రద్దు)" in page
