from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from prometheus_fastapi_instrumentator import Instrumentator
import asyncio
import datetime
import json
import logging
import math
import mimetypes
import threading
import time
import httpx
import polyline
import re
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

import graphhopper_capabilities as ghcaps
import llm_generator
import streetview_index


# ─── Structured Logging ──────────────────────────────────────────────────────
# Backend logs are emitted as one JSON object per line by default so they can be
# shipped/parsed by a log aggregator. Set LOG_FORMAT=text for human-readable
# plain logs during local development. LOG_LEVEL tunes verbosity (default INFO).

# Standard LogRecord attributes — anything NOT in this set that a caller passes
# via `logger.info("msg", extra={...})` is treated as an extra field and merged
# into the JSON output.
_LOGRECORD_RESERVED = frozenset(
    logging.makeLogRecord({}).__dict__.keys()
) | {"message", "asctime"}


class JsonLogFormatter(logging.Formatter):
    """Minimal dependency-free JSON log formatter.

    Emits: timestamp (ISO-8601 UTC), level, logger, message, plus any extra
    fields supplied via `logger.<level>(..., extra={...})`. Exception info is
    rendered into an `exc_info` string field when present.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.datetime.fromtimestamp(
                record.created, tz=datetime.timezone.utc
            ).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _LOGRECORD_RESERVED and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack_info"] = self.formatStack(record.stack_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


_KEY_QUERY_PARAM = re.compile(r"(?i)([?&]key=)[^&\s\"']+")


class _RedactApiKey(logging.Filter):
    """httpx logs every request URL at INFO, and GraphHopper's API key travels in
    the URL's query string: blank it before the line reaches any handler."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        redacted = _KEY_QUERY_PARAM.sub(r"\1***", message)
        if redacted != message:
            record.msg, record.args = redacted, ()
        return True


