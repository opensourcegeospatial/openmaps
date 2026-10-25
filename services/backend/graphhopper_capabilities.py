"""What the configured GraphHopper can deliver beyond a plain route.

GraphHopper answers a request for elevation, or for a path detail whose
encoded value it does not store, with an error. So the backend asks first:
/info reports whether the graph has elevation and which encoded values it
stores. The answer is cached. A failed probe means "nothing extra" for a
minute, so an unreachable /info makes routes plainer but never makes them fail.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Awaitable, Callable

import httpx

logger = logging.getLogger(__name__)

# The route details the frontend knows how to show, in the order requested.
WANTED_DETAILS: tuple[str, ...] = ("surface", "road_class", "max_speed", "road_environment")


@dataclass(frozen=True)
class Capabilities:
    elevation: bool = False
    details: tuple[str, ...] = ()

    @property
    def any(self) -> bool:
        return self.elevation or bool(self.details)


NONE = Capabilities()


def info_url(route_url: str) -> str:
    """GraphHopper's /info beside its /route: `.../route` becomes `.../info`."""
    base = route_url.rstrip("/")
    if base.endswith("/route"):
        return base[: -len("/route")] + "/info"
    return base + "/info"


def parse_info(payload: object) -> Capabilities:
    """Read `elevation` and the wanted details out of a /info payload."""
    if not isinstance(payload, dict):
        return NONE
    encoded = payload.get("encoded_values")
    names = set(encoded) if isinstance(encoded, (dict, list)) else set()
    return Capabilities(
        elevation=payload.get("elevation") is True,
        details=tuple(name for name in WANTED_DETAILS if name in names),
    )


async def probe_info(
    client: httpx.AsyncClient, route_url: str, api_key: str = "", timeout: float = 3.0
) -> Capabilities:
    """Ask GraphHopper /info. Raises on any HTTP, transport or JSON failure."""
    params = {"key": api_key} if api_key else None
    response = await client.get(info_url(route_url), params=params, timeout=timeout)
    response.raise_for_status()
    return parse_info(response.json())


class CapabilityCache:
    """Caches the probe's answer: `ttl` seconds for an answer, `failure_ttl`
    for a failure (remembered as NONE)."""

    def __init__(
        self,
        probe: Callable[[], Awaitable[Capabilities]],
        *,
        ttl: float = 600.0,
        failure_ttl: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._probe = probe
        self._ttl = ttl
        self._failure_ttl = failure_ttl
        self._clock = clock
        self._value: Capabilities | None = None
        self._expires = 0.0

    async def get(self) -> Capabilities:
        now = self._clock()
        if self._value is not None and now < self._expires:
            return self._value
        try:
            value = await self._probe()
            self._value, self._expires = value, now + self._ttl
        except Exception as exc:
            # Never log str(exc): an httpx.HTTPStatusError's message embeds the
            # full request URL, and GraphHopper's API key travels in its query
            # string. Log only the exception type, and for an HTTP error its
            # status code — enough to diagnose, never the secret. This module
            # stays independent of main.py's _RedactApiKey (which is attached
            # only to the httpx logger, not this one).
            if isinstance(exc, httpx.HTTPStatusError):
                logger.warning(
                    "GraphHopper /info probe failed: HTTPStatusError %d",
                    exc.response.status_code,
                )
            else:
                logger.warning(
                    "GraphHopper /info probe failed: %s", type(exc).__name__
                )
            self._value, self._expires = NONE, now + self._failure_ttl
        return self._value

    def clear(self) -> None:
        self._value = None
        self._expires = 0.0
