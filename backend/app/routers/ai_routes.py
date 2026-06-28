import base64
import json

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..ai import categorize_text, scan_receipt
from ..database import get_db
from ..deps import get_current_business
from ..models import AiDecision, Business

router = APIRouter(tags=["ai"])


class CategorizeBody(BaseModel):
    text: str


@router.post("/categorize")
def categorize(
    body: CategorizeBody,
    business: Business = Depends(get_current_business),
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
    business: Business = Depends(get_current_business),
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