def _configure_logging() -> None:
    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    log_format = os.getenv("LOG_FORMAT", "json").lower()

    handler = logging.StreamHandler()
    if log_format == "text":
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
        )
    else:
        handler.setFormatter(JsonLogFormatter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(log_level)
    httpx_logger = logging.getLogger("httpx")
    if not any(isinstance(f, _RedactApiKey) for f in httpx_logger.filters):
        httpx_logger.addFilter(_RedactApiKey())


_configure_logging()
logger = logging.getLogger(__name__)


def env_int(name: str, default: int, lo: int | None = None, hi: int | None = None) -> int:
    """Read an integer env var; a malformed value logs a warning and falls back
    to the default instead of crashing the process (and restart-looping the
    container). The result is clamped to [lo, hi] when given."""
    raw = os.getenv(name)
    value = default
    if raw is not None and raw.strip() != "":
        try:
            value = int(raw)
        except ValueError:
            logger.warning("%s=%r is not an integer; using %d", name, raw, default)
            value = default
    if lo is not None:
        value = max(lo, value)
    if hi is not None:
        value = min(hi, value)
    return value


def env_float(
    name: str, default: float, lo: float | None = None, hi: float | None = None
) -> float:
    """Float counterpart of env_int."""
    raw = os.getenv(name)
    value = default
    if raw is not None and raw.strip() != "":
        try:
            value = float(raw)
            if not math.isfinite(value):
                raise ValueError("not finite")
        except ValueError:
            logger.warning("%s=%r is not a number; using %s", name, raw, default)
            value = default
    if lo is not None:
        value = max(lo, value)
    if hi is not None:
        value = min(hi, value)
    return value


def env_bool(name: str, default: bool) -> bool:
    """Boolean env knob: 1/true/yes → True, 0/false/no → False, anything else → default
    (a non-empty, non-boolean value logs a warning first)."""
    raw = os.getenv(name, "")
    value = raw.strip().lower()
    if value in ("1", "true", "yes"):
        return True
    if value in ("0", "false", "no"):
        return False
    if value != "":
        logger.warning("%s=%r is not a boolean; using %s", name, raw, default)
    return default


# Add parent directory to path so we can import the overpassbot module.
# project_root resolves to services/, so the package is `overpassbot`.
project_root = Path(__file__).parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

# Optional import for OverpassBot (requires torch, not needed for basic functionality)
try:
    from overpassbot.OverpassBot import OverpassBot

    OVERPASS_BOT_AVAILABLE = True
except Exception as e:  # noqa: BLE001 - torch can fail with OSError on a slim image
    OVERPASS_BOT_AVAILABLE = False
    logger.warning(
        "OverpassBot not available - /overpass endpoint will use keyword fallback (%s)",
        e,
    )


# Load configuration from config.json
def load_config():
    config_path = Path(__file__).parent / "config.json"
    # Compose DNS names, matching config.json. A missing or misnamed
    # config.json must never silently point /overpass at a public service:
    # without internet access that would be a hang for the full timeout.
    defaults = {
        "geocode_url": "http://nominatim:8080/search",
        "reverse_geocode_url": "http://nominatim:8080/reverse",
        "graphhopper_url": "http://graphhopper:8989/route",
        "overpass_url": "http://overpass:80/api/interpreter",
    }

    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                file_config = json.load(f)
                # Merge file config with defaults (file takes precedence)
                for key in defaults:
                    if key in file_config:
                        defaults[key] = file_config[key]
            logger.info("Loaded configuration from %s", config_path)
        except Exception as e:
            logger.warning("Error loading config.json: %s, using defaults", e)
    else:
        logger.info("No config.json found at %s, using defaults", config_path)

    # Environment variables override file config. Compose passes them through
    # as "${VAR:-}", i.e. an empty string when unset: empty means "no override".
    def env_or(name: str, fallback: str) -> str:
        value = os.getenv(name, "")
        return value.strip() if value and value.strip() else fallback

    return {
        "geocode_url": env_or("GEOCODE_URL", defaults["geocode_url"]),
        "reverse_geocode_url": env_or("REVERSE_GEOCODE_URL", defaults["reverse_geocode_url"]),
        "graphhopper_url": env_or("GRAPHHOPPER_URL", defaults["graphhopper_url"]),
        "overpass_url": env_or("OVERPASS_API", defaults["overpass_url"]),
    }


config = load_config()
GEOCODE_URL = config["geocode_url"]
REVERSE_GEOCODE_URL = config["reverse_geocode_url"]
GRAPHHOPPER_URL = config["graphhopper_url"]
# The public GraphHopper Directions API authenticates with a "key" query
# parameter. Sent only there; /config shows just whether it is set, and the
# request log redacts it (see _RedactApiKey).
GRAPHHOPPER_API_KEY = os.getenv("GRAPHHOPPER_API_KEY", "").strip()
OVERPASS_API = config["overpass_url"]

logger.info("Using endpoints:")
logger.info("  - Geocode: %s", GEOCODE_URL)
logger.info("  - Reverse Geocode: %s", REVERSE_GEOCODE_URL)
logger.info("  - GraphHopper: %s", GRAPHHOPPER_URL)
logger.info("  - Overpass: %s", OVERPASS_API)

# ─── Geocoding ───────────────────────────────────────────────────────────────
# Languages Nominatim should prefer for place names and addresses (its
# `accept-language` parameter). Norwegian first so display_name comes back in
# Norwegian; English last, for the few objects without a Norwegian name.
# Compose passes "${NOMINATIM_LANGUAGE:-...}", so blank means "use the default".
NOMINATIM_LANGUAGE = os.getenv("NOMINATIM_LANGUAGE", "").strip() or "nb,nn,no,en"

# ─── Flexible routing (alternatives + avoid-areas) limits ───────────────────
# Default number of alternative paths requested in flexible mode. Each path
# costs extra GraphHopper compute, so this is deliberately small and capped.
ROUTING_MAX_ALTERNATIVES = env_int("ROUTING_MAX_ALTERNATIVES", 3, lo=2, hi=6)
# Defensive caps for avoid-areas to keep custom_model requests bounded.
MAX_AVOID_AREAS = 20
MAX_AVOID_AREA_POINTS = 1000
# Via points per route request (each one is a GraphHopper leg).
MAX_ROUTE_WAYPOINTS = env_int("MAX_ROUTE_WAYPOINTS", 25, lo=1, hi=100)

# ─── /overpass resource limits ───────────────────────────────────────────────
# The byt5 model is byte-level with quadratic attention and runs on CPU, so
# input length and concurrency both need hard caps.
OVERPASS_MAX_QUERY_CHARS = 300
OVERPASS_MIN_QUERY_CHARS = 2
# Largest bounding box (square degrees) a search may cover; ~2°x2° is a
# regional view. A country-sized keyword search would return the whole road
# network.
OVERPASS_MAX_BBOX_AREA = env_float("OVERPASS_MAX_BBOX_AREA", 4.0, lo=0.01, hi=64800.0)
# Overpass' own [maxsize:] cap (bytes) for generated queries.
OVERPASS_MAXSIZE_BYTES = env_int("OVERPASS_MAXSIZE_BYTES", 33554432, lo=1048576)
OVERPASS_MAX_CONCURRENT_INFERENCES = env_int("OVERPASS_MAX_CONCURRENT_INFERENCES", 1, lo=1, hi=8)
OVERPASS_MAX_GENERATION_SECONDS = env_float("OVERPASS_MAX_GENERATION_SECONDS", 30.0, lo=1.0, hi=600.0)
# Phase timeouts for the Overpass HTTP call; the query itself carries
# [timeout:25], so 60 s of read is generous. nginx in front of the SPA allows
# 300 s end-to-end (model inference + this).
OVERPASS_HTTP_TIMEOUT = httpx.Timeout(connect=5.0, read=60.0, write=10.0, pool=5.0)
# Inference runs in worker threads; this gate lives with them so it works
# regardless of which event loop scheduled the request.
_inference_gate = threading.BoundedSemaphore(OVERPASS_MAX_CONCURRENT_INFERENCES)

# ─── /overpass generator selection ───────────────────────────────────────────
# auto: the network LLM when LLM_BASE_URL, LLM_MODEL and LLM_API_KEY are all set,
# else the bundled byt5 model when it loads, else keyword search. byt5 / llm /
# keyword force one; a forced generator whose prerequisites are missing serves
# keyword search and says so on /config. The LLM runs elsewhere on the network,
# so its gate only bounds how many requests this backend keeps open at once.
OVERPASS_GENERATOR = os.getenv("OVERPASS_GENERATOR", "auto").strip().lower() or "auto"
if OVERPASS_GENERATOR not in llm_generator.GENERATORS:
    logger.warning("Unknown OVERPASS_GENERATOR=%r; using auto", OVERPASS_GENERATOR)
    OVERPASS_GENERATOR = "auto"
LLM_SETTINGS = llm_generator.settings_from_env()
LLM_MAX_CONCURRENT = env_int("LLM_MAX_CONCURRENT", 4, lo=1, hi=32)
_llm_gate = asyncio.Semaphore(LLM_MAX_CONCURRENT)

# Shared HTTP client and OverpassBot — initialized in the lifespan handler below.
http_client: httpx.AsyncClient | None = None


async def _probe_graphhopper() -> ghcaps.Capabilities:
    return await ghcaps.probe_info(http_client, GRAPHHOPPER_URL, GRAPHHOPPER_API_KEY)


# What GraphHopper can deliver beyond a plain route (elevation, path details),
# probed lazily from its /info on the first /route and cached.
gh_capabilities = ghcaps.CapabilityCache(_probe_graphhopper)

overpass_bot = None
# "unavailable" (no torch / load failed), "loading" (startup, in a thread) or
# "ready". Exposed on /config so the UI and operators can see it.
overpass_model_status = "unavailable"


def active_generator() -> str:
    """The generator /overpass uses right now."""
    return llm_generator.select_generator(
        OVERPASS_GENERATOR, LLM_SETTINGS.configured, overpass_bot is not None
    )


def generator_state() -> tuple[str, str]:
    """(active generator, status). Status is 'loading' while byt5 is still loading
    and keyword search fills in, 'unavailable' when a forced generator cannot run
    and keyword search fills in, else 'ready'."""
    active = active_generator()
    if OVERPASS_GENERATOR == "llm" and active != "llm":
        return active, "unavailable"
    if OVERPASS_GENERATOR == "byt5" and active != "byt5":
        return active, "loading" if overpass_model_status == "loading" else "unavailable"
    if OVERPASS_GENERATOR == "auto" and active == "keyword" and overpass_model_status == "loading":
        return active, "loading"
    return active, "ready"


def _configure_torch_threads() -> None:
    """Cap torch's intra-op thread pool to the CPUs this container may use.
    os.cpu_count() is cgroup-unaware; sched_getaffinity honours the limit."""
    try:
        import torch  # noqa: WPS433 - optional dependency

        try:
            cpus = len(os.sched_getaffinity(0))
        except (AttributeError, OSError):
            cpus = os.cpu_count() or 1
        torch.set_num_threads(env_int("TORCH_NUM_THREADS", cpus, lo=1, hi=64))
    except Exception as e:  # noqa: BLE001
        logger.debug("torch thread configuration skipped: %s", e)


def safe_load_overpass_bot(factory, model_dir):
    """Construct the OverpassBot via ``factory(model_dir=...)``, returning None
    instead of raising on failure.

    A missing or corrupt model directory must never crash backend startup — the
    /overpass endpoint already degrades to a keyword search when the bot is None.
    """
    try:
        bot = factory(model_dir=model_dir)
        logger.info("OverpassBot loaded from %s", model_dir)
        return bot
    except Exception as e:  # noqa: BLE001 - any load failure must degrade, not crash
        logger.warning(
            "Failed to load OverpassBot from %s: %s; /overpass will use keyword fallback",
            model_dir,
            e,
        )
        return None


async def _load_model_in_background() -> None:
    """Load the (2+ GB) model in a worker thread so the socket binds and
    /config liveness answers immediately; /overpass uses the keyword fallback
    until the model is ready."""
    global overpass_bot, overpass_model_status
    model_dir = os.getenv("MODEL_DIR", "/app/models/byt5-base_com08")
    overpass_model_status = "loading"
    _configure_torch_threads()
    bot = await asyncio.to_thread(safe_load_overpass_bot, OverpassBot, model_dir)
    if bot is not None:
        bot.generation_max_time = OVERPASS_MAX_GENERATION_SECONDS
    overpass_bot = bot
    overpass_model_status = "ready" if bot is not None else "unavailable"


# Upstream requests identify the application: the public OSM services reject
# stock library User-Agents (Nominatim answers 403, Overpass 406). Operators who
# point the backend at public services should add a contact, per the OSM usage
# policies, e.g. HTTP_USER_AGENT="OpenMaps/1.0 (+mailto:kart@example.org)".
DEFAULT_USER_AGENT = "OpenMaps/1.0"
USER_AGENT = os.getenv("HTTP_USER_AGENT", "").strip() or DEFAULT_USER_AGENT


def make_http_client(timeout: float) -> httpx.AsyncClient:
    """Every httpx client the backend uses, so the User-Agent is set in one place."""
    return httpx.AsyncClient(timeout=timeout, headers={"User-Agent": USER_AGENT})


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client, overpass_bot, overpass_model_status
    http_client = make_http_client(timeout=30.0)
    if STREETVIEW_INDEX_ON_START:
        try:
            outcome = await asyncio.to_thread(streetview_index.ensure_index, STREETVIEW_DIR)
            if outcome == "unwritable":
                logger.warning(
                    "Street-view index at startup: unwritable (%s) - the index is missing "
                    "or stale and %s is not writable by the backend's user",
                    STREETVIEW_DIR,
                    STREETVIEW_DIR,
                )
            else:
                logger.info("Street-view index at startup: %s (%s)", outcome, STREETVIEW_DIR)
        except Exception as e:  # noqa: BLE001 - an index problem must never stop the API
            logger.warning("Street-view index build failed: %s", e)
    load_task: asyncio.Task | None = None
    if OVERPASS_GENERATOR == "llm" and not LLM_SETTINGS.configured:
        logger.warning(
            "OVERPASS_GENERATOR=llm but LLM_BASE_URL, LLM_MODEL or LLM_API_KEY is missing; "
            "using keyword search"
        )
    if OVERPASS_GENERATOR == "byt5" and not OVERPASS_BOT_AVAILABLE:
        logger.warning(
            "OVERPASS_GENERATOR=byt5 but the model module is not importable; using keyword search"
        )
    if llm_generator.wants_byt5(OVERPASS_GENERATOR, OVERPASS_BOT_AVAILABLE, LLM_SETTINGS.configured):
        load_task = asyncio.create_task(_load_model_in_background())
    else:
        overpass_bot = None
        overpass_model_status = "unavailable"
        logger.info("OverpassBot not loaded (generator=%s)", active_generator())
    try:
        yield
    finally:
        if load_task is not None and not load_task.done():
            load_task.cancel()
        if http_client is not None:
            await http_client.aclose()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Prometheus Metrics ──────────────────────────────────────────────────────
# Instrument the app and expose GET /metrics. This adds request count
# (http_requests_total), a latency histogram (http_request_duration_seconds_*),
# and an in-progress gauge (http_requests_inprogress) without touching any
# existing route. The instrumentator runs as ASGI middleware; CORS/handler
# behavior is unchanged. /metrics itself is excluded from instrumentation.
Instrumentator(
    should_group_status_codes=False,
    should_instrument_requests_inprogress=True,
    inprogress_name="http_requests_inprogress",
    inprogress_labels=True,
    excluded_handlers=["/metrics"],
).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)


