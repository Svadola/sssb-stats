"""Timvis insamling: upptäck nya annonser, snapshotta ködagar, stäng passerade deadlines.

Körs som `python -m scraper.poll`.
"""

import sys
from datetime import timedelta

from . import api, geocode, media, store
from .store import load_latest, save_latest

# Hur länge efter deadline vi fortsätter kolla bokad-status.
STATUS_FOLLOWUP_DAYS = 5


def ensure_listing(obj):
    """Skapa listing-JSON för en ny annons (detaljer, media, geokodning)."""
    key = store.listing_key(obj)
    existing = store.load_listing(key)
    if existing is not None and existing.get("deadline"):
        return existing

    listing = existing or {"key": key}
    listing.update(
        {
            "objektNr": obj["objektNr"],
            "adress": obj.get("adress"),
            "omrade": obj.get("omrade"),
            "omradeKod": obj.get("omradeKod"),
            "typ": obj.get("typ"),
            "typOvergripande": obj.get("typOvergripande"),
            "yta": obj.get("yta"),
            "vaning": obj.get("vaning"),
            "hyra": obj.get("hyra"),
            "hiss": obj.get("hiss"),
            "inflyttningDatum": obj.get("inflyttningDatum"),
            "publiceratDatum": obj.get("publiceratDatum"),
            "detaljUrl": obj.get("detaljUrl"),
            "kartURL": obj.get("kartURL"),
        }
    )

    refid = api.parse_refid(obj.get("detaljUrl"))
    if refid:
        try:
            detail = api.fetch_detail(refid)
        except Exception as e:
            print(f"  varning: detaljhämtning misslyckades för {key}: {e}", file=sys.stderr)
            detail = None
        if detail:
            html = detail.get("html", {})
            listing["deadline"] = api.parse_deadline(html.get("objektintresse"))
            listing["publiceringstexter"] = html.get("objektpubliceringstexter")
            floorplan_url = api.parse_floorplan_url(html.get("objektdokument"))
            if floorplan_url:
                listing["planlosningUrl"] = floorplan_url
                listing["planlosningFil"] = media.download_floorplan(
                    obj["objektNr"], floorplan_url
                )

    if not listing.get("bildFiler"):
        listing["bildFiler"] = media.download_images(obj.get("bilder"))

    if listing.get("lat") is None:
        street, city = api.parse_karturl_address(obj.get("kartURL"))
        lat, lon = geocode.geocode(street, city, geocode_cache)
        listing["lat"], listing["lon"] = lat, lon

    store.save_listing(listing)
    return listing


def snapshot(raw_listings, latest):
    """Appenda snapshot-rader och uppdatera latest.json. Delas med watch.py."""
    ts = store.now().isoformat(timespec="seconds")
    rows = []
    for obj in raw_listings:
        kodagar, antal = api.parse_antal_intresse(obj.get("antalIntresse"))
        if kodagar is None:
            continue
        key = store.listing_key(obj)
        rows.append(
            {"ts": ts, "listing_key": key, "kodagar": kodagar, "antal_sokande": antal}
        )
        listing = store.load_listing(key)
        deadline = store.parse_deadline_dt(listing.get("deadline")) if listing else None
        # Frys latest vid deadline: värdet strax före är det som gällde.
        if deadline is None or store.now() <= deadline:
            latest[key] = {"ts": ts, "kodagar": kodagar, "antal_sokande": antal}
    store.append_snapshots(rows)
    return rows


def mark_seen(raw_listings):
    ts = store.now().isoformat(timespec="seconds")
    for obj in raw_listings:
        listing = store.load_listing(store.listing_key(obj))
        if listing is not None:
            listing["sistSedd"] = ts
            store.save_listing(listing)


def close_finished(latest):
    """Sätt slutresultat för annonser vars deadline passerat, följ upp bokad-status."""
    for listing in store.all_listings():
        if not store.is_closed(listing):
            continue
        changed = False
        if "slutresultat" not in listing:
            listing["slutresultat"] = latest.get(listing["key"])
            changed = True

        deadline = store.parse_deadline_dt(listing.get("deadline"))
        needs_status = listing.get("bokadStatus") in (None, "Detta objekt har ännu inte bokats.")
        within_followup = deadline and store.now() - deadline < timedelta(days=STATUS_FOLLOWUP_DAYS)
        if needs_status and within_followup:
            refid = api.parse_refid(listing.get("detaljUrl"))
            if refid:
                try:
                    detail = api.fetch_widgets(["objektintressestatus"], refid=refid)
                    status = api.parse_status(detail["html"].get("objektintressestatus"))
                    if status and status != listing.get("bokadStatus"):
                        listing["bokadStatus"] = status
                        changed = True
                except Exception:
                    pass
        if changed:
            store.save_listing(listing)


geocode_cache = store.load_geocache()


def run_poll():
    raw = api.fetch_listings()
    print(f"{len(raw)} aktiva annonser i listan")

    new_count = 0
    for obj in raw:
        if store.load_listing(store.listing_key(obj)) is None:
            new_count += 1
        ensure_listing(obj)
    print(f"{new_count} nya annonser")

    latest = load_latest()
    rows = snapshot(raw, latest)
    save_latest(latest)
    mark_seen(raw)
    print(f"{len(rows)} snapshots sparade")

    close_finished(latest)
    n = store.write_data_json()
    print(f"docs/data.json regenererad ({n} listings)")


if __name__ == "__main__":
    run_poll()
