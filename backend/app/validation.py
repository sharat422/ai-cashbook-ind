"""Server-side input validation — the authoritative gate.

The mobile app validates too (for fast feedback), but the client is never
trusted: every amount and phone number that reaches the API is re-checked here
so a bad or malicious payload (a negative amount, a 12-digit "phone", NaN from a
crafted request) can never be persisted. Failures raise HTTP 422 with a plain,
human message the app surfaces directly.

Kept in sync with the client rules in src/utils/validation.ts and the income/
expense domain validators.
"""

import math
import re

from fastapi import HTTPException, status

# ₹1 crore — mirrors the client cap; a single entry above this is almost always
# a typo (extra zeros) rather than a real transaction.
MAX_AMOUNT = 10_000_000

# Indian mobile: 10 digits starting 6-9 (matches validateMobile on the client).
_MOBILE_RE = re.compile(r"^[6-9]\d{9}$")


def _reject(message: str) -> "HTTPException":
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, message)


def validate_amount(amount: float, field: str = "Amount") -> float:
    """Return the amount if it's a sane positive money value, else raise 422."""
    if amount is None or math.isnan(amount) or math.isinf(amount):
        raise _reject(f"{field} is required.")
    if amount <= 0:
        raise _reject(f"{field} must be greater than ₹0.")
    if amount > MAX_AMOUNT:
        raise _reject(f"{field} looks too large — please check and try again.")
    return amount


def normalize_mobile(mobile: str | None) -> str:
    """Reduce a phone number to its 10 national digits.

    Strips spaces/dashes/brackets, then drops a leading +91 country code or a
    trunk '0' so pasted formats ('+91 98765-43210', '098765 43210') normalize to
    the bare 10-digit number the rest of the system stores.
    """
    digits = re.sub(r"\D", "", mobile or "")
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits


def validate_mobile(
    mobile: str | None,
    *,
    required: bool = True,
    field: str = "Mobile number",
) -> str:
    """Return the normalized 10-digit mobile, or raise 422.

    When `required` is False an empty value is allowed (e.g. a customer created
    by name only via voice entry), but a *provided* value must still be valid.
    """
    digits = normalize_mobile(mobile)
    if not digits:
        if required:
            raise _reject(f"{field} is required.")
        return ""
    if not _MOBILE_RE.match(digits):
        raise _reject(f"Enter a valid 10-digit {field.lower()}.")
    return digits
