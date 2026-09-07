"""Audio cache and real loopback HTTP checks; no remote calls or real class DB."""
from concurrent.futures import ThreadPoolExecutor
import copy
import hashlib
from http.client import HTTPConnection
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

from assets import ASSET_ROOT
from audio import AudioLibrary, is_mp3, lesson_texts, validate_audio_library
from content import UserError
from server import make_server
from storage import Store


class AudioCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.assets = self.root / "assets"
        # Use an actual bundled recording as upstream fixture, never synthesize
        # new speech during a test or write into the shipped audio collection.
        self.mp3 = next((ASSET_ROOT / "audio/v1").glob("*.mp3")).read_bytes()
        self.upstream = Mock(return_value=self.mp3)
        self.library = AudioLibrary(self.assets, environ={}, synthesize=self.upstream)
        self.library.runner = Path(sys.executable)

    def test_cache_reuse_after_restart_without_network_or_worker(self):
        first = self.library.prepare("The lizard is on the farm.")
        self.assertFalse(first["cached"])
        offline = AudioLibrary(self.assets, environ={"WORD_GARDEN_TTS_OFFLINE": "1"}, synthesize=Mock(side_effect=AssertionError("network")))
        second = offline.prepare("  The lizard  is on the farm.\n")
        self.assertTrue(second["cached"])
        self.assertEqual(first["url"], second["url"])
        self.upstream.assert_called_once()
        with self.assertRaises(UserError) as error:
            offline.prepare("An uncached sentence.")
        self.assertEqual(error.exception.status, 503)
        self.assertEqual(validate_audio_library(self.assets), {"audio_clips": 1})

    def test_identity_covers_text_voice_rate_and_format(self):
        original, _ = self.library.identity("farm")
        self.assertNotEqual(original, self.library.identity("Farm")[0])
        for field, value in (("voice", "another-voice"), ("rate", "-20%"), ("format", "wav")):
            old = self.library.profile[field]
            self.library.profile[field] = value
            self.assertNotEqual(original, self.library.identity("farm")[0])
            self.library.profile[field] = old
        self.assertEqual(original, self.library.identity(" farm\n")[0])

    def test_concurrent_requests_only_download_once(self):
        barrier = threading.Barrier(6)
        def request(_):
            barrier.wait(timeout=3)
            return self.library.prepare("farm")
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(request, range(6)))
        self.upstream.assert_called_once()
        self.assertEqual(sum(not r["cached"] for r in results), 1)
        self.assertEqual(len({r["url"] for r in results}), 1)

    def test_bad_text_and_non_audio_never_publish(self):
        for text in (None, 123, "", "\n", "仅中文", "hello\x00world", "a" * 2001):
            with self.assertRaises(UserError):
                self.library.prepare(text)
        self.upstream.assert_not_called()
        for body in (b'{"error":"rate limited"}', b"<html>unavailable</html>" * 30, b"ID3" + b"\0" * 200):
            self.upstream.return_value = body
            with self.assertRaises(UserError):
                self.library.prepare("farm")
        self.assertFalse(list(self.assets.rglob("*.json")))

    def test_failed_worker_and_failed_save_allow_retry_without_partial_cache(self):
        self.library.synthesize = self.library._synthesize
        with patch("audio.subprocess.run", return_value=Mock(returncode=1, stdout=self.mp3)):
            with self.assertRaises(UserError): self.library.prepare("farm")
        self.assertFalse(list(self.assets.rglob("*.json")))
        self.library.synthesize = self.upstream
        with patch("audio.os.replace", side_effect=OSError("disk full")):
            with self.assertRaises(UserError): self.library.prepare("farm")
        self.assertFalse(list(self.assets.rglob(".audio-*")))
        self.assertFalse(list(self.assets.rglob("*.json")))
        self.assertFalse(self.library.prepare("farm")["cached"])

    def test_corrupt_audio_and_manifest_are_never_cache_hits(self):
        clip = self.library.prepare("farm")
        audio = self.assets / clip["url"].removeprefix("/assets/")
        audio.write_bytes(b"x" + self.mp3[1:])
        with self.assertRaises(UserError) as error: self.library.prepare("farm")
        self.assertEqual(error.exception.status, 409)
        self.upstream.assert_called_once()
        audio.write_bytes(self.mp3)
        manifest_path = self.library._manifest_path(clip["key"])
        manifest = json.loads(manifest_path.read_text())
        manifest["request"]["text"] = "wrong word"
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaises(UserError): self.library.prepare("farm")
        with self.assertRaises(UserError): validate_audio_library(self.assets)

    def test_generation_cannot_follow_asset_directory_symlink(self):
        outside = self.root / "outside"
        outside.mkdir()
        self.assets.mkdir()
        (self.assets / "audio").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(UserError): self.library.prepare("farm")
        self.assertEqual(list(outside.iterdir()), [])

    def test_inventory_excludes_private_records_and_preserves_lesson(self):
        lesson = {"class_name": "Private class", "notes": "Private teacher notes", "attempts": [{"answer": "Private answer"}],
                  "words": [{"word": "farm", "example": "We are on a farm.", "extra_examples": [{"en": "We are on a farm."}, {"en": "I like the farm."}]}],
                  "materials": {"story": {"scenes": [{"en": "It is a sunny day on the farm.",
                      "question": {"en": "Where are we?", "answer_en": "On a farm."}}]}}}
        before = copy.deepcopy(lesson)
        items = lesson_texts(lesson)
        self.assertEqual(len(items), 6)
        self.library.prepare("farm")
        inventory = self.library.inventory(lesson)
        self.assertEqual(inventory["cached"], 1)
        self.assertNotIn("Private", json.dumps(inventory))
        self.assertEqual(before, lesson)

    def test_real_http_mp3_range_head_origin_and_offline_cache(self):
        clip = self.library.prepare("farm")
        store = Store(self.root / "test.sqlite3", seed=None, asset_root=self.assets)
        offline = AudioLibrary(self.assets, environ={"WORD_GARDEN_TTS_OFFLINE": "1"}, synthesize=Mock(side_effect=AssertionError("network")))
        server = make_server(store, 0, self.root, audio=offline)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def close():
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)
        self.addCleanup(close)
        def request(path, method="GET", data=None, headers=None):
            connection = HTTPConnection("127.0.0.1", server.server_port, timeout=3)
            try:
                connection.request(method, path, json.dumps(data).encode() if data else None, headers or {})
                response = connection.getresponse()
                return response.status, dict(response.getheaders()), response.read()
            finally: connection.close()
        status, headers, body = request(clip["url"])
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "audio/mpeg")
        self.assertIn("immutable", headers["Cache-Control"])
        self.assertEqual(hashlib.sha256(body).hexdigest(), Path(clip["url"]).stem)
        self.assertTrue(is_mp3(body))
        for value, expected in (("bytes=0-19", self.mp3[:20]), ("bytes=-20", self.mp3[-20:]), ("bytes=20-", self.mp3[20:])):
            status, headers, body = request(clip["url"], headers={"Range": value})
            self.assertEqual(status, 206)
            self.assertEqual(body, expected)
            self.assertIn("Content-Range", headers)
        for value in ("bytes=999999999-", "bytes=-0", "bytes=9-1", "bytes=0-1,4-5", "bytes=-"):
            self.assertEqual(request(clip["url"], headers={"Range": value})[0], 416)
        status, headers, body = request(clip["url"], method="HEAD")
        self.assertEqual((status, body), (200, b""))
        self.assertEqual(int(headers["Content-Length"]), len(self.mp3))
        post = {"Content-Type": "application/json"}
        status, _, body = request("/api/audio", "POST", {"text": "farm"}, post)
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["cached"])
        self.assertEqual(request("/api/audio", "POST", {"text": "farm"}, {**post, "Origin": "https://other.example"})[0], 403)
        self.assertEqual(request("/api/audio", "POST", {"text": "farm"}, {"Content-Type": "text/plain"})[0], 415)
        server.audio = self.library
        status, _, body = request("/api/audio", "POST", {"text": "An uncached sentence."}, post)
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(body)["cached"])
        server.audio = offline
        status, _, body = request("/api/audio", "POST", {"text": "An uncached sentence."}, post)
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["cached"])
        self.assertEqual(request("/api/audio?text=new")[0], 404)
        self.assertEqual(request("/assets/audio/v1/" + clip["key"] + ".json")[0], 404)
        self.assertEqual(request("/assets/%2e%2e/test.sqlite3")[0], 400)
