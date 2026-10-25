"""Tests for the Overpass query builders (ML extraction + keyword fallback).

The byt5 model wraps tag filters in many shapes; build_overpass_query_from_model
must reduce any of them to a clean bbox-constrained query, or return None so the
caller falls back to keyword search.
"""

import sys
from unittest.mock import patch

# Force the OverpassBot import to fail so importing `main` doesn't pull in torch.
with patch.dict(sys.modules, {"overpassbot": None, "overpassbot.OverpassBot": None}):
    sys.modules.pop("main", None)
    from main import (
        build_overpass_keyword_query,
        build_overpass_query_from_model,
        safe_load_overpass_bot,
    )


class TestSafeLoadOverpassBot:
    """A missing/corrupt model must never crash startup; the loader returns None
    so the /overpass endpoint degrades to keyword search."""

    def test_returns_none_when_factory_raises(self):
        def boom(model_dir):
            raise RuntimeError("model directory missing")

        assert safe_load_overpass_bot(boom, "/nope") is None

    def test_returns_instance_when_factory_succeeds(self):
        sentinel = object()
        assert safe_load_overpass_bot(lambda model_dir: sentinel, "/ok") is sentinel


class TestBuildOverpassQueryFromModel:
    def test_area_wrapper_stripped(self):
        raw = (
            'relation(30295);map_to_area->.searchArea;'
            '(node["amenity"="restaurant"](area.searchArea);'
            'way["amenity"="restaurant"](area.searchArea););out center;'
        )
        q = build_overpass_query_from_model(raw, 1, 2, 3, 4)
        assert q is not None
        assert 'nwr["amenity"="restaurant"](1,2,3,4)' in q
        assert "map_to_area" not in q and "area.searchArea" not in q
        assert q.startswith("[out:json]")

    def test_bbox_template_stripped(self):
        raw = '(node["amenity"="cafe"]({{bbox}}););out;>;out skel qt;'
        q = build_overpass_query_from_model(raw, 1, 2, 3, 4)
        assert 'nwr["amenity"="cafe"](1,2,3,4)' in q
        assert "{{bbox}}" not in q

    def test_bbox_setting_stripped(self):
        raw = '[bbox:{{bbox}}][out:json];(node["amenity"="restaurant"];);out center;'
        q = build_overpass_query_from_model(raw, 1, 2, 3, 4)
        assert 'nwr["amenity"="restaurant"](1,2,3,4)' in q
        assert "bbox:" not in q

    def test_chained_filters_preserved(self):
        raw = 'node["amenity"="restaurant"]["cuisine"="italian"](area);'
        q = build_overpass_query_from_model(raw, 1, 2, 3, 4)
        assert 'nwr["amenity"="restaurant"]["cuisine"="italian"](1,2,3,4)' in q

    def test_node_way_relation_deduped(self):
        raw = '(node["a"="b"];way["a"="b"];relation["a"="b"];);'
        q = build_overpass_query_from_model(raw, 1, 2, 3, 4)
        assert q.count('nwr["a"="b"]') == 1

    def test_no_filters_returns_none(self):
        assert build_overpass_query_from_model("out count;", 1, 2, 3, 4) is None
        assert build_overpass_query_from_model("", 1, 2, 3, 4) is None


class TestBuildOverpassKeywordQuery:
    def test_norwegian_synonym_applied(self):
        q = build_overpass_keyword_query("apotek", 1, 2, 3, 4)
        assert "pharmacy" in q  # apotek -> pharmacy
        assert "(1,2,3,4)" in q
        assert q.startswith("[out:json]")

    def test_quote_injection_escaped(self):
        q = build_overpass_keyword_query('a"b', 1, 2, 3, 4)
        assert '\\"' in q


class TestKeywordQuerySafety:
    def test_regex_metacharacters_are_escaped(self):
        q = build_overpass_keyword_query("a.b(c", 1, 2, 3, 4)
        # The QL string must carry `\\.` so Overpass' regex engine sees `\.`.
        assert '\\\\.' in q and '\\\\(' in q

    def test_structural_keys_are_not_searched(self):
        q = build_overpass_keyword_query("a", 1, 2, 3, 4)
        for key in ("highway", "building", "landuse", "natural"):
            assert f'"{key}"' not in q
        assert '"amenity"' in q and '"name"' in q

    def test_queries_carry_a_result_size_cap(self):
        assert "[maxsize:" in build_overpass_keyword_query("cafe", 1, 2, 3, 4)
        model_query = build_overpass_query_from_model('node["amenity"="cafe"];', 1, 2, 3, 4)
        assert "[maxsize:" in model_query
