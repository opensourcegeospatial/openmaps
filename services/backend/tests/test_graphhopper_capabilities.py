"""What the configured GraphHopper can deliver: /info parsing, the probe, the cache."""

import logging

import httpx
import pytest

import graphhopper_capabilities as ghcaps

FULL_INFO = {
    "bbox": [0, 0, 1, 1],
    "elevation": True,
    "encoded_values": {
        "surface": ["asphalt", "gravel"],
        "road_class": ["primary"],
        "max_speed": [">number"],
        "road_environment": ["road", "bridge"],
        "country": ["NOR"],
    },
    "profiles": [],
    "version": "10.0",
}


def test_info_url_sits_beside_route():
    assert ghcaps.info_url("http://graphhopper:8989/route") == "http://graphhopper:8989/info"
    assert ghcaps.info_url("https://graphhopper.com/api/1/route/") == "https://graphhopper.com/api/1/info"


def test_parse_info_keeps_elevation_and_wanted_details_in_order():
    caps = ghcaps.parse_info(FULL_INFO)
    assert caps.elevation is True
    assert caps.details == ("surface", "road_class", "max_speed", "road_environment")
    assert caps.any is True


def test_parse_info_self_hosted_today_has_no_elevation_or_surface():
    info = {
        "elevation": False,
        "encoded_values": {
            "road_class": [],
            "max_speed": [],
            "road_environment": [],
            "smoothness": [],
        },
    }
    caps = ghcaps.parse_info(info)
    expected_details = ("road_class", "max_speed", "road_environment")
    assert caps == ghcaps.Capabilities(elevation=False, details=expected_details)


@pytest.mark.parametrize(
    "payload",
    [None, [], "info", {"elevation": "true"}, {"encoded_values": 3}],
)
def test_parse_info_reads_garbage_as_nothing(payload):
    assert ghcaps.parse_info(payload) == ghcaps.NONE
    assert ghcaps.NONE.any is False


async def test_probe_info_asks_info_with_the_key():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = request.url
        return httpx.Response(200, json=FULL_INFO)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        caps = await ghcaps.probe_info(client, "http://gh:8989/route", "secret")
    assert seen["url"].path == "/info"
    assert seen["url"].params["key"] == "secret"
    assert caps.elevation is True


async def test_probe_info_sends_no_key_when_unset():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = request.url
        return httpx.Response(200, json=FULL_INFO)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await ghcaps.probe_info(client, "http://gh:8989/route")
    assert "key" not in seen["url"].params


async def test_probe_info_raises_on_http_errors():
    def error_handler(r):
        return httpx.Response(500)

    async with httpx.AsyncClient(transport=httpx.MockTransport(error_handler)) as client:
        with pytest.raises(httpx.HTTPStatusError):
            await ghcaps.probe_info(client, "http://gh:8989/route")


class _Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


async def test_cache_reuses_an_answer_until_it_expires():
    clock = _Clock()
    calls = []

    async def probe():
        calls.append(clock.now)
        return ghcaps.Capabilities(elevation=True)

    cache = ghcaps.CapabilityCache(probe, ttl=600, clock=clock)
    assert (await cache.get()).elevation is True
    clock.now += 599
    await cache.get()
    assert len(calls) == 1
    clock.now += 2
    await cache.get()
    assert len(calls) == 2


async def test_cache_remembers_a_failure_briefly_as_nothing():
    clock = _Clock()
    calls = []

    async def probe():
        calls.append(clock.now)
        raise httpx.ConnectError("down")

    cache = ghcaps.CapabilityCache(probe, failure_ttl=60, clock=clock)
    assert await cache.get() == ghcaps.NONE
    clock.now += 59
    assert await cache.get() == ghcaps.NONE
    assert len(calls) == 1
    clock.now += 2
    await cache.get()
    assert len(calls) == 2


async def test_cache_never_logs_the_api_key_on_a_probe_failure(caplog):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401)

    async def probe():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await ghcaps.probe_info(
                client, "https://gh.example/api/1/route", "SECRET123"
            )

    cache = ghcaps.CapabilityCache(probe)
    with caplog.at_level(logging.WARNING, logger="graphhopper_capabilities"):
        result = await cache.get()

    assert result == ghcaps.NONE
    logged = "\n".join(record.getMessage() for record in caplog.records)
    assert "SECRET123" not in logged
    assert "401" in logged


async def test_cache_clear_forces_a_fresh_probe():
    calls = []

    async def probe():
        calls.append(1)
        return ghcaps.NONE

    cache = ghcaps.CapabilityCache(probe)
    await cache.get()
    cache.clear()
    await cache.get()
    assert len(calls) == 2
