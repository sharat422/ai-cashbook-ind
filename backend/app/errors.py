"""Central error logging + consistent JSON error responses.

Without this, an unhandled exception logs only to Starlette's default stderr and
returns a plain-text 500 — opaque both in the server logs and to the app. This
logs the full traceback with request context (method + path) so failures are
diagnosable in the Render logs, and always answers with JSON.

Every error body is `{"code", "detail", "params"}` (TE3): `code` is stable, so
the app can show a reviewed translation of the REASON, not just its kind;
`detail` is the English sentence; `params` are the values it names (an
invoice number, an amount), so every language names the same thing. Errors
raised as AppError carry their own code; any other HTTPException gets the code
of its kind (not_found, conflict, …), so no error goes out without one.
"""

import logging

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("cashbook.errors")

KIND = {400: "bad_request", 401: "not_signed_in", 403: "not_allowed", 404: "not_found", 409: "conflict",
        410: "gone", 413: "too_large", 422: "check_details", 429: "too_many_requests",
        502: "upstream_error", 503: "unavailable"}


class AppError(HTTPException):
    """An error with its own stable code and the values its sentence names."""

    def __init__(self, status_code: int, code: str, detail: str, **params) -> None:
        super().__init__(status_code, detail)
        self.code = code
        self.params = {k: str(v) for k, v in params.items()}


def error_body(status_code: int, detail, code: str | None = None, params: dict | None = None) -> dict:
    return {"code": code or KIND.get(status_code, "server_error" if status_code >= 500 else "error"),
            "detail": detail, "params": params or {}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(error_body(exc.status_code, exc.detail, getattr(exc, "code", None),
                                       getattr(exc, "params", None)),
                            status_code=exc.status_code, headers=getattr(exc, "headers", None))

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
            content=error_body(422, "Please check the details you entered and try again."),
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # logger.exception attaches the full traceback at ERROR level.
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        # Send to Sentry (email alert) — DB errors and other 500s surface here.
        from .monitoring import capture_exception

        capture_exception(exc)
        return JSONResponse(
            status_code=500,
            content=error_body(500, "Something went wrong on our side. Please try again."),
        )
