"""The backend builds panoramas.json at startup (a thin deployment has no init
container) unless STREETVIEW_INDEX_ON_START is off, and a failing build never
stops the app from coming up."""

import json
import logging
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

BBOX = {"west": 0, "south": 0, "east": 20, "north": 70}


@pytest.fixture(autouse=True)
def _clean_main():
    sys.modules.pop("main", None)
    yield
    sys.modules.pop("main", None)


def _import_main(monkeypatch, streetview_dir: Path, on_start: str | None):
    monkeypatch.delenv("STREETVIEW_INDEX_ON_START", raising=False)
    if on_start is not None:
        monkeypatch.setenv("STREETVIEW_INDEX_ON_START", on_start)
    monkeypatch.setenv("STREETVIEW_DIR", str(streetview_dir))
    with patch.dict(sys.modules, {"overpassbot": None, "overpassbot.OverpassBot": None}):
        sys.modules.pop("main", None)
        import main

        return main


def _seed(streetview_dir: Path) -> None:
    panoramas = streetview_dir / "panoramas"
    panoramas.mkdir(parents=True)
    (panoramas / "a.jpg").write_bytes(b"\xff\xd8fake")
    (panoramas / "a.json").write_text(json.dumps({"id": "a", "lat": 59.9, "lon": 10.7}))


def _start_and_list(main) -> dict:
    from starlette.testclient import TestClient

    with TestClient(main.app) as client:
        return client.get("/streetview/panoramas", params=BBOX).json()


def test_index_is_built_at_startup_by_default(tmp_path, monkeypatch):
    _seed(tmp_path)
    main = _import_main(monkeypatch, tmp_path, None)
    body = _start_and_list(main)
    assert (tmp_path / "panoramas.json").is_file()
    assert [f["properties"]["id"] for f in body["features"]] == ["a"]


def test_index_is_not_built_when_disabled(tmp_path, monkeypatch):
    _seed(tmp_path)
    main = _import_main(monkeypatch, tmp_path, "false")
    body = _start_and_list(main)
    assert not (tmp_path / "panoramas.json").exists()
    assert body["features"] == []


def test_startup_survives_an_index_failure(tmp_path, monkeypatch):
    _seed(tmp_path)
    main = _import_main(monkeypatch, tmp_path, None)
    with patch.object(main.streetview_index, "ensure_index", side_effect=OSError("disk gone")):
        from starlette.testclient import TestClient

        with TestClient(main.app) as client:
            assert client.get("/config").status_code == 200


def test_unwritable_index_logs_a_warning(tmp_path, monkeypatch, caplog):
    _seed(tmp_path)
    main = _import_main(monkeypatch, tmp_path, None)
    # Importing main re-configures the root logger and drops pytest's capture
    # handler; put it back so the warning from startup is visible.
    root = logging.getLogger()
    root.addHandler(caplog.handler)
    try:
        with caplog.at_level("WARNING"):
            with patch.object(main.streetview_index, "ensure_index", return_value="unwritable"):
                from starlette.testclient import TestClient

                with TestClient(main.app):
                    pass
    finally:
        root.removeHandler(caplog.handler)
    assert any(
        r.levelname == "WARNING" and "unwritable" in r.getMessage() for r in caplog.records
    )


def _start_and_probe(main, caplog) -> tuple[int, int, dict]:
    """Start the app and return the status of /config, the status of
    /streetview/panoramas and its body. Records at ERROR or above fail the
    caller, since an absent or empty panorama folder is a normal setup."""
    from starlette.testclient import TestClient

    # Importing main re-configures the root logger and drops pytest's capture
    # handler; put it back so records from startup are visible.
    root = logging.getLogger()
    root.addHandler(caplog.handler)
    try:
        with caplog.at_level(logging.INFO):
            with TestClient(main.app) as client:
                config = client.get("/config")
                panoramas = client.get("/streetview/panoramas", params=BBOX)
    finally:
        root.removeHandler(caplog.handler)
    # The startup line proves the records were captured, so "no ERROR" means something.
    assert any("Street-view index at startup" in r.getMessage() for r in caplog.records)
    errors = [r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR]
    assert errors == []
    return config.status_code, panoramas.status_code, panoramas.json()


def test_startup_with_an_empty_streetview_dir_serves_an_empty_index(
    tmp_path, monkeypatch, caplog
):
    main = _import_main(monkeypatch, tmp_path, None)
    config_status, panoramas_status, body = _start_and_probe(main, caplog)
    assert config_status == 200
    assert panoramas_status == 200
    assert body == {"type": "FeatureCollection", "features": []}


def test_startup_with_an_empty_panoramas_subdir_serves_an_empty_index(
    tmp_path, monkeypatch, caplog
):
    (tmp_path / "panoramas").mkdir()
    main = _import_main(monkeypatch, tmp_path, None)
    config_status, panoramas_status, body = _start_and_probe(main, caplog)
    assert config_status == 200
    assert panoramas_status == 200
    assert body == {"type": "FeatureCollection", "features": []}
    assert json.loads((tmp_path / "panoramas.json").read_text()) == []


def test_startup_with_a_missing_streetview_dir_stays_healthy(tmp_path, monkeypatch, caplog):
    main = _import_main(monkeypatch, tmp_path / "does-not-exist", None)
    config_status, panoramas_status, body = _start_and_probe(main, caplog)
    assert config_status == 200
    assert panoramas_status == 200
    assert body == {"type": "FeatureCollection", "features": []}
    assert not (tmp_path / "does-not-exist").exists()
