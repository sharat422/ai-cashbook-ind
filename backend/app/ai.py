"""AI integrations.

Provider split mirrors the mobile app's architecture (an explicit project
decision): OpenAI GPT for expense categorization and khata insights, Anthropic
Claude for receipt OCR/extraction. API keys live here on the server only.

Every function degrades gracefully to a deterministic heuristic when the
relevant key is unset or the provider call fails, so the endpoints always
return a usable 200 and the app stays functional offline of a provider.
"""

import json
import logging

from .config import settings

log = logging.getLogger("cashbook.ai")

# Must stay in sync with the app's AI_CATEGORIES / EXPENSE_CATEGORIES.
AI_CATEGORIES = [
    "Rent", "Salary", "Food", "Travel", "Fuel",
    "Inventory", "Utilities", "Marketing", "Miscellaneous",
]
RECEIPT_CATEGORIES = [
    "Rent", "Salary", "Fuel", "Food", "Travel", "Utilities", "Miscellaneous",
]

_KEYWORDS = {
    "Fuel": ["fuel", "petrol", "diesel", "hp ", "indian oil", "bharat petroleum"],
    "Food": ["restaurant", "cafe", "food", "swiggy", "zomato", "hotel", "tea"],
    "Travel": ["uber", "ola", "travel", "flight", "irctc", "train", "bus", "cab"],
    "Rent": ["rent", "lease"],
    "Salary": ["salary", "wages", "payroll", "stipend"],
    "Utilities": ["electricity", "water", "gas bill", "internet", "broadband", "mobile", "recharge"],
    "Marketing": ["ad", "advertis", "marketing", "facebook", "google ads", "promo"],
    "Inventory": ["stock", "inventory", "purchase", "raw material", "supplier", "wholesale"],
}


def _heuristic_category(text: str) -> tuple[str, float]:
    low = (text or "").lower()
    for category, words in _KEYWORDS.items():
        if any(w in low for w in words):
            if category in AI_CATEGORIES:
                return category, 0.55
    return "Miscellaneous", 0.3


