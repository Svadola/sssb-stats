# SSSB·KÖDAGAR

Automatiskt insamlad statistik över hur många ködagar som krävs för [SSSB:s](https://sssb.se)
studentbostäder — något SSSB själva inte publicerar.

**Bostadsutforskaren: https://svadola.github.io/sssb-stats/**

Planera nästa flytt med bostadskort, geografiska områden, karta med radie, favoriter och
jämförelse av upp till tre bostadstyper. Ange dina ködagar och välj en sökmånad för att se
vilka typer som når historisk median, vad ytterligare väntan öppnar och ungefärlig inflyttning.
Detaljvyn visar månadsstaplar, historiskt mittspann, mätkvalitet och sparade planlösningar.
Separata flikar visar öppna annonser samt statistik, metod och annonsarkiv.

Sidan serveras med GitHub Pages direkt från `docs/` och uppdateras vid varje data-commit.
Frontend är vanlig HTML, CSS och JavaScript-moduler, utan byggsteg eller API-nycklar.

## Planeringsmodell

- **Bostadstyper:** område, rumstyp och exakt yta grupperas automatiskt. Hyra och våning
  ingår inte i typens identitet. Kända tidsbegränsade avtal separeras. Manuella regler i
  `data/archetypes.json` kan namnge typer, samla närliggande ytor eller avgränsa byggnader.
  Katalogen beskriver observerade annonser, inte hela beståndet eller identiska planlösningar.
- **Geografi:** `data/areas.json` kopplar SSSB:s namn till stadsdel, kommun och sökalias.
  Kartans koordinater är ungefärliga; radiefiltret räknar fågelvägen.
- **Säsong:** senaste observerade motsvarande kalendermånad återanvänds nästa år. Detta är
  modellens uttryckliga antagande. Saknas månaden används all tidigare historik för typen,
  markerad som uppskattning utan säsongsunderlag. Ingen trend extrapoleras.
- **Nivå:** medianen används som jämförelsenivå; 25:e–75:e percentilen visar mittspannet.
  En annons är en observation, även vid återannonsering. Antalet kända bostäder dedupliceras
  på objektnummer. Noll sökande och tidiga mätningar behålls och redovisas.
- **Tid:** en extra ködag per kalenderdag. Framtida sökmånader räknas på den 15:e.
  Inflyttning uppskattas från medianen av annonsernas tid mellan deadline och inflyttning.
  Saknad inflyttningshistorik kan inte uppfylla filtret ”flytta senast”.
- **Personlig plan:** tidslinjen visar hur många typer som når median varje månad och vilka
  som gör det för första gången inom planen. Detta förutsäger konkurrens, inte att en bostad
  faktiskt annonseras. Favoriter prioriteras; jämförelsen visar tidigaste möjliga sökmånad.
- Ködagar, filter och favoriter sparas lokalt i webbläsaren. En delad länk innehåller valda
  filter, ködagar och deras referensdatum; favoriter delas inte.

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
| `data/areas.json` | Geografiska namn, alias och källor per SSSB-område |
| `data/archetypes.json` | Manuella regler för bostadstyper |
| `docs/data.json` | Export med katalogfält och mätkvalitet, en rad per annons |
| `docs/planner.mjs` | Ren katalog-, filter- och prognoslogik |
| `docs/explorer.mjs`, `docs/explorer.css` | Gränssnitt och presentation |
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
  Exporten innehåller mättid och sekunder till deadline. Detaljvyn visar hur många
  observationer som gjordes högst fem minuter före deadline; arkivet visar varje mätålder.
- Insamlingen startade 2026-06-10; äldre annonser går inte att rekonstruera
  (annons-id:n är krypterade och Wayback Machine har bara tomma JS-skal).
- Originalannonslänkar (`refid`) kan sluta fungera — därför sparas info, planlösning
  och bilder lokalt i repot.

## Köra lokalt

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m scraper.poll    # en insamlingsrunda
.venv/bin/python -m scraper.watch   # deadline-sampling (no-op om ingen deadline är nära)
.venv/bin/python -c 'from scraper.store import write_data_json; write_data_json()' # export utan nätanrop
python3 -m http.server --directory docs 8000 # http://localhost:8000
```

Regressionstester (utan nätanrop eller ändringar i insamlad data):

```bash
.venv/bin/python -m unittest discover -s tests -v
node --test tests/planner.test.mjs
node --check docs/explorer.mjs
```

Frontendtesterna kräver Node.js med inbyggd test-runner (Node 18+). Ingen npm-installation behövs.
Vid ändring av katalogregler eller geografiska namn: regenerera `docs/data.json` och kör testerna.
Exportens `senastInsamlad` kommer från rådatans senaste observation, medan `genererad` anger
exporttidpunkten. En ombyggnad av sidan ska inte få gammal insamling att se ny ut.
