import hashlib
import hmac
import html as html_mod
import json
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import doc_i18n, link_limits
from .. import statement_send as sending
from .. import statements as svc
from ..database import get_db
from ..deps import require
from ..models import Beat, Business, Customer, StatementEvent, StatementLink, StatementSchedule, User
from ..calc import today_iso
from ..config import settings
from ..notifications import WhatsAppNotConfigured, WhatsAppSendError
from ..rbac import DATA_VIEW, ENTRY_EDIT, SETTINGS_MANAGE
from ..security import get_current_user
from ..validation import normalize_mobile, validate_date
from .customers import _owned_customer

router = APIRouter(tags=["statements"])
# Mounted at the site root: what a retailer opens in a browser, no login.
public_router = APIRouter(tags=["statements-public"])


class ConsentBody(BaseModel):
    status: Literal["opted_in", "opted_out"]
    # Opt-in must be a deliberate act: the owner confirms the retailer agreed.
    confirm: bool = False
    note: str | None = Field(default=None, max_length=300)


class PdfShareBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    document: Literal["statement", "statement_csv", "ledger"]
    channel: str
    period_from: str | None = Field(default=None, alias="from")
    to: str | None = None
    detailed: bool = False  # the printable ledger with each bill's lines (ST6)


class ShareBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    period_from: str | None = Field(default=None, alias="from")
    via: Literal["server", "phone"] = "phone"
    detailed: bool = False  # this link's PDF prints each bill's lines (ST6)


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
    return {**svc.consent(db, business.id, customer.id), "history": [_event_dto(e) for e in events],
            "language": customer.statement_language,
            "defaultLanguage": business.statement_language or doc_i18n.DEFAULT_LANGUAGE}


class LanguageBody(BaseModel):
    language: str | None = None  # None (customer) = use the business default


def _language(value: str | None) -> str | None:
    if value is not None and value not in doc_i18n.LANGUAGES:
        raise HTTPException(422, f"Pick one of: {', '.join(doc_i18n.LANGUAGES)}.")
    return value


@router.put("/customers/{customer_id}/statement-language")
def set_customer_language(
    customer_id: str,
    body: LanguageBody,
    business: Business = Depends(require(ENTRY_EDIT)),
    db: Session = Depends(get_db),
) -> dict:
    """The language of this retailer's statement link, PDF and printed ledger."""
    customer = _owned_customer(db, business, customer_id)
    customer.statement_language = _language(body.language)
    db.commit()
    return {"language": customer.statement_language,
            "effective": doc_i18n.language_of(business, customer)}


@router.get("/statement-language")
def get_business_language(business: Business = Depends(require(DATA_VIEW))) -> dict:
    return {"language": business.statement_language or doc_i18n.DEFAULT_LANGUAGE}


