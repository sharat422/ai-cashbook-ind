"""CA + Tally test results, kept on the server so the evidence (which month,
which CA, what was re-typed) can be found later. A record only: saving one
changes no export. Owner writes; owner and accountant read."""
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..calc import IST
from ..database import get_db
from ..deps import require
from ..models import Business, CaTestResult, User
from ..rbac import DATA_VIEW, ENTRY_EDIT
from ..security import get_current_user

router = APIRouter(tags=["gst"])


class CaTestBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    tested_month: str = Field(alias="testedMonth")
    ca_name: str = Field(alias="caName", min_length=1, max_length=120)
    tally_version: str | None = Field(default=None, alias="tallyVersion", max_length=60)
    offline_tool_version: str | None = Field(default=None, alias="offlineToolVersion", max_length=60)
    records_exported: int | None = Field(default=None, alias="recordsExported", ge=0)
    records_imported: int | None = Field(default=None, alias="recordsImported", ge=0)
    fields_retyped: int = Field(alias="fieldsRetyped", ge=0)
    offline_tool_errors: int = Field(default=0, alias="offlineToolErrors", ge=0)
    discrepancy_note: str | None = Field(default=None, alias="discrepancyNote", max_length=5000)


def ca_test_dto(r: CaTestResult) -> dict:
    return {"id": r.id, "testedMonth": r.tested_month, "caName": r.ca_name, "tallyVersion": r.tally_version,
            "offlineToolVersion": r.offline_tool_version, "recordsExported": r.records_exported,
            "recordsImported": r.records_imported, "fieldsRetyped": r.fields_retyped,
            "offlineToolErrors": r.offline_tool_errors, "discrepancyNote": r.discrepancy_note,
            "testedAt": r.tested_at}


@router.post("/gst/ca-tests")
def save_ca_test(
    body: CaTestBody,
    business: Business = Depends(require(ENTRY_EDIT)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Owner: save a CA test result. Changes no export."""
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", body.tested_month):
        raise HTTPException(422, "The month must look like 2026-10.")
    if not body.ca_name.strip():
        raise HTTPException(422, "Enter the CA's name.")
    # Newest first must mean saved last: on a coarse clock (Windows) two quick saves
    # can read the same time, so each save is at least 1 µs after the previous one.
    now = datetime.now(IST)
    last = db.scalars(select(CaTestResult.tested_at).where(CaTestResult.business_id == business.id)
                      .order_by(CaTestResult.tested_at.desc())).first()
    if last and now <= datetime.fromisoformat(last):
        now = datetime.fromisoformat(last) + timedelta(microseconds=1)
    row = CaTestResult(
        business_id=business.id, tested_month=body.tested_month, ca_name=body.ca_name.strip(),
        tally_version=(body.tally_version or "").strip() or None,
        offline_tool_version=(body.offline_tool_version or "").strip() or None,
        records_exported=body.records_exported, records_imported=body.records_imported,
        fields_retyped=body.fields_retyped, offline_tool_errors=body.offline_tool_errors,
        discrepancy_note=(body.discrepancy_note or "").strip() or None,
        tested_at=now.isoformat(timespec="microseconds"), created_by=user.id)
    db.add(row)
    db.commit()
    return ca_test_dto(row)


@router.get("/gst/ca-tests")
def list_ca_tests(
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Past CA test results, newest first."""
    rows = db.scalars(select(CaTestResult).where(CaTestResult.business_id == business.id)
                      .order_by(CaTestResult.tested_at.desc(), CaTestResult.id.desc()))
    return [ca_test_dto(r) for r in rows]
