import logging
import secrets
import time
import threading
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import get_current_membership
from ..models import Business, BusinessMember, User
from ..security import create_access_token, get_current_user
from ..serializers import business_dto
from ..validation import validate_mobile

log = logging.getLogger("cashbook.auth")
router = APIRouter(tags=["auth"])

# In-memory OTP store (dev). Swap for Redis + a real SMS provider in production.
_OTP_STORE: dict[str, dict] = {}
_OTP_LOCK = threading.Lock()
OTP_TTL_SECONDS = 300
OTP_MAX_ATTEMPTS = 5
# This development implementation is process-local. Production requests fail
# closed until a shared challenge store and SMS provider are installed.



class RequestOtpInput(BaseModel):
    mobile: str


class VerifyOtpInput(BaseModel):
    verificationId: str = Field(min_length=1, max_length=80)
    mobile: str = Field(min_length=1, max_length=30)
    otp: str = Field(pattern=r"^\d{6}$")


class CreateBusinessInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    businessName: str = Field(min_length=1, max_length=200)
    ownerName: str = Field(min_length=1, max_length=200)
    businessType: str = Field(min_length=1, max_length=60)
    state: str = Field(min_length=1, max_length=80)
    gstRegistered: bool = False


@router.post("/auth/otp/request")
def request_otp(body: RequestOtpInput) -> dict:
    mobile = validate_mobile(body.mobile)  # reject malformed numbers up front
    if not settings.debug:
        raise HTTPException(503, "SMS authentication is not configured. Contact support.")
    verification_id = f"otp-{uuid.uuid4().hex}"
    otp = f"{secrets.randbelow(1_000_000):06d}"
    now = time.monotonic()
    with _OTP_LOCK:
        expired = [key for key, record in _OTP_STORE.items() if record["expires"] <= now]
        for key in expired:
            del _OTP_STORE[key]
        if sum(r["mobile"] == mobile for r in _OTP_STORE.values()) >= 5:
            raise HTTPException(429, "Too many OTP requests. Try again in five minutes.")
        if len(_OTP_STORE) >= 10000:
            raise HTTPException(429, "Please try again later.")
        _OTP_STORE[verification_id] = {"mobile": mobile, "otp": otp,
                                       "expires": now + OTP_TTL_SECONDS, "attempts": 0}
    return {"verificationId": verification_id, "mobile": mobile}


@router.post("/auth/otp/verify")
def verify_otp(body: VerifyOtpInput, db: Session = Depends(get_db)) -> dict:
    mobile = validate_mobile(body.mobile)  # normalize + validate before lookup
    if not settings.debug:
        raise HTTPException(503, "SMS authentication is not configured. Contact support.")
    with _OTP_LOCK:
        record = _OTP_STORE.get(body.verificationId)
        if (record is None or record["mobile"] != mobile
                or record["expires"] <= time.monotonic()
                or record["attempts"] >= OTP_MAX_ATTEMPTS):
            raise HTTPException(400, "Invalid or expired OTP. Request a new code.")
        record["attempts"] += 1
        master_ok = settings.debug and secrets.compare_digest(body.otp, settings.master_otp)
        if not master_ok and not secrets.compare_digest(record["otp"], body.otp):
            raise HTTPException(400, "Invalid OTP. Please try again.")
        del _OTP_STORE[body.verificationId]

    user = db.scalars(select(User).where(User.mobile == mobile)).first()
    if user is None:
        user = User(mobile=mobile)
        db.add(user)
        db.commit()
        db.refresh(user)

    token = create_access_token(user.id)
    return {"token": token, "user": {"id": user.id, "mobile": user.mobile}}


@router.post("/businesses")
def create_business(
    body: CreateBusinessInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    # The app is single-business per user. If one already exists (e.g. a
    # returning user who briefly landed on onboarding before /businesses/me
    # resolved), return it instead of creating a duplicate that would split
    # their data across two businesses.
    existing = db.scalars(
        select(Business).where(Business.user_id == user.id)
    ).first()
    if existing is not None:
        return business_dto(existing)

    business = Business(
        user_id=user.id,
        business_name=body.businessName,
        owner_name=body.ownerName,
        business_type=body.businessType,
        state=body.state,
        gst_registered=body.gstRegistered,
    )
    db.add(business)
    db.flush()  # assign business.id before creating the membership
    # Seed the creator as the owner member — the basis of RBAC.
    db.add(
        BusinessMember(
            business_id=business.id, user_id=user.id, role="owner", status="active"
        )
    )
    db.commit()
    db.refresh(business)
    return business_dto(business)


@router.get("/businesses/me")
def my_business(
    membership: tuple[Business, str] = Depends(get_current_membership),
) -> dict:
    business, role = membership
    # The caller's role drives client-side UI gating (server still enforces).
    return {**business_dto(business), "role": role}