# ---------------------------------------------------------------------------
# OpenAI — categorization
# ---------------------------------------------------------------------------
def categorize_text(text: str) -> tuple[str, float]:
    """Return (category, confidence in [0,1]) for a receipt/expense description."""
    if not settings.openai_api_key:
        return _heuristic_category(text)

    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.openai_api_key)
        prompt = (
            "You classify an Indian SMB business expense into exactly one "
            f"category from this list: {', '.join(AI_CATEGORIES)}.\n"
            "Respond as JSON: {\"category\": <one of the list>, "
            "\"confidence\": <0..1>}.\n\n"
            f"Expense text: {text}"
        )
        resp = client.chat.completions.create(
            model=settings.openai_model,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        category = data.get("category", "Miscellaneous")
        if category not in AI_CATEGORIES:
            category = "Miscellaneous"
        confidence = float(data.get("confidence", 0.7))
        return category, max(0.0, min(1.0, confidence))
    except Exception as exc:  # noqa: BLE001 — provider errors fall back gracefully
        log.warning("OpenAI categorize failed, using heuristic: %s", exc)
        return _heuristic_category(text)


# ---------------------------------------------------------------------------
# OpenAI — natural-language / voice transaction parsing (multilingual)
# ---------------------------------------------------------------------------
# Indian number words (Hinglish/Hindi) for the offline fallback parser.
_NUM_WORDS = {
    "ek": 1, "do": 2, "teen": 3, "tin": 3, "char": 4, "chaar": 4,
    "paanch": 5, "panch": 5, "che": 6, "chhe": 6, "cheh": 6,
    "saat": 7, "aath": 8, "nau": 9, "das": 10,
    "gyarah": 11, "barah": 12, "bees": 20, "pachas": 50, "sau": 100,
}
_MULTIPLIERS = {"sau": 100, "hazaar": 1000, "hajar": 1000,
                "hazar": 1000, "lakh": 100000, "lac": 100000, "crore": 10000000}

# Keyword hints for direction, across common languages/transliterations.
_CREDIT_HINTS = [
    "diya", "diye", "diyaa", "de diya", "maal", "saman", "udhaar", "udhar",
    "credit", "gave", "sold", "sale", "bech", "becha", "ldiya", "kharch",
    "ఇచ్చా", "கொடுத்த", "ಕೊಟ್ಟ", "দিলাম", "દીધું",
]
_PAYMENT_HINTS = [
    "mile", "mila", "milе", "received", "aaya", "aya", "paisa", "payment",
    "paid", "jama", "vasool", "wapas", "return", "chukaya", "diye paise",
    "వచ్చా", "வந்த", "ಬಂತು", "পেলাম", "મળ્યા",
]


def _heuristic_amount(text: str) -> float | None:
    low = text.lower()
    # 1) explicit digits (handle "2,500" / "2500")
    import re

    digits = re.findall(r"\d[\d,]*", low)
    if digits:
        try:
            return float(digits[0].replace(",", ""))
        except ValueError:
            pass
    # 2) number words + multipliers, e.g. "teen hazaar", "do sau", "ek lakh"
    tokens = re.findall(r"[a-z]+", low)
    total = 0.0
    i = 0
    matched = False
    while i < len(tokens):
        tok = tokens[i]
        if tok in _MULTIPLIERS:
            prev = tokens[i - 1] if i > 0 else ""
            base = _NUM_WORDS.get(prev, 1)
            total += base * _MULTIPLIERS[tok]
            matched = True
        i += 1
    if matched:
        return total
    # 3) a bare number word ("paanch" = 5) as a last resort
    for tok in tokens:
        if tok in _NUM_WORDS:
            return float(_NUM_WORDS[tok])
    return None


def _heuristic_name(text: str) -> str | None:
    import re

    # Name usually precedes "ko"/"se"/"ne" (Ramesh ko…, Suresh se…).
    m = re.search(r"([A-Z][a-zA-Z]+)\s+(ko|se|ne|ku|ki)\b", text)
    if m:
        return m.group(1)
    # else first capitalized word that isn't the sentence start noise
    for w in re.findall(r"[A-Z][a-zA-Z]{2,}", text):
        return w
    return None


def _heuristic_parse(text: str, today: str) -> dict:
    low = text.lower()
    is_payment = any(h in low for h in _PAYMENT_HINTS) and not any(
        h in low for h in ("maal", "udhaar", "udhar", "diya")
    )
    kind = "payment" if is_payment else "credit"
    return {
        "customer_name": _heuristic_name(text),
        "type": kind,
        "amount": _heuristic_amount(text),
        "category": "Payment" if kind == "payment" else "Sale",
        "date": today,
        "confidence": 0.4,
        "raw_text": text,
        "source": "rule",
    }


def _normalize_parsed(data: dict, text: str, today: str) -> dict:
    kind = str(data.get("type", "")).lower()
    if kind not in ("credit", "payment"):
        kind = "credit"
    amount = data.get("amount")
    try:
        amount = float(amount) if amount is not None else None
    except (TypeError, ValueError):
        amount = None
    date = str(data.get("date") or today)[:10]
    name = data.get("customer_name")
    return {
        "customer_name": (str(name).strip() or None) if name else None,
        "type": kind,
        "amount": amount,
        "category": data.get("category")
        or ("Payment" if kind == "payment" else "Sale"),
        "date": date,
        "confidence": 0.85,
        "raw_text": text,
        "source": "ai",
    }


def parse_transaction(text: str, today: str) -> dict:
    """Extract a structured transaction from a natural-language sentence in any
    of several Indian languages. Falls back to a heuristic parser without a key."""
    if not settings.openai_api_key:
        return _heuristic_parse(text, today)

    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.openai_api_key)
        prompt = (
            "You extract ONE business transaction from an Indian shopkeeper's "
            "sentence, which may be in English, Hindi, Hinglish (Roman Hindi), "
            "Telugu, Tamil, Kannada, Marathi, Gujarati, Bengali, Malayalam or "
            "Punjabi.\n\n"
            "Return ONLY JSON with keys: customer_name (party name as written, or "
            "null), type ('credit' or 'payment'), amount (number in INR; convert "
            "words e.g. 'teen hazaar'=3000, 'do sau'=200, 'ek lakh'=100000; null "
            "if none), category (short label like 'Sale' or 'Payment'), date "
            "(YYYY-MM-DD).\n\n"
            "'credit' = the shopkeeper GAVE goods or lent money and the customer "
            "now OWES (e.g. 'maal diya', 'udhaar diya', 'sold', 'gave').\n"
            "'payment' = the shopkeeper RECEIVED money (e.g. 'mile', 'paisa aaya', "
            "'received', 'paid me').\n"
            f"If no date is stated, use {today}.\n\n"
            f'Sentence: "{text}"'
        )
        resp = client.chat.completions.create(
            model=settings.openai_model,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        return _normalize_parsed(data, text, today)
    except Exception as exc:  # noqa: BLE001 — degrade gracefully
        log.warning("OpenAI parse_transaction failed, using heuristic: %s", exc)
        return _heuristic_parse(text, today)


# ---------------------------------------------------------------------------
# Anthropic Claude — receipt extraction (vision)
# ---------------------------------------------------------------------------
_EMPTY_FIELD = {"value": None, "confidence": 0.0}


def _empty_receipt() -> dict:
    return {
        "vendor_name": dict(_EMPTY_FIELD),
        "invoice_number": dict(_EMPTY_FIELD),
        "gst_number": dict(_EMPTY_FIELD),
        "amount": dict(_EMPTY_FIELD),
        "tax_amount": dict(_EMPTY_FIELD),
        "date": dict(_EMPTY_FIELD),
        "category": dict(_EMPTY_FIELD),
    }


_RECEIPT_TOOL = {
    "name": "report_receipt",
    "description": "Report the structured fields extracted from the receipt image.",
    "input_schema": {
        "type": "object",
        "properties": {
            f: {
                "type": "object",
                "properties": {
                    "value": {"type": ["string", "number", "null"]},
                    "confidence": {"type": "number"},
                },
                "required": ["value", "confidence"],
            }
            for f in [
                "vendor_name", "invoice_number", "gst_number",
                "amount", "tax_amount", "date", "category",
            ]
        },
        "required": [
            "vendor_name", "invoice_number", "gst_number",
            "amount", "tax_amount", "date", "category",
        ],
    },
}


def scan_receipt(image_b64: str, media_type: str) -> dict:
    """Extract structured fields from a receipt image as a ReceiptExtractionDto."""
    if not settings.anthropic_api_key:
        return _empty_receipt()

    try:
        from anthropic import Anthropic

        client = Anthropic(api_key=settings.anthropic_api_key)
        instruction = (
            "Extract these fields from the receipt image and call the "
            "report_receipt tool. Each field has a value (or null if absent) and "
            "your confidence in [0,1]. amount and tax_amount are numbers in INR; "
            "date is YYYY-MM-DD; category must be one of: "
            f"{', '.join(RECEIPT_CATEGORIES)}."
        )
        msg = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=1024,
            tools=[_RECEIPT_TOOL],
            tool_choice={"type": "tool", "name": "report_receipt"},
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": image_b64,
                            },
                        },
                        {"type": "text", "text": instruction},
                    ],
                }
            ],
        )
        for block in msg.content:
            if block.type == "tool_use":
                return _normalize_receipt(block.input)
        return _empty_receipt()
    except Exception as exc:  # noqa: BLE001
        log.warning("Anthropic receipt scan failed, returning empty draft: %s", exc)
        return _empty_receipt()


