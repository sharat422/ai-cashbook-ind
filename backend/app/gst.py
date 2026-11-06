"""GST tax split for a sale: CGST+SGST inside the seller's state, IGST across
states — never both. Decimal throughout, rounded to the paisa (half-up).

This is GST-ready bookkeeping for the CA. Bolcash does not file returns and
does not create e-invoices.
"""
from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from fastapi import HTTPException

# Allowed rates. 5 / 18 / 40 are the slabs since 22 Sep 2025; 12 and 28 stay for
# older invoices and goods still taxed at them (e.g. tobacco); 0.25 cut diamonds,
# 3 gold/silver. ponytail: confirm this list with the CA before shipping and on
# every GST Council change — it is the only place rates are defined.
GST_RATES = {Decimal(r) for r in ("0", "0.25", "3", "5", "12", "18", "28", "40")}

# GST state codes (first two digits of a GSTIN; "place of supply" in returns).
STATE_CODES = {
    "Jammu and Kashmir": "01", "Himachal Pradesh": "02", "Punjab": "03",
    "Chandigarh": "04", "Uttarakhand": "05", "Haryana": "06", "Delhi": "07",
    "Rajasthan": "08", "Uttar Pradesh": "09", "Bihar": "10", "Sikkim": "11",
    "Arunachal Pradesh": "12", "Nagaland": "13", "Manipur": "14", "Mizoram": "15",
    "Tripura": "16", "Meghalaya": "17", "Assam": "18", "West Bengal": "19",
    "Jharkhand": "20", "Odisha": "21", "Chhattisgarh": "22", "Madhya Pradesh": "23",
    "Gujarat": "24", "Dadra and Nagar Haveli and Daman and Diu": "26",
    "Maharashtra": "27", "Karnataka": "29", "Goa": "30", "Lakshadweep": "31",
    "Kerala": "32", "Tamil Nadu": "33", "Puducherry": "34",
    "Andaman and Nicobar Islands": "35", "Telangana": "36", "Andhra Pradesh": "37",
    "Ladakh": "38", "Other Territory": "97",
}
STATE_NAMES = {code: name for name, code in STATE_CODES.items()}
_BY_LOWER_NAME = {name.lower(): code for name, code in STATE_CODES.items()}

_GSTIN_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
_HSN_RE = re.compile(r"^(\d{4}|\d{6}|\d{8})$")
_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
PAISA = Decimal("0.01")


def _q(x: Decimal) -> Decimal:
    return x.quantize(PAISA, rounding=ROUND_HALF_UP)


def _reject(msg: str) -> HTTPException:
    return HTTPException(422, msg)


def state_code(value: str | None) -> str | None:
    """A state name ("Karnataka") or code ("29") → code, else None."""
    v = (value or "").strip()
    if v in STATE_NAMES:
        return v
    return _BY_LOWER_NAME.get(v.lower())


def place_label(code: str) -> str:
    """"29-Karnataka" — the format GSTR-1 uses for place of supply."""
    return f"{code}-{STATE_NAMES.get(code, '')}"


def clean_gstin(value: str | None) -> str | None:
    """Uppercase, check format, state code and check digit; None when blank."""
    v = re.sub(r"\s", "", value or "").upper()
    if not v:
        return None
    if not _GSTIN_RE.match(v) or v[:2] not in STATE_NAMES:
        raise _reject("The GSTIN should be 15 characters, like 29ABCDE1234F1Z5.")
    total = 0
    for i, ch in enumerate(v[:14]):
        product = _CHARS.index(ch) * (2 if i % 2 else 1)
        total += product // 36 + product % 36
    if _CHARS[(36 - total % 36) % 36] != v[14]:
        raise _reject("This GSTIN has a typo — its last character doesn't match.")
    return v


def clean_hsn(value: str | None) -> str:
    v = re.sub(r"\s", "", value or "")
    if not _HSN_RE.match(v):
        raise _reject("Enter the HSN/SAC code: 4, 6 or 8 digits.")
    return v


def clean_rate(value) -> Decimal:
    try:
        rate = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise _reject("Enter a GST rate.") from None
    if rate not in GST_RATES:
        allowed = ", ".join(f"{r.normalize():f}" for r in sorted(GST_RATES))
        raise _reject(f"GST rate must be one of {allowed}%.")
    return rate


def split(amount, rate: Decimal, inclusive: bool, inter_state: bool) -> dict[str, Decimal]:
    """Tax split for one invoice.

    Exclusive: `amount` is the taxable value; tax is added on top.
    Inclusive: `amount` is what the customer pays; it is the total exactly.
    Intra-state CGST and SGST are always equal halves; IGST is zero. Inter-state
    is IGST only.
    """
    amount = _q(Decimal(str(amount)))
    rate = Decimal(rate)
    zero = Decimal("0.00")
    if inclusive:
        tax = amount * rate / (Decimal(100) + rate)
        if inter_state:
            igst, half = _q(tax), zero
        else:
            igst, half = zero, _q(tax / 2)
        taxable = amount - igst - 2 * half
    else:
        taxable = amount
        if inter_state:
            igst, half = _q(taxable * rate / 100), zero
        else:
            igst, half = zero, _q(taxable * rate / 200)
    return {
        "taxable_value": taxable,
        "cgst": half,
        "sgst": half,
        "igst": igst,
        "total": taxable + 2 * half + igst,
    }


def invoice(business, *, amount, rate, inclusive: bool, hsn: str | None,
            customer_gstin: str | None, place_of_supply: str | None) -> dict:
    """Validate the GST inputs for a sale and compute its tax.

    Place of supply: the customer's GSTIN state when they have one, else the
    state picked for an unregistered customer, else the seller's own state.
    """
    if not business.gst_registered:
        raise _reject("Turn on 'GST registered' in your business details to add GST.")
    seller = state_code(business.state)
    if seller is None:
        raise _reject("Set your business state in business details to add GST.")
    gstin = clean_gstin(customer_gstin)
    if gstin:
        pos = gstin[:2]
    elif place_of_supply:
        pos = state_code(place_of_supply)
        if pos is None:
            raise _reject("Pick the customer's state.")
    else:
        pos = seller
    rate = clean_rate(rate)
    inter = pos != seller
    return {
        "customer_gstin": gstin,
        "hsn_code": None if hsn is None else clean_hsn(hsn),  # None: preview only
        "place_of_supply": pos,
        "gst_rate": rate,
        "price_includes_gst": inclusive,
        "inter_state": inter,
        **split(amount, rate, inclusive, inter),
    }


def money(x: Decimal | None) -> str | None:
    """Exact string for the API ("1180.00")."""
    return None if x is None else f"{_q(Decimal(x)):.2f}"
