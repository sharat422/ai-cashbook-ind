import os
import uuid

from fastapi import UploadFile, HTTPException

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
    ext = ext.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".pdf", ".webp", ".heic"}:
        raise HTTPException(422, "Upload a JPEG, PNG, WebP, HEIC or PDF file.")
    content = file.file.read(10 * 1024 * 1024 + 1)
    if not content:
        raise HTTPException(422, "The attachment is empty.")
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "Attachments must be 10 MB or smaller.")
    name = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(UPLOAD_DIR, name)
    with open(path, "wb") as out:
        out.write(content)

    return f"{settings.public_base_url.rstrip('/')}/uploads/{name}"
