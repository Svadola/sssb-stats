"""Läs/skriv datafiler: listing-JSON, snapshot-CSV, geocache och docs/data.json."""

import csv
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Stockholm")

ROOT = Path(__file__).resolve().parent.parent
LISTINGS_DIR = ROOT / "data" / "listings"
SNAPSHOTS_DIR = ROOT / "data" / "snapshots"
GEOCACHE_FILE = ROOT / "data" / "geocache.json"
DOCS_DIR = ROOT / "docs"
FLOORPLANS_DIR = DOCS_DIR / "media" / "floorplans"
IMAGES_DIR = DOCS_DIR / "media" / "images"
DATA_JSON = DOCS_DIR / "data.json"

LATEST_FILE = ROOT / "data" / "latest.json"

SNAPSHOT_FIELDS = ["ts", "listing_key", "kodagar", "antal_sokande"]


def now():
    return datetime.now(TZ)


def listing_key(obj):
    """Stabil nyckel per publicering: objektNr + publiceringsdatum."""
    objektnr = re.sub(r"[^0-9A-Za-z-]", "_", obj["objektNr"])
    return f"{objektnr}__{obj['publiceratDatum']}"


def listing_path(key):
    return LISTINGS_DIR / f"{key}.json"


def load_listing(key):
    path = listing_path(key)
    if not path.exists():
        return None
    return json.loads(path.read_text())


def save_listing(listing):
    LISTINGS_DIR.mkdir(parents=True, exist_ok=True)
    path = listing_path(listing["key"])
    path.write_text(json.dumps(listing, ensure_ascii=False, indent=1, sort_keys=True))


def all_listings():
    if not LISTINGS_DIR.exists():
        return []
    return [json.loads(p.read_text()) for p in sorted(LISTINGS_DIR.glob("*.json"))]


def append_snapshots(rows):
    """rows: lista av dictar med SNAPSHOT_FIELDS. Appendas till månadens CSV."""
    if not rows:
        return
    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    path = SNAPSHOTS_DIR / (now().strftime("%Y-%m") + ".csv")
    new_file = not path.exists()
    with path.open("a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=SNAPSHOT_FIELDS)
        if new_file:
            writer.writeheader()
        writer.writerows(rows)


def load_latest():
    """Senast observerade (ködagar, antal sökande) per listing-nyckel, fryst vid deadline."""
    if LATEST_FILE.exists():
        return json.loads(LATEST_FILE.read_text())
    return {}


def save_latest(latest):
    LATEST_FILE.parent.mkdir(parents=True, exist_ok=True)
    LATEST_FILE.write_text(json.dumps(latest, ensure_ascii=False, indent=1, sort_keys=True))


def load_geocache():
    if GEOCACHE_FILE.exists():
        return json.loads(GEOCACHE_FILE.read_text())
    return {}


def save_geocache(cache):
    GEOCACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    GEOCACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True))


def parse_deadline_dt(deadline_str):
    """'2026-06-11T10:00' -> tz-medveten datetime, eller None."""
    if not deadline_str:
        return None
    return datetime.fromisoformat(deadline_str).replace(tzinfo=TZ)


def is_closed(listing, at=None):
    deadline = parse_deadline_dt(listing.get("deadline"))
    if deadline is None:
        # Utan känd deadline: betrakta som stängd när den försvunnit ur listan
        # i mer än ett dygn (sätts av poll via "sistSedd").
        last_seen = listing.get("sistSedd")
        if not last_seen:
            return False
        return (at or now()) - datetime.fromisoformat(last_seen) > timedelta(days=1)
    return (at or now()) > deadline


def write_data_json():
    """Generera docs/data.json för dashboarden ur alla listing-filer."""
    out = []
    latest_by_key = load_latest()
    for l in all_listings():
        closed = is_closed(l)
        final = l.get("slutresultat") or {}
        sample = final if closed and final else (latest_by_key.get(l["key"]) or {})
        out.append(
            {
                "key": l["key"],
                "objektNr": l["objektNr"],
                "adress": l.get("adress"),
                "omrade": l.get("omrade"),
                "typ": l.get("typ"),
                "typOvergripande": l.get("typOvergripande"),
                "yta": l.get("yta"),
                "vaning": l.get("vaning"),
                "hyra": l.get("hyra"),
                "hiss": l.get("hiss"),
                "inflyttningDatum": l.get("inflyttningDatum"),
                "publiceratDatum": l.get("publiceratDatum"),
                "deadline": l.get("deadline"),
                "status": "stangd" if closed else "aktiv",
                "bokadStatus": l.get("bokadStatus"),
                "kodagar": sample.get("kodagar"),
                "antalSokande": sample.get("antal_sokande"),
                "detaljUrl": l.get("detaljUrl"),
                "planlosning": l.get("planlosningFil"),
                "bilder": l.get("bildFiler", []),
                "lat": l.get("lat"),
                "lon": l.get("lon"),
            }
        )
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    DATA_JSON.write_text(
        json.dumps(
            {"genererad": now().isoformat(timespec="seconds"), "listings": out},
            ensure_ascii=False,
        )
    )
    return len(out)
