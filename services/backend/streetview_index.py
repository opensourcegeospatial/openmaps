"""Build panoramas.json, the street-view index the backend serves.

A port of the Python step in init/init-streetview.sh, so a thin deployment
(no init containers) gets its index from the backend itself. Same inputs, same
output: every image under <streetview>/panoramas/ with a <name>.json sidecar
becomes an entry; sidecars without an image are only counted; a panoramas.json
with no sidecars at all is hand-curated and never touched. Pure standard
library, safe to run in a worker thread at startup.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

logger = logging.getLogger("openmaps.streetview")

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
INDEX_NAME = "panoramas.json"
PANORAMAS_SUBDIR = "panoramas"


def _panoramas_dir(streetview_dir: Path) -> Path:
    return streetview_dir / PANORAMAS_SUBDIR


def _index_file(streetview_dir: Path) -> Path:
    return streetview_dir / INDEX_NAME


def _sidecars(panoramas_dir: Path) -> list[Path]:
    return sorted(
        p for p in panoramas_dir.iterdir() if p.is_file() and p.suffix.lower() == ".json"
    )


def _images(panoramas_dir: Path) -> dict[str, str]:
    """Image file names keyed by basename (without the extension)."""
    images: dict[str, str] = {}
    for p in panoramas_dir.iterdir():
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS:
            images[p.stem] = p.name
    return images


def build_index(panoramas_dir: Path) -> list[dict]:
    """Entries for every image with a valid sidecar, in name order. Skips are
    logged at INFO with the init script's wording."""
    entries: list[dict] = []
    images = _images(panoramas_dir)
    no_metadata = 0
    for name, image_file in sorted(images.items()):
        sidecar = panoramas_dir / f"{name}.json"
        if not sidecar.is_file():
            no_metadata += 1
            logger.info("SKIP %s (no %s.json metadata)", image_file, name)
            continue
        try:
            meta = json.loads(sidecar.read_text())
        except (ValueError, OSError) as e:
            logger.info("SKIP %s (invalid JSON: %s)", image_file, e)
            continue
        if not isinstance(meta, dict) or meta.get("lat") is None or meta.get("lon") is None:
            logger.info("SKIP %s (missing lat/lon in metadata)", image_file)
            continue
        try:
            entry = {
                "id": meta.get("id", name),
                "lat": float(meta["lat"]),
                "lon": float(meta["lon"]),
                "heading": float(meta.get("heading", 0)),
                "name": meta.get("address", meta.get("name", name)),
                # The backend serves this exact file, so any image extension and
                # ids that differ from the basename both work.
                "file": image_file,
            }
            if meta.get("date"):
                entry["date"] = str(meta["date"])
            if meta.get("elevation") is not None:
                entry["elevation"] = float(meta["elevation"])
        except (TypeError, ValueError) as e:
            logger.info("SKIP %s (bad number in metadata: %s)", image_file, e)
            continue
        entries.append(entry)

    orphaned = sum(1 for p in _sidecars(panoramas_dir) if p.stem not in images)
    logger.info(
        "%d panorama(s) indexed, %d without metadata, %d orphaned JSON(s)",
        len(entries),
        no_metadata,
        orphaned,
    )
    return entries


def _inputs(panoramas_dir: Path) -> list[Path]:
    return _sidecars(panoramas_dir) + [panoramas_dir / f for f in _images(panoramas_dir).values()]


def index_state(streetview_dir: Path) -> str:
    """'absent' (no panoramas directory), 'hand-curated' (an index exists but no
    sidecars do: the operator owns that file), 'missing', 'stale' (a sidecar or
    image is newer than the index, or a panorama was removed) or 'current'."""
    panoramas_dir = _panoramas_dir(streetview_dir)
    if not panoramas_dir.is_dir():
        return "absent"
    index_file = _index_file(streetview_dir)
    if not _sidecars(panoramas_dir):
        return "hand-curated" if index_file.is_file() else "missing"
    if not index_file.is_file():
        return "missing"
    index_mtime = index_file.stat().st_mtime
    # The directory's own mtime changes whenever an entry is created, deleted or
    # renamed (unlike writing panoramas.json itself, which lives one level up in
    # streetview_dir and never touches it), so it catches a deletion that would
    # otherwise leave every *surviving* file older than the index.
    if panoramas_dir.stat().st_mtime > index_mtime:
        return "stale"
    if any(p.stat().st_mtime > index_mtime for p in _inputs(panoramas_dir)):
        return "stale"
    return "current"


def write_index(index_file: Path, entries: list[dict]) -> None:
    """Temp file plus atomic rename, so a crash never leaves a truncated index."""
    index_file.parent.mkdir(parents=True, exist_ok=True)
    tmp = index_file.with_name(index_file.name + ".tmp")
    tmp.write_text(json.dumps(entries, indent=2))
    os.replace(tmp, index_file)


def ensure_index(streetview_dir: Path) -> str:
    """Build the index when it is missing or stale and the directory is
    writable. Returns 'built', 'kept', 'unwritable' or 'absent'."""
    state = index_state(streetview_dir)
    if state == "absent":
        return "absent"
    if state in ("current", "hand-curated"):
        return "kept"
    if not os.access(streetview_dir, os.W_OK):
        return "unwritable"

    panoramas_dir = _panoramas_dir(streetview_dir)
    entries = build_index(panoramas_dir)
    index_file = _index_file(streetview_dir)
    write_index(index_file, entries)
    # Files copied in from another machine can carry future timestamps; give the
    # index the newest input's mtime (the panoramas directory included, so a
    # rebuild right after a deletion is immediately "current") so it is not
    # "stale" forever.
    newest = max(
        (p.stat().st_mtime for p in _inputs(panoramas_dir)),
        default=0.0,
    )
    newest = max(newest, panoramas_dir.stat().st_mtime)
    if newest > index_file.stat().st_mtime:
        os.utime(index_file, (newest, newest))
    if not entries and _images(panoramas_dir):
        logger.warning(
            "Images found but no panoramas indexed; each image needs a <name>.json "
            "sidecar with id, lat and lon"
        )
    return "built"
