"""streetview_index: the backend's port of init-streetview.sh's index builder."""

import json
import os
import time
from pathlib import Path

import pytest

import streetview_index as si


def _panorama(panoramas: Path, name: str, meta: dict | None, ext: str = ".jpg") -> None:
    (panoramas / f"{name}{ext}").write_bytes(b"\xff\xd8fake")
    if meta is not None:
        (panoramas / f"{name}.json").write_text(json.dumps(meta))


@pytest.fixture()
def streetview(tmp_path: Path) -> Path:
    (tmp_path / "panoramas").mkdir()
    return tmp_path


class TestBuildIndex:
    def test_entries_for_images_with_sidecars_in_name_order(self, streetview):
        panoramas = streetview / "panoramas"
        _panorama(
            panoramas,
            "b",
            {
                "id": "pano-b",
                "lat": 60.39,
                "lon": 5.32,
                "heading": 90,
                "address": "Bryggen",
                "date": "2024-06",
                "elevation": 3.5,
            },
            ext=".PNG",
        )
        _panorama(panoramas, "a", {"lat": "59.91", "lon": "10.75"})

        entries = si.build_index(panoramas)

        assert [e["id"] for e in entries] == ["a", "pano-b"]
        assert entries[0] == {
            "id": "a",
            "lat": 59.91,
            "lon": 10.75,
            "heading": 0.0,
            "name": "a",
            "file": "a.jpg",
        }
        assert entries[1]["file"] == "b.PNG"
        assert entries[1]["name"] == "Bryggen"
        assert entries[1]["heading"] == 90.0
        assert entries[1]["date"] == "2024-06"
        assert entries[1]["elevation"] == 3.5

    def test_skips_are_logged_and_orphans_counted(self, streetview, caplog):
        panoramas = streetview / "panoramas"
        _panorama(panoramas, "nometa", None)
        _panorama(panoramas, "badjson", None)
        (panoramas / "badjson.json").write_text("{not json")
        _panorama(panoramas, "nocoords", {"id": "x"})
        _panorama(panoramas, "badnum", {"lat": "north", "lon": 10})
        _panorama(panoramas, "ok", {"lat": 1, "lon": 2})
        (panoramas / "orphan.json").write_text(json.dumps({"lat": 1, "lon": 2}))

        with caplog.at_level("INFO", logger="openmaps.streetview"):
            entries = si.build_index(panoramas)

        assert [e["id"] for e in entries] == ["ok"]
        messages = " | ".join(r.getMessage() for r in caplog.records)
        assert "SKIP nometa.jpg (no nometa.json metadata)" in messages
        assert "SKIP badjson.jpg (invalid JSON" in messages
        assert "SKIP nocoords.jpg (missing lat/lon in metadata)" in messages
        assert "SKIP badnum.jpg (bad number in metadata" in messages
        assert "1 panorama(s) indexed, 1 without metadata, 1 orphaned JSON(s)" in messages

    def test_empty_directory_gives_an_empty_index(self, streetview):
        assert si.build_index(streetview / "panoramas") == []


class TestIndexState:
    def test_absent_without_a_panoramas_directory(self, tmp_path):
        assert si.index_state(tmp_path) == "absent"
        assert si.ensure_index(tmp_path) == "absent"
        assert not (tmp_path / "panoramas.json").exists()

    def test_hand_curated_index_is_kept_when_no_sidecars_exist(self, streetview):
        (streetview / "panoramas.json").write_text("[]")
        assert si.index_state(streetview) == "hand-curated"
        assert si.ensure_index(streetview) == "kept"
        assert (streetview / "panoramas.json").read_text() == "[]"

    def test_missing_then_current_then_stale_then_rebuilt(self, streetview):
        panoramas = streetview / "panoramas"
        _panorama(panoramas, "a", {"lat": 1, "lon": 2})
        assert si.index_state(streetview) == "missing"

        assert si.ensure_index(streetview) == "built"
        assert si.index_state(streetview) == "current"
        assert json.loads((streetview / "panoramas.json").read_text())[0]["id"] == "a"

        # A newer sidecar (even one copied in with a future timestamp) makes the
        # index stale; a rebuild makes it current again.
        later = time.time() + 60
        os.utime(panoramas / "a.json", (later, later))
        assert si.index_state(streetview) == "stale"
        assert si.ensure_index(streetview) == "built"
        assert si.index_state(streetview) == "current"
        assert si.ensure_index(streetview) == "kept"

    def test_removing_a_panorama_makes_the_index_stale_and_rebuilds(self, streetview):
        panoramas = streetview / "panoramas"
        _panorama(panoramas, "a", {"lat": 1, "lon": 2})
        _panorama(panoramas, "b", {"lat": 3, "lon": 4})

        assert si.ensure_index(streetview) == "built"
        index_file = streetview / "panoramas.json"
        assert [e["id"] for e in json.loads(index_file.read_text())] == ["a", "b"]

        # A real removal comes long after the index was written. Where timestamps
        # step coarsely (a Linux container: 1 ms) the removal below would tie with
        # the index write, and a tie is not "newer". So age the inputs and the
        # index first — the survivors stay older than the index, leaving only the
        # directory's own mtime to report the removal.
        now = time.time()
        for path in [*panoramas.iterdir(), panoramas]:
            os.utime(path, (now - 10, now - 10))
        os.utime(index_file, (now - 5, now - 5))

        (panoramas / "b.jpg").unlink()
        (panoramas / "b.json").unlink()

        assert si.index_state(streetview) == "stale"
        assert si.ensure_index(streetview) == "built"
        assert [e["id"] for e in json.loads(index_file.read_text())] == ["a"]
        assert si.index_state(streetview) == "current"
        assert si.ensure_index(streetview) == "kept"

    def test_images_without_sidecars_build_an_empty_index_with_a_warning(self, streetview, caplog):
        _panorama(streetview / "panoramas", "a", None)
        with caplog.at_level("WARNING", logger="openmaps.streetview"):
            assert si.ensure_index(streetview) == "built"
        assert json.loads((streetview / "panoramas.json").read_text()) == []
        assert any("no panoramas indexed" in r.getMessage() for r in caplog.records)

    def test_unwritable_directory_is_reported_not_raised(self, streetview):
        if os.geteuid() == 0:
            pytest.skip("root ignores directory permissions")
        _panorama(streetview / "panoramas", "a", {"lat": 1, "lon": 2})
        streetview.chmod(0o555)
        try:
            assert si.ensure_index(streetview) == "unwritable"
            assert not (streetview / "panoramas.json").exists()
        finally:
            streetview.chmod(0o755)


class TestWriteIndex:
    def test_write_is_atomic_and_leaves_no_temp_file(self, streetview):
        target = streetview / "panoramas.json"
        si.write_index(target, [{"id": "a"}])
        assert json.loads(target.read_text()) == [{"id": "a"}]
        assert not (streetview / "panoramas.json.tmp").exists()

    def test_write_creates_missing_parent_directories(self, tmp_path):
        target = tmp_path / "deeper" / "panoramas.json"
        si.write_index(target, [])
        assert target.read_text() == "[]"