@app.get("/config")
async def get_config():
    """Return current endpoint configuration (useful for debugging)"""
    generator, status = generator_state()
    return {
        "geocode_url": GEOCODE_URL,
        "reverse_geocode_url": REVERSE_GEOCODE_URL,
        "graphhopper_url": GRAPHHOPPER_URL,
        "graphhopper_api_key": "set" if GRAPHHOPPER_API_KEY else "unset",
        "overpass_url": OVERPASS_API,
        "overpass_model": overpass_model_status,
        "overpass_generator": generator,
        "overpass_generator_status": status,
        **LLM_SETTINGS.redacted(),
    }


# ─── Shared validation / upstream helpers ────────────────────────────────────


def _validate_latlon(lat: float, lon: float) -> None:
    """Reject NaN/inf and out-of-range coordinates with a 400."""
    if not (math.isfinite(lat) and math.isfinite(lon)):
        raise HTTPException(status_code=400, detail="Ugyldige koordinater")
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        raise HTTPException(status_code=400, detail="Koordinater utenfor gyldig område")


def _raise_for_upstream(resp: httpx.Response, service_label: str) -> None:
    """Map an upstream error status to ours: 5xx -> 502 (the service failed),
    4xx -> the same status (the request was refused). Before this, error
    bodies were forwarded as HTTP 200."""
    if resp.status_code >= 500:
        logger.warning("%s answered %s", service_label, resp.status_code)
        raise HTTPException(
            status_code=502, detail=f"{service_label} svarte med feil ({resp.status_code})"
        )
    if resp.status_code >= 400:
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"{service_label} avviste forespørselen ({resp.status_code})",
        )


# ─── Street View ─────────────────────────────────────────────────────────────

STREETVIEW_DIR = Path(os.getenv("STREETVIEW_DIR", "/app/streetview"))
# Build panoramas.json at startup when it is missing or older than the metadata
# files: a thin deployment has no init-streetview container. On a full install
# the directory is mounted read-only and the init container has already written
# the index, so this is a no-op there. Off only for debugging.
STREETVIEW_INDEX_ON_START = env_bool("STREETVIEW_INDEX_ON_START", True)
_streetview_index: list[dict] | None = None
_streetview_index_mtime: float | None = None
_STREETVIEW_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def _load_streetview_index() -> list[dict]:
    """The panoramas.json written by init-streetview; re-read when it changes.
    Anything that is not a list of objects is treated as empty."""
    global _streetview_index, _streetview_index_mtime
    index_file = STREETVIEW_DIR / "panoramas.json"
    try:
        mtime = index_file.stat().st_mtime
    except OSError:
        _streetview_index, _streetview_index_mtime = [], None
        return _streetview_index
    if _streetview_index is not None and _streetview_index_mtime == mtime:
        return _streetview_index
    try:
        loaded = json.loads(index_file.read_text())
    except (ValueError, OSError) as e:
        logger.warning("Could not read panoramas.json: %s", e)
        loaded = []
    if not isinstance(loaded, list):
        logger.warning("panoramas.json is not a list; ignoring it")
        loaded = []
    _streetview_index = [p for p in loaded if isinstance(p, dict)]
    _streetview_index_mtime = mtime
    return _streetview_index


@app.get("/streetview/panoramas")
async def streetview_panoramas(
    west: float = Query(...),
    south: float = Query(...),
    east: float = Query(...),
    north: float = Query(...),
):
    """Return GeoJSON FeatureCollection of available panoramas within bounding box."""
    if south > north or west > east:
        raise HTTPException(status_code=400, detail="Ugyldig avgrensningsboks")
    _validate_latlon(south, west)
    _validate_latlon(north, east)

    index = _load_streetview_index()
    features = []
    for p in index:
        lat = p.get("lat")
        lon = p.get("lon")
        pano_id = p.get("id")
        if lat is None or lon is None or pano_id is None:
            continue
        if south <= lat <= north and west <= lon <= east:
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "id": pano_id,
                    "name": p.get("name", ""),
                    "heading": p.get("heading", 0),
                },
            })
    return {
        "type": "FeatureCollection",
        "features": features,
    }


