"""The global error handler logs the traceback and returns clean JSON."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.errors import install_error_handlers


def _app_that_raises() -> TestClient:
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/boom")
    def boom():
        raise RuntimeError("kaboom-42")

    # raise_server_exceptions=False so the client returns the handler's response
    # (as a real HTTP client would) instead of re-raising in-process.
    return TestClient(app, raise_server_exceptions=False)


def test_unhandled_error_returns_500_json(caplog):
    client = _app_that_raises()
    with caplog.at_level("ERROR", logger="cashbook.errors"):
        r = client.get("/boom")

    assert r.status_code == 500
    assert r.headers["content-type"].startswith("application/json")
    assert r.json()["detail"]  # a friendly message, not blank text

    # The failure was logged with the request path + the real exception/traceback.
    assert "GET /boom" in caplog.text
    assert "kaboom-42" in caplog.text
