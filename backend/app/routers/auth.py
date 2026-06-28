import logging
import random
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import get_current_business
from ..models import Business, User
from ..security import create_access_token, get_current_user
from ..serializers import business_dto

log = logging.getLogger("cashbook.auth")
router = APIRouter(tags=["auth"])

# In-memory OTP store (dev). Swap for Redis + a real SMS provider in production.
_OTP_STORE: dict[str, dict] = {}


class RequestOtpInput(BaseModel):
    mobile: str


class VerifyOtpInput(BaseModel):
    verificationId: str
    mobile: str
    otp: str


class CreateBusinessInput(BaseModel):
    businessName: str
    ownerName: str
    businessType: str
    state: str
    gstRegistered: bool = False


@router.post("/auth/otp/request")
def request_otp(body: RequestOtpInput) -> dict:
    verification_id = f"otp-{uuid.uuid4().hex}"
    otp = f"{random.randint(0, 999999):06d}"
    _OTP_STORE[verification_id] = {"mobile": body.mobile, "otp": otp}
    if settings.debug:
        log.info("OTP for %s -> %s (verificationId=%s)", body.mobile, otp, verification_id)
    # TODO: send `otp` via SMS provider here.
    return {"verificationId": verification_id, "mobile": body.mobile}


@router.post("/auth/otp/verify")
def verify_otp(body: VerifyOtpInput, db: Session = Depends(get_db)) -> dict:
    record = _OTP_STORE.get(body.verificationId)
    master_ok = settings.debug and body.otp == settings.master_otp
    if not master_ok:
        if record is None or record["otp"] != body.otp or record["mobile"] != body.mobile:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid OTP. Please try again.",
            )
    _OTP_STORE.pop(body.verificationId, None)

    user = db.scalars(select(User).where(User.mobile == body.mobile)).first()
    if user is None:
        user = User(mobile=body.mobile)
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
    business = Business(
        user_id=user.id,
        business_name=body.businessName,
        owner_name=body.ownerName,
        business_type=body.businessType,
        state=body.state,
        gst_registered=body.gstRegistered,
    )
    db.add(business)
    db.commit()
    db.refresh(business)
    return business_dto(business)


@router.get("/businesses/me")
def my_business(business: Business = Depends(get_current_business)) -> dict:
    return business_dto(business)
