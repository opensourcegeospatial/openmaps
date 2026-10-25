"""Tests for config loading: 3-layer precedence (defaults -> config.json -> env vars)."""

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest


def _fresh_load_config(config_json=None, env_vars=None):
    """Import main fresh and call load_config with optional overrides."""
    # Remove cached module
    sys.modules.pop("main", None)

    patches = {}
    if env_vars:
        patches = env_vars

    with (
        patch.dict(
            sys.modules, {"overpassbot": None, "overpassbot.OverpassBot": None}
        ),
        patch.dict("os.environ", patches, clear=False),
    ):
        sys.modules.pop("main", None)

        import main as m

        return m.load_config


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """Remove any env vars that would interfere with config tests."""
    for var in ("GEOCODE_URL", "REVERSE_GEOCODE_URL", "GRAPHHOPPER_URL", "OVERPASS_API"):
        monkeypatch.delenv(var, raising=False)


def test_defaults_when_no_config_file(tmp_path, monkeypatch):
    """When config.json doesn't exist, defaults are used."""
    sys.modules.pop("main", None)

    with patch.dict(sys.modules, {"overpassbot": None, "overpassbot.OverpassBot": None}):
        import main

        with patch.object(Path, "exists", return_value=False):
            result = main.load_config()

    # Compose DNS names: never a public service.
    assert result["geocode_url"] == "http://nominatim:8080/search"
    assert result["reverse_geocode_url"] == "http://nominatim:8080/reverse"
    assert result["graphhopper_url"] == "http://graphhopper:8989/route"
    assert result["overpass_url"] == "http://overpass:80/api/interpreter"
    sys.modules.pop("main", None)


def test_config_json_overrides_defaults(tmp_path, monkeypatch):
    """config.json values override hardcoded defaults."""
    config_data = {
        "geocode_url": "http://custom-nominatim:8080/search",
        "overpass_url": "http://custom-overpass:80/api/interpreter",
    }
    config_file = tmp_path / "config.json"
    config_file.write_text(json.dumps(config_data))

    sys.modules.pop("main", None)
    with patch.dict(sys.modules, {"overpassbot": None, "overpassbot.OverpassBot": None}):
        import main

        # Patch the config path to our temp file
        with patch.object(
            Path, "__truediv__", return_value=config_file
        ):
            result = main.load_config()

    # Overridden values
    assert result["geocode_url"] == "http://custom-nominatim:8080/search"
    assert result["overpass_url"] == "http://custom-overpass:80/api/interpreter"
    # Non-overridden values stay as defaults
    assert result["reverse_geocode_url"] == "http://nominatim:8080/reverse"
    assert result["graphhopper_url"] == "http://graphhopper:8989/route"
    sys.modules.pop("main", None)


def test_env_vars_override_config_json(tmp_path, monkeypatch):
    """Environment variables take highest precedence."""
    config_data = {
        "geocode_url": "http://from-config/search",
    }
    config_file = tmp_path / "config.json"
    config_file.write_text(json.dumps(config_data))

    monkeypatch.setenv("GEOCODE_URL", "http://from-env/search")
    monkeypatch.setenv("OVERPASS_API", "http://from-env/overpass")

    sys.modules.pop("main", None)
    with patch.dict(sys.modules, {"overpassbot": None, "overpassbot.OverpassBot": None}):
        import main

        with patch.object(Path, "__truediv__", return_value=config_file):
            result = main.load_config()

    # Env var overrides config.json
    assert result["geocode_url"] == "http://from-env/search"
    # Env var overrides default
    assert result["overpass_url"] == "http://from-env/overpass"
    sys.modules.pop("main", None)


def test_all_env_var_mappings(monkeypatch):
    """Each env var maps to the correct config key."""
    monkeypatch.setenv("GEOCODE_URL", "http://g")
    monkeypatch.setenv("REVERSE_GEOCODE_URL", "http://rg")
    monkeypatch.setenv("GRAPHHOPPER_URL", "http://gh")
    monkeypatch.setenv("OVERPASS_API", "http://op")

    sys.modules.pop("main", None)
    with patch.dict(sys.modules, {"overpassbot": None, "overpassbot.OverpassBot": None}):
        import main

        result = main.load_config()

    assert result["geocode_url"] == "http://g"
    assert result["reverse_geocode_url"] == "http://rg"
    assert result["graphhopper_url"] == "http://gh"
    assert result["overpass_url"] == "http://op"
    sys.modules.pop("main", None)
