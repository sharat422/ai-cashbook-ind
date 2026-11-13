"""ST3: every statement / ledger / bill file share goes through ONE function,
share_statement_pdf — WhatsApp (and the open share sheet, which reaches
WhatsApp) only with the retailer's opt-in; email and save always; every share
in the log. Server-made PDFs open only with the link it issues, and the app has
one function (sharePdf.ts) that calls it before any file leaves the phone."""

import ast
import re
from pathlib import Path

from app.database import SessionLocal
from app.models import StatementEvent
from test_schemes import _bill, _item
from test_statements import API, _shop

ROOT = Path(__file__).resolve().parents[2]
NO_CONSENT = "No consent — ask the retailer to opt in."


def _consent(client, owner, cid, status):
    r = client.post(f"{API}/customers/{cid}/statement-consent", headers=owner.headers,
                    json={"status": status, "confirm": status == "opted_in"})
    assert r.status_code == 200, r.text


def _share(client, owner, cid, channel, document="statement"):
    return client.post(f"{API}/customers/{cid}/pdf-share", headers=owner.headers,
                       json={"document": document, "channel": channel})


def _log(cid):
    with SessionLocal() as db:
        return [(e.kind, e.channel, e.note, e.created_by, e.created_at) for e in db.query(StatementEvent)
                .filter_by(customer_id=cid).order_by(StatementEvent.created_at, StatementEvent.id)]


def test_a_pdf_to_whatsapp_for_an_opted_out_retailer_is_refused_and_logged(make_user, client):
    owner = make_user()
    cid = _shop(client, owner, "Ravi Stores", [("credit", 500, 3)])
    _consent(client, owner, cid, "opted_out")
    for channel in ("whatsapp", "share_sheet"):  # the open share sheet reaches WhatsApp too
        r = _share(client, owner, cid, channel)
        assert r.status_code == 409 and r.json()["detail"] == NO_CONSENT
    refusals = [e for e in _log(cid) if e[0] == "blocked"]
    assert [(k, ch) for k, ch, *_ in refusals] == [("blocked", "pdf_whatsapp"), ("blocked", "pdf_share_sheet")]
    assert all(note.endswith(NO_CONSENT) and note.startswith("Statement PDF") for _, _, note, *_ in refusals)
    # A bill is the same door.
    soap = _item(client, owner.headers, "Soap", price=25)
    bill = _bill(client, owner.headers, cid, [(soap, 2)]).json()
    r = client.post(f"{API}/bills/{bill['id']}/share", headers=owner.headers, json={"channel": "whatsapp"})
    assert r.status_code == 409 and r.json()["detail"] == NO_CONSENT


def test_the_same_pdf_by_email_or_save_is_logged_and_allowed(make_user, client):
    owner = make_user()
    cid = _shop(client, owner, "Ravi Stores", [("credit", 500, 3)])
    _consent(client, owner, cid, "opted_out")
    assert _share(client, owner, cid, "email").status_code == 200
    r = _share(client, owner, cid, "save", document="ledger")
    assert r.status_code == 200 and r.json()["pdfUrl"].startswith(f"/customers/{cid}/ledger.pdf?share=")
    assert client.get(f"{API}{r.json()['pdfUrl']}", headers=owner.headers).status_code == 200
    shared = [e for e in _log(cid) if e[0] == "shared"]
    assert [(ch, note.split(" ")[0]) for _, ch, note, *_ in shared] == [("pdf_email", "Statement"),
                                                                        ("pdf_save", "Printable")]
    assert all(by and at for *_, by, at in shared)  # who and when
    # Opted in: WhatsApp goes too, and is logged the same way.
    _consent(client, owner, cid, "opted_in")
    assert _share(client, owner, cid, "whatsapp").status_code == 200
    assert _log(cid)[-1][:2] == ("shared", "pdf_whatsapp")
    assert _share(client, owner, cid, "telegram").status_code == 422  # only the known channels


def test_no_path_from_a_statement_or_bill_pdf_to_a_share_skips_the_check(make_user, client):
    owner = make_user()
    cid = _shop(client, owner, "Ravi Stores", [("credit", 500, 3)])
    other = _shop(client, owner, "Lakshmi Kirana", [("credit", 90, 1)])
    soap = _item(client, owner.headers, "Soap", price=25)
    bill = _bill(client, owner.headers, cid, [(soap, 2)]).json()
    # 1. Server: the ledger and bill PDFs open only with a link from the check.
    assert client.get(f"{API}/customers/{cid}/ledger.pdf", headers=owner.headers).status_code == 403
    assert client.get(f"{API}/bills/{bill['id']}.pdf", headers=owner.headers).status_code == 403
    theirs = _share(client, owner, other, "save", document="ledger").json()["pdfUrl"]
    assert client.get(f"{API}{theirs.replace(other, cid)}", headers=owner.headers).status_code == 403
    assert {e[1] for e in _log(cid) if e[0] == "blocked"} >= {"ledger_pdf", "bill_pdf"}
    # ...and nothing but share_statement_pdf issues such a link.
    minted = []
    for path in (ROOT / "backend" / "app").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for fn in ast.walk(tree):
            if isinstance(fn, ast.FunctionDef):
                for node in ast.walk(fn):
                    if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "_pdf_token":
                        minted.append((path.name, fn.name))
    assert set(minted) == {("statements.py", "share_statement_pdf"), ("statements.py", "pdf_token_ok")}
    # 2. App: the only file that makes a statement / ledger / bill file AND hands
    #    a file to a share target is sharePdf.ts, and it asks the server first.
    makes = re.compile(r"buildStatementHtml\(|statementToCsv\(|ledger\.pdf|\.pdf\?share|Bill_\$\{")
    shares = re.compile(r"Share\.open\(|Share\.shareSingle\(|downloadAndShare\(|downloadFile\(")
    both = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "src").rglob("*.ts*")
                  if ".test." not in p.name
                  and makes.search(t := p.read_text(encoding="utf-8")) and shares.search(t))
    assert both == ["src/features/customers/presentation/sharePdf.ts"], both
    gate = (ROOT / "src/features/customers/presentation/sharePdf.ts").read_text(encoding="utf-8")
    body = gate[gate.index("export async function sharePdf"):]
    first_check = min(body.index("schemesRemote.shareBill"), body.index("statementsRemote.pdfShare"))
    assert first_check < body.index("makeFile(doc") < body.index("deliver(file")
