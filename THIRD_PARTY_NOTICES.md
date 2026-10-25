# Tredjepartslisenser

OpenMaps er lisensiert under MIT (se [LICENSE](LICENSE)). Nettappen og bildene inneholder i
tillegg kode, en skrift og kartdata fra andre, under deres egne lisenser. Her står hva som
følger med, og hvor du finner lisenstekstene.

## Frontend

### Hele listen

`pnpm build` skriver `dist/third-party-notices.txt`: hver npm-pakke som havner i den bygde
nettappen, med versjon, lisens og lisenstekst. Listen lages på nytt ved hver bygging, så den
følger avhengighetene. Frontend-bildet serverer den på `/third-party-notices.txt`, for
eksempel <http://localhost:8080/third-party-notices.txt>.

Noen pakker har ingen lisensfil i npm-pakken. Byggingen henter da lisensteksten fra
`services/frontend/licenses/`:

- `leaflet-draw` (MIT), fra Leaflet.draw-repoet:
  [leaflet-draw-MIT.txt](services/frontend/licenses/leaflet-draw-MIT.txt)
  (`Copyright 2012-2017 Jon West, Jacob Toye, and Leaflet`).
- `@u-elements/u-combobox`, `u-datalist`, `u-details`, `u-progress` og `u-tabs` (MIT), fra
  u-elements-repoet: [u-elements-MIT.txt](services/frontend/licenses/u-elements-MIT.txt)
  (`Copyright (c) 2023 u-elements`).

Pannellum har lisensen sin i filen `COPYING`, og den tas også med.

### Leaflet

Kartbiblioteket [Leaflet](https://leafletjs.com/) og markørikonene fra Leaflet
(`services/frontend/static/images/markers/`) er lisensiert under BSD-2-Clause:

    Copyright (c) 2010-2023, Volodymyr Agafonkin
    Copyright (c) 2010-2011, CloudMade

Hele lisensteksten står i
[services/frontend/licenses/leaflet-BSD-2-Clause.txt](services/frontend/licenses/leaflet-BSD-2-Clause.txt).

### @mattilsynet/design

Designsystemet `@mattilsynet/design` (komponenter og stiler) er lisensiert under MIT:

    Copyright (c) 2024 Mattilsynet

### Skriften Mattilsynet Sans

Designsystemet bygger inn skriften Mattilsynet Sans i CSS-en sin, og derfra følger den med i
nettappens CSS. Skriften har sin egen lisens, SIL Open Font License 1.1 (OFL), ikke
designsystemets MIT-lisens:

    Copyright 2024 Mattilsynet Sans Project Authors (https://github.com/usted/Albert-Sans)

Hele lisensteksten står i
[services/frontend/licenses/font-OFL-1.1.txt](services/frontend/licenses/font-OFL-1.1.txt),
og den tas med i `third-party-notices.txt`.

### React og de andre pakkene

React, React DOM, Pannellum (gatebildevisningen), leaflet-draw og de andre pakkene i
nettappen står med lisenstekst i `third-party-notices.txt`.

## Backend

Backend-bildet inneholder Python-pakkene i `services/backend/requirements.txt` og pakkene de
trekker inn: blant annet FastAPI (MIT), Uvicorn (BSD-3-Clause), HTTPX (BSD-3-Clause),
polyline (MIT), prometheus-fastapi-instrumentator (ISC) og prometheus-client (Apache-2.0).
Bygger du med `BACKEND_WITH_ML=true`, kommer transformers (Apache-2.0) og PyTorch
(BSD-3-Clause) i tillegg. Hver pakke har lisensfilene sine i bildet, i `*.dist-info`-mappene
under `/usr/local/lib/python3.12/site-packages/`.

En lokal modell følger ikke med. Bruker du en, gjelder lisensen til den modellen.

## Grunnbildene

Bildene bygger på de offisielle Docker-bildene `python:3.12-slim` (backend) og
`nginx:1.27-alpine` (frontend, med Node.js fra Alpine). Programvaren i dem har sine egne
lisenser.

## Kartdata

Kartdataene kommer fra [OpenStreetMap](https://www.openstreetmap.org/copyright),
© OpenStreetMap-bidragsytere, og er lisensiert under Open Database License (ODbL) 1.0. Det
gjelder bakgrunnskartet fra `tile.openstreetmap.org` og svarene fra Nominatim, Overpass og
GraphHopper når de bygger på OpenStreetMap. Nettappen viser «© OpenStreetMap-bidragsytere»
i hjørnet av kartet. Legger du til andre bakgrunnskart i `MAP_STYLES`, skriver du
krediteringen leverandøren krever i `attribution`.

## Gatebilder

Det følger ingen gatebilder med. Bilder du legger inn selv, har sine egne lisenser.
Mapillary-bilder er for eksempel lisensiert under CC BY-SA 4.0 og må krediteres.
