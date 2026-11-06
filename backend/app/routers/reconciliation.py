"""Manual UPI/bank reconciliation and the daily close. No endpoint here moves
money, collects payments or logs in to a bank; it only reads an uploaded
statement and records which line a person says matches which collection."""

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from .. import reconciliation as svc
from ..bank_statement import StatementError
from ..calc import today_iso
from ..database import get_db
from ..deps import get_current_membership, require
from ..models import Business, User
from ..rbac import DATA_VIEW, ENTRY_EDIT
from ..security import get_current_user
from ..validation import validate_date

router = APIRouter(tags=["reconciliation"])

MAX_FILE_BYTES = 5 * 1024 * 1024


class ConfirmBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    bank_line_id: str = Field(alias="bankLineId", max_length=40)
    entry_id: str = Field(alias="entryId", max_length=40)


@router.post("/reconciliation/import")
async def import_statement(
    file: UploadFile = File(...),
    business: Business = Depends(require(ENTRY_EDIT)),
    db: Session = Depends(get_db),
) -> dict:
    data = await file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(413, "The file is larger than 5 MB.")
    if not data:
        raise HTTPException(422, "The file is empty.")
    try:
        return svc.import_statement(db, business, data, file.filename or "")
    except StatementError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/reconciliation/suggestions")
def suggestions(
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    return svc.suggest(db, business)[0]


@router.post("/reconciliation/confirm")
def confirm(
    body: ConfirmBody,
    business: Business = Depends(require(ENTRY_EDIT)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return svc.confirm(db, business, user, body.bank_line_id, body.entry_id)


@router.get("/reconciliation/exceptions")
def exceptions(
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    return svc.exceptions(db, business)


@router.get("/daily-close")
def daily_close(
    beat_id: str | None = Query(None, max_length=40),
    date: str | None = Query(None),
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    business, role = membership
    day = validate_date(date) if date else today_iso()
    return svc.daily_close(db, business, user, role, beat_id or None, day)
