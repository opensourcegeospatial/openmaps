"""/overpass generator selection through the environment: the LLM path, its
fallbacks, what /config reports, and that the key never leaks."""

import logging
import sys
from unittest.mock import AsyncMock, patch

import httpx
import pytest

BBOX = {"south": 59.9, "west": 10.7, "north": 60.0, "east": 10.8}
LLM_ENV = {
    "LLM_BASE_URL": "http://llm.internal:11434/v1",
    "LLM_MODEL": "llama3",
    "LLM_API_KEY": "s3cret-key",
}
ALL_KNOBS = (
    "OVERPASS_GENERATOR",
    "LLM_TIMEOUT_SECONDS",
    "LLM_MAX_TOKENS",
    "LLM_MAX_CONCURRENT",
    *LLM_ENV,
)


@pytest.fixture(autouse=True)
def _clean_main():
    sys.modules.pop("main", None)
    yield
    sys.modules.pop("main", None)


def _import_main(monkeypatch, env):
    """Import main with exactly `env` for the generator knobs (others cleared)."""
    for key in ALL_KNOBS:
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    with patch.dict(sys.modules, {"overpassbot": None, "overpassbot.OverpassBot": None}):
        sys.modules.pop("main", None)
        import main

        return main


def _client(main):
    from starlette.testclient import TestClient

    return TestClient(main.app)


def _chat(content: str) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


def _http_client(chat_outcome) -> AsyncMock:
    """Chat completions get `chat_outcome` (a Response, or an Exception to raise);
    the Overpass POST gets an empty result."""
    mock = AsyncMock()

    async def post(url, **kwargs):
        if url.endswith("/chat/completions"):
            if isinstance(chat_outcome, Exception):
                raise chat_outcome
            return chat_outcome
        return httpx.Response(200, json={"elements": []})

    mock.post = AsyncMock(side_effect=post)
    return mock


def _overpass_query_sent(mock: AsyncMock) -> str:
    for call in mock.post.call_args_list:
        if not call.args[0].endswith("/chat/completions"):
            return call.kwargs["data"]["data"]
    raise AssertionError("no Overpass request was made")


def _chat_calls(mock: AsyncMock) -> list:
    return [c for c in mock.post.call_args_list if c.args[0].endswith("/chat/completions")]


class TestSelectionThroughEnv:
    def test_auto_uses_the_llm_when_configured(self, monkeypatch):
        main = _import_main(monkeypatch, LLM_ENV)
        mock = _http_client(_chat("nwr[amenity=fuel]"))
        with patch.object(main, "http_client", mock):
            resp = _client(main).get("/overpass", params={"nl": "bensinstasjoner", **BBOX})

        assert resp.status_code == 200
        assert len(_chat_calls(mock)) == 1
        assert _chat_calls(mock)[0].kwargs["headers"] == {"Authorization": "Bearer s3cret-key"}
        query = _overpass_query_sent(mock)
        assert "nwr[amenity=fuel](59.9,10.7,60.0,10.8)" in query
        assert '"name"~' not in query

    def test_auto_without_llm_settings_is_keyword_when_no_model(self, monkeypatch):
        main = _import_main(monkeypatch, {})
        mock = _http_client(_chat("nwr[amenity=fuel]"))
        with patch.object(main, "http_client", mock):
            resp = _client(main).get("/overpass", params={"nl": "bensinstasjoner", **BBOX})

        assert resp.status_code == 200
        assert _chat_calls(mock) == []
        assert '"name"~"bensinstasjoner",i' in _overpass_query_sent(mock)
        assert main.OVERPASS_GENERATOR == "auto"

    def test_keyword_forced_ignores_llm_settings(self, monkeypatch):
        main = _import_main(monkeypatch, {**LLM_ENV, "OVERPASS_GENERATOR": "keyword"})
        mock = _http_client(_chat("nwr[amenity=fuel]"))
        with patch.object(main, "http_client", mock):
            _client(main).get("/overpass", params={"nl": "bensinstasjoner", **BBOX})

        assert _chat_calls(mock) == []
        assert _client(main).get("/config").json()["overpass_generator"] == "keyword"

    def test_forced_llm_without_a_key_serves_keyword_and_says_unavailable(self, monkeypatch):
        env = {
            "OVERPASS_GENERATOR": "llm",
            "LLM_BASE_URL": LLM_ENV["LLM_BASE_URL"],
            "LLM_MODEL": "llama3",
        }
        main = _import_main(monkeypatch, env)
        mock = _http_client(_chat("nwr[amenity=fuel]"))
        with patch.object(main, "http_client", mock):
            resp = _client(main).get("/overpass", params={"nl": "bensinstasjoner", **BBOX})
            config = _client(main).get("/config").json()

        assert resp.status_code == 200
        assert _chat_calls(mock) == []
        assert config["overpass_generator"] == "keyword"
        assert config["overpass_generator_status"] == "unavailable"

    def test_unknown_setting_falls_back_to_auto(self, monkeypatch):
        main = _import_main(monkeypatch, {"OVERPASS_GENERATOR": "banana"})
        assert main.OVERPASS_GENERATOR == "auto"

    def test_concurrency_knob_default_and_clamp(self, monkeypatch):
        assert _import_main(monkeypatch, {}).LLM_MAX_CONCURRENT == 4
        assert _import_main(monkeypatch, {"LLM_MAX_CONCURRENT": "500"}).LLM_MAX_CONCURRENT == 32


