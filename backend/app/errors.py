"""Central error logging + consistent JSON error responses.

Without this, an unhandled exception logs only to Starlette's default stderr and
returns a plain-text 500 — opaque both in the server logs and to the app. This
logs the full traceback with request context (method + path) so failures are
diagnosable in the Render logs, and always answers with `{"detail": ...}` JSON.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

log = logging.getLogger("cashbook.errors")


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # logger.exception attaches the full traceback at ERROR level.
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={"detail": "Something went wrong on our side. Please try again."},
        )
