#!/bin/sh
set -e

# Export every variable assigned below so the node config generator (run as a
# child process) sees the resolved defaults, not just vars inherited as env.
set -a

: "${MAP_DEFAULT_ZOOM:=12}"
: "${MAP_DEFAULT_LNG:=10.7446}"
: "${MAP_DEFAULT_LAT:=59.9127}"
: "${MAP_STYLES:=[]}"
: "${API_GRAPHHOPPER_URL:=/api/route}"
: "${API_NOMINATIM_SEARCH_URL:=/api/search}"
: "${API_NOMINATIM_REVERSE_URL:=/api/reverse}"
: "${API_OVERPASS_URL:=/api/overpass}"
: "${HEALTH_DASHBOARD_ENABLED:=}"
: "${STREETVIEW_ENABLED:=false}"
: "${STREETVIEW_TILES_URL:=}"
: "${STREETVIEW_GEOJSON_URL:=}"
: "${STREETVIEW_PANORAMA_URL:=}"
: "${STREETVIEW_METADATA_URL:=}"
: "${STREETVIEW_SOURCE_LAYER:=panoramas}"
: "${STREETVIEW_MIN_ZOOM:=12}"
: "${STREETVIEW_MAX_ZOOM:=18}"
# Marker colours stay empty on purpose: generate-config then omits them and the
# map falls back to the design tokens (mapColors.streetviewFill/Stroke), which
# THEME_PRIMARY re-themes. A default here wins over both — `:=` substitutes on
# empty as well as unset, and compose always sets these variables, so a default
# fires even when the operator left it out of .env.
: "${STREETVIEW_CIRCLE_COLOR:=}"
: "${STREETVIEW_CIRCLE_RADIUS:=6}"
: "${STREETVIEW_CIRCLE_STROKE_COLOR:=}"
: "${STREETVIEW_CIRCLE_STROKE_WIDTH:=2}"
: "${STREETVIEW_CIRCLE_OPACITY:=0.85}"
: "${STREETVIEW_BOUNDS:=}"
: "${THEME_PRIMARY:=}"
: "${THEME_NEUTRAL:=}"
: "${THEME_SURFACE:=}"
: "${THEME_BACKGROUND:=}"
: "${THEME_TEXT:=}"
: "${THEME_BORDER:=}"
: "${THEME_SUCCESS:=}"
: "${THEME_DANGER:=}"
: "${THEME_WARNING:=}"
: "${THEME_ROUTE_PRIMARY:=}"
: "${THEME_ROUTE_ALTERNATIVE:=}"
: "${THEME_MARKER_FROM:=}"
: "${THEME_MARKER_TO:=}"
: "${THEME_MARKER_WAYPOINT:=}"
: "${THEME_AVOID:=}"
: "${THEME_FEATURE_SELECTED:=}"

set +a

# Detect serving root: nginx html dir or legacy /app/dist
if [ -d /usr/share/nginx/html ]; then
  WEBROOT="/usr/share/nginx/html"
else
  WEBROOT="/app/dist"
fi

OUT="${WEBROOT}/config.json"
export OUT WEBROOT

echo "[entrypoint] Generating runtime map config..."
echo "[entrypoint] Output: $OUT"

# Ensure folder exists
mkdir -p "$(dirname "$OUT")"
mkdir -p "${WEBROOT}"
mkdir -p "${WEBROOT}/client"
mkdir -p "${WEBROOT}/static"
mkdir -p "${WEBROOT}/client/static"

# Use the extracted generate-config script (shared with tests)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "${SCRIPT_DIR}/scripts/generate-config.cjs"

echo "[entrypoint] Done. Starting app..."
exec "$@"
