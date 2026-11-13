import hashlib
import hmac
import html as html_mod
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from openpyxl import Workbook

from .. import gst_reports as gr
from .. import mailer
from ..config import settings
from ..database import get_db
from ..deps import get_current_membership, require
from ..beats import end_all_for_member
from ..calc import IST
from ..errors import AppError
from ..models import AccessLog, Business, BusinessMember, Customer, TeamInvite, User, now_iso
from ..rbac import TEAM_MANAGE, ROLES
from ..security import get_current_user
from ..validation import validate_date

router = APIRouter(tags=["team"])
# The page an email invite's link opens (/invite/<token>): no login, no business data.
public_router = APIRouter(tags=["team-invite-public"])
INVITE_DAYS = 7
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AddMemberBody(BaseModel):
    mobile: str
    role: str  # accountant | staff | owner
    name: str | None = Field(default=None, max_length=60)


class UpdateRoleBody(BaseModel):
    role: str | None = None
    name: str | None = Field(default=None, max_length=60)  # "" clears it


def _name(value: str | None) -> str | None:
    v = " ".join((value or "").split())
    return v[:60] or None


def _member_dto(m: BusinessMember, user: User | None, self_user_id: str) -> dict:
    return {
        "user_id": m.user_id,
        "name": m.display_name,
        "mobile": user.mobile if user else m.invited_by_mobile,
        "role": m.role,
        "status": m.status,
        "is_self": m.user_id == self_user_id,
        "created_at": m.created_at,
    }


def _members(db: Session, business_id: str) -> list[BusinessMember]:
    return db.scalars(
        select(BusinessMember)
        .where(BusinessMember.business_id == business_id, BusinessMember.status != "revoked")
        .order_by(BusinessMember.created_at.asc())
    ).all()


def _active_owner_count(db: Session, business_id: str) -> int:
    """Number of *active* owners. Inactive owner rows (invited-but-never-joined,
    soft-removed) must NOT count toward the last-owner guard — otherwise a
    lingering inactive owner lets the sole active owner be demoted/removed,
    leaving the business with zero owners who can actually manage it."""
    return sum(
        1
        for m in _members(db, business_id)
        if m.role == "owner" and m.status == "active"
    )


def _is_last_active_owner(db: Session, business_id: str, member: BusinessMember) -> bool:
    """True if removing/demoting `member` would drop the business to zero active
    owners — i.e. it is itself an active owner and the only one left."""
    return (
        member.role == "owner"
        and member.status == "active"
        and _active_owner_count(db, business_id) <= 1
    )