class TestLlmFallbacks:
    @pytest.mark.parametrize(
        "outcome",
        [
            httpx.Response(500, text="boom"),
            httpx.ReadTimeout("slow"),
            httpx.InvalidURL("Invalid port: 'notaport'"),
            httpx.Response(
                200,
                json={"choices": [{"message": {"content": "Sorry, I cannot help."}}]},
            ),
        ],
    )
    def test_llm_trouble_falls_back_to_keyword_search(self, monkeypatch, outcome):
        main = _import_main(monkeypatch, LLM_ENV)
        mock = _http_client(outcome)
        with patch.object(main, "http_client", mock):
            resp = _client(main).get("/overpass", params={"nl": "bensinstasjoner", **BBOX})

        assert resp.status_code == 200
        assert '"name"~"bensinstasjoner",i' in _overpass_query_sent(mock)

    def test_chatty_reply_still_yields_filters(self, monkeypatch):
        main = _import_main(monkeypatch, LLM_ENV)
        reply = (
            "Sure! Here you go:\n```\nnwr[\"shop\"=\"supermarket\"]\n"
            "nwr[shop=convenience]\n```"
        )
        mock = _http_client(_chat(reply))
        with patch.object(main, "http_client", mock):
            _client(main).get("/overpass", params={"nl": "dagligvare", **BBOX})

        query = _overpass_query_sent(mock)
        assert 'nwr["shop"="supermarket"](59.9,10.7,60.0,10.8)' in query
        assert "nwr[shop=convenience](59.9,10.7,60.0,10.8)" in query


class TestConfigAndSecrets:
    def test_config_reports_the_generator_and_redacts_the_key(self, monkeypatch):
        main = _import_main(monkeypatch, LLM_ENV)
        resp = _client(main).get("/config")
        data = resp.json()

        assert data["overpass_generator"] == "llm"
        assert data["overpass_generator_status"] == "ready"
        assert data["llm_base_url"] == "http://llm.internal:11434/v1"
        assert data["llm_model"] == "llama3"
        assert data["llm_api_key"] == "set"
        assert data["overpass_model"] == "unavailable"
        assert "s3cret-key" not in resp.text
        assert all(isinstance(v, str) for v in data.values())

    def test_config_without_llm_says_unset(self, monkeypatch):
        data = _client(_import_main(monkeypatch, {})).get("/config").json()
        assert data["llm_api_key"] == "unset"
        assert data["overpass_generator"] == "keyword"
        assert data["overpass_generator_status"] == "ready"

    def test_key_never_reaches_the_logs_or_the_response(self, monkeypatch, caplog):
        main = _import_main(monkeypatch, LLM_ENV)
        # Importing main re-configures the root logger and drops pytest's capture
        # handler; put it back so this test can see what the backend logs.
        root = logging.getLogger()
        root.addHandler(caplog.handler)
        try:
            with caplog.at_level(logging.DEBUG):
                mock = _http_client(httpx.Response(401, json={"error": "invalid key s3cret-key"}))
                with patch.object(main, "http_client", mock):
                    resp = _client(main).get("/overpass", params={"nl": "kafeer", **BBOX})
        finally:
            root.removeHandler(caplog.handler)

        assert resp.status_code == 200
        assert "s3cret-key" not in resp.text
        messages = [record.getMessage() for record in caplog.records]
        assert any("LLM answered HTTP 401" in message for message in messages), messages
        for record in caplog.records:
            assert "s3cret-key" not in record.getMessage()
            assert "s3cret-key" not in str(record.args)


class TestStartup:
    """The lifespan loads byt5 only when it could be used, and /config tells the
    truth while it loads."""

    def _run_lifespan(self, main, monkeypatch):
        """Start the app once with the model module 'available' and the real
        loader replaced by a mock. One request gives the scheduled load task a
        turn on the loop before shutdown, so the mock's await count is settled."""
        from starlette.testclient import TestClient

        monkeypatch.setattr(main, "OVERPASS_BOT_AVAILABLE", True)
        loader = AsyncMock()
        monkeypatch.setattr(main, "_load_model_in_background", loader)
        with TestClient(main.app) as client:
            config = client.get("/config").json()
        return loader, config

    def test_byt5_is_not_loaded_when_the_llm_is_selected(self, monkeypatch):
        main = _import_main(monkeypatch, LLM_ENV)
        loader, config = self._run_lifespan(main, monkeypatch)
        assert loader.await_count == 0
        assert config["overpass_generator"] == "llm"
        assert config["overpass_generator_status"] == "ready"
        assert config["overpass_model"] == "unavailable"

    def test_byt5_is_loaded_when_nothing_better_is_configured(self, monkeypatch):
        main = _import_main(monkeypatch, {})
        loader, _ = self._run_lifespan(main, monkeypatch)
        assert loader.await_count == 1

    def test_byt5_is_not_loaded_when_keyword_is_forced(self, monkeypatch):
        main = _import_main(monkeypatch, {"OVERPASS_GENERATOR": "keyword"})
        loader, config = self._run_lifespan(main, monkeypatch)
        assert loader.await_count == 0
        assert config["overpass_generator"] == "keyword"

    @pytest.mark.parametrize("setting", ["auto", "byt5"])
    def test_state_reports_loading_while_byt5_loads(self, monkeypatch, setting):
        main = _import_main(monkeypatch, {"OVERPASS_GENERATOR": setting})
        monkeypatch.setattr(main, "overpass_bot", None)
        monkeypatch.setattr(main, "overpass_model_status", "loading")
        assert main.generator_state() == ("keyword", "loading")
