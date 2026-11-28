"""One list of expense categories: the app's expense form (EXPENSE_CATEGORIES) and
the server's categorizer, receipt scan and AI entry (ai.EXPENSE_CATEGORIES)."""

import re
from pathlib import Path

from app import ai
from app.stock import PURCHASES

APP_LIST = Path(__file__).resolve().parents[2] / "src" / "features" / "expense" / "domain" / "entities.ts"


def test_the_app_form_and_the_server_categorizer_offer_the_same_categories():
    block = re.search(r"EXPENSE_CATEGORIES = \[(.*?)\]", APP_LIST.read_text(encoding="utf-8"), re.S).group(1)
    assert re.findall(r"'([^']+)'", block) == ai.EXPENSE_CATEGORIES
    assert PURCHASES in ai.EXPENSE_CATEGORIES  # a stock purchase's category is one the form offers


def test_the_offline_fallback_answers_from_the_list():
    assert ai._heuristic_category("Wholesale supplier bill")[0] == "Purchases"
    assert ai._heuristic_category("Facebook ads, Diwali promo")[0] == "Marketing"
    assert ai._to_expense_category("inventory") == "Purchases"
    assert ai._to_expense_category("Advertising") == "Marketing"