@app.get("/streetview/panorama/{panoid}")
async def streetview_image(panoid: str):
    """Serve a panorama image by ID.

    The indexer records the image's file name (`file`), so .png/.jpeg/.webp
    panoramas and ids that differ from the file basename work; entries
    without it fall back to the legacy `<id>.jpg`.
    """
    if not _STREETVIEW_ID_RE.match(panoid):
        raise HTTPException(status_code=400, detail="Ugyldig panorama-id")
    panoramas_dir = STREETVIEW_DIR / "panoramas"
    entry = next((p for p in _load_streetview_index() if str(p.get("id")) == panoid), None)
    file_name = entry.get("file") if entry else None
    if isinstance(file_name, str) and file_name:
        image_path = panoramas_dir / Path(file_name).name
    else:
        image_path = panoramas_dir / f"{panoid}.jpg"
    if not image_path.is_file():
        return JSONResponse(status_code=404, content={"error": "Panorama ikke funnet"})
    media_type = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
    return FileResponse(
        image_path,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


# ─── Norwegian → OSM tag synonym map (used by Overpass fallback) ─────────────
_NORWEGIAN_SYNONYMS: dict[str, str] = {
    "skole": "school", "barnehage": "kindergarten", "sykehus": "hospital",
    "lege": "doctors", "tannlege": "dentist", "apotek": "pharmacy",
    "restaurant": "restaurant", "kafé": "cafe", "kafe": "cafe",
    "bar": "bar", "pub": "pub", "bakeri": "bakery",
    "butikk": "shop", "dagligvare": "supermarket", "supermarked": "supermarket",
    "bensinstasjon": "fuel", "parkering": "parking", "parkeringshus": "parking",
    "kirke": "church", "moské": "mosque", "synagoge": "synagogue",
    "bibliotek": "library", "museum": "museum", "kino": "cinema",
    "svømmehall": "swimming_pool", "stadion": "stadium", "idrettshall": "sports_centre",
    "togstasjon": "station", "busstasjon": "bus_station", "flyplass": "aerodrome",
    "hotell": "hotel", "camping": "camp_site", "hytter": "chalet",
    "strand": "beach", "park": "park", "lekeplass": "playground",
    "politistasjon": "police", "brannstasjon": "fire_station",
    "posthus": "post_office", "postkontor": "post_office",
    "bank": "bank", "minibank": "atm", "toalett": "toilets",
}

# ─── Health Check ────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class HealthTarget:
    name: str
    url: str
    # Optional services (the extra UIs) are reported but never fail the
    # aggregate: the map works without them.
    optional: bool = False
    # Request headers for the probe (the LLM needs its bearer key).
    headers: dict[str, str] | None = field(default=None, repr=False)


def _origin(url: str) -> str:
    parts = urlparse(url)
    return f"{parts.scheme}://{parts.netloc}"


# Every probe name /health can report; HEALTH_SKIP entries are validated against it.
KNOWN_HEALTH_TARGETS: tuple[str, ...] = (
    "tileserver",
    "nominatim",
    "overpass",
    "graphhopper",
    "nominatim-ui",
    "overpassbot",
    "overpass-ultra",
    "graphhopper-maps",
    "llm",
)


def build_health_targets(cfg: dict) -> list[HealthTarget]:
    """Health probes follow the configured upstream URLs, so redirecting a
    service via GEOCODE_URL/GRAPHHOPPER_URL/OVERPASS_API keeps the dashboard
    truthful. The frontend is deliberately absent: it is what polls /health."""
    tileserver = os.getenv("TILESERVER_URL", "http://tileserver:8080").rstrip("/")
    targets = [
        HealthTarget("tileserver", f"{tileserver}/health"),
        HealthTarget("nominatim", f"{_origin(cfg['geocode_url'])}/status"),
        HealthTarget("overpass", f"{_origin(cfg['overpass_url'])}/api/status"),
        HealthTarget("graphhopper", f"{_origin(cfg['graphhopper_url'])}/health"),
        HealthTarget("nominatim-ui", "http://nominatim-ui:8765/healthz", optional=True),
        HealthTarget("overpassbot", "http://overpassbot:8501/_stcore/health", optional=True),
        HealthTarget("overpass-ultra", "http://overpass-ultra:8000/healthz", optional=True),
        HealthTarget("graphhopper-maps", "http://graphhopper-maps:3000/healthz", optional=True),
    ]
    # Probe the LLM only when it is the generator in use: a configured but
    # unselected LLM is never called, so it should not be polled either.
    if llm_generator.select_generator(OVERPASS_GENERATOR, LLM_SETTINGS.configured, False) == "llm":
        # Optional: keyword search keeps working when the LLM is down.
        targets.append(
            HealthTarget(
                "llm",
                f"{LLM_SETTINGS.base_url}/models",
                optional=True,
                headers={"Authorization": f"Bearer {LLM_SETTINGS.api_key}"},
            )
        )
    # HEALTH_SKIP: probes to leave out. A thin deployment has no tool UIs, and
    # the network's tile service may have no probe endpoint at all.
    skip = {name.strip() for name in os.getenv("HEALTH_SKIP", "").split(",") if name.strip()}
    for name in sorted(skip - set(KNOWN_HEALTH_TARGETS)):
        logger.warning(
            "HEALTH_SKIP names an unknown target %r (known: %s)",
            name,
            ", ".join(KNOWN_HEALTH_TARGETS),
        )
    return [t for t in targets if t.name not in skip]


HEALTH_CHECK_SERVICES = build_health_targets(config)

# Timeout for individual health checks (seconds)
HEALTH_CHECK_TIMEOUT = env_float("HEALTH_CHECK_TIMEOUT", 5.0, lo=0.5, hi=60.0)
# Fan-out results are cached briefly: the dashboard polls, and nine upstream
# probes per poll add up.
HEALTH_CACHE_SECONDS = env_float("HEALTH_CACHE_SECONDS", 5.0, lo=0.0, hi=300.0)
_health_cache: tuple[float, dict, int] | None = None


async def _check_service(
    client: httpx.AsyncClient, name: str, url: str, headers: dict[str, str] | None = None
) -> dict:
    """Check a single service's health. Returns a status dict."""
    kwargs: dict = {"timeout": HEALTH_CHECK_TIMEOUT}
    if headers:
        kwargs["headers"] = headers
    try:
        resp = await client.get(url, **kwargs)
        if 200 <= resp.status_code < 300:
            return {"name": name, "status": "healthy", "status_code": resp.status_code}
        return {
            "name": name,
            "status": "unhealthy",
            "status_code": resp.status_code,
            # An authenticated probe's error body can echo the credential it
            # received; never relay it. Plain probes keep the diagnostic text.
            "detail": f"HTTP {resp.status_code}" if headers else resp.text[:200],
        }
    except httpx.ConnectError:
        # Service not reachable — could be starting up or down
        return {"name": name, "status": "unhealthy", "detail": "connection refused"}
    except httpx.TimeoutException:
        return {"name": name, "status": "unhealthy", "detail": "timeout"}
    except httpx.RequestError as exc:
        return {"name": name, "status": "unhealthy", "detail": str(exc)[:200]}


@app.get("/health")
async def health():
    """Aggregate health of all OpenMaps services.

    Returns HTTP 200 when every core service is healthy, HTTP 503 otherwise.
    Optional UI services are listed with `optional: true` and never fail the
    aggregate.
    """
    global _health_cache
    now = time.monotonic()
    if _health_cache is not None and now - _health_cache[0] < HEALTH_CACHE_SECONDS:
        _, cached_body, cached_status = _health_cache
        return JSONResponse(content=cached_body, status_code=cached_status)

    own_client = http_client is None
    client = http_client or make_http_client(timeout=HEALTH_CHECK_TIMEOUT)
    try:
        results = await asyncio.gather(
            *[
                _check_service(client, t.name, t.url, headers=t.headers)
                for t in HEALTH_CHECK_SERVICES
            ]
        )
    finally:
        if own_client:
            await client.aclose()

    optional = {t.name: t.optional for t in HEALTH_CHECK_SERVICES}
    services = {}
    for r in results:
        entry = {k: v for k, v in r.items() if k != "name"}
        entry["optional"] = optional.get(r["name"], False)
        services[r["name"]] = entry
    all_healthy = all(
        r["status"] == "healthy" for r in results if not optional.get(r["name"], False)
    )

    body = {
        "status": "healthy" if all_healthy else "unhealthy",
        "services": services,
    }
    status_code = 200 if all_healthy else 503
    _health_cache = (now, body, status_code)
    return JSONResponse(content=body, status_code=status_code)


def parse_viewbox(raw: str | None) -> str | None:
    """Validate the SPA's `west,south,east,north` view box and return it in
    Nominatim's `viewbox` format (same order). None when absent; HTTP 400 when
    malformed, so a typo never reaches Nominatim as garbage."""
    if raw is None or raw.strip() == "":
        return None
    parts = raw.split(",")
    if len(parts) != 4:
        raise HTTPException(status_code=400, detail="Ugyldig kartutsnitt")
    try:
        west, south, east, north = (float(p) for p in parts)
    except ValueError:
        raise HTTPException(status_code=400, detail="Ugyldig kartutsnitt") from None
    if any(math.isnan(v) or math.isinf(v) for v in (west, south, east, north)):
        raise HTTPException(status_code=400, detail="Ugyldig kartutsnitt")
    if not (-180.0 <= west <= 180.0 and -180.0 <= east <= 180.0):
        raise HTTPException(status_code=400, detail="Ugyldig kartutsnitt")
    if not (-90.0 <= south <= 90.0 and -90.0 <= north <= 90.0):
        raise HTTPException(status_code=400, detail="Ugyldig kartutsnitt")
    if west > east or south > north:
        raise HTTPException(status_code=400, detail="Ugyldig kartutsnitt")
    return f"{west},{south},{east},{north}"


@app.get("/search")
async def search(q: str, viewbox: str | None = Query(None)):
    params = {
        "q": q,
        "format": "geojson",
        "polygon_geojson": 1,
        "addressdetails": 1,
        "extratags": 1,
        "limit": 100,
        "accept-language": NOMINATIM_LANGUAGE,
    }
    box = parse_viewbox(viewbox)
    if box is not None:
        # Prefer hits inside the current map view without excluding the rest:
        # bounded=1 would hide everything outside the box.
        params["viewbox"] = box
        params["bounded"] = 0
    try:
        r = await http_client.get(GEOCODE_URL, params=params)
        _raise_for_upstream(r, "Søketjenesten")
        return r.json()
    except httpx.RequestError as e:
        logger.warning("Geocode request failed: %s", e)
        raise HTTPException(status_code=502, detail="Kunne ikke kontakte søketjenesten")
    except ValueError as e:
        logger.warning("Geocode returned invalid JSON: %s", e)
        raise HTTPException(status_code=502, detail="Ugyldig svar fra søketjenesten")


@app.get("/reverse")
async def reverse_geocode(lat: float, lon: float):
    _validate_latlon(lat, lon)
    params = {
        "lat": lat,
        "lon": lon,
        "format": "geojson",
        "polygon_geojson": 1,
        "addressdetails": 1,
        "extratags": 1,
        "accept-language": NOMINATIM_LANGUAGE,
    }
    try:
        r = await http_client.get(REVERSE_GEOCODE_URL, params=params)
        _raise_for_upstream(r, "Søketjenesten")
        return r.json()
    except httpx.RequestError as e:
        logger.warning("Reverse geocode request failed: %s", e)
        raise HTTPException(
            status_code=502, detail="Kunne ikke kontakte søketjenesten"
        )
    except ValueError as e:
        logger.warning("Reverse geocode returned invalid JSON: %s", e)
        raise HTTPException(status_code=502, detail="Ugyldig svar fra søketjenesten")


def _parse_route_coord(raw: str) -> tuple[float, float]:
    """Parse a 'lat,lon' string into (lat, lon), raising HTTP 400 on bad input."""
    parts = raw.split(",")
    if len(parts) != 2:
        raise HTTPException(
            status_code=400,
            detail=f"Ugyldige koordinater: '{raw}' (forventet 'lat,lon')",
        )
    try:
        lat = float(parts[0])
        lon = float(parts[1])
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Ugyldige koordinater: '{raw}' (forventet 'lat,lon')",
        )
    _validate_latlon(lat, lon)
    return lat, lon


