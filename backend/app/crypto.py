"""Application-level field encryption for sensitive columns.

Some columns hold data that must not sit in the database as plaintext even
though the disk is encrypted at rest (defense in depth): GST numbers, addresses,
payment references/methods and free-text notes. This module provides a
transparent SQLAlchemy column type — values are encrypted on the way in and
decrypted on the way out, so routers and serializers keep working with plain
strings and never see ciphertext.

Cipher: Fernet (AES-128-CBC + HMAC-SHA256, authenticated) via `cryptography`.
`MultiFernet` supports key rotation — set APP_ENCRYPTION_KEY to a comma-separated
list "newkey,oldkey"; new writes use the first, reads try all.

Rollout safety: `decrypt` returns the raw value unchanged if it isn't a valid
token, so rows written BEFORE encryption was enabled keep reading correctly and
get encrypted the next time they're saved. Run scripts/encrypt_backfill.py to
re-encrypt them eagerly.
"""

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

from .config import settings

# Dev/test fallback key ONLY. Production requires APP_ENCRYPTION_KEY (enforced in
# config._production_secrets), so this key is never used for real data.
_DEV_FALLBACK_KEY = "zEPbPfexMUut8E0MBnP1xSd_7WYjLlxmJK870W2-zX4="


def _build_cipher() -> MultiFernet:
    raw = settings.app_encryption_key or _DEV_FALLBACK_KEY
    keys = [k.strip() for k in raw.split(",") if k.strip()]
    return MultiFernet([Fernet(k) for k in keys])


_cipher = _build_cipher()


def encrypt(value: str) -> str:
    return _cipher.encrypt(value.encode("utf-8")).decode("ascii")


def decrypt(token: str) -> str:
    try:
        return _cipher.decrypt(token.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError):
        # Not a token → legacy plaintext written before encryption was enabled.
        return token


class EncryptedText(TypeDecorator):
    """A Text column whose value is transparently encrypted at rest."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return encrypt(str(value))

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return decrypt(value)
