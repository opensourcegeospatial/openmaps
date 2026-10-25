# Frontend

Nettappen i OpenMaps: React, Vite og Tailwind CSS, med kartet i Leaflet og komponenter fra
`@mattilsynet/design`. I bildet serverer nginx den bygde appen og sender `/api/*` videre til
backend. Grensesnittet er bare på norsk.

## Lokal utvikling

Node 22 og pnpm (versjonen står i `package.json`; `corepack enable` gir deg den).

```sh
corepack enable
pnpm install             # første gang, og når pnpm-lock.yaml endres
pnpm dev                 # Vite på http://localhost:5173, sender /api/* til localhost:8000
pnpm build               # typesjekk og bygging til dist/
pnpm lint                # ESLint
pnpm exec tsc --noEmit   # typesjekk
pnpm exec vitest run     # enhetstester
pnpm exec playwright install chromium   # første gang
CI=1 pnpm test:e2e       # nettlesertester med Playwright
```

`pnpm dev` trenger en backend på port 8000, for eksempel `docker compose up -d backend` fra
rotmappen. Under utvikling leser appen innstillingene fra `static/config.json`.

Nettlesertestene er selvstendige: alt nett er mocket (`e2e/fixtures/`), så de trenger
verken backend eller internett. De starter sin egen Vite-server på port 5180. `CI=1` hindrer
at Playwright bruker en server som allerede kjører der.

`pnpm build` skriver også `dist/third-party-notices.txt`, med lisensen til hver pakke som
følger med i appen, og lisensen til skriften (`licenses/`). Bildet serverer filen på
`/third-party-notices.txt`.

## Innstillinger når containeren starter

Appen stilles inn når containeren starter, ikke når den bygges. `docker-entrypoint.sh`
kjører `scripts/generate-config.cjs`, som gjør miljøvariablene `MAP_*`, `API_*`,
`STREETVIEW_*`, `THEME_*` og `HEALTH_DASHBOARD_ENABLED` om til `config.json`. Appen henter
den filen når den lastes. En endret verdi trenger derfor bare
`docker compose up -d frontend`, ikke et nytt bilde. Alle variablene er forklart i
`.env.example` og under «Konfigurasjon» i README-en i rotmappen.

## Lister i nettleseren

«Nylige søk» (de siste 8 valgte treffene) og «Mine steder» (opptil 50 stjernemerkede
steder) lagres i nettleserens `localStorage` (`openmaps.recentSearches` og
`openmaps.savedPlaces`). De gjelder én nettleser og én brukerprofil, sendes aldri til
backend og forsvinner når nettstedsdataene slettes. Stedssøket sender med kartutsnittet
(`viewbox`), så treff i nærheten kommer først.

## Oppbygging

- `src/components/`: React-komponentene (`Map`, `SideBar`, `SearchField`,
  `NavigationPanel`, `LayerManager` og flere).
- `src/lib/`: hjelpefunksjoner uten React, med enhetstester (`theme`, `mapColors`,
  `nominatim`, `overpass`, `graphhopper` og flere).
- `src/config/`: lasting og kontroll av `config.json`.
- `scripts/generate-config.cjs`: lager `config.json` fra miljøvariablene.
- `nginx/default.conf`: nginx-oppsettet i bildet.
- `e2e/`: Playwright-testene.
- `licenses/`: lisenstekster for skriften, markørikonene fra Leaflet og pakkene som ikke har
  egen lisensfil. Etter `pnpm build` står alle også i `third-party-notices.txt`.
