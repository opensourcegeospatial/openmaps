import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# Ensure the backend package is importable
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

# Block the optional torch-based OverpassBot import for the entire test session so
# importing `main` never loads torch. The unit tests don't exercise the model, and
# torch can segfault under some local Python builds; main.py degrades gracefully to
# OVERPASS_BOT_AVAILABLE=False when the import fails. (conftest is imported before
# any test module, so this covers files that import `main` outside the fixtures.)
sys.modules.setdefault("overpassbot", None)
sys.modules.setdefault("overpassbot.OverpassBot", None)


@pytest.fixture()
def client():
    """Create a FastAPI TestClient with OverpassBot mocked out."""
    # Mock the OverpassBot import so main.py loads without torch
    with patch.dict(
        sys.modules,
        {"overpassbot": None, "overpassbot.OverpassBot": None},
    ):
        # Clear cached module so it re-imports with mocked modules
        sys.modules.pop("main", None)
        from starlette.testclient import TestClient

        import graphhopper_capabilities as ghcaps
        import main  # noqa: F811

        async def _nothing_extra():
            return ghcaps.NONE

        # The /route tests mock http_client and count its calls; a real
        # capability probe would add a GET to /info. Tests that exercise
        # route details patch main.gh_capabilities themselves.
        main.gh_capabilities = ghcaps.CapabilityCache(_nothing_extra)
        yield TestClient(main.app)
