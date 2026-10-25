"""Tests for Overpass-to-GeoJSON conversion (nodes, ways, relations/multipolygons)."""

import sys
from unittest.mock import patch

with patch.dict(sys.modules, {"overpass": None, "overpass.OverpassBot": None}):
    sys.modules.pop("main", None)
    from main import overpass_to_geojson


class TestOverpassToGeoJSON:
    def test_empty_elements(self):
        result = overpass_to_geojson({"elements": []})
        assert result["type"] == "FeatureCollection"
        assert result["features"] == []

    def test_node_with_tags_becomes_point(self):
        data = {
            "elements": [
                {"type": "node", "id": 1, "lat": 59.9, "lon": 10.7, "tags": {"name": "Oslo"}},
            ]
        }
        result = overpass_to_geojson(data)
        assert len(result["features"]) == 1
        feat = result["features"][0]
        assert feat["geometry"]["type"] == "Point"
        assert feat["geometry"]["coordinates"] == [10.7, 59.9]
        assert feat["properties"]["name"] == "Oslo"

    def test_node_without_tags_is_skipped(self):
        data = {
            "elements": [
                {"type": "node", "id": 1, "lat": 59.9, "lon": 10.7},
            ]
        }
        result = overpass_to_geojson(data)
        assert len(result["features"]) == 0

    def test_open_way_becomes_linestring(self):
        data = {
            "elements": [
                {"type": "node", "id": 1, "lat": 0.0, "lon": 0.0},
                {"type": "node", "id": 2, "lat": 1.0, "lon": 1.0},
                {"type": "node", "id": 3, "lat": 2.0, "lon": 2.0},
                {
                    "type": "way",
                    "id": 10,
                    "nodes": [1, 2, 3],
                    "tags": {"highway": "residential"},
                },
            ]
        }
        result = overpass_to_geojson(data)
        ways = [f for f in result["features"] if f["geometry"]["type"] == "LineString"]
        assert len(ways) == 1
        assert ways[0]["properties"]["highway"] == "residential"
        assert len(ways[0]["geometry"]["coordinates"]) == 3

    def test_closed_way_becomes_polygon(self):
        data = {
            "elements": [
                {"type": "node", "id": 1, "lat": 0.0, "lon": 0.0},
                {"type": "node", "id": 2, "lat": 1.0, "lon": 0.0},
                {"type": "node", "id": 3, "lat": 1.0, "lon": 1.0},
                {"type": "node", "id": 4, "lat": 0.0, "lon": 1.0},
                {
                    "type": "way",
                    "id": 10,
                    "nodes": [1, 2, 3, 4, 1],
                    "tags": {"building": "yes"},
                },
            ]
        }
        result = overpass_to_geojson(data)
        polys = [f for f in result["features"] if f["geometry"]["type"] == "Polygon"]
        assert len(polys) == 1
        assert polys[0]["properties"]["building"] == "yes"
        # Polygon coords are [[ring]]
        assert len(polys[0]["geometry"]["coordinates"]) == 1
        assert len(polys[0]["geometry"]["coordinates"][0]) == 5

    def test_multipolygon_relation(self):
        data = {
            "elements": [
                {"type": "node", "id": 1, "lat": 0.0, "lon": 0.0},
                {"type": "node", "id": 2, "lat": 1.0, "lon": 0.0},
                {"type": "node", "id": 3, "lat": 1.0, "lon": 1.0},
                {"type": "node", "id": 4, "lat": 0.0, "lon": 1.0},
                {
                    "type": "way",
                    "id": 10,
                    "nodes": [1, 2, 3, 4, 1],
                    "tags": {},
                },
                {
                    "type": "relation",
                    "id": 100,
                    "tags": {"type": "multipolygon", "landuse": "forest"},
                    "members": [
                        {"type": "way", "ref": 10, "role": "outer"},
                    ],
                },
            ]
        }
        result = overpass_to_geojson(data)
        mp = [
            f
            for f in result["features"]
            if f["geometry"] and f["geometry"]["type"] in ("Polygon", "MultiPolygon")
        ]
        assert len(mp) >= 1
        assert mp[-1]["properties"]["landuse"] == "forest"

    def test_non_multipolygon_relation(self):
        data = {
            "elements": [
                {
                    "type": "relation",
                    "id": 100,
                    "tags": {"type": "route", "name": "Bus 31"},
                    "members": [],
                },
            ]
        }
        result = overpass_to_geojson(data)
        assert len(result["features"]) == 1
        assert result["features"][0]["geometry"] is None
        assert result["features"][0]["properties"]["name"] == "Bus 31"

    def test_way_with_missing_node_refs(self):
        """Way referencing nodes not in the dataset should still work (skip missing)."""
        data = {
            "elements": [
                {"type": "node", "id": 1, "lat": 0.0, "lon": 0.0},
                {
                    "type": "way",
                    "id": 10,
                    "nodes": [1, 999],  # 999 doesn't exist
                    "tags": {"highway": "path"},
                },
            ]
        }
        result = overpass_to_geojson(data)
        ways = [f for f in result["features"] if f["geometry"]["type"] == "LineString"]
        assert len(ways) == 1
        assert len(ways[0]["geometry"]["coordinates"]) == 1


