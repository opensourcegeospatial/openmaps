"""llm_generator: settings parsing, the prompt, the pure selection rule, and the
one HTTP call to an OpenAI-compatible chat API. The API key must never leave the
Authorization header."""

import logging
from unittest.mock import AsyncMock

import httpx
import pytest

from llm_generator import (
    FEW_SHOT,
    GENERATORS,
    SYSTEM_PROMPT,
    LlmSettings,
    build_messages,
    generate,
    select_generator,
    settings_from_env,
    wants_byt5,
)

SETTINGS = LlmSettings(
    base_url="http://llm.internal:11434/v1",
    model="llama3",
    api_key="s3cret-key",
)


class TestSettings:
    def test_reads_all_knobs_and_strips_a_trailing_slash(self):
        s = settings_from_env(
            {
                "LLM_BASE_URL": " http://llm.internal:11434/v1/ ",
                "LLM_MODEL": "llama3",
                "LLM_API_KEY": "s3cret-key",
                "LLM_TIMEOUT_SECONDS": "12.5",
                "LLM_MAX_TOKENS": "64",
            }
        )
        assert s.base_url == "http://llm.internal:11434/v1"
        assert s.model == "llama3"
        assert s.api_key == "s3cret-key"
        assert s.timeout_seconds == 12.5
        assert s.max_tokens == 64
        assert s.configured is True

    def test_defaults_when_unset(self):
        s = settings_from_env({})
        assert (s.base_url, s.model, s.api_key) == ("", "", "")
        assert s.timeout_seconds == 30.0
        assert s.max_tokens == 200
        assert s.configured is False

    @pytest.mark.parametrize("missing", ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY"])
    def test_not_configured_when_any_of_the_three_is_blank(self, missing):
        env = {
            "LLM_BASE_URL": "http://llm.internal/v1",
            "LLM_MODEL": "llama3",
            "LLM_API_KEY": "s3cret-key",
        }
        env[missing] = "   "
        assert settings_from_env(env).configured is False

    def test_malformed_numbers_fall_back_and_are_clamped(self):
        s = settings_from_env({"LLM_TIMEOUT_SECONDS": "fast", "LLM_MAX_TOKENS": "999999"})
        assert s.timeout_seconds == 30.0
        assert s.max_tokens == 4096
        assert settings_from_env({"LLM_TIMEOUT_SECONDS": "0"}).timeout_seconds == 1.0

    def test_redacted_never_contains_the_key(self):
        view = SETTINGS.redacted()
        assert view == {
            "llm_base_url": "http://llm.internal:11434/v1",
            "llm_model": "llama3",
            "llm_api_key": "set",
        }
        assert "s3cret-key" not in str(view)
        assert settings_from_env({}).redacted()["llm_api_key"] == "unset"

    def test_repr_and_str_never_contain_the_key(self):
        assert "s3cret-key" not in repr(SETTINGS)
        assert "s3cret-key" not in str(SETTINGS)
        assert "s3cret-key" not in f"{SETTINGS}"


class TestPrompt:
    def test_messages_are_system_few_shot_then_the_user_text(self):
        messages = build_messages("bensinstasjoner i nærheten")
        assert messages[0] == {"role": "system", "content": SYSTEM_PROMPT}
        assert len(messages) == 2 + 2 * len(FEW_SHOT)
        for i, (question, answer) in enumerate(FEW_SHOT):
            assert messages[1 + 2 * i] == {"role": "user", "content": question}
            assert messages[2 + 2 * i] == {"role": "assistant", "content": answer}
        assert messages[-1] == {"role": "user", "content": "bensinstasjoner i nærheten"}

    def test_few_shot_answers_are_bare_tag_filters(self):
        for _, answer in FEW_SHOT:
            for line in answer.splitlines():
                assert line.startswith("nwr[") and line.endswith("]")

    def test_system_prompt_forbids_everything_but_filters(self):
        for word in ("nwr[key=value]", "area", "bbox", "explanation", "Norwegian"):
            assert word in SYSTEM_PROMPT


class TestSelection:
    def test_generators_constant(self):
        assert GENERATORS == ("auto", "byt5", "llm", "keyword")

    @pytest.mark.parametrize(
        "setting, llm_configured, byt5_ready, expected",
        [
            ("auto", True, True, "llm"),
            ("auto", True, False, "llm"),
            ("auto", False, True, "byt5"),
            ("auto", False, False, "keyword"),
            ("llm", True, True, "llm"),
            ("llm", False, True, "keyword"),
            ("byt5", True, True, "byt5"),
            ("byt5", True, False, "keyword"),
            ("keyword", True, True, "keyword"),
        ],
    )
    def test_select_generator(self, setting, llm_configured, byt5_ready, expected):
        assert select_generator(setting, llm_configured, byt5_ready) == expected

    @pytest.mark.parametrize(
        "setting, bot_available, llm_configured, expected",
        [
            ("auto", True, False, True),
            ("auto", True, True, False),
            ("auto", False, False, False),
            ("byt5", True, True, True),
            ("byt5", False, False, False),
            ("llm", True, False, False),
            ("keyword", True, False, False),
        ],
    )
    def test_wants_byt5(self, setting, bot_available, llm_configured, expected):
        assert wants_byt5(setting, bot_available, llm_configured) is expected


def _chat_response(content, status: int = 200) -> httpx.Response:
    return httpx.Response(
        status, json={"choices": [{"message": {"role": "assistant", "content": content}}]}
    )


def _client(
    response: httpx.Response | None = None, error: Exception | None = None
) -> AsyncMock:
    client = AsyncMock()
    if error is not None:
        client.post = AsyncMock(side_effect=error)
    else:
        client.post = AsyncMock(return_value=response)
    return client


class TestGenerate:
    async def test_posts_a_chat_completion_with_the_bearer_key(self):
        client = _client(_chat_response("nwr[amenity=fuel]"))

        result = await generate(client, SETTINGS, "bensinstasjoner")

        assert result == "nwr[amenity=fuel]"
        args, kwargs = client.post.call_args
        assert args[0] == "http://llm.internal:11434/v1/chat/completions"
        assert kwargs["headers"] == {"Authorization": "Bearer s3cret-key"}
        assert kwargs["json"]["model"] == "llama3"
        assert kwargs["json"]["temperature"] == 0
        assert kwargs["json"]["max_tokens"] == 200
        assert kwargs["json"]["messages"] == build_messages("bensinstasjoner")
        assert kwargs["timeout"].connect == 5.0
        assert kwargs["timeout"].read == 30.0

    @pytest.mark.parametrize(
        "kind, response, error",
        [
            ("timeout", None, httpx.ReadTimeout("slow")),
            ("connect", None, httpx.ConnectError("refused")),
            ("bad-url", None, httpx.InvalidURL("Invalid port: 'notaport'")),
            ("http-500", httpx.Response(500, text="boom"), None),
            ("http-401", httpx.Response(401, json={"error": "bad key s3cret-key"}), None),
            ("not-json", httpx.Response(200, text="<html>"), None),
            ("no-choices", httpx.Response(200, json={"error": "x"}), None),
            ("no-choice-items", httpx.Response(200, json={"choices": []}), None),
            ("choices-not-a-list", httpx.Response(200, json={"choices": "x"}), None),
            ("empty", _chat_response("   "), None),
            ("not-a-string", _chat_response(["nwr"]), None),
        ],
    )
    async def test_every_failure_returns_none_and_warns_without_the_key(
        self, kind, response, error, caplog
    ):
        client = _client(response=response, error=error)

        with caplog.at_level(logging.WARNING, logger="openmaps.llm"):
            assert await generate(client, SETTINGS, "kafeer") is None

        warnings = [r for r in caplog.records if r.name == "openmaps.llm"]
        assert len(warnings) == 1, kind
        assert "s3cret-key" not in warnings[0].getMessage()
        assert "s3cret-key" not in str(warnings[0].args)
