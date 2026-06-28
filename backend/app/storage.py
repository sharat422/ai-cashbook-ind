import os
import uuid

from fastapi import UploadFile

from .config import settings

UPLOAD_DIR = os.path.join(os.getcwd(), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


def save_upload(file: UploadFile | None) -> str | None:
    """Persist an uploaded file and return an absolute URL the app can load.

    Returns None when no file was provided.
    """
    if file is None:
        return None

    _, ext = os.path.splitext(file.filename or "")
    name = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(UPLOAD_DIR, name)
    with open(path, "wb") as out:
        out.write(file.file.read())

    return f"{settings.public_base_url.rstrip('/')}/uploads/{name}"
