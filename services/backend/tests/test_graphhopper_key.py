"""GRAPHHOPPER_API_KEY: the public GraphHopper Directions API authenticates with a
`key` query parameter. The key is sent only there, /config reports just whether
it is set, and the request log never prints it."""

import json
import logging
import sys
from unittest.mock import patch

import httpx
import pytest
from starlette.testclient import TestClient

import graphhopper_capabilities as ghcaps

SECRET = "gh-secret-0123"


@pytest.fixture(autouse=True)
def _clean_main():
    sys.modules.pop("main", None)
    yield
    sys.modules.pop("main", None)


def _import_main(monkeypatch, key: str | None):
    monkeypatch.delenv("GRAPHHOPPER_API_KEY", raising=False)
    if key is not None:
        monkeypatch.setenv("GRAPHHOPPER_API_KEY", key)
    with patch.dict(sys.modules, {"overpassbot": None, "overpassbot.OverpassBot": None}):
        sys.modules.pop("main", None)
        import main

        return main


def _route_request(main) -> httpx.URL:
    """The URL the backend asks GraphHopper for, captured through a stub transport."""
    seen: dict[str, httpx.URL] = {}

    def capture(request: httpx.Request) -> httpx.Response:
        seen["url"] = request.url
        return httpx.Response(200, json={"paths": []})

    with TestClient(main.app) as client:
        main.http_client._transport = httpx.MockTransport(capture)
        client.get("/route", params={"from": "60.39,5.32", "to": "60.41,5.33"})
    return seen["url"]


def test_route_sends_the_key_as_a_query_parameter(monkeypatch):
    main = _import_main(monkeypatch, SECRET)
    url = _route_request(main)
    assert url.params["key"] == SECRET
    assert url.params.get_list("point") == ["60.39,5.32", "60.41,5.33"]


def test_route_sends_no_key_when_unset(monkeypatch):
    main = _import_main(monkeypatch, None)
    assert "key" not in _route_request(main).params


# One small polygon to avoid, as the frontend sends it: [[lon, lat], ...].
AVOID_AREAS = json.dumps([[[5.32, 60.395], [5.33, 60.395], [5.33, 60.40]]])


def _flexible_route_request(main, extra: dict[str, str]) -> httpx.Request:
    """The route request the backend sends GraphHopper when /route gets `extra`
    (alternatives or avoid areas, which take the POST path), captured through a
    stub transport. The capability probe's /info request is left out."""
    route_calls: list[httpx.Request] = []

    def capture(request: httpx.Request) -> httpx.Response:
        if not request.url.path.endswith("/info"):
            route_calls.append(request)
        return httpx.Response(200, json={"paths": []})

    with TestClient(main.app) as client:
        main.http_client._transport = httpx.MockTransport(capture)
        client.get("/route", params={"from": "60.39,5.32", "to": "60.41,5.33", **extra})
    assert len(route_calls) == 1, route_calls
    return route_calls[0]


def test_route_with_alternatives_sends_the_key(monkeypatch):
    main = _import_main(monkeypatch, SECRET)
    request = _flexible_route_request(main, {"alternatives": "true"})
    assert request.method == "POST"
    assert json.loads(request.content)["algorithm"] == "alternative_route"
    assert request.url.params["key"] == SECRET
    # The key travels as the query parameter only, never in the JSON body.
    assert SECRET not in request.content.decode()


def test_route_with_avoid_areas_sends_the_key(monkeypatch):
    main = _import_main(monkeypatch, SECRET)
    request = _flexible_route_request(main, {"avoid_areas": AVOID_AREAS})
    assert request.method == "POST"
    assert "custom_model" in json.loads(request.content)
    assert request.url.params["key"] == SECRET
    assert SECRET not in request.content.decode()


@pytest.mark.parametrize("extra", [{"alternatives": "true"}, {"avoid_areas": AVOID_AREAS}])
def test_flexible_route_sends_no_key_when_unset(monkeypatch, extra):
    main = _import_main(monkeypatch, None)
    request = _flexible_route_request(main, extra)
    assert request.method == "POST"
    assert "key" not in request.url.params


