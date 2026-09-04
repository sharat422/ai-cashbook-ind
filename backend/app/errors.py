"""Central error logging + consistent JSON error responses.

Without this, an unhandled exception logs only to Starlette's default stderr and
returns a plain-text 500 — opaque both in the server logs and to the app. This
logs the full traceback with request context (method + path) so failures are
diagnosable in the Render logs, and always answers with `{"detail": ...}` JSON.
"""

import logging

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

log = logging.getLogger("cashbook.errors")


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        # FastAPI's default 422 body is a verbose array of Pydantic error objects
        # that the app can't render. Log the detail for diagnostics, but answer
        # with a single human sentence in the same {"detail": ...} shape every
        # other error uses, so the client shows one clear message.
        log.warning(
            "422 validation error on %s %s: %s",
            request.method, request.url.path, exc.errors(),
        )
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"detail": "Please check the details you entered and try again."},
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # logger.exception attaches the full traceback at ERROR level.
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={"detail": "Something went wrong on our side. Please try again."},
        )
