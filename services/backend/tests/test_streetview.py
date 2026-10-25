"""/streetview/* serves whatever the init indexer recorded, not only `<id>.jpg`."""

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest


@pytest.fixture()
def client_with_index(tmp_path):
    (tmp_path / "panoramas").mkdir()
    (tmp_path / "panoramas" / "pic-1.png").write_bytes(b"\x89PNG\r\n\x1a\nfake")
    (tmp_path / "panoramas" / "old.jpg").write_bytes(b"\xff\xd8fake")
    (tmp_path / "panoramas.json").write_text(
        json.dumps(
            [
                {"id": "abc", "lat": 59.9, "lon": 10.7, "heading": 0, "file": "pic-1.png"},
                {"id": "old", "lat": 59.9, "lon": 10.7, "heading": 0},
            ]
        )
    )
    with patch.dict(sys.modules, {"overpassbot": None, "overpassbot.OverpassBot": None}):
        sys.modules.pop("main", None)
        from starlette.testclient import TestClient

        import main

        main.STREETVIEW_DIR = Path(tmp_path)
        main._streetview_index = None
        yield TestClient(main.app)
    sys.modules.pop("main", None)


def test_serves_the_indexed_file_with_its_own_media_type(client_with_index):
    resp = client_with_index.get("/streetview/panorama/abc")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("image/png")
    assert "max-age" in resp.headers.get("cache-control", "")


def test_falls_back_to_id_dot_jpg_for_legacy_index_entries(client_with_index):
    resp = client_with_index.get("/streetview/panorama/old")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("image/jpeg")


def test_unknown_id_is_404_and_traversal_is_rejected(client_with_index):
    assert client_with_index.get("/streetview/panorama/nope").status_code == 404
    # Ids are never silently rewritten: anything outside [A-Za-z0-9_-] is rejected.
    assert client_with_index.get("/streetview/panorama/a.b").status_code == 400


def test_index_that_is_not_a_list_is_treated_as_empty(tmp_path):
    (tmp_path / "panoramas.json").write_text(json.dumps({"abc": {"lat": 1, "lon": 2}}))
    with patch.dict(sys.modules, {"overpassbot": None, "overpassbot.OverpassBot": None}):
        sys.modules.pop("main", None)
        from starlette.testclient import TestClient

        import main

        main.STREETVIEW_DIR = Path(tmp_path)
        main._streetview_index = None
        resp = TestClient(main.app).get(
            "/streetview/panoramas", params={"west": 0, "south": 0, "east": 20, "north": 70}
        )
    sys.modules.pop("main", None)
    assert resp.status_code == 200
    assert resp.json()["features"] == []
