"""Geokodning av annonsadresser via Nominatim, med cache i data/geocache.json."""

import time

import requests

from . import api, store

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
_last_request = 0.0


def geocode(street, city, cache):
    """Returnerar (lat, lon) eller (None, None). Max 1 anrop/s enligt Nominatims policy."""
    global _last_request
    if not street:
        return None, None
    query = ", ".join(p for p in [street, city, "Stockholm", "Sweden"] if p)
    if query in cache:
        hit = cache[query]
        return hit.get("lat"), hit.get("lon")

    wait = 1.1 - (time.monotonic() - _last_request)
    if wait > 0:
        time.sleep(wait)
    _last_request = time.monotonic()
    try:
        r = requests.get(
            NOMINATIM_URL,
            params={"q": query, "format": "json", "limit": 1, "countrycodes": "se"},
            headers={"User-Agent": api.USER_AGENT},
            timeout=30,
        )
        r.raise_for_status()
        results = r.json()
    except requests.RequestException:
        return None, None  # cachas inte; försöker igen nästa körning

    lat = lon = None
    if results:
        lat, lon = float(results[0]["lat"]), float(results[0]["lon"])
    cache[query] = {"lat": lat, "lon": lon}
    store.save_geocache(cache)
    return lat, lon
