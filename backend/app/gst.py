"""GST tax split for a sale: CGST+SGST inside the seller's state, IGST across
states — never both. Decimal throughout, rounded to the paisa (half-up).

This is GST-ready bookkeeping for the CA. Bolcash does not file returns and
does not create e-invoices.
"""
from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from fastapi import HTTPException

# Rates in force today (GST 2.0, from 22 Sep 2025): 0, 5, 18 and 40%, plus the
# special 3% (gold, silver, jewellery) and 0.25% (rough diamonds).
CURRENT_RATES = {Decimal(r) for r in ("0", "0.25", "3", "5", "18", "40")}
# Retired slabs and the first day they no longer apply. They stay valid on
# invoices dated before that day (late entries, corrections, imports):
#   12%: folded into 5/18% from 22 Sep 2025;
#   28%: kept for tobacco and pan masala until the compensation cess ended on
#        1 Feb 2026, when those moved to 40%.
RETIRED_RATES = {Decimal("12"): "2025-09-22", Decimal("28"): "2026-02-01"}
# Every rate any invoice can carry (tests and exports).
GST_RATES = CURRENT_RATES | set(RETIRED_RATES)
# ponytail: the only place rates live — re-check on every GST Council change.

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


# GST Unique Quantity Codes (GSTN master), used in invoices and GSTR-1 table 12.
UQC = {
    "BAG": "Bags", "BAL": "Bale", "BDL": "Bundles", "BKL": "Buckles", "BOU": "Billion of units",
    "BOX": "Box", "BTL": "Bottles", "BUN": "Bunches", "CAN": "Cans", "CBM": "Cubic meters",
    "CCM": "Cubic centimeters", "CMS": "Centimeters", "CTN": "Cartons", "DOZ": "Dozens",
    "DRM": "Drums", "GGK": "Great gross", "GMS": "Grammes", "GRS": "Gross", "GYD": "Gross yards",
    "KGS": "Kilograms", "KLR": "Kilolitre", "KME": "Kilometre", "LTR": "Litres", "MLT": "Millilitre",
    "MTR": "Meters", "MTS": "Metric ton", "NOS": "Numbers", "OTH": "Others", "PAC": "Packs",
    "PCS": "Pieces", "PRS": "Pairs", "QTL": "Quintal", "ROL": "Rolls", "SET": "Sets",
    "SQF": "Square feet", "SQM": "Square meters", "SQY": "Square yards", "TBS": "Tablets",
    "TGM": "Ten gross", "THD": "Thousands", "TON": "Tonnes", "TUB": "Tubes", "UGS": "US gallons",
    "UNT": "Units", "YDS": "Yards",
}


# A catalogue unit ("bag", "kg", "pcs") as a UQC. Same table as uqcForUnit in
# src/features/gst/domain/gst.ts; change both together.
_UNIT_UQC = {
    "box": "BOX", "boxes": "BOX", "bag": "BAG", "bags": "BAG", "bottle": "BTL", "btl": "BTL", "can": "CAN",
    "carton": "CTN", "ctn": "CTN", "dozen": "DOZ", "doz": "DOZ", "kg": "KGS", "kgs": "KGS", "kilo": "KGS",
    "g": "GMS", "gm": "GMS", "gram": "GMS", "l": "LTR", "ltr": "LTR", "litre": "LTR", "liter": "LTR",
    "ml": "MLT", "m": "MTR", "mtr": "MTR", "metre": "MTR", "nos": "NOS", "no": "NOS", "pc": "PCS", "pcs": "PCS",
    "piece": "PCS", "pieces": "PCS", "pack": "PAC", "packet": "PAC", "pkt": "PAC", "pair": "PRS", "set": "SET",
    "roll": "ROL", "ton": "TON", "tonne": "TON", "quintal": "QTL", "unit": "UNT", "units": "UNT", "tube": "TUB",
}