def parse_avoid_areas(raw: str | None) -> list[list[list[float]]]:
    """Parse + strictly validate the `avoid_areas` query parameter.

    Input is a JSON-encoded array of polygons; each polygon is an array of
    [lng, lat] pairs (GeoJSON ring order). Rings need not be closed — callers
    may omit the repeated first/last vertex; close_ring() handles that later.

    Raises HTTPException(400, <Norwegian>) on any malformed/oversized input.
    Returns [] when raw is None/empty (no avoid-areas requested).
    """
    if raw is None or raw.strip() == "":
        return []

    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=400, detail="Ugyldig JSON for unngåtte områder"
        )

    if not isinstance(parsed, list):
        raise HTTPException(
            status_code=400,
            detail="Unngåtte områder må være en liste med polygoner",
        )
    if len(parsed) > MAX_AVOID_AREAS:
        raise HTTPException(
            status_code=400,
            detail=f"For mange unngåtte områder (maks {MAX_AVOID_AREAS})",
        )

    polygons: list[list[list[float]]] = []
    for polygon in parsed:
        if not isinstance(polygon, list) or len(polygon) < 3:
            raise HTTPException(
                status_code=400,
                detail="Hvert unngått område må ha minst 3 punkter",
            )
        if len(polygon) > MAX_AVOID_AREA_POINTS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Et unngått område har for mange punkter "
                    f"(maks {MAX_AVOID_AREA_POINTS})"
                ),
            )
        ring: list[list[float]] = []
        for point in polygon:
            if (
                not isinstance(point, (list, tuple))
                or len(point) != 2
                or isinstance(point[0], bool)
                or isinstance(point[1], bool)
                or not isinstance(point[0], (int, float))
                or not isinstance(point[1], (int, float))
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Hvert punkt må være [lng, lat] med tall",
                )
            lng, lat = float(point[0]), float(point[1])
            if not (-180.0 <= lng <= 180.0) or not (-90.0 <= lat <= 90.0):
                raise HTTPException(
                    status_code=400,
                    detail="Punkt utenfor gyldig område ([lng,lat])",
                )
            ring.append([lng, lat])
        polygons.append(ring)

    return polygons


def build_avoid_custom_model(polygons: list[list[list[float]]]) -> dict:
    """Build a GraphHopper custom_model that blocks routing through `polygons`.

    GraphHopper 10 custom-model `areas` schema: `areas` is a GeoJSON
    FeatureCollection; each Feature has a unique `id` and a Polygon geometry.
    A priority rule `{"if": "in_<id>", "multiply_by": "0"}` zeroes the priority
    of every edge inside that area, effectively forbidding it. Requires
    ch.disable=true (set by the caller in the POST body).
    """
    features = []
    rules = []
    for index, ring in enumerate(polygons):
        area_id = f"avoid_{index}"
        closed = ring + [ring[0]] if ring[0] != ring[-1] else list(ring)
        features.append(
            {
                "type": "Feature",
                "id": area_id,
                "properties": {},
                "geometry": {"type": "Polygon", "coordinates": [closed]},
            }
        )
        rules.append({"if": f"in_{area_id}", "multiply_by": "0"})

    return {
        "priority": rules,
        "areas": {"type": "FeatureCollection", "features": features},
    }


def _path_to_feature(path: dict, primary: bool, index: int) -> dict | None:
    """Convert one GraphHopper path into a GeoJSON LineString Feature.

    Returns None if the path has no geometry. `index` orders the routes
    (0 = primary). Non-primary routes are marked style='alternative'.
    Properties optionally carry `elevation` (per-point heights),
    `ascend`/`descend` (total climb/descent) and `details` (path details as
    point-index intervals) when GraphHopper supplied them. `elevation` and
    `details` point into the geometry by coordinate index, so both are
    withheld — geometry still returned — when a malformed coordinate was
    dropped, which would otherwise shift every later index out of alignment.
    """
    pts = path.get("points")
    if not pts:
        return None
    # `points` is a GeoJSON LineString when points_encoded=false (now both
    # paths) or an encoded polyline string (a GraphHopper that ignores the
    # flag). Coordinates may carry a height as a third value.
    if isinstance(pts, dict):
        raw = pts.get("coordinates", [])
    else:
        raw = [[lon, lat] for lat, lon in polyline.decode(pts)]
    filtered = [c for c in raw if isinstance(c, (list, tuple)) and len(c) >= 2]
    if not filtered:
        return None
    coords_aligned = len(filtered) == len(raw)
    coordinates = [[c[0], c[1]] for c in filtered]
    properties = {
        "distance": path.get("distance"),
        "time": path.get("time"),
        "instructions": path.get("instructions", []),
        "style": "solid" if primary else "alternative",
        "route_index": index,
        "primary": primary,
    }
    # Heights only when every coordinate has one: a profile with a gap would
    # be drawn wrong, so it is not drawn at all. And only when nothing was
    # dropped above (see docstring).
    if coords_aligned:
        heights = [c[2] if len(c) >= 3 else None for c in filtered]
        if all(
            isinstance(h, (int, float)) and not isinstance(h, bool) and math.isfinite(h)
            for h in heights
        ):
            properties["elevation"] = heights
    for key in ("ascend", "descend"):
        value = path.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            properties[key] = value
    if coords_aligned:
        details = path.get("details")
        if isinstance(details, dict):
            kept = {k: v for k, v in details.items() if k in ghcaps.WANTED_DETAILS and isinstance(v, list)}
            if kept:
                properties["details"] = kept
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coordinates},
        "properties": properties,
    }


