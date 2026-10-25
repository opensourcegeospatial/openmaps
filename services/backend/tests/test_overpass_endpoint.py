"""Resource limits on /overpass: input length, bbox size, inference concurrency,
upstream timeouts. The byt5 model is CPU-bound and byte-level, so one oversized
or over-parallel request can stall or OOM the whole backend."""

import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import AsyncMock, patch

import httpx
import pytest


@pytest.fixture(autouse=True)
def _clean_main():
    sys.modules.pop("main", None)
    yield
    sys.modules.pop("main", None)


@pytest.fixture()
def client():
    with patch.dict(sys.modules, {"overpassbot": None, "overpassbot.OverpassBot": None}):
        sys.modules.pop("main", None)
        from starlette.testclient import TestClient

        import main

        yield TestClient(main.app)


BBOX = {"south": 59.9, "west": 10.7, "north": 60.0, "east": 10.8}


def _overpass_ok():
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=httpx.Response(200, json={"elements": []}))
    return mock_client


class TestInputLimits:
    def test_rejects_overlong_query_text(self, client):
        resp = client.get("/overpass", params={"nl": "x" * 301, **BBOX})
        assert resp.status_code == 422

    def test_rejects_blank_or_single_character_terms(self, client):
        assert client.get("/overpass", params={"nl": "   ", **BBOX}).status_code == 400
        assert client.get("/overpass", params={"nl": "a", **BBOX}).status_code == 400

    def test_rejects_a_bbox_that_covers_a_whole_country(self, client):
        import main

        with patch.object(main, "http_client", _overpass_ok()):
            resp = client.get(
                "/overpass",
                params={"nl": "cafe", "south": 58.0, "west": 5.0, "north": 63.0, "east": 12.0},
            )
        assert resp.status_code == 400
        assert "zoom" in resp.json()["detail"].lower()


class TestUpstreamTimeout:
    def test_overpass_request_uses_bounded_phase_timeouts(self, client):
        import main

        mock_client = _overpass_ok()
        with patch.object(main, "http_client", mock_client):
            client.get("/overpass", params={"nl": "cafe", **BBOX})
        timeout = mock_client.post.call_args.kwargs["timeout"]
        assert isinstance(timeout, httpx.Timeout)
        assert timeout.connect is not None and timeout.connect <= 10
        assert timeout.read is not None and timeout.read <= 90


class TestInferenceConcurrency:
    def test_model_inference_is_serialised(self, client):
        import main

        lock = threading.Lock()
        state = {"running": 0, "max": 0}

        class SlowBot:
            def generate_query(self, text):
                with lock:
                    state["running"] += 1
                    state["max"] = max(state["max"], state["running"])
                time.sleep(0.3)
                with lock:
                    state["running"] -= 1
                return 'node["amenity"="cafe"];'

        main.overpass_bot = SlowBot()
        with patch.object(main, "http_client", _overpass_ok()):
            with ThreadPoolExecutor(max_workers=3) as pool:
                def call(_):
                    return client.get("/overpass", params={"nl": "cafe", **BBOX}).status_code

                results = list(pool.map(call, range(3)))
        assert results == [200, 200, 200]
        assert state["max"] == 1


class TestGeneratorReported:
    """The response names the engine that built the query, so the UI can say it."""

    def test_the_query_that_ran_is_reported(self, client):
        import main

        main.overpass_bot = None
        with patch.object(main, "http_client", _overpass_ok()), patch.object(
            main, "active_generator", lambda: "keyword"
        ):
            resp = client.get("/overpass", params={"nl": "cafe", **BBOX})
        assert resp.status_code == 200
        query = resp.json()["query"]
        assert isinstance(query, str) and query.strip()

    def test_keyword_search_says_so(self, client):
        import main

        main.overpass_bot = None
        with patch.object(main, "http_client", _overpass_ok()), patch.object(
            main, "active_generator", lambda: "keyword"
        ):
            resp = client.get("/overpass", params={"nl": "cafe", **BBOX})
        assert resp.status_code == 200
        assert resp.json()["generator"] == "keyword"

    def test_a_model_built_query_names_the_model(self, client):
        import main

        class Bot:
            def generate_query(self, text):
                return 'node["amenity"="cafe"];'

        main.overpass_bot = Bot()
        with patch.object(main, "http_client", _overpass_ok()), patch.object(
            main, "active_generator", lambda: "byt5"
        ):
            resp = client.get("/overpass", params={"nl": "cafe", **BBOX})
        assert resp.status_code == 200
        assert resp.json()["generator"] == "byt5"

    def test_unusable_model_output_is_reported_as_keyword(self, client):
        import main

        class Bot:
            def generate_query(self, text):
                return "no filters here"

        main.overpass_bot = Bot()
        with patch.object(main, "http_client", _overpass_ok()), patch.object(
            main, "active_generator", lambda: "byt5"
        ):
            resp = client.get("/overpass", params={"nl": "cafe", **BBOX})
        assert resp.status_code == 200
        assert resp.json()["generator"] == "keyword"