def uqc_for_unit(unit: str | None) -> str | None:
    u = (unit or "").strip().lower().rstrip(".")
    return _UNIT_UQC.get(u) or (u.upper() if u.upper() in UQC else None)


def clean_line(quantity, uqc: str | None) -> tuple[Decimal, str]:
    """Quantity and unit of a GST invoice line — both required (Rule 46)."""
    code = (uqc or "").strip().upper()
    if code not in UQC:
        raise _reject("Pick the unit (UQC) for this invoice, e.g. BOX, PCS or KGS.")
    try:
        q = Decimal(str(quantity)).quantize(Decimal("0.001"))
    except (InvalidOperation, ValueError, TypeError):
        raise _reject("Enter the quantity sold.") from None
    if not q.is_finite() or q <= 0 or q > Decimal("10000000"):
        raise _reject("Enter the quantity sold.")
    return q, code


def clean_hsn(value: str | None) -> str:
    v = re.sub(r"\s", "", value or "")
    if not _HSN_RE.match(v):
        raise _reject("Enter the HSN/SAC code: 4, 6 or 8 digits.")
    return v


def rates_on(day: str | None) -> set[Decimal]:
    """Rates allowed on an invoice dated `day` (YYYY-MM-DD); None = today."""
    return CURRENT_RATES | {r for r, ends in RETIRED_RATES.items() if day is not None and day < ends}


def clean_rate(value, day: str | None = None) -> Decimal:
    try:
        rate = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise _reject("Enter a GST rate.") from None
    if rate in RETIRED_RATES and rate not in rates_on(day):
        raise _reject(f"{rate.normalize():f}% GST ended on {RETIRED_RATES[rate]}. Use the current rate "
                      "for this item (0, 5, 18 or 40%; 3% gold/silver; 0.25% rough diamonds).")
    if rate not in rates_on(day):
        allowed = ", ".join(f"{r.normalize():f}" for r in sorted(rates_on(day)))
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


def seller_gstin(gstin: str | None, state: str | None) -> str | None:
    """The business's own GSTIN, checked against its state (first two digits)."""
    v = clean_gstin(gstin)
    if v and state_code(state) and v[:2] != state_code(state):
        raise _reject(f"This GSTIN is registered in {STATE_NAMES[v[:2]]}, not {state}. "
                      "Check the GSTIN or the business state.")
    return v


def invoice(business, *, amount, rate, inclusive: bool, hsn: str | None,
            customer_gstin: str | None, place_of_supply: str | None,
            day: str | None = None) -> dict:
    """Validate the GST inputs for a sale and compute its tax.

    Place of supply: the customer's GSTIN state when they have one, else the
    state picked for an unregistered customer, else the seller's own state.
    """
    if not business.gst_registered:
        raise _reject("Turn on 'GST registered' in your business details to add GST.")
    if not getattr(business, "gstin", None):
        raise _reject("Add your GSTIN in business details to add GST. A GST invoice must show it.")
    seller = business.gstin[:2]
    gstin = clean_gstin(customer_gstin)
    if gstin:
        pos = gstin[:2]
    elif place_of_supply:
        pos = state_code(place_of_supply)
        if pos is None:
            raise _reject("Pick the customer's state.")
    else:
        pos = seller
    rate = clean_rate(rate, day)
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


def financial_year(day: str) -> str:
    """'2026-11-07' -> '26-27' (Indian FY, April to March)."""
    y, m = int(day[:4]), int(day[5:7])
    start = y if m >= 4 else y - 1
    return f"{start % 100:02d}-{(start + 1) % 100:02d}"


def invoice_number(fy: str, serial: int) -> str:
    """Rule 46: consecutive, unique in the FY, at most 16 characters."""
    return f"{fy}/{serial:05d}"  # '26-27/00001' — 11 characters


def money(x: Decimal | None) -> str | None:
    """Exact string for the API ("1180.00")."""
    return None if x is None else f"{_q(Decimal(x)):.2f}"