@router.get("/team")
def list_team(
    business: Business = Depends(require(TEAM_MANAGE)),
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    rows = _members(db, business.id)
    out = []
    for m in rows:
        user = db.get(User, m.user_id)
        out.append(_member_dto(m, user, current.id))
    return out


def _check_role(role: str) -> None:
    if role not in ROLES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Role must be one of {', '.join(ROLES)}")


def _grant(db: Session, business: Business, user: User, role: str, name: str | None,
           invited_by_mobile: str | None) -> BusinessMember:
    """The one way a person joins a business, whatever channel invited them."""
    existing = db.scalars(
        select(BusinessMember).where(
            BusinessMember.business_id == business.id,
            BusinessMember.user_id == user.id,
        )
    ).first()
    if existing is not None:
        existing.role = role  # already a member → update their role
        existing.status = "active"  # re-inviting someone whose access was removed
        if name is not None:
            existing.display_name = _name(name)
        return existing
    member = BusinessMember(business_id=business.id, user_id=user.id, role=role, status="active",
                            invited_by_mobile=invited_by_mobile, display_name=_name(name))
    db.add(member)
    return member


def _sender(db: Session, business: Business, user: User) -> str:
    role = db.scalars(select(BusinessMember.role).where(
        BusinessMember.business_id == business.id, BusinessMember.user_id == user.id)).first() or "owner"
    return f"{role} · {user.mobile}"[:60]


@router.post("/team")
def add_member(
    body: AddMemberBody,
    business: Business = Depends(require(TEAM_MANAGE)),
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    mobile = body.mobile.strip()
    if not mobile:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Mobile is required")
    _check_role(body.role)

    # Find or create the invitee's identity by mobile (they gain access on their
    # next OTP login — mirrors verify_otp's reuse-by-mobile behaviour).
    user = db.scalars(select(User).where(User.mobile == mobile)).first()
    if user is None:
        user = User(mobile=mobile)
        db.add(user)
        db.flush()

    member = _grant(db, business, user, body.role, body.name, mobile)
    # The invite log (AC2): a phone invite is accepted the moment it's made.
    now = now_iso()
    db.add(TeamInvite(business_id=business.id, channel="phone", mobile=mobile, role=body.role,
                      display_name=_name(body.name), sent_by_user_id=current.id,
                      sent_by=_sender(db, business, current), accepted_at=now, accepted_user_id=user.id))
    db.commit()
    db.refresh(member)
    return _member_dto(member, user, current.id)


# ------------------------------------------------------------ email invites (AC2)

def _invite_token(invite: TeamInvite) -> str:
    """The link holds the invite id and its expiry, signed — never business data."""
    exp = int(datetime.fromisoformat(invite.expires_at).timestamp())
    mac = hmac.new(settings.jwt_secret.encode(), f"invite:{invite.id}:{exp}".encode(), hashlib.sha256)
    return f"{invite.id}.{exp}.{mac.hexdigest()[:32]}"


def _invite_from_token(db: Session, token: str) -> TeamInvite | None:
    invite_id, _, rest = (token or "").partition(".")
    exp, _, mac = rest.partition(".")
    invite = db.get(TeamInvite, invite_id) if invite_id and exp.isdigit() else None
    if invite is None or invite.channel != "email" or not invite.expires_at:
        return None
    return invite if hmac.compare_digest(_invite_token(invite), token) else None


def _invite_status(invite: TeamInvite) -> str:
    if invite.accepted_at:
        return "accepted"
    if invite.superseded_at:
        return "replaced"
    if invite.expires_at and datetime.fromisoformat(invite.expires_at) < datetime.now(timezone.utc):
        return "expired"
    return "pending"


def _invite_dto(invite: TeamInvite) -> dict:
    return {"id": invite.id, "channel": invite.channel, "to": invite.email if invite.channel == "email" else invite.mobile,
            "role": invite.role, "name": invite.display_name, "sentBy": invite.sent_by, "sentAt": invite.created_at,
            "expiresAt": invite.expires_at, "acceptedAt": invite.accepted_at, "status": _invite_status(invite)}


def _send_invite(db: Session, business: Business, current: User, email: str, role: str,
                 name: str | None) -> TeamInvite:
    """A new link (7 days, one use). Any pending invite to the same address is
    replaced, so only the newest link works. Nothing is saved if it can't be sent."""
    now = datetime.now(timezone.utc)
    for old in db.scalars(select(TeamInvite).where(
            TeamInvite.business_id == business.id, TeamInvite.channel == "email",
            TeamInvite.accepted_at.is_(None), TeamInvite.superseded_at.is_(None))):
        if (old.email or "").lower() == email.lower():
            old.superseded_at = now.isoformat()
    invite = TeamInvite(business_id=business.id, channel="email", email=email, role=role, display_name=_name(name),
                        sent_by_user_id=current.id, sent_by=_sender(db, business, current),
                        created_at=now.isoformat(), expires_at=(now + timedelta(days=INVITE_DAYS)).isoformat())
    db.add(invite)
    db.flush()
    link = f"{settings.public_base_url.rstrip('/')}/invite/{_invite_token(invite)}"
    until = datetime.fromisoformat(invite.expires_at).astimezone(IST).strftime("%d %b %Y")
    try:
        mailer.send_email(email, f"{business.business_name} invited you to Bolcash", (
            f"{business.business_name} has invited you to their books on Bolcash as {role}.\n\n"
            f"1. Install Bolcash on your phone and log in with your own mobile number.\n"
            f"2. Open this link on that phone: {link}\n\n"
            f"The link works once, until {until}. If you weren't expecting this, ignore this email."))
    except mailer.MailNotConfigured:
        db.rollback()
        raise AppError(503, "email_unavailable", "Email isn't set up on this server yet. Invite by mobile number instead.")
    except OSError:  # smtplib errors are OSErrors
        db.rollback()
        raise AppError(502, "email_failed", "The invite email couldn't be sent. Check the address and try again.")
    db.commit()
    return invite


class EmailInviteBody(BaseModel):
    email: str = Field(max_length=254)
    role: str
    name: str | None = Field(default=None, max_length=60)


@router.post("/team/invites/email")
def invite_by_email(
    body: EmailInviteBody,
    business: Business = Depends(require(TEAM_MANAGE)),  # owner only
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """The same invite as by mobile, delivered by email: for a CA who works by email."""
    email = body.email.strip()
    if not EMAIL.match(email):
        raise AppError(422, "email_invalid", "Enter a valid email address.")
    _check_role(body.role)
    return _invite_dto(_send_invite(db, business, current, email, body.role, body.name))


@router.post("/team/invites/{invite_id}/resend")
def resend_invite(
    invite_id: str,
    business: Business = Depends(require(TEAM_MANAGE)),
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """A new link; the old one stops working."""
    old = db.get(TeamInvite, invite_id)
    if old is None or old.business_id != business.id or old.channel != "email":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found")
    if old.accepted_at:
        raise AppError(409, "invite_used", "This invite was already accepted.")
    return _invite_dto(_send_invite(db, business, current, old.email or "", old.role, old.display_name))


@router.get("/team/invites")
def list_invites(
    business: Business = Depends(require(TEAM_MANAGE)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """The invite log: channel, to whom, who sent it, when, and what became of it."""
    rows = db.scalars(select(TeamInvite).where(TeamInvite.business_id == business.id)
                      .order_by(TeamInvite.created_at.desc()).limit(200)).all()
    return [_invite_dto(r) for r in rows]


class AcceptBody(BaseModel):
    token: str = Field(min_length=1, max_length=200)


@router.post("/team/invites/accept")
def accept_invite(
    body: AcceptBody,
    current: User = Depends(get_current_user),  # any signed-in person: they may have no business yet
    db: Session = Depends(get_db),
) -> dict:
    """Opened from the email link in the app: the same membership as a phone invite."""
    invite = _invite_from_token(db, body.token.strip())
    if invite is None:
        raise AppError(404, "invite_invalid", "This invite link isn't valid. Ask for a new one.")
    if invite.accepted_at:
        raise AppError(409, "invite_used", "This invite was already accepted.")
    if invite.superseded_at:
        raise AppError(410, "invite_replaced", "A newer invite was sent; use the link in the latest email.")
    if _invite_status(invite) == "expired":
        raise AppError(410, "invite_expired", "This invite has expired. Ask for a new one.")
    business = db.get(Business, invite.business_id)
    already = db.scalars(select(BusinessMember).where(
        BusinessMember.business_id == business.id, BusinessMember.user_id == current.id,
        BusinessMember.status == "active")).first()
    if already is not None:  # never change the role of someone already on the team (e.g. the owner)
        raise AppError(409, "invite_already_member", "You're already on this team.")
    _grant(db, business, current, invite.role, invite.display_name, None)
    invite.accepted_at, invite.accepted_user_id = now_iso(), current.id
    db.commit()
    return {"businessId": business.id, "businessName": business.business_name, "role": invite.role}


_PAGE_HEADERS = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow",
                 "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"}


@public_router.get("/invite/{token}", response_class=HTMLResponse)
def invite_page(token: str) -> HTMLResponse:
    """What the email link opens. It names no business and checks nothing (it
    gives nothing away); the app checks the invite when it's opened there."""
    t = html_mod.escape(token, quote=True)
    body = f"""<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Bolcash invite</title>
<style>body{{font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;line-height:1.5}}
a.b{{display:inline-block;background:#0f766e;color:#fff;padding:.75rem 1.25rem;border-radius:.5rem;text-decoration:none}}</style></head>
<body><h1>You've been invited to Bolcash</h1>
<ol><li>Install Bolcash and log in with your own mobile number.</li>
<li>On that phone, tap <a class=b href="bolcash://invite/{t}">Open in Bolcash</a></li></ol>
<p>Or, in Bolcash: <b>Settings → Join with an invite</b> (or <b>Join with an invite</b> on the first screen), and paste this page's link.</p>
<p>The invite works once and expires 7 days after it was sent.</p></body></html>"""
    return HTMLResponse(body, headers=_PAGE_HEADERS)


def _owned_member(db: Session, business_id: str, user_id: str) -> BusinessMember:
    member = db.scalars(
        select(BusinessMember).where(
            BusinessMember.business_id == business_id,
            BusinessMember.user_id == user_id,
        )
    ).first()
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    return member


@router.patch("/team/{user_id}")
def update_member_role(
    user_id: str,
    body: UpdateRoleBody,
    business: Business = Depends(require(TEAM_MANAGE)),
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    # Last write wins, by decision (IM3): team settings (a member's role and name) are settings the owner changes rarely,
    # from one phone; a version check would only add conflicts. Beats differ (two
    # owners reorder one beat's shops at once) and carry a version. Don't "fix" this.
    member = _owned_member(db, business.id, user_id)
    if body.name is not None:
        member.display_name = _name(body.name)
    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Role must be one of {', '.join(ROLES)}",
            )
        # Guard: don't let the last active owner demote themselves and lock the
        # business out (inactive owner rows don't count — see _active_owner_count).
        if body.role != "owner" and _is_last_active_owner(db, business.id, member):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "This is the only owner — promote someone else to owner first.",
            )
        member.role = body.role
    db.commit()
    db.refresh(member)
    return _member_dto(member, db.get(User, member.user_id), current.id)


@router.delete("/team/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    user_id: str,
    business: Business = Depends(require(TEAM_MANAGE)),
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    member = _owned_member(db, business.id, user_id)
    if _is_last_active_owner(db, business.id, member):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Can't remove the only owner. Assign another owner first.",
        )
    # Kept as "revoked", not deleted: their next call is refused with a clear
    # "access removed" (not "set up a business"), and their audit trail stays.
    member.status = "revoked"
    end_all_for_member(db, business, user_id)  # their past visits stay in history
    db.commit()


_AREAS = (
    (re.compile(r"/customers/[^/]+/(ledger|statement)"), "ledger"),
    (re.compile(r"/(statements|customer-aging|ageing|khata)"), "ageing"),
    (re.compile(r"/customers"), "customers"),
    (re.compile(r"/(daily-close|reconciliation)"), "dailyClose"),
    (re.compile(r"/gst"), "gst"),
    (re.compile(r"/(reports|transactions|incomes|expenses)"), "reports"),
    (re.compile(r"/(dashboard|daily-summary|summary)"), "dashboard"),
    (re.compile(r"/account/"), "export"),
    (re.compile(r"/chatbot/"), "assistant"),
)
_CUSTOMER_ID = re.compile(r"/customers/([0-9a-f]{32})")


# What an accountant's export was, for the owner's alert (AC4).
_EXPORT_KIND = (
    (re.compile(r"tally"), "tally"),
    (re.compile(r"gstr1"), "gstr1"),
    (re.compile(r"gstr3b"), "gstr3b"),
    (re.compile(r"itc-review"), "itc"),
    (re.compile(r"/account/export"), "data"),
    (re.compile(r"balances"), "balances"),
    (re.compile(r"ledger|statement"), "statement"),
    (re.compile(r"/reports/"), "report"),
)


def _ist_day_start(day: str) -> str:
    """The UTC instant an IST calendar day starts, in the log's own format."""
    d = datetime.fromisoformat(day).replace(tzinfo=IST)
    return d.astimezone(timezone.utc).isoformat()


def _activity(db: Session, business: Business, user_id: str | None, start: str | None, end: str | None,
              limit: int) -> list[dict]:
    """The accountant audit log, newest first, times in IST; `start`/`end` are IST
    days, both included. The screen, the API and the Excel export all use this."""
    q = select(AccessLog).where(AccessLog.business_id == business.id,
                                AccessLog.action.in_(("view", "export", "denied")))
    if user_id:
        q = q.where(AccessLog.user_id == user_id)
    if start:
        q = q.where(AccessLog.created_at >= _ist_day_start(validate_date(start)))
    if end:
        after = (datetime.fromisoformat(validate_date(end)) + timedelta(days=1)).date().isoformat()
        q = q.where(AccessLog.created_at < _ist_day_start(after))
    rows = db.scalars(q.order_by(AccessLog.created_at.desc()).limit(limit)).all()
    ids = {m.group(1) for r in rows if (m := _CUSTOMER_ID.search(r.path))}
    names = dict(db.execute(select(Customer.id, Customer.full_name).where(
        Customer.business_id == business.id, Customer.id.in_(ids))).all()) if ids else {}
    names_by_user = dict(db.execute(select(BusinessMember.user_id, BusinessMember.display_name).where(
        BusinessMember.business_id == business.id)).all())
    out = []
    for r in rows:
        m = _CUSTOMER_ID.search(r.path)
        out.append({
            "at": r.created_at,
            "atIst": datetime.fromisoformat(r.created_at).astimezone(IST).strftime("%d %b %Y, %I:%M %p IST"),
            "mobile": r.mobile,
            "name": names_by_user.get(r.user_id),
            "userId": r.user_id,
            "action": r.action,
            "area": next((a for rx, a in _AREAS if rx.search(r.path)), "other"),
            "customer": names.get(m.group(1)) if m else None,
            "path": r.path,
            "detail": r.detail,  # AC7: Ask AI: the question and the figures the answer used
        })
    return out


@router.get("/team/activity")
def accountant_activity(
    user_id: str | None = None,
    start: str | None = Query(None, alias="from"),
    end: str | None = Query(None, alias="to"),
    limit: int = Query(300, ge=1, le=1000),
    business: Business = Depends(require(TEAM_MANAGE)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Owner: what accountants viewed and exported, newest first, times in IST.
    The last 300 by default; `from`/`to` (IST days) narrow it (AC4). Kept for ever."""
    return _activity(db, business, user_id, start, end, limit)


@router.get("/team/activity.xlsx")
def accountant_activity_excel(
    user_id: str | None = None,
    start: str | None = Query(None, alias="from"),
    end: str | None = Query(None, alias="to"),
    business: Business = Depends(require(TEAM_MANAGE)),
    db: Session = Depends(get_db),
) -> Response:
    """The filtered log as Excel (AC4): the same query as the screen, up to 1,000 rows."""
    rows = _activity(db, business, user_id, start, end, 1000)
    wb = Workbook()
    gr._sheet(wb, "Accountant activity", ["Date and time (IST)", "Person", "Mobile", "Action", "What", "Customer",
                                          "Business", "Detail"],
              [[r["atIst"], r["name"] or "", r["mobile"], r["action"], r["area"], r["customer"] or "",
                business.business_name, r["detail"] or ""] for r in rows])
    name = f"accountant_activity_{start or 'start'}_{end or 'today'}.xlsx"
    return Response(gr._save(wb), media_type=gr.XLSX,
                    headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})


@router.get("/team/export-alerts")
def export_alerts(
    business: Business = Depends(require(TEAM_MANAGE)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Accountant exports an owner hasn't opened yet (AC4): a notice on the home
    screen, not a permission; the export already happened."""
    rows = db.scalars(select(AccessLog).where(
        AccessLog.business_id == business.id, AccessLog.action == "export", AccessLog.seen_at.is_(None))
        .order_by(AccessLog.created_at.desc()).limit(50)).all()
    names = dict(db.execute(select(BusinessMember.user_id, BusinessMember.display_name).where(
        BusinessMember.business_id == business.id)).all())
    return [{"id": r.id, "at": r.created_at, "name": names.get(r.user_id), "mobile": r.mobile,
             "what": next((k for rx, k in _EXPORT_KIND if rx.search(r.path)), "other")} for r in rows]


@router.post("/team/export-alerts/seen")
def export_alerts_seen(
    business: Business = Depends(require(TEAM_MANAGE)),
    db: Session = Depends(get_db),
) -> dict:
    """The owner opened the alert: it clears (the log rows stay, for ever)."""
    rows = db.scalars(select(AccessLog).where(
        AccessLog.business_id == business.id, AccessLog.action == "export", AccessLog.seen_at.is_(None))).all()
    now = now_iso()
    for r in rows:
        r.seen_at = now
    db.commit()
    return {"cleared": len(rows)}