def _normalize_receipt(raw: dict) -> dict:
    out = _empty_receipt()
    for key in out:
        field = raw.get(key) or {}
        out[key] = {
            "value": field.get("value"),
            "confidence": max(0.0, min(1.0, float(field.get("confidence", 0) or 0))),
        }
    return out


# ---------------------------------------------------------------------------
# OpenAI — khata insights
# ---------------------------------------------------------------------------
def generate_insights(stats: dict) -> list[dict]:
    """Return a list of InsightDto dicts from aggregate khata stats."""
    if not settings.openai_api_key:
        return _heuristic_insights(stats)

    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.openai_api_key)
        prompt = (
            "You are a financial analyst for an Indian SMB khata (credit ledger). "
            "Given these aggregate stats, produce 3-6 concise, actionable insights.\n"
            "Return JSON: {\"insights\": [{"
            "\"id\": str, \"type\": one of [collection,risk,behavior,concentration,general], "
            "\"sentiment\": one of [positive,neutral,warning,critical], "
            "\"title\": short headline, \"detail\": one sentence, "
            "\"metric\": short like '+12%' or '8 days' (optional), "
            "\"drill\": {\"target\": one of [khata,customers,none], \"search\": optional customer name}"
            "}]}.\n\n"
            f"Stats: {json.dumps(stats)}"
        )
        resp = client.chat.completions.create(
            model=settings.openai_model,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        insights = data.get("insights", [])
        return insights if isinstance(insights, list) else _heuristic_insights(stats)
    except Exception as exc:  # noqa: BLE001
        log.warning("OpenAI insights failed, using heuristic: %s", exc)
        return _heuristic_insights(stats)


def _heuristic_insights(stats: dict) -> list[dict]:
    insights: list[dict] = []
    receivable = stats.get("total_receivable", 0)
    overdue = stats.get("overdue_amount", 0)
    top = stats.get("top_defaulters", [])
    collected_change = stats.get("collection_change_pct")

    if collected_change is not None:
        positive = collected_change >= 0
        insights.append({
            "id": "collection-trend",
            "type": "collection",
            "sentiment": "positive" if positive else "warning",
            "title": f"Collections {'improved' if positive else 'dropped'} this month",
            "detail": "Compared with last month's collections.",
            "metric": f"{'+' if positive else ''}{collected_change}%",
            "drill": {"target": "khata"},
        })

    if receivable > 0 and overdue > 0:
        pct = round(overdue / receivable * 100)
        insights.append({
            "id": "overdue-risk",
            "type": "risk",
            "sentiment": "critical" if pct >= 25 else "warning",
            "title": f"{pct}% of outstanding is overdue",
            "detail": "Focus collection efforts on overdue accounts first.",
            "metric": f"{pct}%",
            "drill": {"target": "khata"},
        })

    if top:
        d = top[0]
        insights.append({
            "id": "top-defaulter",
            "type": "behavior",
            "sentiment": "warning",
            "title": f"{d.get('name', 'A customer')} owes the most",
            "detail": f"{d.get('days_overdue', 0)} days overdue — consider a reminder.",
            "metric": f"{d.get('days_overdue', 0)} days",
            "drill": {"target": "customers", "search": d.get("name")},
        })

    if len(top) >= 3 and receivable > 0:
        share = round(sum(x.get("amount", 0) for x in top[:3]) / receivable * 100)
        insights.append({
            "id": "concentration",
            "type": "concentration",
            "sentiment": "neutral",
            "title": f"Top 3 customers are {share}% of pending dues",
            "detail": "Your receivables are concentrated in a few accounts.",
            "metric": f"{share}%",
            "drill": {"target": "customers"},
        })

    if not insights:
        insights.append({
            "id": "empty",
            "type": "general",
            "sentiment": "neutral",
            "title": "Not enough data yet",
            "detail": "Add customers and record credit/payments to unlock insights.",
            "drill": {"target": "none"},
        })
    return insights
