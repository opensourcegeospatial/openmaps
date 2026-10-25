"""Tests for config propagation: env vars override config.json, verified via /config endpoint."""

import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

ENV_VAR_KEYS = ("GEOCODE_URL", "REVERSE_GEOCODE_URL", "GRAPHHOPPER_URL", "OVERPASS_API")

# Built-in defaults are the compose DNS names: a missing config.json must never
# silently point /overpass at a public service.
HARDCODED_DEFAULTS = {
    "geocode_url": "http://nominatim:8080/search",
    "reverse_geocode_url": "http://nominatim:8080/reverse",
    "graphhopper_url": "http://graphhopper:8989/route",
    "overpass_url": "http://overpass:80/api/interpreter",
}


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """Remove config env vars so tests start from a clean slate."""
    for var in ENV_VAR_KEYS:
        monkeypatch.delenv(var, raising=False)


def _make_client(monkeypatch, env_overrides=None, config_json_data=None,
                 config_file_exists=True):
    """Build a TestClient with fresh module import, optional env/config overrides.

    Args:
        monkeypatch: pytest monkeypatch fixture.
        env_overrides: dict of env vars to set before import.
        config_json_data: dict to write as config.json content (None = use real file).
        config_file_exists: if False, pretend config.json doesn't exist.
    """
    if env_overrides:
        for k, v in env_overrides.items():
            monkeypatch.setenv(k, v)

    sys.modules.pop("main", None)

    with patch.dict(sys.modules, {"overpass": None, "overpass.OverpassBot": None}):
        # Optionally override config.json
        if not config_file_exists:
            with patch.object(Path, "exists", return_value=False):
                sys.modules.pop("main", None)
                import main
        elif config_json_data is not None:
            tmp = tempfile.NamedTemporaryFile(
                mode="w", suffix=".json", delete=False, dir=str(Path(__file__).parent)
            )
            json.dump(config_json_data, tmp)
            tmp.close()
            tmp_path = Path(tmp.name)
            try:
                with patch.object(Path, "__truediv__", return_value=tmp_path):
                    sys.modules.pop("main", None)
                    import main
            finally:
                os.unlink(tmp.name)
        else:
            sys.modules.pop("main", None)
            import main

        main.overpass_bot = None
        from starlette.testclient import TestClient
        client = TestClient(main.app)
        return client


# ─── Env var overrides verified via /config endpoint ──────────────────────────


def test_geocode_url_env_overrides_config(monkeypatch):
    """GEOCODE_URL env var overrides config.json geocode URL, verified via /config."""
    client = _make_client(monkeypatch, env_overrides={
        "GEOCODE_URL": "http://env-geocode:9999/search",
    })
    resp = client.get("/config")
    assert resp.status_code == 200
    assert resp.json()["geocode_url"] == "http://env-geocode:9999/search"


def test_graphhopper_url_env_overrides_config(monkeypatch):
    """GRAPHHOPPER_URL env var overrides config.json GraphHopper URL."""
    client = _make_client(monkeypatch, env_overrides={
        "GRAPHHOPPER_URL": "http://env-gh:1234/route",
    })
    resp = client.get("/config")
    assert resp.status_code == 200
    assert resp.json()["graphhopper_url"] == "http://env-gh:1234/route"


def test_overpass_api_env_overrides_config(monkeypatch):
    """OVERPASS_API env var overrides config.json Overpass URL."""
    client = _make_client(monkeypatch, env_overrides={
        "OVERPASS_API": "http://env-overpass:5555/api/interpreter",
    })
    resp = client.get("/config")
    assert resp.status_code == 200
    assert resp.json()["overpass_url"] == "http://env-overpass:5555/api/interpreter"


def test_reverse_geocode_url_env_overrides_config(monkeypatch):
    """REVERSE_GEOCODE_URL env var overrides config.json reverse geocode URL."""
    client = _make_client(monkeypatch, env_overrides={
        "REVERSE_GEOCODE_URL": "http://env-reverse:8080/reverse",
    })
    resp = client.get("/config")
    assert resp.status_code == 200
    assert resp.json()["reverse_geocode_url"] == "http://env-reverse:8080/reverse"


# ─── Fallthrough behavior ────────────────────────────────────────────────────


def test_missing_env_vars_fall_through_to_config_json(monkeypatch):
    """When no env vars are set, /config returns values from config.json."""
    custom_config = {
        "geocode_url": "http://config-json-geocode/search",
        "reverse_geocode_url": "http://config-json-reverse/reverse",
        "graphhopper_url": "http://config-json-gh/route",
        "overpass_url": "http://config-json-overpass/api",
    }
    client = _make_client(monkeypatch, config_json_data=custom_config)
    resp = client.get("/config")
    assert resp.status_code == 200
    data = resp.json()
    assert data["geocode_url"] == "http://config-json-geocode/search"
    assert data["reverse_geocode_url"] == "http://config-json-reverse/reverse"
    assert data["graphhopper_url"] == "http://config-json-gh/route"
    assert data["overpass_url"] == "http://config-json-overpass/api"


def test_missing_config_json_falls_through_to_defaults(monkeypatch):
    """When config.json is missing and no env vars set, /config returns hardcoded defaults."""
    client = _make_client(monkeypatch, config_file_exists=False)
    resp = client.get("/config")
    assert resp.status_code == 200
    data = resp.json()
    assert data["geocode_url"] == HARDCODED_DEFAULTS["geocode_url"]
    assert data["reverse_geocode_url"] == HARDCODED_DEFAULTS["reverse_geocode_url"]
    assert data["graphhopper_url"] == HARDCODED_DEFAULTS["graphhopper_url"]
    assert data["overpass_url"] == HARDCODED_DEFAULTS["overpass_url"]


def test_empty_env_override_falls_back_to_config_json(monkeypatch):
    """Compose passes GEOCODE_URL="${GEOCODE_URL:-}" through, i.e. an empty
    string when unset; that must mean "not overridden", not "use an empty URL"."""
    client = _make_client(
        monkeypatch,
        env_overrides={"GEOCODE_URL": "", "OVERPASS_API": "   "},
        config_json_data={
            "geocode_url": "http://config-json-nominatim/search",
            "overpass_url": "http://config-json-overpass/api",
        },
    )
    data = client.get("/config").json()
    assert data["geocode_url"] == "http://config-json-nominatim/search"
    assert data["overpass_url"] == "http://config-json-overpass/api"
