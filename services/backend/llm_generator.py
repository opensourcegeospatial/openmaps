"""Natural-language → Overpass tag filters through an OpenAI-compatible chat API
(for example a local Ollama server).

The model's reply is plain text; ``main.build_overpass_query_from_model`` extracts
the ``nwr[...]`` chains from it, so this module never touches Overpass QL syntax.
It only has to obtain text, or ``None`` when anything goes wrong.

Secrets: the API key is read once from the environment and used only in the
``Authorization`` header. Nothing in this module logs, returns or serialises it.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass, field

import httpx

logger = logging.getLogger("openmaps.llm")

GENERATORS: tuple[str, ...] = ("auto", "byt5", "llm", "keyword")

SYSTEM_PROMPT = (
    "You convert a short description of map objects into Overpass QL tag filters "
    "for OpenStreetMap. Reply with one filter chain per line, each of the form "
    "nwr[key=value] or nwr[key=value][key2=value2]. Use only OpenStreetMap keys "
    "and values. Do not write area, bbox or out statements, code fences or any "
    "explanation. Descriptions may be in Norwegian or English."
)

# Alternating user/assistant examples; kept short so the whole prompt stays small.
FEW_SHOT: tuple[tuple[str, str], ...] = (
    ("bensinstasjoner", "nwr[amenity=fuel]"),
    ("italienske restauranter", "nwr[amenity=restaurant][cuisine=italian]"),
    ("skoler og barnehager", "nwr[amenity=school]\nnwr[amenity=kindergarten]"),
    ("grocery stores", "nwr[shop=supermarket]\nnwr[shop=convenience]"),
)

DEFAULT_TIMEOUT_SECONDS = 30.0
DEFAULT_MAX_TOKENS = 200
CONNECT_TIMEOUT_SECONDS = 5.0


@dataclass(frozen=True)
class LlmSettings:
    base_url: str
    model: str
    # Excluded from repr/str so a logged or traced settings object never shows it.
    api_key: str = field(repr=False)
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
    max_tokens: int = DEFAULT_MAX_TOKENS

    @property
    def configured(self) -> bool:
        """All three of URL, model and key are present; nothing else is required."""
        return bool(self.base_url and self.model and self.api_key)

    def redacted(self) -> dict[str, str]:
        """The /config view: everything except the key itself."""
        return {
            "llm_base_url": self.base_url,
            "llm_model": self.model,
            "llm_api_key": "set" if self.api_key else "unset",
        }


def _read_float(env: Mapping[str, str], name: str, default: float, lo: float, hi: float) -> float:
    try:
        value = float(env.get(name, "").strip() or default)
    except ValueError:
        return default
    return min(hi, max(lo, value))


def _read_int(env: Mapping[str, str], name: str, default: int, lo: int, hi: int) -> int:
    try:
        value = int(env.get(name, "").strip() or default)
    except ValueError:
        return default
    return min(hi, max(lo, value))


def settings_from_env(env: Mapping[str, str] | None = None) -> LlmSettings:
    """Read the LLM_* knobs. Blank values mean unset (compose passes "${VAR:-}")."""
    if env is None:
        import os

        env = os.environ
    return LlmSettings(
        base_url=env.get("LLM_BASE_URL", "").strip().rstrip("/"),
        model=env.get("LLM_MODEL", "").strip(),
        api_key=env.get("LLM_API_KEY", "").strip(),
        timeout_seconds=_read_float(
            env, "LLM_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS, 1.0, 600.0
        ),
        max_tokens=_read_int(env, "LLM_MAX_TOKENS", DEFAULT_MAX_TOKENS, 16, 4096),
    )


def build_messages(nl: str) -> list[dict[str, str]]:
    """System prompt, the few-shot pairs, then the user's text."""
    messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for question, answer in FEW_SHOT:
        messages.append({"role": "user", "content": question})
        messages.append({"role": "assistant", "content": answer})
    messages.append({"role": "user", "content": nl})
    return messages


def select_generator(setting: str, llm_configured: bool, byt5_ready: bool) -> str:
    """Which generator /overpass should use right now (pure)."""
    if setting == "llm":
        return "llm" if llm_configured else "keyword"
    if setting == "byt5":
        return "byt5" if byt5_ready else "keyword"
    if setting == "keyword":
        return "keyword"
    if llm_configured:
        return "llm"
    return "byt5" if byt5_ready else "keyword"


def wants_byt5(setting: str, bot_available: bool, llm_configured: bool) -> bool:
    """Load the 2 GB byt5 model only when it could actually be used."""
    if not bot_available:
        return False
    if setting == "byt5":
        return True
    return setting == "auto" and not llm_configured


async def generate(client: httpx.AsyncClient, settings: LlmSettings, nl: str) -> str | None:
    """Ask the model for tag filters. Returns the reply text, or None after one
    warning when the request fails in any way. The warning names the failure
    class or HTTP status only: exception messages and reply bodies can echo the
    request, and the request carries the key."""
    url = f"{settings.base_url}/chat/completions"
    body = {
        "model": settings.model,
        "messages": build_messages(nl),
        "temperature": 0,
        "max_tokens": settings.max_tokens,
    }
    headers = {"Authorization": f"Bearer {settings.api_key}"}
    timeout = httpx.Timeout(settings.timeout_seconds, connect=CONNECT_TIMEOUT_SECONDS)
    try:
        resp = await client.post(url, json=body, headers=headers, timeout=timeout)
    except httpx.TimeoutException:
        logger.warning("LLM request timed out after %s s", settings.timeout_seconds)
        return None
    except httpx.RequestError as exc:
        logger.warning("LLM request failed: %s", type(exc).__name__)
        return None
    except Exception as exc:  # noqa: BLE001 - a bad LLM_BASE_URL (httpx.InvalidURL) is not a RequestError
        # Last resort: whatever the client raises, the caller gets None and the
        # user gets keyword results. Only the class name is logged.
        logger.warning("LLM request failed: %s", type(exc).__name__)
        return None
    if resp.status_code != 200:
        logger.warning("LLM answered HTTP %s", resp.status_code)
        return None
    try:
        content = resp.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        logger.warning("LLM reply was not a chat completion")
        return None
    if not isinstance(content, str) or not content.strip():
        logger.warning("LLM reply was empty")
        return None
    return content
