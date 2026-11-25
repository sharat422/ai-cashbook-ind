"""A name matches across scripts and spellings: AI Entry saves names in the
app's language (నరేన్) while older customers are in English letters (Naren)."""

import pytest

from helpers import add_customer
from app.chatbot.tools import get_customer_balance
from app.database import SessionLocal
from app.names import contains, loose, romanize, same_name


@pytest.mark.parametrize("native, latin", [
    ("నరేన్", "naren"),            # Telugu
    ("नरेन", "naren"),             # Hindi: no "a" at the end
    ("रमेश", "ramesh"),
    ("सुरेश कुमार", "suresh kumar"),
    ("లక్ష్మి", "lakshmi"),
    ("శ్రీనివాస్", "shrinivas"),
    ("రాము", "ramu"),
    ("ரமேஷ்", "ramesh"),           # Tamil
    ("சுரேஷ்", "suresh"),          # Tamil ச is "s" in names
    ("ರಮೇಶ್", "ramesh"),           # Kannada
    ("രമേശ്", "ramesh"),           # Malayalam
    ("അരുൺ", "arun"),              # Malayalam chillu
    ("સુરેશ", "suresh"),           # Gujarati
    ("সুমন", "suman"),             # Bengali
    ("ਸੁਰੇਸ਼", "suresh"),          # Gurmukhi
    ("సంపత్", "sampat"),           # anusvara before p is m
    ("संजय", "sanjay"),
])
def test_romanize(native, latin):
    assert romanize(native) == latin


@pytest.mark.parametrize("a, b", [
    ("Naren", "నరేన్"), ("Naren", "नरेन"), ("Ramesh", "రమేష్"), ("Lakshmi", "లక్ష్మి"),
    ("Laxmi", "Lakshmi"), ("Srinivas", "శ్రీనివాస్"), ("Bharath", "భరత్"), ("Devi", "தேவி"),
    ("Bala", "பாலா"), ("Ganesh", "గణేష్"), ("Seetha", "సీత"), ("Naren Reddy", "నరేన్ రెడ్డి"),
    ("Sanjay", "संजय"),
])
def test_same_person_in_two_spellings(a, b):
    assert loose(a) == loose(b)


def test_contains_is_plain_for_english_and_loose_across_scripts():
    assert contains("నరేన్ రెడ్డి 9876543210", "naren")
    assert contains("Naren Reddy 9876543210", "నరేన్")
    assert contains("Naren Reddy", "nar") and not contains("Mohan", "moan")  # English stays as typed
    assert same_name("naren", "నరేన్") and not same_name("naren", "naresh")


def test_customer_search_finds_a_name_saved_in_another_script(make_user, client):
    u = make_user()
    te = add_customer(client, u.headers, full_name="నరేన్", mobile="9876500001")
    en = add_customer(client, u.headers, full_name="Lakshmi Devi", mobile="9876500002")
    add_customer(client, u.headers, full_name="Mahesh", mobile="9876500003")

    def ids(search):
        r = client.get("/api/v1/customers", headers=u.headers, params={"search": search})
        assert r.status_code == 200
        return [c["id"] for c in r.json()["items"]]

    assert ids("Naren") == [te["id"]]          # AI Entry with an English name, customer in Telugu
    assert ids("లక్ష్మి") == [en["id"]]       # AI Entry in Telugu, customer in English
    assert ids("Mahesh 98765 00003") == ids("mah")  # English searches unchanged
    page = client.get("/api/v1/customers", headers=u.headers, params={"limit": 2}).json()
    assert len(page["items"]) == 2 and page["total"] == 3 and page["next_cursor"] == "2"


def test_ask_ai_finds_a_customer_saved_in_another_script(make_user, client):
    u = make_user()
    te = add_customer(client, u.headers, full_name="నరేన్ రెడ్డి")
    with SessionLocal() as s:
        out = get_customer_balance(s, u.business["id"], customer_name="Naren Reddy")
        assert out["status"] == "found" and out["customer"]["customer_id"] == te["id"]
        close = get_customer_balance(s, u.business["id"], customer_name="Narin Redy")  # close spelling
        assert close["status"] == "ambiguous" and close["similar"]
        assert [m["customer_id"] for m in close["matches"]] == [te["id"]]
