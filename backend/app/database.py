from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from .config import settings


def _normalize_db_url(url: str) -> str:
    """Managed Postgres providers (Render, Heroku) hand out `postgres://` URLs,
    which SQLAlchemy 2.0 no longer recognizes. Rewrite to the explicit driver."""
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg2://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return url


DATABASE_URL = _normalize_db_url(settings.database_url)

connect_args = (
    {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
)

# pool_pre_ping avoids stale connections dropped by managed Postgres idle timeouts.
engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=not DATABASE_URL.startswith("sqlite"),
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
