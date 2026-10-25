"""Tests for endpoint response shapes with mocked external services."""

import json
import sys
from unittest.mock import AsyncMock, patch

import httpx
import pytest


@pytest.fixture(autouse=True)
def _clean_main():
    """Ensure main module is freshly imported for each test."""
    sys.modules.pop("main", None)
    yield
    sys.modules.pop("main", None)


class TestConfigEndpoint:
    def test_config_returns_all_keys(self, client):
        resp = client.get("/config")
        assert resp.status_code == 200
        data = resp.json()
        assert "geocode_url" in data
        assert "reverse_geocode_url" in data
        assert "graphhopper_url" in data
        assert "overpass_url" in data

    def test_config_reports_model_status(self, client):
        # Without the torch module the model is unavailable; the UI can show that
        # instead of guessing why natural-language search is slow or degraded.
        resp = client.get("/config")
        assert resp.json()["overpass_model"] == "unavailable"

    def test_config_values_are_strings(self, client):
        resp = client.get("/config")
        data = resp.json()
        for value in data.values():
            assert isinstance(value, str)


class TestSearchEndpoint:
    def test_search_returns_geojson(self, client):
        import main

        geo = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [10.7, 59.9]},
                    "properties": {"display_name": "Oslo"},
                }
            ],
        }
        with patch.object(main, "http_client", _mock_http_client(get_json=geo)):
            resp = client.get("/search", params={"q": "Oslo"})

        assert resp.status_code == 200
        data = resp.json()
        assert data["type"] == "FeatureCollection"
        assert "features" in data

    def test_search_requires_q_param(self, client):
        resp = client.get("/search")
        assert resp.status_code == 422  # FastAPI validation error


class TestReverseEndpoint:
    def test_reverse_returns_geojson(self, client):
        import main

        geo = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [10.7, 59.9]},
                    "properties": {"display_name": "Oslo"},
                }
            ],
        }
        with patch.object(main, "http_client", _mock_http_client(get_json=geo)):
            resp = client.get("/reverse", params={"lat": 59.9, "lon": 10.7})

        assert resp.status_code == 200
        data = resp.json()
        assert data["type"] == "FeatureCollection"

    def test_reverse_requires_lat_lon(self, client):
        resp = client.get("/reverse")
        assert resp.status_code == 422

    def test_reverse_requires_both_params(self, client):
        resp = client.get("/reverse", params={"lat": 59.9})
        assert resp.status_code == 422


def _mock_http_client(get_json=None, post_json=None):
    """Build an AsyncMock standing in for main.http_client (the shared client).

    The /route endpoint (and others) use the module-level shared http_client
    created in the lifespan handler, so tests patch that object directly.
    """
    mock_client = AsyncMock()
    if get_json is not None:
        mock_client.get = AsyncMock(return_value=httpx.Response(200, json=get_json))
    if post_json is not None:
        mock_client.post = AsyncMock(return_value=httpx.Response(200, json=post_json))
    return mock_client


