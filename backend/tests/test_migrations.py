"""Startup migrations: self-heal a live DB whose schema predates model changes."""

from sqlalchemy import create_engine, inspect, text

from app.migrations import run_startup_migrations
from app.models import Base, Business, BusinessMember, User


def test_adds_missing_customer_columns_and_backfills():
    """Simulate the production bug: a `customers` table created before the
    version/updated_at columns existed → every query 500s until migrated."""
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE customers ("
                "id VARCHAR PRIMARY KEY, business_id VARCHAR, full_name VARCHAR, "
                "mobile VARCHAR, created_at VARCHAR)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO customers (id, business_id, full_name, mobile, created_at) "
                "VALUES ('c1','b1','Old Customer','999','2026-01-01T00:00:00')"
            )
        )

    # Before: the new columns don't exist.
    assert "version" not in {c["name"] for c in inspect(engine).get_columns("customers")}

    run_startup_migrations(engine)

    cols = {c["name"] for c in inspect(engine).get_columns("customers")}
    assert {"version", "updated_at"} <= cols
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT version, updated_at FROM customers WHERE id='c1'")
        ).one()
    assert row.version == 1
    assert row.updated_at == "2026-01-01T00:00:00"  # backfilled from created_at


def test_is_idempotent():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)  # already has the columns
    run_startup_migrations(engine)
    run_startup_migrations(engine)  # second run must not error
    cols = {c["name"] for c in inspect(engine).get_columns("customers")}
    assert {"version", "updated_at"} <= cols


def test_backfills_owner_membership_for_legacy_business():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    from sqlalchemy.orm import Session

    with Session(engine) as s:
        s.add(User(id="u1", mobile="9000000000", created_at="2026-01-01"))
        s.add(
            Business(
                id="b1", user_id="u1", business_name="Legacy", owner_name="O",
                business_type="Retail", state="KA", created_at="2026-01-01",
            )
        )
        s.commit()

    run_startup_migrations(engine)

    with Session(engine) as s:
        members = s.query(BusinessMember).filter_by(business_id="b1").all()
    assert len(members) == 1
    assert members[0].role == "owner" and members[0].user_id == "u1"
