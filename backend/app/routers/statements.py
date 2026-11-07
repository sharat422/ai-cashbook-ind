import html as html_mod
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import statements as svc
from ..database import get_db
from ..deps import require
from ..models import Business, StatementEvent, User
from ..notifications import WhatsAppNotConfigured, WhatsAppSendError, send_whatsapp_text
from ..rbac import DATA_VIEW, ENTRY_EDIT
from ..security import get_current_user
from ..validation import validate_date
from .customers import _owned_customer

router = APIRouter(tags=["statements"])
# Mounted at the site root: what a retailer opens in a browser, no login.
public_router = APIRouter(tags=["statements-public"])


class ConsentBody(BaseModel):
    status: Literal["opted_in", "opted_out"]
    # Opt-in must be a deliberate act: the owner confirms the retailer agreed.
    confirm: bool = False
    note: str | None = Field(default=None, max_length=300)


class ShareBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    period_from: str | None = Field(default=None, alias="from")
    via: Literal["server", "phone"] = "phone"


def _event_dto(e: StatementEvent) -> dict:
    return {"kind": e.kind, "source": e.source, "channel": e.channel, "note": e.note,
            "createdAt": e.created_at}


@router.get("/customers/{customer_id}/statement-consent")
def get_consent(
    customer_id: str,
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    customer = _owned_customer(db, business, customer_id)
    events = db.scalars(select(StatementEvent).where(
        StatementEvent.business_id == business.id, StatementEvent.customer_id == customer.id)
        .order_by(StatementEvent.created_at.desc()).limit(50)).all()
    return {**svc.consent(db, business.id, customer.id), "history": [_event_dto(e) for e in events]}


@router.post("/customers/{customer_id}/statement-consent")
def set_consent(
    customer_id: str,
    body: ConsentBody,
    business: Business = Depends(require(ENTRY_EDIT)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Record the retailer's choice (told to the owner in person or by phone)."""
    customer = _owned_customer(db, business, customer_id)
    if body.status == "opted_in" and not body.confirm:
        raise HTTPException(422, "Confirm that the retailer agreed to get statements on WhatsApp.")
    svc.log(db, business.id, customer.id, "opt_in" if body.status == "opted_in" else "opt_out",
            "owner", channel="whatsapp", note=body.note, user=user)
    db.commit()
    return svc.consent(db, business.id, customer.id)


@router.post("/customers/{customer_id}/statement-link")
def create_link(
    customer_id: str,
    body: ShareBody,
    business: Business = Depends(require(DATA_VIEW)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """A link to this retailer's statement only, for sharing any way the owner likes."""
    customer = _owned_customer(db, business, customer_id)
    start = validate_date(body.period_from) if body.period_from else None
    url = svc.new_link(db, business, customer, user, start)
    db.commit()
    return {"url": url, "expiresInDays": svc.LINK_DAYS}


@router.post("/customers/{customer_id}/statement-whatsapp")
def share_on_whatsapp(
    customer_id: str,
    body: ShareBody,
    business: Business = Depends(require(DATA_VIEW)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Send the statement link on WhatsApp — only with the retailer's opt-in.

    via='server': sent by the WhatsApp Business API. via='phone': the app opens
    WhatsApp with this message. Either way it is refused and logged without
    a current opt-in, and an opt-out stops it at once.
    """
    customer = _owned_customer(db, business, customer_id)
    if svc.consent(db, business.id, customer.id)["status"] != "opted_in":
        svc.log(db, business.id, customer.id, "blocked", "system", channel=f"whatsapp_{body.via}",
                note="No WhatsApp opt-in from this retailer", user=user)
        db.commit()
        raise HTTPException(409, f"{customer.full_name} hasn't agreed to get statements on WhatsApp. "
                                 "Ask them first, or share the link another way.")
    if not customer.mobile:
        raise HTTPException(422, "Add the retailer's mobile number first.")
    start = validate_date(body.period_from) if body.period_from else None
    url = svc.new_link(db, business, customer, user, start)
    st = svc.build(db, customer, start)
    message = (f"{business.business_name}: your statement is ready. Current balance "
               f"{svc.inr(st.current)}. Open it here (no app needed): {url}\n"
               "To stop statements on WhatsApp, open the link and tap 'Stop'.")
    if body.via == "server":
        try:
            send_whatsapp_text(customer.mobile, message)
        except WhatsAppNotConfigured:
            db.rollback()
            raise HTTPException(503, "WhatsApp sending isn't set up on the server.") from None
        except WhatsAppSendError as exc:
            db.rollback()
            raise HTTPException(502, str(exc)) from None
    svc.log(db, business.id, customer.id, "sent", "owner", channel=f"whatsapp_{body.via}", user=user)
    db.commit()
    return {"status": "sent" if body.via == "server" else "ready", "url": url,
            "message": message, "mobile": customer.mobile}


@router.get("/customers/{customer_id}/ledger.pdf")
def printable_ledger(
    customer_id: str,
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> Response:
    """Print-friendly ledger: distributor, period, page totals, period totals."""
    customer = _owned_customer(db, business, customer_id)
    start = validate_date(from_) if from_ else None
    end = validate_date(to) if to else None
    if start and end and start > end:
        raise HTTPException(422, "The start date is after the end date.")
    pdf = svc.render(business, customer, svc.build(db, customer, start, end), kind="ledger")
    return Response(pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="Ledger_{customer.id[:8]}.pdf"'})


# ------------------------------------------------------------ public (retailer)

_PUBLIC_HEADERS = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",  # the token never leaks to other sites
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
}


def _error_page(exc: HTTPException) -> HTMLResponse:
    body = (f"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>"
            f"<p style='font-family:sans-serif;padding:24px'>{html_mod.escape(str(exc.detail))}</p>")
    return HTMLResponse(body, status_code=exc.status_code, headers=_PUBLIC_HEADERS)


def _first_view(db: Session, link, business: Business, customer) -> None:
    seen = db.scalars(select(StatementEvent).where(
        StatementEvent.customer_id == customer.id, StatementEvent.kind == "viewed",
        StatementEvent.note == link.id)).first()
    if seen is None:
        svc.log(db, business.id, customer.id, "viewed", "retailer", channel="link", note=link.id)
        db.commit()


@public_router.get("/s/{token}", response_class=HTMLResponse)
def statement_page(token: str, done: str | None = None, db: Session = Depends(get_db)):
    try:
        link, business, customer = svc.resolve(db, token)
    except HTTPException as exc:
        return _error_page(exc)
    _first_view(db, link, business, customer)
    notice = {"out": "Done. You won't get statements on WhatsApp any more.",
              "in": "Done. Statements will come to you on WhatsApp."}.get(done or "")
    page = svc.page_html(business, customer, svc.build(db, customer, link.period_from),
                         svc.consent(db, business.id, customer.id)["status"], notice,
                         base=f"/s/{token}")
    return HTMLResponse(page, headers=_PUBLIC_HEADERS)


@public_router.get("/s/{token}/statement.pdf")
def statement_pdf(token: str, db: Session = Depends(get_db)):
    try:
        link, business, customer = svc.resolve(db, token)
    except HTTPException as exc:
        return _error_page(exc)
    _first_view(db, link, business, customer)
    pdf = svc.render(business, customer, svc.build(db, customer, link.period_from), kind="statement")
    return Response(pdf, media_type="application/pdf", headers={
        **_PUBLIC_HEADERS, "Content-Disposition": 'inline; filename="Statement.pdf"'})


def _retailer_choice(token: str, kind: str, db: Session, request: Request):
    try:
        _, business, customer = svc.resolve(db, token)
    except HTTPException as exc:
        return _error_page(exc)
    svc.log(db, business.id, customer.id, kind, "retailer", channel="whatsapp",
            note=f"from the statement link ({request.client.host if request.client else 'unknown'})")
    db.commit()
    return RedirectResponse(f"/s/{token}?done={'out' if kind == 'opt_out' else 'in'}",
                            status_code=303, headers=_PUBLIC_HEADERS)


@public_router.post("/s/{token}/opt-out")
def retailer_opt_out(token: str, request: Request, db: Session = Depends(get_db)):
    """The retailer stops WhatsApp statements themselves; it applies at once."""
    return _retailer_choice(token, "opt_out", db, request)


@public_router.post("/s/{token}/opt-in")
def retailer_opt_in(token: str, request: Request, db: Session = Depends(get_db)):
    return _retailer_choice(token, "opt_in", db, request)
