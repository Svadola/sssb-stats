"""Nedladdning av planlösningar och bilder med deduplicering."""

import hashlib
import re

from . import api, store

IMAGE_DIMS = "width=1200&height=900"


def download_floorplan(objektnr, url):
    """Spara planlösnings-PDF per objektNr (samma lägenhet återpubliceras med samma plan).
    Returnerar relativ sökväg under docs/ eller None."""
    safe = re.sub(r"[^0-9A-Za-z-]", "_", objektnr)
    path = store.FLOORPLANS_DIR / f"{safe}.pdf"
    rel = f"media/floorplans/{safe}.pdf"
    if path.exists():
        return rel
    try:
        content = api.download(url)
    except Exception:
        return None
    if not content or not content.startswith(b"%PDF"):
        return None
    store.FLOORPLANS_DIR.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return rel


def download_images(bilder):
    """bilder: [{'url': '//minasidor.sssb.se/bilder/?fid=..', 'text': ...}, ...].
    fid roterar per session, så dedup sker på SHA-1 av innehållet (fast dimension).
    Returnerar [{'fil': 'media/images/<sha>.jpg', 'text': ...}, ...]."""
    result = []
    for bild in bilder or []:
        url = bild.get("url")
        if not url:
            continue
        if url.startswith("//"):
            url = "https:" + url
        url += ("&" if "?" in url else "?") + IMAGE_DIMS
        try:
            content = api.download(url)
        except Exception:
            continue
        if not content or len(content) < 100:
            continue
        sha = hashlib.sha1(content).hexdigest()
        path = store.IMAGES_DIR / f"{sha}.jpg"
        if not path.exists():
            store.IMAGES_DIR.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        result.append({"fil": f"media/images/{sha}.jpg", "text": bild.get("text")})
    return result
