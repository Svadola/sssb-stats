import json
import tempfile
import unittest
from contextlib import ExitStack
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from scraper import geocode, poll, store, watch


class ScraperTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        for name, relative in {
            "LISTINGS_DIR": "listings", "SNAPSHOTS_DIR": "snapshots",
            "LATEST_FILE": "latest.json", "GEOCACHE_FILE": "geocache.json",
            "DOCS_DIR": "docs", "DATA_JSON": "docs/data.json",
        }.items():
            self.stack.enter_context(patch.object(store, name, root / relative))
        self.stack.enter_context(patch.object(poll, "geocode_cache", {}))
        self.at = datetime(2026, 7, 20, 15, 59, tzinfo=store.TZ)
        self.clock = self.stack.enter_context(patch.object(store, "now", return_value=self.at))
        self.obj = {
            "objektNr": "123-456", "publiceratDatum": "2026-07-16",
            "antalIntresse": "71 (4st)", "hyra": "5 000",
            "detaljUrl": "https://example.test/?refid=current",
            "kartURL": "https://maps.google.se/?q=Gatan+1,Stockholm",
            "bilder": [{"url": "https://example.test/image"}],
        }
        self.key = store.listing_key(self.obj)
        self.listing = {
            "key": self.key, **self.obj, "deadline": "2026-07-20T16:00",
            "planlosningUrl": "https://example.test/plan.pdf",
            "planlosningFil": "media/floorplans/123-456.pdf",
            "bildFiler": [{"fil": "media/images/a.jpg", "text": None}],
            "lat": 59.3, "lon": 18.0,
        }
        store.save_listing(self.listing)
        # Inga tester får göra riktiga nätanrop.
        self.stack.enter_context(patch.object(poll.api._session, "get", side_effect=AssertionError("network")))
        self.stack.enter_context(patch.object(geocode.requests, "get", side_effect=AssertionError("network")))

    def test_retry_floorplan_even_with_known_deadline(self):
        self.listing["planlosningFil"] = None
        store.save_listing(self.listing)
        with patch.object(poll.media, "download_floorplan", return_value="recovered.pdf") as download:
            result = poll.ensure_listing(self.obj)
        download.assert_called_once_with("123-456", self.listing["planlosningUrl"])
        self.assertEqual(result["planlosningFil"], "recovered.pdf")

    def test_failed_detail_refresh_preserves_deadline(self):
        self.listing.pop("planlosningUrl")
        store.save_listing(self.listing)
        with patch.object(poll.api, "fetch_detail", return_value={"html": {}}):
            result = poll.ensure_listing(self.obj)
        self.assertEqual(result["deadline"], "2026-07-20T16:00")

    def test_retry_missing_coordinates(self):
        self.listing["lon"] = None
        store.save_listing(self.listing)
        with patch.object(poll.geocode, "geocode", return_value=(59.4, 18.1)) as lookup:
            result = poll.ensure_listing(self.obj)
        lookup.assert_called_once()
        self.assertEqual((result["lat"], result["lon"]), (59.4, 18.1))

    def test_retry_partial_images_keeps_successful_downloads(self):
        self.obj["bilder"].append({"url": "https://example.test/image2"})
        with patch.object(poll.media, "download_images", return_value=[{"fil": "media/images/b.jpg"}]):
            result = poll.ensure_listing(self.obj)
        self.assertEqual([b["fil"] for b in result["bildFiler"]],
                         ["media/images/a.jpg", "media/images/b.jpg"])

    def test_failed_image_retry_keeps_existing_images(self):
        self.obj["bilder"].append({"url": "https://example.test/image2"})
        with patch.object(poll.media, "download_images", return_value=[]):
            result = poll.ensure_listing(self.obj)
        self.assertEqual(result["bildFiler"], self.listing["bildFiler"])

    def test_complete_listing_skips_downloads_but_refreshes_metadata(self):
        self.obj["hyra"] = "5 100"
        with patch.object(poll.media, "download_images") as images, \
                patch.object(poll.media, "download_floorplan") as floorplan, \
                patch.object(poll.api, "fetch_detail") as detail, \
                patch.object(poll.geocode, "geocode") as lookup:
            result = poll.ensure_listing(self.obj)
        for fn in [images, floorplan, detail, lookup]:
            fn.assert_not_called()
        self.assertEqual(result["hyra"], "5 100")

    def test_null_image_list_is_allowed(self):
        self.obj["bilder"] = None
        self.assertEqual(poll.ensure_listing(self.obj)["bildFiler"], self.listing["bildFiler"])

    def test_snapshot_uses_observation_time_even_after_slow_enrichment(self):
        self.clock.return_value = self.at + timedelta(minutes=5)
        latest = {}
        poll.snapshot([self.obj], latest, observed_at=self.at)
        self.assertEqual(latest[self.key]["ts"], self.at.isoformat(timespec="seconds"))
        self.assertEqual(latest[self.key]["kodagar"], 71)

    def test_poll_keeps_fetch_time_when_enrichment_crosses_deadline(self):
        def slow_enrichment(obj):
            self.clock.return_value = self.at + timedelta(minutes=5)

        with patch.object(poll.api, "fetch_listings", return_value=[self.obj]), \
                patch.object(poll, "ensure_listing", side_effect=slow_enrichment), \
                patch.object(poll, "close_finished"), patch("builtins.print"):
            poll.run_poll()
        self.assertEqual(store.load_latest()[self.key]["ts"], self.at.isoformat(timespec="seconds"))

    def test_watch_recovers_from_fetch_failure_and_freezes_at_deadline(self):
        calls = 0

        def fetch():
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("temporary network failure")
            return [{**self.obj, "antalIntresse": f"{calls} (4st)"}]

        def advance(seconds):
            self.clock.return_value += timedelta(seconds=seconds)

        with patch.object(watch.api, "fetch_listings", side_effect=fetch), \
                patch.object(watch.time, "sleep", side_effect=advance), patch("builtins.print"):
            watch.run_watch()
        final = store.load_listing(self.key)["slutresultat"]
        dl = store.parse_deadline_dt(self.listing["deadline"])
        self.assertLessEqual(datetime.fromisoformat(final["ts"]), dl)
        self.assertLess(final["kodagar"], calls)
        self.assertEqual(self.clock.return_value, dl + timedelta(seconds=60))

    def test_after_deadline_does_not_replace_last_predeadline_value(self):
        latest = {self.key: {"kodagar": 50}}
        poll.snapshot([self.obj], latest, observed_at=self.at + timedelta(minutes=2))
        self.assertEqual(latest[self.key], {"kodagar": 50})

    def test_unknown_deadline_can_still_be_sampled(self):
        self.listing.pop("deadline")
        store.save_listing(self.listing)
        latest = {}
        poll.snapshot([self.obj], latest)
        self.assertEqual(latest[self.key]["kodagar"], 71)

    def test_watch_finds_morning_and_afternoon_in_both_seasons(self):
        for month in [1, 7]:
            for hour in [10, 16]:
                with self.subTest(month=month, hour=hour):
                    dl = datetime(2026, month, 20, hour, tzinfo=store.TZ)
                    self.clock.return_value = dl - timedelta(minutes=90)
                    self.listing["deadline"] = dl.strftime("%Y-%m-%dT%H:%M")
                    store.save_listing(self.listing)
                    self.assertEqual(watch.upcoming_deadlines(150), [dl])

    def test_watch_excludes_elapsed_or_far_away_deadlines(self):
        self.clock.return_value = self.at - timedelta(hours=3)
        self.assertEqual(watch.upcoming_deadlines(150), [])
        self.clock.return_value = self.at + timedelta(minutes=2)
        self.assertEqual(watch.upcoming_deadlines(150), [])

    def test_sampling_accelerates_at_each_deadline(self):
        dl = self.at + timedelta(minutes=1)
        for remaining, expected in [(600, 120), (310, 10), (300, 15), (60, 15), (5, 5)]:
            with self.subTest(remaining=remaining):
                self.assertEqual(watch.next_sample_delay([dl], 120, dl - timedelta(seconds=remaining)), expected)
        self.assertEqual(watch.next_sample_delay([dl], 120, dl), 120)
        self.assertEqual(watch.next_sample_delay([dl, dl + timedelta(hours=6)], 120,
                                               dl + timedelta(hours=6) - timedelta(seconds=30)), 15)

    def test_watch_rejects_zero_interval(self):
        with self.assertRaises(ValueError):
            watch.run_watch(interval_s=0)

    def test_export_preserves_final_value_and_reports_measurement_age(self):
        self.clock.return_value = self.at + timedelta(minutes=2)
        self.listing["slutresultat"] = {
            "ts": (self.at - timedelta(minutes=9)).isoformat(),
            "kodagar": 71, "antal_sokande": 4,
        }
        store.save_listing(self.listing)
        store.save_latest({self.key: {"ts": self.at.isoformat(), "kodagar": 999}})
        store.write_data_json()
        result = json.loads(store.DATA_JSON.read_text())["listings"][0]
        self.assertEqual(result["kodagar"], 71)
        self.assertEqual(result["sekunderForeDeadline"], 600)
        self.assertEqual(result["observerat"], self.listing["slutresultat"]["ts"])

    def test_export_without_sample_has_no_measurement_age(self):
        store.write_data_json()
        result = json.loads(store.DATA_JSON.read_text())["listings"][0]
        self.assertIsNone(result["sekunderForeDeadline"])
        self.assertIsNone(result["observerat"])

    def test_negative_geocache_is_retried(self):
        cache = {"Gatan 1, Stockholm, Sweden": {"lat": None, "lon": None}}
        with patch.object(geocode.requests, "get") as get, patch.object(geocode.time, "sleep"):
            get.return_value.json.return_value = [{"lat": "59.3", "lon": "18.0"}]
            self.assertEqual(geocode.geocode("Gatan 1", None, cache), (59.3, 18.0))
        get.assert_called_once()

    def test_successful_geocache_needs_no_request(self):
        cache = {"Gatan 1, Stockholm, Sweden": {"lat": 59.3, "lon": 18.0}}
        self.assertEqual(geocode.geocode("Gatan 1", None, cache), (59.3, 18.0))


if __name__ == "__main__":
    unittest.main()
