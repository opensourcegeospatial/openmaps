"""/route asks GraphHopper only for what it has (elevation, details) and
passes it through: heights aligned 1:1 with a 2D geometry, ascend/descend,
and point-index detail intervals."""

from unittest.mock import AsyncMock, patch

import httpx

import graphhopper_capabilities as ghcaps

FULL = ghcaps.Capabilities(
    elevation=True, details=("surface", "road_class", "max_speed", "road_environment")
)

GH_3D = {
    "paths": [
        {
            "distance": 240.0,
            "time": 60000,
            "ascend": 10.0,
            "descend": 0.0,
            "points": {
                "type": "LineString",
                "coordinates": [[10.70, 59.90, 20.0], [10.71, 59.91, 25.5], [10.72, 59.92, 30.0]],
            },
            "snapped_waypoints": {
                "type": "LineString",
                "coordinates": [[10.70, 59.90, 20.0], [10.72, 59.92, 30.0]],
            },
            "details": {
                "surface": [[0, 1, "asphalt"], [1, 2, "gravel"]],
                "max_speed": [[0, 2, None]],
            },
            "instructions": [],
        }
    ]
}

GH_2D = {
    "paths": [
        {
            "distance": 240.0,
            "time": 60000,
            "points": {"type": "LineString", "coordinates": [[10.70, 59.90], [10.72, 59.92]]},
            "instructions": [],
        }
    ]
}

ROUTE = {"from": "59.9,10.7", "to": "59.92,10.72"}


def _caps(value, calls=None):
    async def probe():
        if calls is not None:
            calls.append(1)
        return value

    return ghcaps.CapabilityCache(probe)


def _client(get=None, post=None):
    mock = AsyncMock()
    if get is not None:
        mock.get = AsyncMock(side_effect=get)
    if post is not None:
        mock.post = AsyncMock(side_effect=post)
    return mock


def test_fast_path_asks_for_elevation_and_details(client):
    import main

    http = _client(get=[httpx.Response(200, json=GH_3D)])
    with (
        patch.object(main, "gh_capabilities", _caps(FULL)),
        patch.object(main, "http_client", http),
    ):
        resp = client.get("/route", params=ROUTE)

    assert resp.status_code == 200
    params = http.get.await_args.kwargs["params"]
    assert params["points_encoded"] == "false"
    assert params["elevation"] == "true"
    assert params["details"] == ["surface", "road_class", "max_speed", "road_environment"]


def test_flexible_path_asks_for_them_in_the_body(client):
    import main

    http = _client(post=[httpx.Response(200, json=GH_3D)])
    with (
        patch.object(main, "gh_capabilities", _caps(FULL)),
        patch.object(main, "http_client", http),
    ):
        resp = client.get("/route", params={**ROUTE, "alternatives": "true"})

    assert resp.status_code == 200
    body = http.post.await_args.kwargs["json"]
    assert body["elevation"] is True
    assert body["details"] == ["surface", "road_class", "max_speed", "road_environment"]


def test_heights_leave_the_geometry_and_details_pass_through(client):
    import main

    http = _client(get=[httpx.Response(200, json=GH_3D)])
    with (
        patch.object(main, "gh_capabilities", _caps(FULL)),
        patch.object(main, "http_client", http),
    ):
        data = client.get("/route", params=ROUTE).json()

    route = data["routes"][0]
    assert route["geometry"]["coordinates"] == [[10.70, 59.90], [10.71, 59.91], [10.72, 59.92]]
    props = route["properties"]
    assert props["elevation"] == [20.0, 25.5, 30.0]
    assert props["ascend"] == 10.0
    assert props["descend"] == 0.0
    assert props["details"]["surface"] == [[0, 1, "asphalt"], [1, 2, "gravel"]]
    assert props["details"]["max_speed"] == [[0, 2, None]]
    # Snapped waypoints are compared in 2D: a stop that snapped onto itself
    # draws no connector (with 3D points every stop drew one).
    assert data["dashed_segments"] == []


def test_without_capabilities_the_request_and_the_shape_stay_plain(client):
    import main

    http = _client(get=[httpx.Response(200, json=GH_2D)])
    with (
        patch.object(main, "gh_capabilities", _caps(ghcaps.NONE)),
        patch.object(main, "http_client", http),
    ):
        data = client.get("/route", params=ROUTE).json()

    params = http.get.await_args.kwargs["params"]
    assert "elevation" not in params
    assert "details" not in params
    props = data["routes"][0]["properties"]
    for key in ("elevation", "ascend", "descend", "details"):
        assert key not in props


