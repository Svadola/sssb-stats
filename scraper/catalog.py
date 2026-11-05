"""Normalisera bostäder till en katalog utan att ändra rå insamlingsdata.

Regler i data/archetypes.json kan avgränsas med area, type, sizes och addresses.
En regel kan samla flera ytor eller dela en typ mellan olika byggnader. Nya
kombinationer får en deterministisk ID. Hyra och våning ingår inte i identiteten.
"""

import hashlib
import html
import json
import re
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def load_config():
    areas = json.loads((DATA_DIR / "areas.json").read_text())
    rules = json.loads((DATA_DIR / "archetypes.json").read_text())["rules"]
    return areas, rules


def plain_text(value):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", " ", value or ""))).strip()


def floor(value):
    s = str(value if value is not None else "").strip().lower()
    if s == "0":
        return 0, "ground"
    if "botten" in s:
        return 0, "ground"
    if "sut" in s:
        return -1, "basement"
    try:
        return int(s), "number"
    except ValueError:
        return None, "unknown"


def title(typ):
    names = {
        "Rum i korridor": "Korridorsrum", "Rum i kollektiv": "Rum i kollektiv",
        "1 rum i dubblettlägenhet": "Rum i dubblett",
        "1 rum & kök": "Etta med eget kök", "1 rum & pentry": "Etta med pentry",
    }
    return names.get(typ, typ or "Bostad")


def enrich(listing, areas, rules):
    area = listing.get("omrade") or "Okänt område"
    typ = listing.get("typ") or "Bostad"
    street = (listing.get("adress") or "").split("/")[0].strip()
    text = plain_text(listing.get("publiceringstexter"))
    special = bool(re.search(r"besittningsskydd|korttids|korttid|bo max|begränsad boendetid", text, re.I))
    contract = "limited" if special else "not_stated"
    rule = next((r for r in rules if
                 r["area"] == area and r.get("type", typ) == typ
                 and (not r.get("sizes") or listing.get("yta") in r["sizes"])
                 and (not r.get("addresses") or street in r["addresses"])), None)
    identity = json.dumps([area, typ, listing.get("yta")], ensure_ascii=False)
    type_id = rule["id"] if rule else hashlib.sha256(identity.encode()).hexdigest()[:12]
    building_id = hashlib.sha256(f"{area}|{street}".encode()).hexdigest()[:12]
    number, kind = floor(listing.get("vaning"))
    digits = re.sub(r"\D", "", str(listing.get("hyra") or ""))
    geo = areas.get(area, {})
    terms = ""
    if special:
        terms = next((s.strip() for s in re.split(r"(?<=[.!?])\s+", text)
                      if re.search(r"bo max|besittningsskydd|korttid|begränsad boendetid", s, re.I)), "Särskilda avtalsvillkor")
    return {
        "archetypeId": f"{type_id}-{contract}",
        "archetypeName": rule.get("name", title(typ)) if rule else title(typ),
        "variant": rule.get("variant") if rule else None,
        "curated": rule is not None,
        "buildingId": building_id,
        "street": street,
        "district": geo.get("district", area),
        "municipality": geo.get("municipality", ""),
        "areaAliases": geo.get("aliases", []),
        "areaSource": geo.get("source"),
        "floorNum": number,
        "floorKind": kind,
        "rentNum": int(digits) if digits else None,
        "contractType": contract,
        "contractNote": terms[:500],
        "electricityMetered": bool(re.search(r"individuell mätning.*el|eget elabonnemang", text, re.I)),
    }
