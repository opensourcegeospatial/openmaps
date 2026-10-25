# Bidra til OpenMaps

Takk for at du vil bidra. Prosjektet leveres som det er og har begrenset støtte, så det
hjelper om bidraget er lett å vurdere.

- **Større endringer:** opprett et issue først og beskriv hva du vil gjøre. Da finner vi ut
  om det passer før du bruker tid på det. Små rettelser kan gå rett til en pull request.
- **CI må være grønn.** Hver pull request kjører de samme sjekkene som under. Rødt kryss
  betyr at den ikke blir slått sammen.
- **Grensesnittet er på norsk** (bokmål). Det gjelder alle tekster brukeren ser, også
  feilmeldinger fra backend. Kodekommentarer skrives på engelsk.
- **Dokumentasjonen følger koden.** Endrer du hvordan noe virker eller stilles inn, oppdater
  `README.md` og `.env.example`.

## Kjør testene

Frontend (Node 22 og pnpm):

```sh
cd services/frontend
corepack enable
pnpm install
pnpm lint
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm build
pnpm exec playwright install chromium    # første gang
CI=1 pnpm test:e2e
```

Backend (Python 3.12):

```sh
cd services/backend
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
ruff check .
python -m pytest
```

Se også «Utvikling» i [README.md](README.md).

Sikkerhetsfeil skal ikke meldes som issue. Se [SECURITY.md](SECURITY.md).
