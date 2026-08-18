from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..deps import get_current_business
from ..models import Business
from ..notifications import (
    WhatsAppNotConfigured,
    WhatsAppSendError,
    send_whatsapp_text,
    whatsapp_configured,
)

router = APIRouter(tags=["notifications"])


class WhatsAppSendBody(BaseModel):
    to: str
    message: str


@router.get("/notifications/whatsapp/status")
def whatsapp_status(business: Business = Depends(get_current_business)) -> dict:
    """Lets the app confirm whether the server can deliver via WhatsApp."""
    return {"configured": whatsapp_configured()}


@router.post("/notifications/whatsapp")
def send_whatsapp(
    body: WhatsAppSendBody,
    business: Business = Depends(get_current_business),
) -> dict:
    """Forward a message to WhatsApp Business Cloud API using the server token.

    Returns 503 when WhatsApp isn't configured (the app treats this as the
    channel being unavailable and falls back to the in-app inbox), and 502 when
    the upstream WhatsApp API rejects the send.
    """
    try:
        result = send_whatsapp_text(body.to, body.message)
    except WhatsAppNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        )
    except WhatsAppSendError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        )
    return {"status": "sent", "provider_response": result}
