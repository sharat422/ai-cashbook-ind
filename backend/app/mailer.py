"""Plain-text email over SMTP with STARTTLS (AC2: accountant invites).
Standard library only. Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD
and MAIL_FROM; without a host and a From address nothing is sent."""
from __future__ import annotations

import smtplib
from email.message import EmailMessage

from .config import settings


class MailNotConfigured(Exception):
    pass


def send_email(to: str, subject: str, body: str) -> None:
    if not (settings.smtp_host and settings.mail_from):
        raise MailNotConfigured()
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = settings.mail_from, to, subject
    msg.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
        smtp.starttls()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(msg)
