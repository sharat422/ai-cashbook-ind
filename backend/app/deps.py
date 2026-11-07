import re

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .consent import PURPOSE_AI
from .database import get_db
from .models import AccessLog, Business, BusinessMember, User, UserConsent
from .rbac import READ_ONLY_ROLES, SELF_SERVICE_WRITES, role_can
from .security import get_current_user


def consent_granted(db: Session, user_id: str, purpose: str) -> bool:
    """True only if the user has explicitly granted this consent purpose."""
    row = db.scalars(
        select(UserConsent).where(
            UserConsent.user_id == user_id, UserConsent.purpose == purpose
        )
    ).first()
    return bool(row and row.granted)


def ai_consent_granted(db: Session, user_id: str) -> bool:
    """True only if the user has explicitly granted AI-processing consent.

    This is the gate that keeps a user's data from ever being sent to an
    external AI provider without opt-in — no consent, no scraping.
    """
    return consent_granted(db, user_id, PURPOSE_AI)


def require_ai_consent(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Dependency for AI endpoints: 403 unless the caller has opted in to AI
    processing. Use on every route that sends user data to an AI model."""
    if not ai_consent_granted(db, user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "AI processing is turned off for your account. Turn on "
                "'AI processing for insights' in Settings to use AI features — "
                "your data is never sent to AI without your consent."
            ),
        )


REVOKED_HEADER = {"X-Bolcash-Access": "revoked"}


def _revoked() -> HTTPException:
    # The app sees the header and signs out of that business at once.
    return HTTPException(status.HTTP_403_FORBIDDEN,
                         "The owner has removed your access to this business.",
                         headers=REVOKED_HEADER)


def _resolve_membership(db: Session, user: User, business_id: str | None = None) -> tuple[Business, str]:
    """Return (business, role) for the business this request is about.

    The app sends `X-Business-Id` (a CA can be assigned to several
    businesses); access is only ever through an *active* membership of that
    business, re-read on every request, so a revoked member is refused on
    their very next call. Without the header: the first active membership
    (older app versions). Falls back to a legacy owner-by-user_id business.
    """
    q = select(BusinessMember).where(
        BusinessMember.user_id == user.id, BusinessMember.status == "active")
    if business_id:
        q = q.where(BusinessMember.business_id == business_id)
    member = db.scalars(q.order_by(BusinessMember.created_at.asc())).first()
    if member is not None:
        business = db.get(Business, member.business_id)
        if business is not None:
            return business, member.role

    legacy_q = select(Business).where(Business.user_id == user.id)
    if business_id:
        legacy_q = legacy_q.where(Business.id == business_id)
    legacy = db.scalars(legacy_q).first()
    if legacy is not None:
        return legacy, "owner"

    revoked_q = select(BusinessMember).where(
        BusinessMember.user_id == user.id, BusinessMember.status == "revoked")
    if business_id:
        revoked_q = revoked_q.where(BusinessMember.business_id == business_id)
    if db.scalars(revoked_q).first() is not None:
        raise _revoked()
    if business_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have access to this business.")
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="No business found. Complete onboarding first.",
    )


# Accountant calls that are app housekeeping, not "viewing the books".
_HOUSEKEEPING = ("/api/v1/businesses/me", "/api/v1/me/", "/api/v1/notifications",
                 "/api/v1/consents", "/api/v1/auth/", "/api/v1/chatbot/history")
_EXPORT = re.compile(r"export|\.xlsx|\.pdf|\.csv|tally|gstr|backup|download", re.I)


def mark_for_audit(request: Request | None, business: Business, user: User, role: str) -> None:
    """Flag an accountant's request; `write_audit` logs it once the response
    status is known (so a refused call is one "denied" row, not a "view")."""
    if role == "accountant" and request is not None:
        request.state.audit = {"business_id": business.id, "user_id": user.id, "mobile": user.mobile}


def write_audit(db: Session, request: Request, status_code: int) -> None:
    pending = getattr(request.state, "audit", None)
    path = request.url.path
    if not pending or path.startswith(_HOUSEKEEPING):
        return
    if status_code == 403:
        action = "denied"
    elif request.method == "GET" and status_code < 400:
        action = "export" if _EXPORT.search(path) else "view"
    elif path == "/api/v1/chatbot/ask" and status_code < 400:
        action = "view"  # a question to Ask AI reads the books
    else:
        return
    query = f"?{request.url.query}" if request.url.query else ""
    db.add(AccessLog(**pending, action=action, method=request.method, path=(path + query)[:300]))
    db.commit()


def get_current_membership(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_business_id: str | None = Header(default=None, max_length=40),
) -> tuple[Business, str]:
    """The business this request is about plus the caller's role in it."""
    business, role = _resolve_membership(db, user, x_business_id)
    mark_for_audit(request, business, user, role)
    if (role in READ_ONLY_ROLES and request.method not in ("GET", "HEAD", "OPTIONS")
            and (request.method, request.url.path) not in SELF_SERVICE_WRITES):
        # Read-only means read-only on every route, including any that only
        # check the role inside the handler (or forget to).
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role is read-only.")
    return business, role


def get_current_business(
    membership: tuple[Business, str] = Depends(get_current_membership),
) -> Business:
    """Resolve the active business for the authenticated user (any role)."""
    return membership[0]


def require(*permissions: str):
    """Dependency factory: allow the request only if the caller's role grants
    every listed permission, else 403. Returns the active Business so gated
    endpoints can use it exactly like `get_current_business`.
    """

    def _dep(
        membership: tuple[Business, str] = Depends(get_current_membership),
    ) -> Business:
        business, role = membership
        if not all(role_can(role, p) for p in permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your role doesn't allow this action.",
            )
        return business

    return _dep