# GraphHopper error `hints[].details` class names that mean the request
# itself was unroutable (bad/disconnected/too-far-apart points), not a stale
# capability probe. The self-hosted GraphHopper always advertises some
# details, so every ordinary routing failure would otherwise be retried and
# flush the capability cache. Matched against the end of `details`, since it
# is the exception's fully-qualified name (e.g.
# "com.graphhopper.util.exceptions.PointNotFoundException").
_UNROUTABLE_DETAILS: tuple[str, ...] = (
    "PointNotFoundException",
    "ConnectionNotFoundException",
    "PointOutOfBoundsException",
    "PointDistanceExceededException",
    "MaximumNodesExceededException",
)


def _is_unroutable(data: object) -> bool:
    """True when a GraphHopper 400 body names one of `_UNROUTABLE_DETAILS` in
    any hint. Parses defensively: `data` may not be a dict, `hints` may be
    missing, not a list, or contain non-dict entries."""
    if not isinstance(data, dict):
        return False
    hints = data.get("hints")
    if not isinstance(hints, list):
        return False
    for hint in hints:
        if not isinstance(hint, dict):
            continue
        details = hint.get("details")
        if isinstance(details, str) and details.endswith(_UNROUTABLE_DETAILS):
            return True
    return False


def _handle_graphhopper_error(data: dict):
    """Map a GraphHopper error payload (no `paths`) to a 400 JSONResponse."""
    error_msg = data.get("message", "Ukjent feil fra rutetjenesten")
    hints = data.get("hints", [])
    if isinstance(hints, list) and hints and isinstance(hints[0], dict):
        error_msg = hints[0].get("message", error_msg)
    logger.warning("GraphHopper error: %s", data)
    return JSONResponse(status_code=400, content={"error": error_msg, "details": data})


def _graphhopper_failure(status_code: int, data) -> JSONResponse:
    """A 5xx from GraphHopper (e.g. during a graph rebuild) is the service
    failing, not the user's route being impossible: report 502, never 400."""
    logger.warning("GraphHopper answered %s: %s", status_code, str(data)[:300])
    return JSONResponse(
        status_code=502,
        content={"error": "Rutetjenesten feilet. Prøv igjen senere.", "details": data},
    )


# The hosted GraphHopper answers a missing, wrong or used-up API key with 401,
# 403 or 429 and an English sentence. Left to the generic error path that
# sentence would come back as a 400, which the UI reads as "no route between
# these points". A 429 is its rate or credit limit: always a quota answer.
_KEY_REJECTED_STATUSES = (401, 403, 429)
_QUOTA_WORDS = re.compile(r"quota|limit|credit", re.IGNORECASE)
KEY_REJECTED_DETAIL = "Rutetjenesten avviste API-nøkkelen (sjekk GRAPHHOPPER_API_KEY)"
KEY_QUOTA_DETAIL = "Rutetjenesten melder at kvoten for API-nøkkelen er brukt opp"
# Let the frontend recognise these answers without matching on the Norwegian text.
KEY_REJECTED_CODE = "graphhopper_key_rejected"
KEY_QUOTA_CODE = "graphhopper_key_quota"


class _GraphHopperKeyRefused(Exception):
    """GraphHopper refused or rate-limited the API key; carries its answer."""

    def __init__(self, response: httpx.Response):
        super().__init__(response.status_code)
        self.response = response


def _graphhopper_key_failure(response: httpx.Response) -> JSONResponse:
    """A 401/403 from GraphHopper is the service refusing our API key, not the
    user's route being impossible: report 502 with a Norwegian sentence that
    names the key. A 429, or a 403 that talks about a quota, is reported as the
    quota being used up."""
    body = response.text
    # Redact before cutting: a key straddling the cut would survive in part.
    if GRAPHHOPPER_API_KEY:
        body = body.replace(GRAPHHOPPER_API_KEY, "***")
    body = body[:500]
    logger.warning("GraphHopper refused the API key (%s): %s", response.status_code, body)
    quota = response.status_code == 429 or (
        response.status_code == 403 and _QUOTA_WORDS.search(body) is not None
    )
    return JSONResponse(
        status_code=502,
        content={
            "detail": KEY_QUOTA_DETAIL if quota else KEY_REJECTED_DETAIL,
            "code": KEY_QUOTA_CODE if quota else KEY_REJECTED_CODE,
        },
    )


