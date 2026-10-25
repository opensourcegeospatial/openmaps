"""Upstream requests identify the application. Public OSM services (Nominatim,
Overpass) reject stock library User-Agents, so every httpx client the backend
builds carries an identifying one, overridable with HTTP_USER_AGENT."""

import sys
from unittest.mock import patch

import httpx
import pytest


@pytest.fixture(autouse=True)
def _clean_main():
    sys.modules.pop("main", None)
    yield
    sys.modules.pop("main", None)


def _import_main(monkeypatch, user_agent: str | None):
    monkeypatch.delenv("HTTP_USER_AGENT", raising=False)
    if user_agent is not None:
        monkeypatch.setenv("HTTP_USER_AGENT", user_agent)
    with patch.dict(sys.modules, {"overpassbot": None, "overpassbot.OverpassBot": None}):
        sys.modules.pop("main", None)
        import main

        return main


async def _sent_user_agent(client: httpx.AsyncClient) -> str:
    """The User-Agent a real request through this client carries."""
    seen: dict[str, str] = {}

    def capture(request: httpx.Request) -> httpx.Response:
        seen["ua"] = request.headers.get("user-agent", "")
        return httpx.Response(200)

    client._transport = httpx.MockTransport(capture)
    await client.get("http://upstream.invalid/")
    return seen["ua"]


async def test_requests_identify_the_application_by_default(monkeypatch):
    main = _import_main(monkeypatch, None)
    assert await _sent_user_agent(main.make_http_client(timeout=1.0)) == "OpenMaps/1.0"


async def test_http_user_agent_overrides_the_default(monkeypatch):
    main = _import_main(monkeypatch, "OpenMaps/1.0 (+mailto:kart@example.org)")
    ua = await _sent_user_agent(main.make_http_client(timeout=1.0))
    assert ua == "OpenMaps/1.0 (+mailto:kart@example.org)"


async def test_blank_http_user_agent_keeps_the_default(monkeypatch):
    main = _import_main(monkeypatch, "   ")
    assert await _sent_user_agent(main.make_http_client(timeout=1.0)) == "OpenMaps/1.0"


def test_the_shared_client_is_built_the_same_way(monkeypatch):
    main = _import_main(monkeypatch, "OpenMaps/1.0 (+mailto:kart@example.org)")
    from starlette.testclient import TestClient

    with TestClient(main.app):
        assert main.http_client.headers["user-agent"] == "OpenMaps/1.0 (+mailto:kart@example.org)"
