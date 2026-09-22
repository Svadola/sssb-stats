"""Deadline-sampling: sampla listan tätt fram till dagens sista bokningsdeadline.

Det sista värdet före deadline ≈ ködagar som krävdes (sökande anmäler sig ofta
sista minuterna). Körs som `python -m scraper.watch` strax före deadline-tid;
avslutar direkt om ingen deadline finns inom fönstret.
"""

import argparse
import sys
import time
from datetime import timedelta

from . import api, store
from .poll import close_finished, load_latest, save_latest, snapshot

LOOKAHEAD_MINUTES = 150  # hur långt fram vi letar deadlines innan no-op
SAMPLE_INTERVAL_S = 120
FINAL_WINDOW_S = 300
FINAL_INTERVAL_S = 15
EXTRA_AFTER_DEADLINE_S = 60  # sampla en stund förbi deadline för säkerhets skull
MAX_RUNTIME_MINUTES = 200  # hård gräns så Actions-jobbet aldrig fastnar


def upcoming_deadlines(lookahead_minutes):
    now = store.now()
    horizon = now + timedelta(minutes=lookahead_minutes)
    deadlines = []
    for listing in store.all_listings():
        dl = store.parse_deadline_dt(listing.get("deadline"))
        if dl and now < dl <= horizon and "slutresultat" not in listing:
            deadlines.append(dl)
    return sorted(deadlines)


def next_sample_delay(deadlines, interval_s, at):
    """Sampla var 15:e sekund sista fem minuterna före varje deadline."""
    upcoming = [dl for dl in deadlines if dl > at]
    if not upcoming:
        return interval_s
    until_deadline = (min(upcoming) - at).total_seconds()
    if until_deadline <= FINAL_WINDOW_S:
        return min(interval_s, FINAL_INTERVAL_S, until_deadline)
    return min(interval_s, until_deadline - FINAL_WINDOW_S)


def run_watch(lookahead_minutes=LOOKAHEAD_MINUTES, interval_s=SAMPLE_INTERVAL_S):
    if lookahead_minutes <= 0 or interval_s <= 0:
        raise ValueError("lookahead och interval måste vara större än noll")
    deadlines = upcoming_deadlines(lookahead_minutes)
    if not deadlines:
        print(f"Inga deadlines inom {lookahead_minutes} min — avslutar.")
        return

    end = deadlines[-1] + timedelta(seconds=EXTRA_AFTER_DEADLINE_S)
    hard_stop = store.now() + timedelta(minutes=MAX_RUNTIME_MINUTES)
    end = min(end, hard_stop)
    print(f"{len(deadlines)} deadlines, sista {deadlines[-1]:%Y-%m-%d %H:%M}. "
          f"Samplar var {interval_s}s (var {min(interval_s, FINAL_INTERVAL_S)}s "
          f"sista fem minuterna) till {end:%H:%M:%S}.")

    latest = load_latest()
    while True:
        try:
            raw = api.fetch_listings()
            rows = snapshot(raw, latest)
            save_latest(latest)
            print(f"{store.now():%H:%M:%S} {len(rows)} snapshots")
        except Exception as e:
            print(f"varning: sampling misslyckades: {e}", file=sys.stderr)
        at = store.now()
        remaining = (end - at).total_seconds()
        if remaining <= 0:
            break
        time.sleep(min(next_sample_delay(deadlines, interval_s, at), remaining))

    close_finished(latest)
    n = store.write_data_json()
    print(f"Klart. docs/data.json regenererad ({n} listings).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lookahead", type=int, default=LOOKAHEAD_MINUTES,
                        help="minuter framåt att leta deadlines")
    parser.add_argument("--interval", type=int, default=SAMPLE_INTERVAL_S,
                        help="sekunder mellan samplingar")
    args = parser.parse_args()
    run_watch(args.lookahead, args.interval)
