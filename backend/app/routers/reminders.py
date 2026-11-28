from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from .. import beats as beat_svc
from .. import reminders as svc
from ..database import get_db
from ..deps import check_cron_secret, get_current_membership, require
from ..models import Beat, Business, Customer, User, now_iso
from ..rbac import ENTRY_CREATE, SETTINGS_MANAGE, role_can
from ..security import get_current_user
from ..calc import today_iso
from ..validation import validate_notes

router = APIRouter(tags=["reminders"])


class RulesBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enabled: bool
    before_promise_days: int | None = Field(default=None, alias="beforePromiseDays", ge=0, le=30)
    overdue_days: int | None = Field(default=None, alias="overdueDays", ge=0, le=365)
    repeat_days: int = Field(default=7, alias="repeatDays", ge=1, le=90)
    beat_id: str | None = Field(default=None, alias="beatId")


class SentBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    customer_id: str = Field(alias="customerId")
    channel: str  # whatsapp | sms
    message: str


@router.get("/reminders/rules")
def get_rules(business: Business = Depends(require(SETTINGS_MANAGE)), db: Session = Depends(get_db)) -> dict:
    return svc.rules_dto(svc.rules(db, business))


@router.put("/reminders/rules")
def save_rules(body: RulesBody, business: Business = Depends(require(SETTINGS_MANAGE)),
               user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """Owner: who gets chased and when; `enabled` sends the automatic ones."""
    if body.beat_id and (db.get(Beat, body.beat_id) is None or db.get(Beat, body.beat_id).business_id != business.id):
        raise HTTPException(422, "Unknown beat.")
    r = svc.rules(db, business)
    if r.id is None:
        db.add(r)
    r.enabled, r.before_promise_days, r.overdue_days = body.enabled, body.before_promise_days, body.overdue_days
    r.repeat_days, r.beat_id, r.updated_by, r.updated_at = body.repeat_days, body.beat_id, user.id, now_iso()
    db.commit()
    return svc.rules_dto(r)


@router.get("/reminders/due")
def due_reminders(
    beat_id: str | None = Query(None, alias="beatId"),
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Who needs chasing today (the owner's rules), on one beat or all this
    person sees; `auto` says whether the opted-in ones go by themselves."""
    business, role = membership
    r = svc.rules(db, business)
    customers = svc.visible_customers(db, business, user, role, beat_id)
    return {"auto": bool(r.enabled), "items": svc.due(db, business, customers, r, date.fromisoformat(today_iso()))}


@router.get("/reminders")
def reminder_history(
    customer_id: str | None = Query(None, alias="customerId"),
    beat_id: str | None = Query(None, alias="beatId"),
    limit: int = Query(50, ge=1, le=200),
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """The shared history: every reminder to a retailer, automatic or sent by hand
    from any phone. Staff see the retailers on their beats."""
    business, role = membership
    if beat_svc._sees_all(role) and not beat_id:
        ids = None
    else:
        ids = [c.id for c in svc.visible_customers(db, business, user, role, beat_id)]
    if customer_id:
        if ids is not None and customer_id not in ids:
            raise HTTPException(403, "This retailer isn't on your beats.")
        ids = [customer_id]
    return svc.history(db, business, ids, limit)


@router.post("/reminders")
def record_sent(
    body: SentBody,
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """A reminder sent by hand from a phone (its WhatsApp or SMS link), for the
    shared history."""
    business, role = membership
    if not role_can(role, ENTRY_CREATE):
        raise HTTPException(403, "Your role doesn't allow this action.")
    if body.channel not in ("whatsapp", "sms"):
        raise HTTPException(422, "Channel must be whatsapp or sms.")
    c = db.get(Customer, body.customer_id)
    if c is None or c.business_id != business.id:
        raise HTTPException(404, "Customer not found.")
    if not beat_svc._sees_all(role) and c.id not in {x.id for x in svc.visible_customers(db, business, user, role, None)}:
        raise HTTPException(403, "This retailer isn't on your beats.")
    svc.record(db, business, c.id, channel=body.channel, reason="manual", status="sent",
               message=validate_notes(body.message, 2000), user=user)
    db.commit()
    return svc.history(db, business, [c.id], 1)[0]


@router.post("/cron/reminders")
def run_reminders(request: Request, db: Session = Depends(get_db)) -> dict:
    """Called by .github/workflows/reminders.yml with the cron secret: sends
    today's automatic reminders. Safe to call any time (one a day per retailer)."""
    check_cron_secret(request)
    return {"ran": svc.run(db)}