def test_config_reports_only_whether_the_key_is_set(monkeypatch):
    main = _import_main(monkeypatch, SECRET)
    with TestClient(main.app) as client:
        body = client.get("/config")
    assert SECRET not in body.text
    assert body.json()["graphhopper_api_key"] == "set"


def test_request_log_redacts_the_key(monkeypatch, caplog):
    _import_main(monkeypatch, SECRET)
    # Importing main re-configures the root logger; re-attach pytest's capture.
    root = logging.getLogger()
    root.addHandler(caplog.handler)
    try:
        with caplog.at_level("INFO"):
            logging.getLogger("httpx").info(
                'HTTP Request: %s %s "%s"',
                "GET",
                f"https://graphhopper.com/api/1/route?point=1,2&key={SECRET}&type=json",
                "HTTP/1.1 200 OK",
            )
    finally:
        root.removeHandler(caplog.handler)
    messages = [r.getMessage() for r in caplog.records]
    assert messages, "the httpx line was not captured"
    assert all(SECRET not in m for m in messages)
    assert any("key=***" in m and "point=1,2" in m for m in messages)


def _route_answered_with(main, status: int, body: dict | str):
    """GET /route while the stub GraphHopper answers `status` with `body`."""

    def answer(request: httpx.Request) -> httpx.Response:
        if isinstance(body, str):
            return httpx.Response(status, text=body)
        return httpx.Response(status, json=body)

    with TestClient(main.app) as client:
        main.http_client._transport = httpx.MockTransport(answer)
        return client.get("/route", params={"from": "59.91,10.74", "to": "59.92,10.76"})


def test_route_with_a_rejected_key_says_so_in_norwegian(monkeypatch):
    main = _import_main(monkeypatch, "wrong-key")
    response = _route_answered_with(
        main,
        401,
        {
            "message": "Wrong credentials. Register and get a valid API key at "
            "https://www.graphhopper.com/developers"
        },
    )
    assert response.status_code == 502
    assert "API-nøkkel" in response.json()["detail"]
    # The frontend recognises this answer by its code, not by the Norwegian text.
    assert response.json()["code"] == "graphhopper_key_rejected"
    # The provider's English sentence and the key itself never reach the user.
    assert "Wrong credentials" not in response.text
    assert "wrong-key" not in response.text


def test_a_rejected_key_is_not_logged_even_when_the_provider_echoes_it(monkeypatch, caplog):
    main = _import_main(monkeypatch, SECRET)
    root = logging.getLogger()
    root.addHandler(caplog.handler)
    try:
        with caplog.at_level("INFO"):
            _route_answered_with(main, 401, {"message": f"Invalid key {SECRET}"})
    finally:
        root.removeHandler(caplog.handler)
    messages = [r.getMessage() for r in caplog.records]
    assert any("refused the API key" in m for m in messages)
    assert all(SECRET not in m for m in messages)


def test_an_echoed_key_across_the_log_cut_leaks_no_part_of_it(monkeypatch, caplog):
    """The logged body is cut at 500 characters. The key is redacted before the
    cut, so a key straddling it cannot survive as a fragment."""
    main = _import_main(monkeypatch, SECRET)
    half = len(SECRET) // 2
    body = "x" * (500 - half) + SECRET + " is not a valid key"
    root = logging.getLogger()
    root.addHandler(caplog.handler)
    try:
        with caplog.at_level("INFO"):
            _route_answered_with(main, 401, body)
    finally:
        root.removeHandler(caplog.handler)
    refused = [r.getMessage() for r in caplog.records if "refused the API key" in r.getMessage()]
    assert refused, "the refusal was not logged"
    assert all(SECRET[:half] not in m for m in refused)
    assert any("***" in m for m in refused)


def test_route_with_an_exhausted_quota_says_so_in_norwegian(monkeypatch):
    main = _import_main(monkeypatch, SECRET)
    response = _route_answered_with(
        main, 403, {"message": "API key quota exceeded for today"}
    )
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert "API-nøkkel" in detail
    assert "kvote" in detail
    assert response.json()["code"] == "graphhopper_key_quota"


