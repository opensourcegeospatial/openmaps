"""Startup must not crash on a malformed numeric env var; it logs and falls back."""

import logging
import sys
from unittest.mock import patch


def _import_main():
    with patch.dict(sys.modules, {"overpassbot": None, "overpassbot.OverpassBot": None}):
        sys.modules.pop("main", None)
        import main

        return main


def test_env_int_falls_back_and_clamps(monkeypatch):
    main = _import_main()
    monkeypatch.setenv("X_INT", "three")
    assert main.env_int("X_INT", 3, lo=2, hi=6) == 3
    monkeypatch.setenv("X_INT", "99")
    assert main.env_int("X_INT", 3, lo=2, hi=6) == 6
    monkeypatch.delenv("X_INT")
    assert main.env_int("X_INT", 3, lo=2, hi=6) == 3


def test_env_float_falls_back(monkeypatch):
    main = _import_main()
    monkeypatch.setenv("X_FLOAT", "fast")
    assert main.env_float("X_FLOAT", 5.0, lo=0.5, hi=60.0) == 5.0


def test_malformed_routing_alternatives_env_does_not_crash_import(monkeypatch):
    monkeypatch.setenv("ROUTING_MAX_ALTERNATIVES", "three")
    main = _import_main()
    assert main.ROUTING_MAX_ALTERNATIVES == 3
    sys.modules.pop("main", None)


def test_nominatim_language_env_override(monkeypatch):
    monkeypatch.setenv("NOMINATIM_LANGUAGE", "nn,nb")
    main = _import_main()
    assert main.NOMINATIM_LANGUAGE == "nn,nb"
    sys.modules.pop("main", None)


def test_nominatim_language_blank_env_uses_default(monkeypatch):
    # Compose passes "${NOMINATIM_LANGUAGE:-...}"; an explicitly blank value
    # must mean "default", not "no language".
    monkeypatch.setenv("NOMINATIM_LANGUAGE", "   ")
    main = _import_main()
    assert main.NOMINATIM_LANGUAGE == "nb,nn,no,en"
    sys.modules.pop("main", None)


def test_env_bool_parses_and_falls_back(monkeypatch, caplog):
    main = _import_main()
    for value in ("1", "true", "YES", " True "):
        monkeypatch.setenv("X_BOOL", value)
        assert main.env_bool("X_BOOL", False) is True
    for value in ("0", "false", "No"):
        monkeypatch.setenv("X_BOOL", value)
        assert main.env_bool("X_BOOL", True) is False
    # Importing main re-configures the root logger and drops pytest's capture
    # handler; put it back so the warning below is visible.
    root = logging.getLogger()
    root.addHandler(caplog.handler)
    try:
        with caplog.at_level("WARNING"):
            monkeypatch.setenv("X_BOOL", "maybe")
            assert main.env_bool("X_BOOL", True) is True
    finally:
        root.removeHandler(caplog.handler)
    assert any(
        "X_BOOL" in r.getMessage() and "'maybe'" in r.getMessage() for r in caplog.records
    )
    monkeypatch.delenv("X_BOOL")
    assert main.env_bool("X_BOOL", False) is False
    sys.modules.pop("main", None)
