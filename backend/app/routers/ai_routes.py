import base64
import json

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from datetime import datetime, timezone

from ..ai import categorize_text, parse_transaction, scan_receipt
from ..database import get_db
from ..deps import require
from ..rbac import ENTRY_CREATE
from ..models import AiDecision, Business

router = APIRouter(tags=["ai"])


class CategorizeBody(BaseModel):
    text: str


class ParseTransactionBody(BaseModel):
    text: str
    # Client's local date (YYYY-MM-DD); defaults to server UTC today.
    today: str | None = None


@router.post("/parse-transaction")
def parse_transaction_route(
    body: ParseTransactionBody,
    business: Business = Depends(require(ENTRY_CREATE)),
    db: Session = Depends(get_db),
) -> dict:
    """Turn a spoken/typed sentence (any of several Indian languages) into a
    structured transaction: {customer_name, type, amount, category, date}."""
    today = body.today or datetime.now(timezone.utc).date().isoformat()
    result = parse_transaction(body.text, today)

    db.add(AiDecision(
        business_id=business.id,
        kind="voice_transaction",
        input_text=body.text,
        output_json=json.dumps(result),
        confidence=result.get("confidence"),
    ))
    db.commit()
    return result


@router.post("/categorize")
def categorize(
    body: CategorizeBody,
    business: Business = Depends(require(ENTRY_CREATE)),
    db: Session = Depends(get_db),
) -> dict:
    category, confidence = categorize_text(body.text)
    result = {"category": category, "confidence": confidence}

    db.add(AiDecision(
        business_id=business.id,
        kind="categorization",
        input_text=body.text,
        output_json=json.dumps(result),
        confidence=confidence,
    ))
    db.commit()
    return result


@router.post("/receipts/scan")
def scan(
    receipt: UploadFile = File(...),
    business: Business = Depends(require(ENTRY_CREATE)),
    db: Session = Depends(get_db),
) -> dict:
    raw = receipt.file.read()
    image_b64 = base64.b64encode(raw).decode("ascii")
    media_type = receipt.content_type or "image/jpeg"

    result = scan_receipt(image_b64, media_type)

    db.add(AiDecision(
        business_id=business.id,
        kind="receipt_scan",
        input_text=receipt.filename,
        output_json=json.dumps(result),
        confidence=None,
    ))
    db.commit()
    return result