def test_heights_with_a_gap_are_dropped_not_guessed(client):
    import main

    broken = {
        "paths": [
            {
                **GH_3D["paths"][0],
                "points": {
                    "type": "LineString",
                    "coordinates": [[10.70, 59.90, 20.0], [10.71, 59.91], [10.72, 59.92, 30.0]],
                },
            }
        ]
    }
    http = _client(get=[httpx.Response(200, json=broken)])
    with (
        patch.object(main, "gh_capabilities", _caps(FULL)),
        patch.object(main, "http_client", http),
    ):
        props = client.get("/route", params=ROUTE).json()["routes"][0]["properties"]

    assert "elevation" not in props


def test_a_refusal_forgets_the_probe_and_retries_plainly(client):
    import main

    calls = []
    http = _client(
        get=[
            httpx.Response(400, json={"message": "Elevation not supported!"}),
            httpx.Response(200, json=GH_2D),
            httpx.Response(200, json=GH_2D),
        ]
    )
    with (
        patch.object(main, "gh_capabilities", _caps(FULL, calls)),
        patch.object(main, "http_client", http),
    ):
        resp = client.get("/route", params=ROUTE)
        assert resp.status_code == 200
        retry_params = http.get.await_args_list[1].kwargs["params"]
        assert "elevation" not in retry_params
        assert "details" not in retry_params
        # The cache was cleared: the next route probes again.
        client.get("/route", params=ROUTE)
    assert len(calls) == 2


def test_a_plain_refusal_is_not_retried(client):
    import main

    http = _client(get=[httpx.Response(400, json={"message": "Cannot find point 0"})])
    with (
        patch.object(main, "gh_capabilities", _caps(ghcaps.NONE)),
        patch.object(main, "http_client", http),
    ):
        resp = client.get("/route", params=ROUTE)

    assert resp.status_code == 400
    http.get.assert_awaited_once()


UNROUTABLE_400 = {
    "message": "Cannot find point 0: 59.9,10.7",
    "hints": [
        {
            "message": "Cannot find point 0: 59.9,10.7",
            "details": "com.graphhopper.util.exceptions.PointNotFoundException",
        }
    ],
}


def test_an_unroutable_400_is_not_retried_even_with_full_capabilities(client):
    import main

    calls = []
    http = _client(get=[httpx.Response(400, json=UNROUTABLE_400), httpx.Response(200, json=GH_3D)])
    with (
        patch.object(main, "gh_capabilities", _caps(FULL, calls)),
        patch.object(main, "http_client", http),
    ):
        resp = client.get("/route", params=ROUTE)
        assert resp.status_code == 400
        http.get.assert_awaited_once()
        # The cache was not touched: the next route does not re-probe.
        client.get("/route", params=ROUTE)
    assert len(calls) == 1


def test_flexible_refusal_retries_plainly_too(client):
    import main

    http = _client(
        post=[
            httpx.Response(400, json={"message": "Elevation not supported!"}),
            httpx.Response(200, json=GH_2D),
        ]
    )
    with (
        patch.object(main, "gh_capabilities", _caps(FULL)),
        patch.object(main, "http_client", http),
    ):
        resp = client.get("/route", params={**ROUTE, "alternatives": "true"})

    assert resp.status_code == 200
    retry_body = http.post.await_args.kwargs["json"]
    assert "elevation" not in retry_body
    assert "details" not in retry_body


def test_a_refusal_that_fails_plainly_too_keeps_the_cache(client):
    import main

    calls = []
    http = _client(
        get=[
            httpx.Response(400, json={"message": "Elevation not supported!"}),
            httpx.Response(400, json={"message": "Elevation not supported!"}),
            httpx.Response(200, json=GH_2D),
        ]
    )
    with (
        patch.object(main, "gh_capabilities", _caps(FULL, calls)),
        patch.object(main, "http_client", http),
    ):
        resp = client.get("/route", params=ROUTE)
        assert resp.status_code == 400
        # Not cleared: the next route does not re-probe.
        client.get("/route", params=ROUTE)
    assert len(calls) == 1


def test_a_dropped_coordinate_withholds_elevation_and_details_not_the_geometry(client):
    import main

    broken = {
        "paths": [
            {
                **GH_3D["paths"][0],
                "points": {
                    "type": "LineString",
                    "coordinates": [
                        [10.70, 59.90, 20.0],
                        "not-a-point",
                        [10.71, 59.91, 25.5],
                        [10.72, 59.92, 30.0],
                    ],
                },
            }
        ]
    }
    http = _client(get=[httpx.Response(200, json=broken)])
    with (
        patch.object(main, "gh_capabilities", _caps(FULL)),
        patch.object(main, "http_client", http),
    ):
        data = client.get("/route", params=ROUTE).json()

    route = data["routes"][0]
    assert route["geometry"]["coordinates"] == [[10.70, 59.90], [10.71, 59.91], [10.72, 59.92]]
    props = route["properties"]
    assert "elevation" not in props
    assert "details" not in props
