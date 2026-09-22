# SSSB·KÖDAGAR

Automatiskt insamlad statistik över hur många ködagar som krävs för [SSSB:s](https://sssb.se)
studentbostäder — något SSSB själva inte publicerar.

**Dashboard: https://svadola.github.io/sssb-stats/** — tabell, filter, karta och en planerare:
avgjorda annonser grupperas i segment (område · typ · yta, där lägenheterna är likvärdiga) med
median-ködagar per deadline-månad, och anger du dina egna ködagar visas när de räcker för varje
segment — t.ex. "korridorrum nu, eller Lappis-etta i januari".
Sidan serveras med GitHub Pages direkt från `docs/`-mappen i detta repo och uppdateras
automatiskt vid varje data-commit.

## Hur det funkar

Varje annons på [minasidor.sssb.se](https://minasidor.sssb.se/lediga-bostader/) visar löpande
den ledande sökandens ködagar (`antalIntresse`, t.ex. `"71 (4st)"` = ledaren har 71 ködagar,
4 har anmält intresse). Den som vinner anmäler sig ofta sista minuterna, så värdet **strax före
bokningsdeadline ≈ ködagar som krävdes**.

Två GitHub Actions-workflows samlar data via sajtens öppna widgets-API (ingen HTML-scraping):

- **Poll** (varje timme): upptäcker nya annonser, sparar all annonsinfo + deadline,
  laddar ner planlösning (PDF) och bilder, geokodar adressen (Nominatim, cachad),
  snapshottar ködagar för alla aktiva annonser, sätter slutresultat när deadline passerat
  och regenererar `docs/data.json`.
- **Deadline watch** (startförsök varje timme): letar efter deadlines inom 150 minuter,
  oavsett klockslag och sommar-/vintertid. Samplar listan varannan minut och var 15:e sekund
  sista fem minuterna före varje deadline. Poll och watch delar en kö utan att ersätta
  väntande jobb; varje körning checkar ut senaste datan när den faktiskt startar.
- Saknade planlösningar, helt eller delvis misslyckade bildhämtningar och saknade
  koordinater försöks igen när annonsen återkommer i nästa poll.

Kartan använder Leaflet och OpenStreetMaps standardkartlager direkt, utan CARTO eller
API-nyckel. Kartbilder laddas bara för den synliga kartan och cachas av webbläsaren enligt
[OpenStreetMaps användningspolicy](https://operations.osmfoundation.org/policies/tiles/).

## Datastruktur

| Var | Vad |
|---|---|
| `data/listings/<objektNr>__<publicerad>.json` | All info per annons: typ, yta, hyra, deadline, geokod, slutresultat, bokad-status |
| `data/snapshots/YYYY-MM.csv` | Tidsserie: `ts, listing_key, kodagar, antal_sokande` |
| `data/latest.json` | Senast observerade värde per annons (fryses vid deadline) |
| `docs/data.json` | Aggregat för dashboarden, en rad per annons |
| `docs/media/floorplans/<objektNr>.pdf` | Planlösningar (dedup per lägenhet) |
| `docs/media/images/<sha1>.jpg` | Annonsbilder (dedup på innehåll — bild-id:n roterar per session) |

## Caveats

- Värdet vid deadline är **toppsökandens** ködagar. Tackar denne nej går erbjudandet vidare
  till nästa, så det verkliga kravet kan vara något lägre. Bokad-status efter deadline loggas,
  men vinnarens faktiska poäng exponeras aldrig av SSSB.
- Pågående annonser visar nuvarande ledare — inte ett slutvärde.
- GitHub Actions kan starta flera timmar sent eller missa schemalagda körningar. Fler
  startförsök förbättrar täckningen men ger ingen tidsgaranti; exakt deadlinebevakning
  kräver en mer tillförlitlig schemaläggare. Redan missade slutvärden går inte att återskapa.
  Dashboardens data innehåller mättid och sekunder till deadline; slutvärden äldre än
  fem minuter före deadline markeras med ⚠ i tabellen och har en förklarande tooltip.
- Insamlingen startade 2026-06-10; äldre annonser går inte att rekonstruera
  (annons-id:n är krypterade och Wayback Machine har bara tomma JS-skal).
- Originalannonslänkar (`refid`) kan sluta fungera — därför sparas info, planlösning
  och bilder lokalt i repot.

## Köra lokalt

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m scraper.poll    # en insamlingsrunda
.venv/bin/python -m scraper.watch   # deadline-sampling (no-op om ingen deadline är nära)
cd docs && python3 -m http.server   # dashboard på http://localhost:8000
```

Regressionstester (utan nätanrop eller ändringar i insamlad data):

```bash
.venv/bin/python -m unittest discover -s tests -v
```
