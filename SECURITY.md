# Sikkerhet

## Melde en sårbarhet

Meld sårbarheter privat, med GitHubs funksjon for private sårbarhetsmeldinger
(*Private vulnerability reporting*): gå til fanen **Security** i dette repoet og velg
**Report a vulnerability**. Ikke opprett et vanlig issue, for det kan alle lese.

Beskriv hva som er galt, hvordan det kan gjenskapes, og hvilken versjon det gjelder.
Prosjektet har begrenset støtte, så svaret kan ta litt tid, men alle meldinger blir lest.

## Hva som ikke regnes som en sårbarhet

OpenMaps har ingen innlogging, tillater forespørsler fra alle nettsteder (CORS `*`),
publiserer backend-porten og viser driftstall på `/metrics`. Det er med vilje: løsningen er
laget for å kjøre på et nett du stoler på, eller bak en egen omvendt proxy med innlogging.
Se «Kjør trygt» i [README.md](README.md).

Meldinger om installasjoner som er gjort tilgjengelige fra internett uten en slik omvendt
proxy, faller derfor utenfor. Det gjelder også at andre kan bruke kvoten på
`GRAPHHOPPER_API_KEY` eller `LLM_API_KEY` i en slik installasjon.