def test_route_rate_limited_says_quota_in_norwegian(monkeypatch):
    main = _import_main(monkeypatch, SECRET)
    response = _route_answered_with(main, 429, {"message": "API limit reached"})
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail == "Rutetjenesten melder at kvoten for API-nøkkelen er brukt opp"
    assert "kvote" in detail
    assert response.json()["code"] == "graphhopper_key_quota"
    # The provider's English sentence never reaches the user.
    assert "API limit reached" not in response.text


def test_route_rate_limited_is_quota_whatever_the_body_says(monkeypatch):
    main = _import_main(monkeypatch, SECRET)
    for body in ("<html>Too Many Requests</html>", {"message": "Slow down"}):
        response = _route_answered_with(main, 429, body)
        assert response.status_code == 502, body
        assert "kvote" in response.json()["detail"], body
        assert response.json()["code"] == "graphhopper_key_quota", body


def test_route_with_a_forbidden_key_that_is_not_about_quota_names_the_key(monkeypatch):
    main = _import_main(monkeypatch, SECRET)
    response = _route_answered_with(main, 403, {"message": "Access denied"})
    assert response.status_code == 502
    assert "API-nøkkel" in response.json()["detail"]
    assert "kvote" not in response.json()["detail"]


def test_route_with_no_key_set_names_the_key_when_the_provider_wants_one(monkeypatch):
    main = _import_main(monkeypatch, None)
    response = _route_answered_with(main, 401, {"message": "Missing API key"})
    assert response.status_code == 502
    assert "API-nøkkel" in response.json()["detail"]


def test_route_with_a_key_rejection_that_is_not_json_still_names_the_key(monkeypatch):
    main = _import_main(monkeypatch, "wrong-key")
    response = _route_answered_with(main, 401, "<html>Unauthorized</html>")
    assert response.status_code == 502
    assert "API-nøkkel" in response.json()["detail"]


def _route_retried_with(main, status: int, body: dict | str):
    """GET /route when the first GraphHopper answer is a 400 that blames the
    elevation/details the probe advertised (so the backend retries plainly) and
    the plain retry answers `status` with `body`."""

    async def probe():
        return ghcaps.Capabilities(elevation=True)

    route_calls: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        route_calls.append(request)
        if len(route_calls) == 1:
            return httpx.Response(400, json={"message": "Elevation not supported!"})
        if isinstance(body, str):
            return httpx.Response(status, text=body)
        return httpx.Response(status, json=body)

    with (
        patch.object(main, "gh_capabilities", ghcaps.CapabilityCache(probe)),
        TestClient(main.app) as client,
    ):
        main.http_client._transport = httpx.MockTransport(answer)
        response = client.get("/route", params={"from": "59.91,10.74", "to": "59.92,10.76"})
    assert len(route_calls) == 2, "the first answer should have been retried plainly"
    return response


@pytest.mark.parametrize(
    "body", [{"message": "API limit reached"}, "<html>Too Many Requests</html>"]
)
def test_the_plain_retry_being_rate_limited_says_quota_in_norwegian(monkeypatch, body):
    main = _import_main(monkeypatch, SECRET)
    response = _route_retried_with(main, 429, body)
    assert response.status_code == 502
    assert response.json()["detail"] == (
        "Rutetjenesten melder at kvoten for API-nøkkelen er brukt opp"
    )
    assert response.json()["code"] == "graphhopper_key_quota"
    assert "API limit reached" not in response.text


@pytest.mark.parametrize("body", [{"message": "Wrong credentials"}, "<html>Unauthorized</html>"])
def test_the_plain_retry_being_refused_names_the_key(monkeypatch, body):
    main = _import_main(monkeypatch, "wrong-key")
    response = _route_retried_with(main, 401, body)
    assert response.status_code == 502
    assert response.json()["detail"] == (
        "Rutetjenesten avviste API-nøkkelen (sjekk GRAPHHOPPER_API_KEY)"
    )
    assert response.json()["code"] == "graphhopper_key_rejected"
    assert "Wrong credentials" not in response.text
