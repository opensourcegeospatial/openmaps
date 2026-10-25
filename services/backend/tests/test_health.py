"""/health: targets follow the configured upstream URLs; optional UIs never fail
the aggregate; results are cached briefly."""

import logging
import sys
from unittest.mock import AsyncMock, patch

import httpx
import pytest


@pytest.fixture(autouse=True)
def _clean_main():
    sys.modules.pop("main", None)
    yield
    sys.modules.pop("main", None)


def _import_main(monkeypatch=None):
    with patch.dict(sys.modules, {"overpassbot": None, "overpassbot.OverpassBot": None}):
        sys.modules.pop("main", None)
        import main

        return main


class TestHealthTargets:
    def test_core_targets_are_derived_from_the_configured_urls(self, monkeypatch):
        monkeypatch.setenv("GEOCODE_URL", "http://geo.internal:9999/search")
        monkeypatch.setenv("GRAPHHOPPER_URL", "http://router.internal:8989/route")
        monkeypatch.setenv("OVERPASS_API", "http://osm.internal:8080/api/interpreter")
        main = _import_main()
        targets = {t.name: t for t in main.build_health_targets(main.config)}
        assert targets["nominatim"].url == "http://geo.internal:9999/status"
        assert targets["graphhopper"].url == "http://router.internal:8989/health"
        assert targets["overpass"].url == "http://osm.internal:8080/api/status"
        for name in ("nominatim", "graphhopper", "overpass", "tileserver"):
            assert targets[name].optional is False

    def test_ui_services_are_optional(self):
        main = _import_main()
        targets = {t.name: t for t in main.build_health_targets(main.config)}
        for name in ("nominatim-ui", "graphhopper-maps", "overpass-ultra", "overpassbot"):
            assert targets[name].optional is True
        # The backend must not probe the frontend that is polling it.
        assert "frontend" not in targets


class TestHealthAggregate:
    def _client(self, main):
        from starlette.testclient import TestClient

        return TestClient(main.app)

    def test_optional_service_down_does_not_fail_the_aggregate(self):
        main = _import_main()

        async def fake_check(client, name, url, headers=None):
            if name == "graphhopper-maps":
                return {"name": name, "status": "unhealthy", "detail": "connection refused"}
            return {"name": name, "status": "healthy", "status_code": 200}

        with patch.object(main, "_check_service", fake_check):
            resp = self._client(main).get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "healthy"
        assert body["services"]["graphhopper-maps"]["status"] == "unhealthy"
        assert body["services"]["graphhopper-maps"]["optional"] is True

    def test_core_service_down_fails_the_aggregate(self):
        main = _import_main()

        async def fake_check(client, name, url, headers=None):
            if name == "nominatim":
                return {"name": name, "status": "unhealthy", "detail": "timeout"}
            return {"name": name, "status": "healthy", "status_code": 200}

        with patch.object(main, "_check_service", fake_check):
            resp = self._client(main).get("/health")
        assert resp.status_code == 503

    def test_results_are_cached_for_a_few_seconds(self):
        main = _import_main()
        calls = {"n": 0}

        async def fake_check(client, name, url, headers=None):
            calls["n"] += 1
            return {"name": name, "status": "healthy", "status_code": 200}

        with patch.object(main, "_check_service", fake_check):
            c = self._client(main)
            c.get("/health")
            first = calls["n"]
            c.get("/health")
        assert first > 0
        assert calls["n"] == first


