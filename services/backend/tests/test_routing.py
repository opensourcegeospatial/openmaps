"""Unit tests for the flexible-routing helpers (avoid-areas + custom_model).

These exercise the pure functions in main.py directly (no live GraphHopper):
  - parse_avoid_areas: strict parsing/validation of the avoid_areas query param
  - build_avoid_custom_model: GraphHopper 10 custom_model / areas FeatureCollection
"""

import json
import sys
from unittest.mock import patch

import pytest

with patch.dict(sys.modules, {"overpassbot": None, "overpassbot.OverpassBot": None}):
    sys.modules.pop("main", None)
    from fastapi import HTTPException

    import main
    from main import build_avoid_custom_model, parse_avoid_areas


class TestParseAvoidAreas:
    def test_none_returns_empty(self):
        assert parse_avoid_areas(None) == []

    def test_empty_string_returns_empty(self):
        assert parse_avoid_areas("   ") == []

    def test_valid_single_polygon(self):
        raw = json.dumps([[[10.0, 59.0], [10.1, 59.0], [10.1, 59.1]]])
        result = parse_avoid_areas(raw)
        assert len(result) == 1
        assert result[0][0] == [10.0, 59.0]

    def test_invalid_json_raises_400(self):
        with pytest.raises(HTTPException) as exc:
            parse_avoid_areas("{not json")
        assert exc.value.status_code == 400
        assert "JSON" in exc.value.detail

    def test_not_a_list_raises_400(self):
        with pytest.raises(HTTPException) as exc:
            parse_avoid_areas(json.dumps({"foo": "bar"}))
        assert exc.value.status_code == 400

    def test_polygon_too_few_points_raises_400(self):
        with pytest.raises(HTTPException) as exc:
            parse_avoid_areas(json.dumps([[[10.0, 59.0], [10.1, 59.0]]]))
        assert exc.value.status_code == 400

    def test_point_not_pair_raises_400(self):
        with pytest.raises(HTTPException) as exc:
            parse_avoid_areas(json.dumps([[[10.0], [10.1, 59.0], [10.2, 59.1]]]))
        assert exc.value.status_code == 400

    def test_non_numeric_point_raises_400(self):
        with pytest.raises(HTTPException) as exc:
            parse_avoid_areas(json.dumps([[["a", "b"], [10.1, 59.0], [10.2, 59.1]]]))
        assert exc.value.status_code == 400

    def test_bool_rejected_as_coordinate(self):
        with pytest.raises(HTTPException) as exc:
            parse_avoid_areas(json.dumps([[[True, 59.0], [10.1, 59.0], [10.2, 59.1]]]))
        assert exc.value.status_code == 400

    def test_out_of_range_point_raises_400(self):
        with pytest.raises(HTTPException) as exc:
            parse_avoid_areas(json.dumps([[[200.0, 59.0], [10.1, 59.0], [10.2, 59.1]]]))
        assert exc.value.status_code == 400

    def test_too_many_polygons_raises_400(self):
        one = [[10.0, 59.0], [10.1, 59.0], [10.1, 59.1]]
        raw = json.dumps([one] * (main.MAX_AVOID_AREAS + 1))
        with pytest.raises(HTTPException) as exc:
            parse_avoid_areas(raw)
        assert exc.value.status_code == 400

    def test_too_many_points_raises_400(self):
        big = [[10.0, 59.0]] * (main.MAX_AVOID_AREA_POINTS + 1)
        with pytest.raises(HTTPException) as exc:
            parse_avoid_areas(json.dumps([big]))
        assert exc.value.status_code == 400


class TestBuildAvoidCustomModel:
    def test_structure_has_areas_and_priority(self):
        polygons = [[[10.0, 59.0], [10.1, 59.0], [10.1, 59.1]]]
        model = build_avoid_custom_model(polygons)
        assert model["areas"]["type"] == "FeatureCollection"
        assert len(model["areas"]["features"]) == 1
        feature = model["areas"]["features"][0]
        assert feature["type"] == "Feature"
        assert feature["id"] == "avoid_0"
        assert feature["geometry"]["type"] == "Polygon"
        # priority rule references in_<id> and multiplies by 0
        assert model["priority"] == [{"if": "in_avoid_0", "multiply_by": "0"}]

    def test_ring_is_closed(self):
        polygons = [[[10.0, 59.0], [10.1, 59.0], [10.1, 59.1]]]
        model = build_avoid_custom_model(polygons)
        ring = model["areas"]["features"][0]["geometry"]["coordinates"][0]
        assert ring[0] == ring[-1]
        assert len(ring) == 4  # 3 distinct + closing vertex

    def test_already_closed_ring_not_double_closed(self):
        polygons = [[[10.0, 59.0], [10.1, 59.0], [10.1, 59.1], [10.0, 59.0]]]
        model = build_avoid_custom_model(polygons)
        ring = model["areas"]["features"][0]["geometry"]["coordinates"][0]
        assert ring[0] == ring[-1]
        assert len(ring) == 4

    def test_multiple_polygons_get_unique_ids(self):
        poly = [[10.0, 59.0], [10.1, 59.0], [10.1, 59.1]]
        model = build_avoid_custom_model([poly, poly])
        ids = [f["id"] for f in model["areas"]["features"]]
        assert ids == ["avoid_0", "avoid_1"]
        rules = [r["if"] for r in model["priority"]]
        assert rules == ["in_avoid_0", "in_avoid_1"]


class TestPathToFeature:
    """Regression: flexible requests (points_encoded=false) return `points` as a
    GeoJSON LineString object, not an encoded polyline string. _path_to_feature
    must handle both — previously it called polyline.decode() on the dict and
    raised KeyError, 500-ing every alternative-route / avoid-area request."""

    def test_geojson_dict_points(self):
        path = {
            "points": {"type": "LineString", "coordinates": [[10.0, 59.0], [10.1, 59.1]]},
            "distance": 100,
            "time": 5000,
        }
        feat = main._path_to_feature(path, primary=False, index=1)
        assert feat is not None
        assert feat["geometry"]["coordinates"] == [[10.0, 59.0], [10.1, 59.1]]
        assert feat["properties"]["primary"] is False
        assert feat["properties"]["style"] == "alternative"
        assert feat["properties"]["route_index"] == 1

    def test_encoded_polyline_points(self):
        import polyline

        encoded = polyline.encode([(59.0, 10.0), (59.1, 10.1)])
        feat = main._path_to_feature({"points": encoded}, primary=True, index=0)
        assert feat is not None
        coords = feat["geometry"]["coordinates"]
        # stored as [lon, lat], rounded to polyline's ~5-decimal precision
        assert coords[0][0] == pytest.approx(10.0, abs=1e-4)
        assert coords[0][1] == pytest.approx(59.0, abs=1e-4)
        assert feat["properties"]["style"] == "solid"

    def test_missing_points_returns_none(self):
        assert main._path_to_feature({"points": None}, primary=True, index=0) is None
        assert main._path_to_feature({}, primary=True, index=0) is None
        assert (
            main._path_to_feature(
                {"points": {"type": "LineString", "coordinates": []}},
                primary=True,
                index=0,
            )
            is None
        )