class TestRouteEndpoint:
    def test_route_returns_routes_list(self, client):
        import main

        gh = {
            "paths": [
                {
                    "distance": 1234.5,
                    "time": 60000,
                    "points": "o~r`IqcbM_@_@",
                    "snapped_waypoints": "o~r`IqcbM_@_@",
                    "instructions": [],
                }
            ]
        }
        with patch.object(main, "http_client", _mock_http_client(get_json=gh)):
            resp = client.get(
                "/route",
                params={"from": "59.9,10.7", "to": "60.0,10.8", "profile": "car"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert "routes" in data
        assert len(data["routes"]) >= 1
        route_feat = data["routes"][0]
        assert route_feat["geometry"]["type"] == "LineString"
        assert route_feat["properties"]["primary"] is True
        assert "distance" in route_feat["properties"]
        assert "time" in route_feat["properties"]

    def test_route_fast_path_uses_get_not_post(self, client):
        """No alternatives + no avoid_areas must use the CH GET fast path."""
        import main

        gh = {
            "paths": [
                {"distance": 1.0, "time": 1, "points": "o~r`IqcbM_@_@", "instructions": []}
            ]
        }
        mock_client = _mock_http_client(get_json=gh, post_json=gh)
        with patch.object(main, "http_client", mock_client):
            resp = client.get(
                "/route", params={"from": "59.9,10.7", "to": "60.0,10.8"}
            )

        assert resp.status_code == 200
        mock_client.get.assert_awaited_once()
        mock_client.post.assert_not_awaited()

    def test_route_asks_graphhopper_for_norwegian_instructions(self, client):
        """Turn-by-turn text is shown verbatim in the UI, so it must be Norwegian."""
        import main

        gh = {
            "paths": [
                {"distance": 1.0, "time": 1, "points": "o~r`IqcbM_@_@", "instructions": []}
            ]
        }
        mock_client = _mock_http_client(get_json=gh, post_json=gh)
        with patch.object(main, "http_client", mock_client):
            client.get("/route", params={"from": "59.9,10.7", "to": "60.0,10.8"})
            client.get(
                "/route",
                params={"from": "59.9,10.7", "to": "60.0,10.8", "alternatives": "true"},
            )

        get_params = mock_client.get.await_args.kwargs["params"]
        post_body = mock_client.post.await_args.kwargs["json"]
        assert get_params["locale"] == "nb_NO"
        assert post_body["locale"] == "nb_NO"

    def test_route_alternatives_uses_post_flexible(self, client):
        """alternatives=true must POST a flexible request with ch.disable=true."""
        import main

        gh = {
            "paths": [
                {"distance": 1.0, "time": 1, "points": "o~r`IqcbM_@_@", "instructions": []},
                {"distance": 2.0, "time": 2, "points": "o~r`IqcbM_@_@", "instructions": []},
            ]
        }
        mock_client = _mock_http_client(get_json=gh, post_json=gh)
        with patch.object(main, "http_client", mock_client):
            resp = client.get(
                "/route",
                params={"from": "59.9,10.7", "to": "60.0,10.8", "alternatives": "true"},
            )

        assert resp.status_code == 200
        mock_client.post.assert_awaited_once()
        mock_client.get.assert_not_awaited()
        body = mock_client.post.call_args.kwargs["json"]
        assert body["ch.disable"] is True
        assert body["algorithm"] == "alternative_route"
        assert body["points_encoded"] is False
        data = resp.json()
        assert len(data["routes"]) == 2
        assert data["routes"][0]["properties"]["primary"] is True
        assert data["routes"][1]["properties"]["style"] == "alternative"

    def test_route_avoid_areas_builds_custom_model(self, client):
        """avoid_areas must POST a custom_model with an areas FeatureCollection."""
        import main

        gh = {
            "paths": [
                {"distance": 1.0, "time": 1, "points": "o~r`IqcbM_@_@", "instructions": []}
            ]
        }
        mock_client = _mock_http_client(get_json=gh, post_json=gh)
        avoid = json.dumps([[[10.0, 59.0], [10.1, 59.0], [10.1, 59.1]]])
        with patch.object(main, "http_client", mock_client):
            resp = client.get(
                "/route",
                params={"from": "59.9,10.7", "to": "60.0,10.8", "avoid_areas": avoid},
            )

        assert resp.status_code == 200
        mock_client.post.assert_awaited_once()
        body = mock_client.post.call_args.kwargs["json"]
        assert body["ch.disable"] is True
        cm = body["custom_model"]
        assert cm["areas"]["type"] == "FeatureCollection"
        assert cm["priority"] == [{"if": "in_avoid_0", "multiply_by": "0"}]

    def test_route_rejects_malformed_avoid_areas(self, client):
        resp = client.get(
            "/route",
            params={
                "from": "59.9,10.7",
                "to": "60.0,10.8",
                "avoid_areas": "{not json",
            },
        )
        assert resp.status_code == 400
        assert "JSON" in resp.json()["detail"]

    def test_route_requires_from_and_to(self, client):
        resp = client.get("/route", params={"from": "59.9,10.7"})
        assert resp.status_code == 422

    def test_route_graphhopper_error(self, client):
        import main

        gh = {"message": "Cannot find point", "hints": []}
        with patch.object(main, "http_client", _mock_http_client(get_json=gh)):
            resp = client.get(
                "/route", params={"from": "59.9,10.7", "to": "60.0,10.8"}
            )

        assert resp.status_code == 400
        assert "error" in resp.json()


class TestOverpassEndpoint:
    def test_overpass_keyword_fallback_when_bot_unavailable(self, client):
        # When the OverpassBot model is unavailable the endpoint falls back to a
        # keyword query and forwards it to the Overpass API. Mock the shared
        # http_client so the fallback returns a GeoJSON FeatureCollection.
        import main

        main.overpass_bot = None
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(
            return_value=httpx.Response(200, json={"elements": []})
        )
        with patch.object(main, "http_client", mock_client):
            resp = client.get(
                "/overpass",
                params={
                    "nl": "cafe",
                    "south": 52.0,
                    "west": 13.0,
                    "north": 53.0,
                    "east": 14.0,
                },
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["type"] == "FeatureCollection"

    def test_overpass_requires_all_params(self, client):
        resp = client.get("/overpass", params={"nl": "cafes"})
        assert resp.status_code == 422

    def test_overpass_rejects_inverted_bbox(self, client):
        # south > north is a malformed box and must be rejected before any
        # upstream call (mirrors the /streetview/panoramas bbox guard).
        resp = client.get(
            "/overpass",
            params={"nl": "cafe", "south": 53.0, "west": 13.0, "north": 52.0, "east": 14.0},
        )
        assert resp.status_code == 400

    def test_overpass_rejects_out_of_range_coords(self, client):
        resp = client.get(
            "/overpass",
            params={"nl": "cafe", "south": -91.0, "west": 13.0, "north": 53.0, "east": 14.0},
        )
        assert resp.status_code == 400


class TestUpstreamStatusMapping:
    """Upstream failures must not be reported as success or as the user's fault."""

    def _client_with(self, method, response):
        mock_client = AsyncMock()
        setattr(mock_client, method, AsyncMock(return_value=response))
        return mock_client

    def test_search_maps_nominatim_5xx_to_502(self, client):
        import main

        response = httpx.Response(500, json={"error": "boom"})
        with patch.object(main, "http_client", self._client_with("get", response)):
            resp = client.get("/search", params={"q": "Oslo"})
        assert resp.status_code == 502
        assert "søketjenesten" in resp.json()["detail"].lower()

    def test_search_passes_through_nominatim_4xx(self, client):
        import main

        response = httpx.Response(429, json={"error": "slow down"})
        with patch.object(main, "http_client", self._client_with("get", response)):
            resp = client.get("/search", params={"q": "Oslo"})
        assert resp.status_code == 429

    def test_reverse_maps_nominatim_5xx_to_502(self, client):
        import main

        response = httpx.Response(503, text="down")
        with patch.object(main, "http_client", self._client_with("get", response)):
            resp = client.get("/reverse", params={"lat": 59.9, "lon": 10.7})
        assert resp.status_code == 502

    def test_route_maps_graphhopper_5xx_to_502_not_400(self, client):
        import main

        gh = {"message": "Internal error while building graph", "hints": []}
        response = httpx.Response(500, json=gh)
        with patch.object(main, "http_client", self._client_with("get", response)):
            resp = client.get("/route", params={"from": "59.9,10.7", "to": "60.0,10.8"})
        assert resp.status_code == 502
        assert "error" in resp.json()

    def test_route_keeps_400_for_graphhopper_client_errors(self, client):
        import main

        gh = {
            "message": "Cannot find point 0: 59.9,10.7",
            "hints": [{"message": "Point 0 is out of bounds"}],
        }
        response = httpx.Response(400, json=gh)
        with patch.object(main, "http_client", self._client_with("get", response)):
            resp = client.get("/route", params={"from": "59.9,10.7", "to": "60.0,10.8"})
        assert resp.status_code == 400
        assert resp.json()["error"] == "Point 0 is out of bounds"

    def test_route_survives_non_object_graphhopper_json(self, client):
        import main

        response = httpx.Response(200, json=["weird"])
        with patch.object(main, "http_client", self._client_with("get", response)):
            resp = client.get("/route", params={"from": "59.9,10.7", "to": "60.0,10.8"})
        assert resp.status_code == 502


class TestCoordinateValidation:
    def test_reverse_rejects_out_of_range_coordinates(self, client):
        resp = client.get("/reverse", params={"lat": 91.0, "lon": 10.7})
        assert resp.status_code == 400

    def test_route_rejects_nan_and_out_of_range_points(self, client):
        nan = client.get("/route", params={"from": "nan,10.7", "to": "60.0,10.8"})
        out_of_range = client.get("/route", params={"from": "59.9,10.7", "to": "60.0,181"})
        assert nan.status_code == 400
        assert out_of_range.status_code == 400

    def test_route_caps_number_of_via_points(self, client):
        params = [("from", "59.9,10.7"), ("to", "60.0,10.8")] + [("waypoint", "59.95,10.75")] * 30
        resp = client.get("/route", params=params)
        assert resp.status_code == 400


class TestSearchContext:
    """/search ranks hits in the current map view first and asks Nominatim for
    Norwegian names; /reverse asks for Norwegian names too."""

    EMPTY = {"type": "FeatureCollection", "features": []}

    def test_search_forwards_viewbox_and_language(self, client):
        import main

        mock_client = _mock_http_client(get_json=self.EMPTY)
        with patch.object(main, "http_client", mock_client):
            resp = client.get(
                "/search", params={"q": "Storgata", "viewbox": "10.5,59.8,10.9,60.0"}
            )

        assert resp.status_code == 200
        params = mock_client.get.call_args.kwargs["params"]
        assert params["viewbox"] == "10.5,59.8,10.9,60.0"
        # Rank, never filter: bounded=1 would hide every hit outside the view.
        assert params["bounded"] == 0
        assert params["accept-language"] == "nb,nn,no,en"

    def test_search_without_viewbox_sends_neither_viewbox_nor_bounded(self, client):
        import main

        mock_client = _mock_http_client(get_json=self.EMPTY)
        with patch.object(main, "http_client", mock_client):
            resp = client.get("/search", params={"q": "Storgata"})

        assert resp.status_code == 200
        params = mock_client.get.call_args.kwargs["params"]
        assert "viewbox" not in params
        assert "bounded" not in params
        assert params["accept-language"] == "nb,nn,no,en"

    def test_search_rejects_a_malformed_viewbox_before_calling_nominatim(self, client):
        import main

        mock_client = _mock_http_client(get_json=self.EMPTY)
        with patch.object(main, "http_client", mock_client):
            resp = client.get(
                "/search", params={"q": "Storgata", "viewbox": "10.9,59.8,10.5,60.0"}
            )

        assert resp.status_code == 400
        assert resp.json()["detail"] == "Ugyldig kartutsnitt"
        mock_client.get.assert_not_called()

    def test_reverse_sends_the_language_preference(self, client):
        import main

        mock_client = _mock_http_client(get_json=self.EMPTY)
        with patch.object(main, "http_client", mock_client):
            resp = client.get("/reverse", params={"lat": 59.9, "lon": 10.7})

        assert resp.status_code == 200
        assert mock_client.get.call_args.kwargs["params"]["accept-language"] == "nb,nn,no,en"
