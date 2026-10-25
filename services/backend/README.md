# Backend

API-et i OpenMaps (Python 3.12 og FastAPI). Det sender søk, adresseoppslag, ruter og
Overpass-spørringer videre til karttjenestene, gjør tekstsøk om til Overpass-spørringer,
serverer gatebilder og svarer på helsesjekken. Nettappen når det gjennom sin egen nginx på
`/api/*`.

## Innstillinger

Alt stilles inn med miljøvariabler. Med Compose kommer de fra `.env` i rotmappen. Hver
variabel er forklart i `.env.example` og under «Konfigurasjon» i README-en der. De
viktigste:

| Variabel | Beskrivelse |
|---|---|
| `GEOCODE_URL`, `REVERSE_GEOCODE_URL` | Nominatims `/search` og `/reverse`. |
| `GRAPHHOPPER_URL` | GraphHoppers `/route`. |
| `OVERPASS_API` | Overpass' `/api/interpreter`. |
| `GRAPHHOPPER_API_KEY` | Nøkkel for graphhopper.com, sendt som parameteren `key`. Vises aldri på `/config` og logges aldri. |
| `HTTP_USER_AGENT` | User-Agent på alle forespørsler videre (standard `OpenMaps/1.0`). De offentlige OSM-tjenestene vil ha navn og en kontaktadresse. |
| `NOMINATIM_LANGUAGE` | Språk for stedsnavn (standard `nb,nn,no,en`). |
| `OVERPASS_GENERATOR` | Tekstsøket: `auto` (standard), `llm`, `byt5` eller `keyword`. |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | OpenAI-kompatibelt chat-API for `llm`. Nøkkelen sendes bare som bearer-token og vises eller logges aldri. |
| `MODEL_DIR` | Mappen med den lokale modellen (standard `/app/models/byt5-base_com08`). |
| `STREETVIEW_DIR` | Mappen med gatebilder (standard `/app/streetview`). Bildene ligger i `panoramas/` under den. |
| `STREETVIEW_INDEX_ON_START` | Bygg `panoramas.json` ved oppstart når den mangler eller er utdatert (standard `true`). |
| `HEALTH_SKIP` | Kommaseparert liste med sjekker `/health` hopper over. |

Uten de fire adressene peker backend på `http://nominatim:8080`, `http://graphhopper:8989` og
`http://overpass:80`. Det er tjenestenavn som bare finnes hvis du kjører slike tjenester i
samme Compose-prosjekt. `compose.yml` i rotmappen krever derfor at adressene står i `.env`.

## Slankt bilde eller bilde med lokal modell

`Dockerfile` har byggeargumentet `WITH_ML`:

- `WITH_ML=false` gir et slankt bilde uten torch og transformers. Tekstsøket bruker da en
  språkmodell (`LLM_*`) eller nøkkelordsøk. De ferdige bildene er bygd slik, og
  `compose.yml` bygger slik som standard (`BACKEND_WITH_ML=false`).
- `WITH_ML=true` tar med torch (CPU-utgaven) og transformers for den lokale ByT5-modellen.
  Bildet blir mye større. Det er standard i `Dockerfile` når du bygger uten argument.

```sh
# fra rotmappen
docker compose build backend                               # slankt
BACKEND_WITH_ML=true docker compose build backend          # med lokal modell
docker build --build-arg WITH_ML=false -t openmaps-backend services/backend
```

Modellen følger ikke med. Se «Lokal modell» i README-en i rotmappen.

## Kjøre lokalt

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt

export GEOCODE_URL=https://nominatim.openstreetmap.org/search
export REVERSE_GEOCODE_URL=https://nominatim.openstreetmap.org/reverse
export GRAPHHOPPER_URL=https://graphhopper.com/api/1/route
export GRAPHHOPPER_API_KEY=nøkkelen-din
export OVERPASS_API=https://overpass-api.de/api/interpreter
export HTTP_USER_AGENT="OpenMaps-utvikling (+mailto:deg@example.org)"
uvicorn main:app --reload --port 8000
```

Den lokale modellen trenger i tillegg pakkene i `requirements-ml.txt`. PyTorch-hjulet der
finnes bare på PyTorchs CPU-indeks (se `Dockerfile`).

## Tester

```sh
ruff check .
python -m pytest
```

Testene er enhetstester og trenger ikke Docker.

## Endepunkter

- `GET /config`: gjeldende innstillinger, aktiv tekstsøk-generator og LLM-status, uten
  nøkler. Brukes også som helsesjekk for containeren.
- `GET /health`: samlet status for karttjenestene.
- `GET /metrics`: driftstall i Prometheus-format.
- `GET /search?q=…&viewbox=vest,sør,øst,nord`: søk. `viewbox` er valgfri; treff i
  kartutsnittet kommer først.
- `GET /reverse?lat=…&lon=…`: adresseoppslag.
- `GET /route?from=…&to=…`: rute. Valgfritt: `waypoint` (flere ganger), `profile` (`car`,
  `foot` eller `bike`), `alternatives` og `avoid_areas`.
- `GET /overpass?nl=…&south=…&west=…&north=…&east=…`: tekstsøk i kartobjekter.
- `GET /streetview/panoramas?west=…&south=…&east=…&north=…`: gatebildene i et område, som
  GeoJSON.
- `GET /streetview/panorama/{id}`: ett gatebilde.