@app.get("/route")
async def route(
    from_coord: str = Query(..., alias="from"),
    to_coord: str = Query(..., alias="to"),
    waypoints: list[str] = Query(None, alias="waypoint"),
    profile: str = Query("car", pattern="^(car|foot|bike)$"),
    alternatives: bool = Query(False),
    avoid_areas: str | None = Query(None),
):
    lat1, lon1 = _parse_route_coord(from_coord)
    lat2, lon2 = _parse_route_coord(to_coord)
    orig_from = [lon1, lat1]
    orig_to = [lon2, lat2]

    # GraphHopper "point" order is lat,lon (GET) / [lon,lat] (POST JSON).
    points = [f"{lat1},{lon1}"]
    point_pairs = [[lon1, lat1]]
    orig_points = [orig_from]

    if waypoints:
        if len(waypoints) > MAX_ROUTE_WAYPOINTS:
            raise HTTPException(
                status_code=400,
                detail=f"For mange viapunkter (maks {MAX_ROUTE_WAYPOINTS})",
            )
        for waypoint in waypoints:
            wlat, wlon = _parse_route_coord(waypoint)
            points.append(f"{wlat},{wlon}")
            point_pairs.append([wlon, wlat])
            orig_points.append([wlon, wlat])

    points.append(f"{lat2},{lon2}")
    point_pairs.append([lon2, lat2])
    orig_points.append(orig_to)

    avoid_polygons = parse_avoid_areas(avoid_areas)
    # GraphHopper's alternative_route algorithm supports only a start and end
    # point — with intermediate waypoints it returns 400. Silently drop
    # alternatives for via-point routes so the user still gets a route.
    effective_alternatives = alternatives and not waypoints
    use_flexible = effective_alternatives or bool(avoid_polygons)

    async def ask_graphhopper(caps: ghcaps.Capabilities) -> httpx.Response:
        if not use_flexible:
            # ── Fast path: no alternatives and no avoid-areas → CH GET ───────
            params: dict = {
                "point": points,
                "type": "json",
                "profile": profile,
                "locale": "nb_NO",
                # GeoJSON coordinates, as the flexible path already uses: with
                # elevation the encoded polyline becomes 3D, which
                # polyline.decode would misread.
                "points_encoded": "false",
            }
            if caps.elevation:
                params["elevation"] = "true"
            if caps.details:
                params["details"] = list(caps.details)
            if GRAPHHOPPER_API_KEY:
                params["key"] = GRAPHHOPPER_API_KEY
            return await http_client.get(GRAPHHOPPER_URL, params=params)

        # ── Flexible path: POST JSON with ch.disable=true ────────────────────
        body: dict = {
            "points": point_pairs,
            "profile": profile,
            "locale": "nb_NO",
            "points_encoded": False,
            "instructions": True,
            "ch.disable": True,
        }
        if caps.elevation:
            body["elevation"] = True
        if caps.details:
            body["details"] = list(caps.details)
        if effective_alternatives:
            body["algorithm"] = "alternative_route"
            body["alternative_route.max_paths"] = ROUTING_MAX_ALTERNATIVES
            body["alternative_route.max_weight_factor"] = 1.4
            body["alternative_route.max_share_factor"] = 0.6
        if avoid_polygons:
            body["custom_model"] = build_avoid_custom_model(avoid_polygons)
        # The hosted API takes the key as a query parameter on POST as well.
        key_params = {"key": GRAPHHOPPER_API_KEY} if GRAPHHOPPER_API_KEY else None
        return await http_client.post(GRAPHHOPPER_URL, json=body, params=key_params)

    async def ask_checked(caps: ghcaps.Capabilities) -> httpx.Response:
        """One GraphHopper answer, except that a refused or rate-limited key
        ends the request at once: the plain retry below is asked the same way."""
        answer = await ask_graphhopper(caps)
        if answer.status_code in _KEY_REJECTED_STATUSES:
            raise _GraphHopperKeyRefused(answer)
        return answer

    caps = await gh_capabilities.get()
    try:
        r = await ask_checked(caps)
        data = r.json()
        # A probe gone stale (GraphHopper changed under us) makes GraphHopper
        # refuse the elevation or details it no longer has. Forget the probe
        # and ask once more for a plain route, so the user still gets one.
        # An ordinary routing failure (unroutable points) is never retried:
        # it has nothing to do with the probe, and retrying it would ask
        # GraphHopper twice for every "Cannot find point"/"Connection between
        # locations not found".
        if r.status_code == 400 and caps.any and not _is_unroutable(data):
            plain_r = await ask_checked(ghcaps.NONE)
            plain_data = plain_r.json()
            # Clear the cache only once the plain retry proves the extras
            # were the cause; if it fails too, keep the cache and fall
            # through with its response, same as an ordinary failure.
            if plain_r.status_code == 200:
                gh_capabilities.clear()
            r, data = plain_r, plain_data
    except _GraphHopperKeyRefused as refused:
        return _graphhopper_key_failure(refused.response)
    except httpx.RequestError as e:
        logger.warning("Route request failed: %s", e)
        raise HTTPException(status_code=502, detail="Kunne ikke kontakte rutetjenesten")
    except ValueError as e:
        logger.warning("Route returned invalid JSON: %s", e)
        raise HTTPException(status_code=502, detail="Ugyldig svar fra rutetjenesten")

    # Check for GraphHopper errors (shared by both paths)
    if not isinstance(data, dict):
        return _graphhopper_failure(r.status_code, data)
    if r.status_code >= 500:
        return _graphhopper_failure(r.status_code, data)
    if "paths" not in data:
        return _handle_graphhopper_error(data)

    if not data["paths"]:
        raise HTTPException(status_code=502, detail="Ingen rute funnet")

    routes = []
    for index, path in enumerate(data["paths"]):
        feature = _path_to_feature(path, primary=(index == 0), index=index)
        if feature is None:
            if index == 0:
                raise HTTPException(
                    status_code=502, detail="Mangler rutedata fra rutetjenesten"
                )
            continue
        routes.append(feature)

    if not routes:
        raise HTTPException(status_code=502, detail="Mangler rutedata fra rutetjenesten")

    # Dashed connector segments from the original click points to the snapped
    # points — computed for the primary route only (the fast-path behavior).
    primary_path = data["paths"][0]
    snapped_coordinates: list[list[float]] = []
    encoded_snapped = primary_path.get("snapped_waypoints")
    if isinstance(encoded_snapped, dict) and encoded_snapped.get("type") == "LineString":
        snapped_coordinates = [
            [c[0], c[1]] for c in encoded_snapped.get("coordinates", []) if len(c) >= 2
        ]
    elif encoded_snapped:
        snapped_points = polyline.decode(encoded_snapped)
        snapped_coordinates = [[lon, lat] for lat, lon in snapped_points]

    dashed_segments = [
        [orig_point, snapped_point]
        for orig_point, snapped_point in zip(orig_points, snapped_coordinates)
        if orig_point != snapped_point
    ]

    return JSONResponse(content={"routes": routes, "dashed_segments": dashed_segments})


def build_overpass_query_from_model(
    raw: str, south: float, west: float, north: float, east: float
) -> str | None:
    """Rebuild a clean, bbox-constrained Overpass query from the model's output.

    The byt5 model wraps the same tag filter in wildly varied ways depending on
    the prompt (``area``/``map_to_area``/``{{geocodeArea}}``/``[bbox:…]``/
    ``({{bbox}})``), which regex-rewriting can't reliably normalize. Instead we
    extract just the tag-filter chains attached to node/way/relation/nwr elements
    and rebuild a minimal query constrained to the requested bbox. Returns None
    if no tag filters could be extracted (caller falls back to keyword search).
    """
    chains = re.findall(r"\b(?:node|way|relation|nwr)((?:\s*\[[^\]]*\])+)", raw)
    seen: list[str] = []
    for chain in chains:
        chain = chain.strip()
        if chain and chain not in seen:
            seen.append(chain)
    if not seen:
        return None
    bbox = f"{south},{west},{north},{east}"
    body = "".join(f"  nwr{chain}({bbox});\n" for chain in seen)
    return f"{_overpass_settings()}\n(\n{body});\nout body;\n>;\nout skel qt;"


def _overpass_settings() -> str:
    """Query header: JSON output, the server-side query timeout and a result
    size cap so one broad search cannot return hundreds of megabytes."""
    return f"[out:json][timeout:25][maxsize:{OVERPASS_MAXSIZE_BYTES}];"


# Keys searched by the keyword fallback. Structural keys (highway, building,
# landuse, natural) are deliberately absent: a short term like "a" would match
# every road and building in the box.
_KEYWORD_TAG_KEYS = [
    "name", "amenity", "shop", "tourism", "leisure",
    "cuisine", "sport", "healthcare", "office", "craft",
]


def build_overpass_keyword_query(
    nl: str, south: float, west: float, north: float, east: float
) -> str:
    """Keyword fallback: treat the input as a term and search it (case-insensitive,
    substring) across common OSM tag keys within the bbox. Applies the
    Norwegian synonym map."""
    term = nl.strip().lower()
    term = _NORWEGIAN_SYNONYMS.get(term, term)
    # The term is used as a regex by Overpass: escape metacharacters so "a.b(c"
    # matches literally, then escape for the QL string literal (backslashes and
    # quotes) and drop newlines to rule out OverpassQL injection.
    pattern = re.escape(term.replace("\r", "").replace("\n", ""))
    safe = pattern.replace("\\", "\\\\").replace('"', '\\"')
    bbox = f"{south},{west},{north},{east}"
    nwr_lines = "\n".join(f'  nwr["{key}"~"{safe}",i]({bbox});' for key in _KEYWORD_TAG_KEYS)
    return f"{_overpass_settings()}(\n{nwr_lines}\n);\nout body;\n>;\nout skel qt;"


def _point_in_ring(point: list[float], ring: list[list[float]]) -> bool:
    """Ray-casting point-in-polygon test.

    point and ring vertices are [lon, lat]. Returns True if the point lies
    inside the (closed) ring.
    """
    x, y = point[0], point[1]
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        intersects = ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / (yj - yi) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def _assemble_rings(segments: list[list[list[float]]]) -> list[list[list[float]]]:
    """Chain way segments into closed rings by matching endpoints.

    Real multipolygons (forests, lakes, land use) are made of several open
    member ways; each may run in either direction. Segments that cannot be
    closed are dropped.
    """
    remaining = [list(seg) for seg in segments if len(seg) >= 2]
    rings: list[list[list[float]]] = []
    while remaining:
        ring = remaining.pop(0)
        progressed = True
        while ring[0] != ring[-1] and progressed:
            progressed = False
            for i, seg in enumerate(remaining):
                if seg[0] == ring[-1]:
                    ring.extend(seg[1:])
                elif seg[-1] == ring[-1]:
                    ring.extend(reversed(seg[:-1]))
                elif seg[-1] == ring[0]:
                    ring = seg[:-1] + ring
                elif seg[0] == ring[0]:
                    ring = list(reversed(seg[1:])) + ring
                else:
                    continue
                remaining.pop(i)
                progressed = True
                break
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring)
    return rings


