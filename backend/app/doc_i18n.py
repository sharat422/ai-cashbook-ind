"""Server-made retailer documents in the retailer's language (ST5).

Only REVIEWED translations are used — never machine translation at render
time. `doc_strings/en.json` is the English (the same `doc.*` keys as the app's
src/i18n/locales/en.json, kept equal by a test). `doc_strings/<lang>.json`
holds what a native reviewer passed, each pinned to the English it was
reviewed against; `scripts/i18n_review_sheets.py apply` writes it. A key with
no reviewed translation, or whose English has changed since, falls back to
English and is logged once per language and key.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Callable

DIR = Path(__file__).parent / "doc_strings"
LANGUAGES = ("te", "hinglish", "en", "hi", "ta", "kn", "mr", "gu", "bn", "ml", "pa")  # the app's list
DEFAULT_LANGUAGE = "te"  # Telugu first, like the app

log = logging.getLogger("cashbook.i18n")
_logged: set[tuple[str, str]] = set()

Tr = Callable[..., str]


@lru_cache
def english() -> dict[str, str]:
    return json.loads((DIR / "en.json").read_text(encoding="utf-8"))


@lru_cache
def reviewed(lang: str) -> dict[str, dict]:
    path = DIR / f"{lang}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def text(lang: str, key: str, **values) -> str:
    en = english()[key]
    hit = reviewed(lang).get(key) if lang != "en" else None
    if hit and hit.get("en") == en:
        out = hit["text"]
    else:
        out = en
        if lang != "en" and (lang, key) not in _logged:
            _logged.add((lang, key))
            log.warning("doc i18n: no reviewed %s translation for %s%s; using English", lang, key,
                        " (the English changed since review)" if hit else "")
    for k, v in values.items():
        out = out.replace("{" + k + "}", str(v))
    return out


def translator(lang: str) -> Tr:
    return lambda key, **values: text(lang, key, **values)


ENGLISH: Tr = translator("en")


def date(t: Tr, iso: str) -> str:
    """'2026-11-11' -> '11 Nov 2026', the month in the document's language.
    Dates are the business's IST days (calc.today_iso), stored as such."""
    y, m, d = iso[:10].split("-")
    return f"{int(d)} {t(f'doc.month.{int(m)}')} {y}"


def language_of(business, customer) -> str:
    """The retailer's own choice, else the distributor's default, else Telugu."""
    return customer.statement_language or business.statement_language or DEFAULT_LANGUAGE