@router.put("/statement-language")
def set_business_language(
    body: LanguageBody,
    business: Business = Depends(require(SETTINGS_MANAGE)),
    db: Session = Depends(get_db),
) -> dict:
    """Owner: the default for retailers without their own (Telugu first)."""
    business.statement_language = _language(body.language) or doc_i18n.DEFAULT_LANGUAGE
    db.commit()
    return {"language": business.statement_language}


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
    svc.record_consent(db, business.id, customer.id, "opt_in" if body.status == "opted_in" else "opt_out",
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
    url = svc.new_link(db, business, customer, user, start, body.detailed)
    db.commit()
    return {"url": url, "expiresInDays": svc.LINK_DAYS}


def _link_dto(link, limited_at: str | None = None) -> dict:
    return {"id": link.id, "createdAt": link.created_at, "expiresAt": link.expires_at,
            "revokedAt": link.revoked_at, "periodFrom": link.period_from, "status": svc.link_status(link),
            "limitedAt": limited_at}


@router.get("/customers/{customer_id}/statement-links")
def list_links(
    customer_id: str,
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """This retailer's statement links, newest first: live, expired or revoked."""
    customer = _owned_customer(db, business, customer_id)
    links = db.scalars(select(StatementLink).where(StatementLink.business_id == business.id,
                                                   StatementLink.customer_id == customer.id)
                       .order_by(StatementLink.created_at.desc()).limit(20)).all()
    limited: dict[str, str] = {}  # link id -> its latest rate-limit hit (ST8)
    for e in db.scalars(select(StatementEvent).where(
            StatementEvent.customer_id == customer.id, StatementEvent.kind == "rate_limited")
            .order_by(StatementEvent.created_at)):
        for x in links:
            if x.id in (e.note or ""):
                limited[x.id] = e.created_at
    return [_link_dto(x, limited.get(x.id)) for x in links]


@router.post("/statements/{link}/revoke")
def revoke_link(
    link: str,
    business: Business = Depends(require(ENTRY_EDIT)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Owner: close a statement link before its 30 days — by its id (the app)
    or its token (from the URL). It answers "This link has been revoked" from
    then on. Already revoked: 422 — send a fresh link instead."""
    row = db.get(StatementLink, link) or svc.link_by_token(db, link)
    if row is None or row.business_id != business.id:
        raise HTTPException(404, "Link not found")
    svc.revoke(db, row, user)
    db.commit()
    return _link_dto(row)


@router.post("/customers/{customer_id}/statement-whatsapp")
def share_on_whatsapp(
    customer_id: str,
    body: ShareBody,
    business: Business = Depends(require(DATA_VIEW)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Send the statement link on WhatsApp — only with the retailer's opt-in.

    via='server': sent by the WhatsApp Business API with the approved UTILITY
    template and its four variables — never free text (Meta refuses free text
    outside the 24-hour window, 131026). Template not APPROVED, or Meta refuses
    the send: logged as a refusal with the reason, and the reply is the phone
    fallback (`fallback: true`). via='phone': the app opens WhatsApp on the
    owner's phone with this message — the owner sends it, not the server.
    Either way it is refused and logged without a current opt-in, and an
    opt-out stops it at once.
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
    url = svc.new_link(db, business, customer, user, start, body.detailed)
    st = svc.build(db, customer, start)
    if body.via == "server":
        name = settings.whatsapp_statement_template
        status = sending.template_status(name)
        refused = None
        if status != "APPROVED":
            refused = f"Server send off: template '{name or '-'}' is {status}"
        else:
            # The template's own words; the server only fills its four variables.
            try:
                sending.send_template(db, business, customer, user, start, url=url)
                db.commit()
                return {"status": "sent", "template": name, "url": url, "mobile": customer.mobile}
            except (WhatsAppSendError, WhatsAppNotConfigured) as exc:
                code = getattr(exc, "code", None)
                refused = f"WhatsApp refused{f' ({code})' if code else ''}: {getattr(exc, 'reason', str(exc))}"
        # Never dropped: the refusal is logged, and the owner's phone sends it instead.
        svc.log(db, business.id, customer.id, "blocked", "system", channel="whatsapp_server", note=refused, user=user)
    message = (f"{business.business_name}: your statement is ready. Current balance "
               f"{svc.inr(st.current)}. Open it here (no app needed): {url}\n"
               "To stop statements on WhatsApp, open the link and tap 'Stop'.")
    svc.log(db, business.id, customer.id, "sent", "owner", channel="whatsapp_phone", user=user)
    db.commit()
    out = {"status": "ready", "url": url, "message": message, "mobile": customer.mobile}
    return out | ({"fallback": True, "reason": refused} if body.via == "server" else {})


@router.post("/customers/{customer_id}/pdf-share")
def share_pdf(
    customer_id: str,
    body: PdfShareBody,
    business: Business = Depends(require(DATA_VIEW)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Before the app shares a statement (PDF or CSV, made on the phone) or the
    printable ledger: the consent check and the log (svc.share_statement_pdf).
    The ledger comes back as a link only this check issues."""
    customer = _owned_customer(db, business, customer_id)
    start = validate_date(body.period_from) if body.period_from else None
    end = validate_date(body.to) if body.to else None
    period = f" {start or 'start'} to {end or today_iso()}"
    what = {"statement": "Statement PDF", "statement_csv": "Statement CSV",
            "ledger": "Printable ledger PDF"}[body.document] + period
    token = svc.share_statement_pdf(db, business, customer, body.channel, user, what,
                                    subject=f"ledger:{customer.id}" if body.document == "ledger" else None)
    url = None
    if token:
        url = f"/customers/{customer.id}/ledger.pdf?share={token}" + \
            (f"&from={start}" if start else "") + (f"&to={end}" if end else "") + \
            ("&detailed=1" if body.detailed else "")
    return {"status": "ok", "channel": body.channel, "mobile": customer.mobile, "pdfUrl": url}


# --------------------------------------------------- bulk statements (ST7)

class BulkBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    beat_id: str | None = Field(default=None, alias="beatId")
    period_from: str | None = Field(default=None, alias="from")


def _beat(db: Session, business: Business, beat_id: str | None) -> str | None:
    if beat_id:
        beat = db.get(Beat, beat_id)
        if beat is None or beat.business_id != business.id:
            raise HTTPException(404, "Beat not found")
    return beat_id


@router.get("/statements/bulk/preview")
def bulk_preview(
    beat_id: str | None = Query(None, alias="beatId"),
    business: Business = Depends(require(SETTINGS_MANAGE)),
    db: Session = Depends(get_db),
) -> dict:
    """Owner: who a bulk send would reach now, and what would stop it."""
    customers = sending.retailers(db, business, _beat(db, business, beat_id))
    return sending.preview(db, business, customers, sending.ist_now())


@router.post("/statements/bulk")
def bulk_send(
    body: BulkBody,
    business: Business = Depends(require(SETTINGS_MANAGE)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Owner: send every opted-in retailer (or a beat's) their statement now,
    with the template, 1 a day, 9–8 IST, stopping above 10% failures."""
    start = validate_date(body.period_from) if body.period_from else None
    customers = sending.retailers(db, business, _beat(db, business, body.beat_id))
    return sending.bulk(db, business, user, customers, start=start, now=sending.ist_now())


class ScheduleBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enabled: bool
    day: int = Field(default=1, ge=1, le=28)
    hour: int = Field(default=10, ge=9, le=19)
    beat_id: str | None = Field(default=None, alias="beatId")


def _schedule_dto(s: StatementSchedule | None) -> dict:
    if s is None:
        return {"enabled": False, "day": 1, "hour": 10, "beatId": None, "lastRunMonth": None, "lastResult": None}
    return {"enabled": s.enabled, "day": s.day, "hour": s.hour, "beatId": s.beat_id,
            "lastRunMonth": s.last_run_month, "lastResult": json.loads(s.last_result) if s.last_result else None}


@router.get("/statements/schedule")
def get_schedule(business: Business = Depends(require(SETTINGS_MANAGE)), db: Session = Depends(get_db)) -> dict:
    return _schedule_dto(db.scalars(select(StatementSchedule).where(
        StatementSchedule.business_id == business.id)).first())


@router.put("/statements/schedule")
def set_schedule(
    body: ScheduleBody,
    business: Business = Depends(require(SETTINGS_MANAGE)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Owner: the monthly send — e.g. 1st of the month, 10 a.m. IST; off in one call."""
    s = db.scalars(select(StatementSchedule).where(StatementSchedule.business_id == business.id)).first()
    if s is None:
        s = StatementSchedule(business_id=business.id)
        db.add(s)
    s.enabled, s.day, s.hour = body.enabled, body.day, body.hour
    s.beat_id = _beat(db, business, body.beat_id)
    s.updated_by, s.updated_at = user.id, sending.ist_now().isoformat()
    db.commit()
    return _schedule_dto(s)


@router.post("/cron/statement-schedules")
def run_statement_schedules(request: Request, db: Session = Depends(get_db)) -> dict:
    """Called hourly by .github/workflows/statement-schedules.yml with the cron
    secret. Runs the monthly sends that are due; safe to call any time."""
    secret = settings.cron_secret
    if not secret or not hmac.compare_digest(request.headers.get("X-Cron-Secret", ""), secret):
        raise HTTPException(403, "Wrong cron secret.")
    return {"ran": sending.run_schedules(db)}


@router.get("/customers/{customer_id}/ledger.pdf")
def printable_ledger(
    customer_id: str,
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    share: str | None = Query(None),
    detailed: bool = Query(False),
    business: Business = Depends(require(DATA_VIEW)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Print-friendly ledger: distributor, period, page totals, period totals —
    only with the link from POST …/pdf-share (consent-checked, logged)."""
    customer = _owned_customer(db, business, customer_id)
    if not svc.pdf_token_ok(f"ledger:{customer.id}", share):
        svc.log(db, business.id, customer.id, "blocked", "system", channel="ledger_pdf",
                note="Ledger PDF asked for without the consent-checked share", user=user)
        db.commit()
        raise HTTPException(403, "Share the ledger from the statement screen: it checks the retailer's consent first.")
    start = validate_date(from_) if from_ else None
    end = validate_date(to) if to else None
    if start and end and start > end:
        raise HTTPException(422, "The start date is after the end date.")
    lang = doc_i18n.language_of(business, customer)  # the same language as their statement
    pdf = svc.render(business, customer, svc.build(db, customer, start, end, t=doc_i18n.translator(lang)),
                     kind="ledger", lang=lang, detailed=detailed)
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


def _limited(request: Request, db: Session, token: str) -> HTMLResponse | None:
    """ST8: over the per-IP or per-link rate -> 429 "Too many requests — try
    again later". A link that was never opened still opens (the limit never
    blocks a first open). The first request over a limit in its window is
    logged on that retailer's statement log (IP, link, time) and in the server
    log; the ones after it aren't, so a bot can't flood the log."""
    link = svc.link_by_token(db, token)
    ip = link_limits.client_ip(request)
    over = link_limits.hit(ip, link.id if link else None)
    if over is None:
        return None
    which, count, limit = over
    if link is not None and db.scalar(select(StatementEvent.id).where(
            StatementEvent.customer_id == link.customer_id, StatementEvent.kind == "viewed",
            StatementEvent.note == link.id)) is None:
        return None
    per = "a minute from one IP" if which == "IP" else "an hour on one link"
    if count == limit + 1:
        wa_log.warning("statement link rate limit: %s requests %s, IP %s, link %s",
                       limit, per, ip, link.id if link else "(unknown token)")
        if link is not None:
            svc.log(db, link.business_id, link.customer_id, "rate_limited", "system", channel="link",
                    note=f"Too many requests ({limit} {per}) from IP {ip} on link {link.id}")
            db.commit()
    page = _error_page(HTTPException(429, "Too many requests — try again later."))
    page.headers["Retry-After"] = str(link_limits.PER_IP[1] if which == "IP" else link_limits.PER_LINK[1])
    return page


def _first_view(db: Session, link, business: Business, customer) -> None:
    seen = db.scalars(select(StatementEvent).where(
        StatementEvent.customer_id == customer.id, StatementEvent.kind == "viewed",
        StatementEvent.note == link.id)).first()
    if seen is None:
        svc.log(db, business.id, customer.id, "viewed", "retailer", channel="link", note=link.id)
        db.commit()


@public_router.get("/s/{token}", response_class=HTMLResponse)
def statement_page(token: str, request: Request, done: str | None = None, db: Session = Depends(get_db)):
    if (limited := _limited(request, db, token)) is not None:
        return limited
    try:
        link, business, customer = svc.resolve(db, token)
    except HTTPException as exc:
        return _error_page(exc)
    _first_view(db, link, business, customer)
    lang = doc_i18n.language_of(business, customer)
    t = doc_i18n.translator(lang)
    notice = t("doc.doneIn") if done == "in" else None
    page = svc.page_html(business, customer, svc.build(db, customer, link.period_from, t=t),
                         svc.consent(db, business.id, customer.id)["status"], notice,
                         base=f"/s/{token}", lang=lang)
    return HTMLResponse(page, headers=_PUBLIC_HEADERS)


@public_router.get("/s/{token}/statement.pdf")
def statement_pdf(token: str, request: Request, db: Session = Depends(get_db)):
    if (limited := _limited(request, db, token)) is not None:
        return limited
    try:
        link, business, customer = svc.resolve(db, token)
    except HTTPException as exc:
        return _error_page(exc)
    _first_view(db, link, business, customer)
    lang = doc_i18n.language_of(business, customer)
    pdf = svc.render(business, customer, svc.build(db, customer, link.period_from, t=doc_i18n.translator(lang)),
                     kind="statement", lang=lang, detailed=link.detailed)
    return Response(pdf, media_type="application/pdf", headers={
        **_PUBLIC_HEADERS, "Content-Disposition": 'inline; filename="Statement.pdf"'})


def _retailer_choice(token: str, kind: str, db: Session, request: Request):
    if (limited := _limited(request, db, token)) is not None:
        return limited
    try:
        _, business, customer = svc.resolve(db, token)
    except HTTPException as exc:
        return _error_page(exc)
    svc.record_consent(db, business.id, customer.id, kind, "retailer", channel="whatsapp",
                       note=f"from the statement link ({request.client.host if request.client else 'unknown'})")
    db.commit()
    if kind == "opt_out":  # this link is revoked with the rest now: say so here, once
        t = doc_i18n.translator(doc_i18n.language_of(business, customer))
        return _error_page(HTTPException(200, t("doc.doneOut", business=business.business_name)))
    return RedirectResponse(f"/s/{token}?done=in", status_code=303, headers=_PUBLIC_HEADERS)


@public_router.post("/s/{token}/opt-out")
def retailer_opt_out(token: str, request: Request, db: Session = Depends(get_db)):
    """The retailer stops WhatsApp statements themselves; it applies at once."""
    return _retailer_choice(token, "opt_out", db, request)


@public_router.post("/s/{token}/opt-in")
def retailer_opt_in(token: str, request: Request, db: Session = Depends(get_db)):
    return _retailer_choice(token, "opt_in", db, request)


# ------------------------------- WhatsApp webhook: statuses (ST1), replies (ST2)
# Meta calls ONE URL per app for both, so one handler.

STOP_WORDS = {"stop", "band karo", "mat bhejo", "unsubscribe", "stop please"}
wa_log = logging.getLogger("cashbook.whatsapp")


def _is_stop(text: str) -> bool:
    """Trimmed, lower-cased, spaces collapsed; a trailing '.' or '!' is ignored."""
    return " ".join(text.lower().split()).strip(" .!") in STOP_WORDS


def _seen(db: Session, message_id: str, kind: str | None = None) -> bool:
    q = select(StatementEvent.id).where(StatementEvent.message_id == message_id)
    return db.scalar(q.where(StatementEvent.kind == kind) if kind else q) is not None


def _statement_to(db: Session, sender: str, replied_to: str | None) -> StatementEvent | None:
    """The server-sent statement this message answers: the one it quotes
    (WhatsApp's reply context), else the latest one sent to that number.
    All distributors send from the one Bolcash number, so the number alone
    can't say which distributor; the latest send is the best guess."""
    if replied_to:
        ev = db.scalars(select(StatementEvent).where(StatementEvent.message_id == replied_to,
                                                     StatementEvent.kind == "sent")).first()
        if ev is not None:
            return ev
    return db.scalars(
        select(StatementEvent).join(Customer, Customer.id == StatementEvent.customer_id)
        .where(StatementEvent.kind == "sent", StatementEvent.channel == "whatsapp_server",
               Customer.mobile == normalize_mobile(sender))
        .order_by(StatementEvent.created_at.desc())).first()


@router.get("/whatsapp/inbound")
def whatsapp_verify(mode: str = Query("", alias="hub.mode"), token: str = Query("", alias="hub.verify_token"),
                    challenge: str = Query("", alias="hub.challenge")) -> Response:
    """Meta's subscribe check."""
    ok = mode == "subscribe" and settings.whatsapp_verify_token and \
        hmac.compare_digest(token, settings.whatsapp_verify_token)
    if not ok:
        wa_log.warning("WhatsApp webhook verify refused")
        raise HTTPException(403, "Wrong verify token.")
    return Response(challenge, media_type="text/plain")


@router.post("/whatsapp/inbound")
async def whatsapp_inbound(request: Request, db: Session = Depends(get_db)) -> dict:
    """Everything Meta sends us, signed with the app secret (anything else: 403,
    logged).

    - Statuses of server-sent statements: 'delivered' is logged; 'failed'
      (e.g. 131026) is logged as a refusal with Meta's reason.
    - Replies: STOP (or band karo / mat bhejo / unsubscribe / stop please)
      opts the retailer out for that distributor, logged with their words —
      and nothing is sent back. Any other reply is logged and left alone: no
      auto-answer, no consent change.
    Meta retries deliveries, so each message id is acted on once."""
    raw = await request.body()
    want = "sha256=" + hmac.new(settings.whatsapp_app_secret.encode(), raw, hashlib.sha256).hexdigest()
    if not settings.whatsapp_app_secret or not hmac.compare_digest(
            request.headers.get("X-Hub-Signature-256", ""), want):
        wa_log.warning("WhatsApp webhook: unverified request from %s refused",
                       request.client.host if request.client else "?")
        raise HTTPException(403, "Bad signature.")
    payload = json.loads(raw or b"{}")
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for s in value.get("statuses", []):
                _status(db, s)
            for m in value.get("messages", []):
                _reply(db, m)
    db.commit()
    return {"ok": True}


def _status(db: Session, s: dict) -> None:
    sent = db.scalars(select(StatementEvent).where(StatementEvent.message_id == s.get("id"),
                                                   StatementEvent.kind == "sent")).first()
    if sent is None or s.get("status") not in ("delivered", "failed"):
        return
    kind = "delivered" if s["status"] == "delivered" else "blocked"
    if _seen(db, sent.message_id, kind):
        return
    err = (s.get("errors") or [{}])[0]
    why = (err.get("error_data") or {}).get("details") or err.get("message") or err.get("title")
    note = (f"Delivered ({sent.note})" if kind == "delivered"
            else f"WhatsApp refused ({err.get('code', '?')}): {why or 'no reason given'}")
    svc.log(db, sent.business_id, sent.customer_id, kind, "system", channel="whatsapp_server",
            note=note, message_id=sent.message_id)


def _reply(db: Session, m: dict) -> None:
    mid = m.get("id")
    if not mid or _seen(db, mid):
        return  # a retry of a message already handled
    text = ((m.get("text") or {}).get("body") or (m.get("button") or {}).get("text") or "").strip()
    stmt = _statement_to(db, m.get("from", ""), (m.get("context") or {}).get("id"))
    if stmt is None:
        wa_log.info("WhatsApp reply from a number we never sent a statement to: ignored")
        return
    if _is_stop(text):
        svc.record_consent(db, stmt.business_id, stmt.customer_id, "opt_out", "retailer", channel="whatsapp_reply",
                           note=f'Replied "{text[:100]}" on WhatsApp', message_id=mid)
    else:
        svc.log(db, stmt.business_id, stmt.customer_id, "inbound", "retailer", channel="whatsapp_reply",
                note=text[:300] or f"({m.get('type', 'message')})", message_id=mid)