def _multipolygon_geometry(
    relation: dict, ways: dict, coords_for_way
) -> dict | None:
    """Build a Polygon/MultiPolygon from a multipolygon relation's members."""
    outer_segments, inner_segments = [], []
    for member in relation.get("members", []) or []:
        if not isinstance(member, dict) or member.get("type") != "way":
            continue
        way = ways.get(member.get("ref"))
        if way is None:
            continue
        coords = coords_for_way(way)
        if len(coords) < 2:
            continue
        # OSM data commonly omits the role on outer ways.
        (inner_segments if member.get("role") == "inner" else outer_segments).append(coords)

    outer_rings = _assemble_rings(outer_segments)
    inner_rings = _assemble_rings(inner_segments)
    if not outer_rings:
        return None

    # Assign each inner ring (hole) to the outer ring containing its first vertex.
    polygons = []
    for outer in outer_rings:
        holes = [inner for inner in inner_rings if _point_in_ring(inner[0], outer)]
        polygons.append([outer] + holes)
    if len(polygons) > 1:
        return {"type": "MultiPolygon", "coordinates": polygons}
    return {"type": "Polygon", "coordinates": polygons[0]}


def overpass_to_geojson(overpass_json) -> dict:
    """Convert an Overpass JSON answer to a GeoJSON FeatureCollection.

    Untagged nodes and ways (pulled in by `>` as geometry for something else)
    are never emitted as features of their own; multipolygon relations are
    assembled from their member ways.
    """
    features: list[dict] = []
    elements = overpass_json.get("elements") if isinstance(overpass_json, dict) else None
    if not isinstance(elements, list):
        return {"type": "FeatureCollection", "features": features}
    elements = [el for el in elements if isinstance(el, dict) and "id" in el and "type" in el]

    nodes = {
        el["id"]: el
        for el in elements
        if el["type"] == "node" and "lat" in el and "lon" in el
    }
    ways = {el["id"]: el for el in elements if el["type"] == "way"}

    def coords_for_way(way):
        return [
            [nodes[nid]["lon"], nodes[nid]["lat"]]
            for nid in way.get("nodes", []) or []
            if nid in nodes
        ]

    for el in elements:
        tags = el.get("tags") or {}
        if el["type"] == "node":
            if tags:
                features.append(
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [el["lon"], el["lat"]],
                        },
                        "properties": tags,
                    }
                )

        elif el["type"] == "way":
            if not tags:
                continue
            coords = coords_for_way(el)
            if coords:
                if len(coords) > 3 and coords[0] == coords[-1]:
                    geom_type = "Polygon"
                    coords = [coords]
                else:
                    geom_type = "LineString"
                features.append(
                    {
                        "type": "Feature",
                        "geometry": {"type": geom_type, "coordinates": coords},
                        "properties": tags,
                    }
                )

        elif el["type"] == "relation":
            if tags.get("type") == "multipolygon":
                geometry = _multipolygon_geometry(el, ways, coords_for_way)
                if geometry is not None:
                    features.append(
                        {"type": "Feature", "geometry": geometry, "properties": tags}
                    )
            else:
                features.append(
                    {
                        "type": "Feature",
                        "geometry": None,
                        "properties": tags,
                    }
                )

    return {"type": "FeatureCollection", "features": features}


def _generate_gated(bot, text: str) -> str:
    """Run one model inference under the concurrency gate (in a worker thread)."""
    with _inference_gate:
        return bot.generate_query(text)


@app.get("/overpass")
async def overpass_query(
    nl: str = Query(..., max_length=OVERPASS_MAX_QUERY_CHARS),
    south: float = Query(...),
    west: float = Query(...),
    north: float = Query(...),
    east: float = Query(...),
):
    nl = nl.strip()
    if len(nl) < OVERPASS_MIN_QUERY_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Skriv inn minst {OVERPASS_MIN_QUERY_CHARS} tegn",
        )
    # Validate the bounding box before any upstream call (mirrors the
    # /streetview/panoramas guard): reject inverted or out-of-range boxes.
    if south > north or west > east:
        raise HTTPException(status_code=400, detail="Ugyldig avgrensningsboks")
    if not (
        -90.0 <= south <= 90.0
        and -90.0 <= north <= 90.0
        and -180.0 <= west <= 180.0
        and -180.0 <= east <= 180.0
    ):
        raise HTTPException(status_code=400, detail="Koordinater utenfor gyldig område")
    if (north - south) * (east - west) > OVERPASS_MAX_BBOX_AREA:
        raise HTTPException(
            status_code=400,
            detail="Zoom inn på kartet før du søker – området er for stort",
        )

    query: str | None = None
    raw: str | None = None
    generator = active_generator()
    if generator == "llm":
        # The model runs elsewhere; the semaphore bounds our open requests.
        async with _llm_gate:
            raw = await llm_generator.generate(http_client, LLM_SETTINGS, nl)
    elif generator == "byt5":
        try:
            # Model inference is CPU-bound and blocking; run it in a thread so it
            # doesn't freeze the event loop (which would time out the healthcheck
            # and stall routing/geocoding requests during an Overpass query).
            # The gate serialises inferences: N concurrent generate() calls on a
            # 2-CPU limit would thrash and can OOM the container.
            raw = await asyncio.to_thread(_generate_gated, overpass_bot, nl)
        except Exception as e:  # noqa: BLE001 - model failure must not 500 the endpoint
            logger.warning("OverpassBot generation failed for %r: %s", nl, e)
            raw = None
    if raw is not None:
        # Extract tag filters from the reply and rebuild a clean, bbox-constrained
        # query (robust to code fences, prose and the byt5 wrappers alike).
        query = build_overpass_query_from_model(raw, south, west, north, east)
        if query is None:
            logger.warning(
                "%s output had no extractable tag filters; using keyword fallback for %r",
                generator, nl,
            )

    # Which engine actually built the query, for the UI to name: the model that
    # was asked, or the keyword search when there was no model or its output
    # was unusable.
    engine = generator if query is not None else "keyword"
    if query is None:
        # No model, or the model output was unusable: keyword tag search.
        query = build_overpass_keyword_query(nl, south, west, north, east)

    try:
        resp = await http_client.post(
            OVERPASS_API, data={"data": query}, timeout=OVERPASS_HTTP_TIMEOUT
        )
    except httpx.RequestError as e:
        logger.warning("Error contacting Overpass API: %s", e)
        return JSONResponse(
            status_code=502,
            content={"error": "Kunne ikke kontakte Overpass-tjenesten"},
        )

    if resp.status_code != 200:
        return JSONResponse(
            status_code=resp.status_code,
            content={
                "error": f"Overpass-tjenesten svarte med {resp.status_code}",
                "raw_query": query,
                "raw_response": resp.text[:500],
            },
        )

    if not resp.text.strip():
        return JSONResponse(
            status_code=502,
            content={
                "error": "Tomt svar fra Overpass-tjenesten",
                "raw_query": query,
            },
        )

    try:
        overpass_json = resp.json()
    except Exception as e:
        logger.warning("Invalid JSON from Overpass: %s", e)
        return JSONResponse(
            status_code=502,
            content={
                "error": "Ugyldig svar fra Overpass-tjenesten",
                "raw_query": query,
                "raw_response": resp.text[:500],
            },
        )

    # Conversion of a large answer is CPU work; keep it off the event loop so
    # routing and geocoding stay responsive meanwhile.
    geojson = await asyncio.to_thread(overpass_to_geojson, overpass_json)
    # A GeoJSON foreign member: which engine read the question.
    geojson["generator"] = engine
    # And the Overpass query that ran, so an analyst can check or reuse it.
    geojson["query"] = query
    return JSONResponse(content=geojson)
