"""Klient mot SSSB:s (Fast2) widgets-API på minasidor.sssb.se."""

import json
import re
import time
import urllib.parse

import requests

BASE = "https://minasidor.sssb.se"
WIDGETS_URL = BASE + "/widgets/"
USER_AGENT = "sssb-stats scraper (personligt statistikprojekt; kontakt: maxmazzolasvadling@gmail.com)"

LIST_WIDGET = "objektlistabilder@lagenheter"
DETAIL_WIDGETS = [
    "objektinformation@lagenheter",
    "objektintresse",
    "objektintressestatus",
    "objektdokument",
    "objektpubliceringstexter",
]

_session = requests.Session()
_session.headers["User-Agent"] = USER_AGENT


def _get_jsonp(params, retries=3):
    for attempt in range(retries):
        try:
            r = _session.get(WIDGETS_URL, params=params, timeout=30)
            r.raise_for_status()
            text = r.text
            return json.loads(text[text.index("(") + 1 : text.rindex(")")])
        except (requests.RequestException, ValueError):
            if attempt == retries - 1:
                raise
            time.sleep(5 * (attempt + 1))


def fetch_widgets(widgets, refid=None):
    params = [("callback", "cb")]
    if refid:
        params.append(("refid", refid))
    params += [("widgets[]", w) for w in widgets]
    return _get_jsonp(params)


def fetch_listings():
    """Alla aktiva annonser som en lista av dictar (rå API-form)."""
    data = fetch_widgets([LIST_WIDGET])
    return data["data"][LIST_WIDGET]


def fetch_detail(refid):
    """Detaljwidgets för en annons. Returnerar {'data': ..., 'html': ...}."""
    return fetch_widgets(DETAIL_WIDGETS, refid=refid)


def parse_antal_intresse(value):
    """'71 (4st)' -> (71, 4). Returnerar (None, None) om formatet inte känns igen."""
    m = re.match(r"\s*(\d+)\s*\((\d+)\s*st\)", value or "")
    if not m:
        return None, None
    return int(m.group(1)), int(m.group(2))


def parse_deadline(intresse_html):
    """'Kan bokas till 2026-06-11 klockan 10:00' -> '2026-06-11T10:00'."""
    m = re.search(
        r"[Kk]an bokas till (\d{4}-\d{2}-\d{2})\s+klockan\s+(\d{1,2}:\d{2})",
        intresse_html or "",
    )
    if not m:
        return None
    hhmm = m.group(2).zfill(5)
    return f"{m.group(1)}T{hhmm}"


def parse_floorplan_url(dokument_html):
    m = re.search(r'href="(https://sssb\.bim\.cloud/[^"]+)"', dokument_html or "")
    if not m:
        return None
    # HTML-attributet innehåller &amp;
    return m.group(1).replace("&amp;", "&")


def parse_status(status_html):
    """Ren text ur objektintressestatus-widgeten."""
    return re.sub(r"<[^>]+>", "", status_html or "").strip()


def parse_refid(detalj_url):
    q = urllib.parse.urlparse(detalj_url or "").query
    return urllib.parse.parse_qs(q).get("refid", [None])[0]


def parse_karturl_address(kart_url):
    """'https://maps.google.se/?q=Simrishamnsv%C3%A4gen+15+%2F+1003%2CJohanneshov'
    -> ('Simrishamnsvägen 15', 'Johanneshov')."""
    q = urllib.parse.urlparse(kart_url or "").query
    addr = urllib.parse.parse_qs(q).get("q", [None])[0]
    if not addr:
        return None, None
    parts = addr.split(",")
    street = parts[0].split("/")[0].strip()
    city = parts[1].strip() if len(parts) > 1 else None
    return street, city


def download(url, retries=3):
    """Ladda ner binärt innehåll (bilder, PDF)."""
    for attempt in range(retries):
        try:
            r = _session.get(url, timeout=60)
            r.raise_for_status()
            return r.content
        except requests.RequestException:
            if attempt == retries - 1:
                raise
            time.sleep(5 * (attempt + 1))