class TestLlmHealthTarget:
    def test_probe_present_with_the_bearer_header_when_configured(self, monkeypatch):
        monkeypatch.setenv("LLM_BASE_URL", "http://llm.internal:11434/v1/")
        monkeypatch.setenv("LLM_MODEL", "llama3")
        monkeypatch.setenv("LLM_API_KEY", "s3cret-key")
        monkeypatch.delenv("OVERPASS_GENERATOR", raising=False)
        main = _import_main()
        targets = {t.name: t for t in main.build_health_targets(main.config)}
        assert targets["llm"].url == "http://llm.internal:11434/v1/models"
        assert targets["llm"].optional is True
        assert targets["llm"].headers == {"Authorization": "Bearer s3cret-key"}
        assert "s3cret-key" not in repr(targets["llm"])

    def test_probe_absent_when_not_configured(self, monkeypatch):
        for key in ("LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY"):
            monkeypatch.delenv(key, raising=False)
        main = _import_main()
        assert "llm" not in {t.name for t in main.build_health_targets(main.config)}

    async def test_check_service_sends_the_target_headers(self):
        main = _import_main()
        client = AsyncMock()
        client.get = AsyncMock(return_value=httpx.Response(200, text="ok"))
        result = await main._check_service(
            client, "llm", "http://llm.internal/v1/models", headers={"Authorization": "Bearer x"}
        )
        assert result["status"] == "healthy"
        assert client.get.call_args.kwargs["headers"] == {"Authorization": "Bearer x"}

    async def test_check_service_without_headers_keeps_the_old_call_shape(self):
        main = _import_main()
        client = AsyncMock()
        client.get = AsyncMock(return_value=httpx.Response(200, text="ok"))
        await main._check_service(client, "nominatim", "http://nominatim/status")
        assert "headers" not in client.get.call_args.kwargs

    def test_llm_down_never_fails_the_aggregate(self, monkeypatch):
        monkeypatch.setenv("LLM_BASE_URL", "http://llm.internal:11434/v1")
        monkeypatch.setenv("LLM_MODEL", "llama3")
        monkeypatch.setenv("LLM_API_KEY", "s3cret-key")
        main = _import_main()

        async def fake_check(client, name, url, headers=None):
            if name == "llm":
                return {"name": name, "status": "unhealthy", "detail": "timeout"}
            return {"name": name, "status": "healthy", "status_code": 200}

        from starlette.testclient import TestClient

        with patch.object(main, "_check_service", fake_check):
            resp = TestClient(main.app).get("/health")
        assert resp.status_code == 200
        assert resp.json()["services"]["llm"]["optional"] is True

    async def test_authenticated_probe_never_relays_the_error_body(self):
        main = _import_main()
        client = AsyncMock()
        client.get = AsyncMock(
            return_value=httpx.Response(401, json={"error": "invalid key s3cret-key"})
        )
        result = await main._check_service(
            client,
            "llm",
            "http://llm.internal/v1/models",
            headers={"Authorization": "Bearer s3cret-key"},
        )
        assert result["status"] == "unhealthy"
        assert result["detail"] == "HTTP 401"
        assert "s3cret-key" not in str(result)

    async def test_plain_probe_keeps_the_diagnostic_body(self):
        main = _import_main()
        client = AsyncMock()
        client.get = AsyncMock(return_value=httpx.Response(503, text="db not ready"))
        result = await main._check_service(client, "nominatim", "http://nominatim/status")
        assert result["detail"] == "db not ready"

    def test_health_body_never_contains_the_key(self, monkeypatch):
        monkeypatch.setenv("LLM_BASE_URL", "http://llm.internal:11434/v1")
        monkeypatch.setenv("LLM_MODEL", "llama3")
        monkeypatch.setenv("LLM_API_KEY", "s3cret-key")
        monkeypatch.delenv("OVERPASS_GENERATOR", raising=False)
        main = _import_main()
        client = AsyncMock()

        async def get(url, **kwargs):
            if url.endswith("/v1/models"):
                return httpx.Response(401, json={"error": "invalid key s3cret-key"})
            return httpx.Response(200, text="ok")

        client.get = AsyncMock(side_effect=get)
        from starlette.testclient import TestClient

        with patch.object(main, "http_client", client):
            resp = TestClient(main.app).get("/health")
        assert resp.status_code == 200
        assert resp.json()["services"]["llm"]["status"] == "unhealthy"
        assert "s3cret-key" not in resp.text

    def test_probe_absent_when_the_llm_is_configured_but_not_selected(self, monkeypatch):
        monkeypatch.setenv("LLM_BASE_URL", "http://llm.internal:11434/v1")
        monkeypatch.setenv("LLM_MODEL", "llama3")
        monkeypatch.setenv("LLM_API_KEY", "s3cret-key")
        monkeypatch.setenv("OVERPASS_GENERATOR", "keyword")
        main = _import_main()
        assert "llm" not in {t.name for t in main.build_health_targets(main.config)}


class TestHealthSkip:
    def test_skipped_targets_are_absent(self, monkeypatch):
        monkeypatch.setenv(
            "HEALTH_SKIP", "nominatim-ui, overpassbot,overpass-ultra,graphhopper-maps ,tileserver"
        )
        main = _import_main()
        names = {t.name for t in main.build_health_targets(main.config)}
        assert names == {"nominatim", "overpass", "graphhopper"}

    def test_blank_skip_changes_nothing(self, monkeypatch):
        monkeypatch.setenv("HEALTH_SKIP", " , ,")
        main = _import_main()
        names = {t.name for t in main.build_health_targets(main.config)}
        assert {"tileserver", "nominatim", "overpass", "graphhopper", "nominatim-ui"} <= names

    def test_unknown_name_warns_and_is_ignored(self, monkeypatch, caplog):
        monkeypatch.setenv("HEALTH_SKIP", "tileserver,frontend")
        main = _import_main()
        # Importing main re-configures the root logger and drops pytest's capture
        # handler; put it back so the warning from a fresh call is visible.
        root = logging.getLogger()
        root.addHandler(caplog.handler)
        try:
            with caplog.at_level("WARNING"):
                names = {t.name for t in main.build_health_targets(main.config)}
        finally:
            root.removeHandler(caplog.handler)
        assert "tileserver" not in names
        assert any(
            "HEALTH_SKIP" in r.getMessage() and "'frontend'" in r.getMessage()
            for r in caplog.records
        )

    def test_skipping_a_core_service_keeps_the_aggregate_healthy(self, monkeypatch):
        monkeypatch.setenv("HEALTH_SKIP", "tileserver")
        main = _import_main()

        async def fake_check(client, name, url, headers=None):
            if name == "tileserver":
                raise AssertionError("a skipped target must never be probed")
            return {"name": name, "status": "healthy", "status_code": 200}

        from starlette.testclient import TestClient

        with patch.object(main, "_check_service", fake_check):
            resp = TestClient(main.app).get("/health")
        assert resp.status_code == 200
        assert "tileserver" not in resp.json()["services"]