def _square_nodes(offset_id=0, x0=0.0, y0=0.0, size=1.0):
    return [
        {"type": "node", "id": offset_id + 1, "lat": y0, "lon": x0},
        {"type": "node", "id": offset_id + 2, "lat": y0, "lon": x0 + size},
        {"type": "node", "id": offset_id + 3, "lat": y0 + size, "lon": x0 + size},
        {"type": "node", "id": offset_id + 4, "lat": y0 + size, "lon": x0},
    ]


class TestMultipolygonAssembly:
    """Real OSM multipolygons (forests, lakes, land use) are built from several
    open member ways whose endpoints chain into a ring."""

    def test_outer_ring_from_two_open_ways(self):
        data = {
            "elements": [
                *_square_nodes(),
                # Two open ways sharing endpoints: 1-2-3 and 3-4-1.
                {"type": "way", "id": 10, "nodes": [1, 2, 3]},
                {"type": "way", "id": 11, "nodes": [3, 4, 1]},
                {
                    "type": "relation",
                    "id": 100,
                    "tags": {"type": "multipolygon", "landuse": "forest"},
                    "members": [
                        {"type": "way", "ref": 10, "role": "outer"},
                        {"type": "way", "ref": 11, "role": "outer"},
                    ],
                },
            ]
        }
        result = overpass_to_geojson(data)
        polys = [
            f for f in result["features"] if f["geometry"] and f["geometry"]["type"] == "Polygon"
        ]
        assert len(polys) == 1
        assert polys[0]["properties"]["landuse"] == "forest"
        ring = polys[0]["geometry"]["coordinates"][0]
        assert ring[0] == ring[-1]
        assert len(ring) == 5

    def test_member_way_direction_is_normalised_when_chaining(self):
        data = {
            "elements": [
                *_square_nodes(),
                # Second way runs "backwards" (1-4-3) relative to the first (1-2-3).
                {"type": "way", "id": 10, "nodes": [1, 2, 3]},
                {"type": "way", "id": 11, "nodes": [1, 4, 3]},
                {
                    "type": "relation",
                    "id": 100,
                    "tags": {"type": "multipolygon", "natural": "water"},
                    "members": [
                        {"type": "way", "ref": 10, "role": "outer"},
                        {"type": "way", "ref": 11, "role": "outer"},
                    ],
                },
            ]
        }
        result = overpass_to_geojson(data)
        polys = [
            f for f in result["features"] if f["geometry"] and f["geometry"]["type"] == "Polygon"
        ]
        assert len(polys) == 1
        assert len(polys[0]["geometry"]["coordinates"][0]) == 5

    def test_inner_ring_becomes_a_hole(self):
        data = {
            "elements": [
                *_square_nodes(0, 0.0, 0.0, 10.0),
                *_square_nodes(10, 4.0, 4.0, 2.0),
                {"type": "way", "id": 10, "nodes": [1, 2, 3, 4, 1]},
                {"type": "way", "id": 11, "nodes": [11, 12, 13, 14, 11]},
                {
                    "type": "relation",
                    "id": 100,
                    "tags": {"type": "multipolygon", "landuse": "forest"},
                    "members": [
                        {"type": "way", "ref": 10, "role": "outer"},
                        {"type": "way", "ref": 11, "role": "inner"},
                    ],
                },
            ]
        }
        result = overpass_to_geojson(data)
        polys = [
            f for f in result["features"] if f["geometry"] and f["geometry"]["type"] == "Polygon"
        ]
        assert len(polys) == 1
        assert len(polys[0]["geometry"]["coordinates"]) == 2  # outer + one hole

    def test_untagged_member_ways_are_not_emitted_as_fragments(self):
        data = {
            "elements": [
                *_square_nodes(),
                {"type": "way", "id": 10, "nodes": [1, 2, 3]},
                {"type": "way", "id": 11, "nodes": [3, 4, 1]},
                {
                    "type": "relation",
                    "id": 100,
                    "tags": {"type": "multipolygon", "landuse": "forest"},
                    "members": [
                        {"type": "way", "ref": 10, "role": "outer"},
                        {"type": "way", "ref": 11, "role": "outer"},
                    ],
                },
            ]
        }
        result = overpass_to_geojson(data)
        # Exactly one feature: the forest. The two untagged member ways pulled
        # in by `>` must not clutter the map as property-less LineStrings.
        assert len(result["features"]) == 1

    def test_untagged_standalone_way_is_skipped_like_untagged_nodes(self):
        data = {
            "elements": [
                *_square_nodes(),
                {"type": "way", "id": 10, "nodes": [1, 2, 3]},
            ]
        }
        assert overpass_to_geojson(data)["features"] == []

    def test_tagged_member_way_is_still_its_own_feature(self):
        data = {
            "elements": [
                *_square_nodes(),
                {"type": "way", "id": 10, "nodes": [1, 2, 3, 4, 1], "tags": {"highway": "track"}},
                {
                    "type": "relation",
                    "id": 100,
                    "tags": {"type": "multipolygon", "landuse": "forest"},
                    "members": [{"type": "way", "ref": 10, "role": "outer"}],
                },
            ]
        }
        result = overpass_to_geojson(data)
        assert len(result["features"]) == 2

    def test_non_object_input_yields_empty_collection(self):
        assert overpass_to_geojson([])["features"] == []
        assert overpass_to_geojson({"elements": [{"type": "node"}]})["features"] == []
