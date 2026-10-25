"""parse_viewbox turns the SPA's west,south,east,north box into Nominatim's
viewbox and rejects anything that is not four in-range, ordered numbers."""

import sys
from unittest.mock import patch

import pytest
from fastapi import HTTPException


def _import_main():
    with patch.dict(sys.modules, {"overpassbot": None, "overpassbot.OverpassBot": None}):
        sys.modules.pop("main", None)
        import main

        return main


def test_absent_or_blank_means_no_viewbox():
    main = _import_main()
    assert main.parse_viewbox(None) is None
    assert main.parse_viewbox("   ") is None


def test_valid_box_is_passed_through_in_nominatim_order():
    main = _import_main()
    assert main.parse_viewbox("10.5,59.8,10.9,60.0") == "10.5,59.8,10.9,60.0"


@pytest.mark.parametrize(
    "raw",
    [
        "10.5,59.8,10.9",  # three numbers
        "a,b,c,d",  # not numbers
        "nan,59.8,10.9,60.0",  # NaN parses as a float but is not a coordinate
        "1e999,59.8,10.9,60.0",  # infinity
        "10.9,59.8,10.5,60.0",  # west east of east
        "10.5,60.0,10.9,59.8",  # south north of north
        "10.5,59.8,10.9,95",  # latitude out of range
        "-190,59.8,10.9,60.0",  # longitude out of range
    ],
)
def test_malformed_box_is_a_400_in_norwegian(raw):
    main = _import_main()
    with pytest.raises(HTTPException) as excinfo:
        main.parse_viewbox(raw)
    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "Ugyldig kartutsnitt"
