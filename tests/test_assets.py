"""Assets remain portable, bounded and immutable once snapshotted into a lesson."""
import base64
import hashlib
import json
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path

from assets import asset_path, load_bundle, validate_library
from content import UserError, parse_csv
from storage import Store
from server import make_server
from test_classroom import csv_text


class AssetCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.assets = self.root / "assets"
        self.assets.mkdir()
        self.words = ["farm", "song", "suit", "stamp", "lizard"]
        image = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1kAAAAASUVORK5CYII=")
        digest = hashlib.sha256(image).hexdigest()
        (self.assets / (digest + ".png")).write_bytes(image)
        self.picture = {"id": "test-image", "file": digest + ".png", "sha256": digest,
                        "alt": "test pixel", "prompt": "test fixture, not generated", "generator": "test", "created_at": "2026-09-07"}
        self.mapping = {}
        for word in self.words:
            relative = "words/" + word + "/v1/manifest.json"
            self.mapping["KET:" + word] = relative
            self.write(relative, {"schema_version": 1, "id": word + "-v1", "word": word,
                                 "levels": ["KET"], "teaching": {"meaning_zh": "原素材释义 " + word},
                                 "images": [self.picture] if word == "farm" else []})
        self.write("catalog.json", {"schema_version": 1, "words": self.mapping})
        self.bundle = {"schema_version": 1, "id": "test-v1", "level": "KET", "word_order": self.words,
                       "word_assets": self.mapping, "story": {"title_en": "Farm Day", "title_zh": "农场的一天", "level": "KET", "covered_words": ["farm", "song", "suit"], "scenes": [
                           {"id": "first", "title": "农场", "en": "At the farm, I wear a suit and sing a song.", "zh": "在农场里，我穿着西装唱歌。", "image": self.picture,
                            "question": {"en": "Where are we?", "zh": "我们在哪里？", "answer_en": "At the farm.", "answer_zh": "在农场里。"}}]}}
        self.write("lessons/test-v1/manifest.json", self.bundle)
        self.store = Store(self.root / "classroom.sqlite3", seed=None, asset_root=self.assets)
        rows = [{"word": w, "level": "KET", "meaning_zh": "词库释义 " + w, "pos": "n.", "topic": "日常", "difficulty": 1, "is_basic": 0, "parts_json": "[]", "accepted": ""} for w in self.words]
        with self.store.connect() as db:
            self.store.import_words(db, parse_csv(csv_text(rows)))
            self.ids = [db.execute("SELECT id FROM vocabulary WHERE word=?", (w,)).fetchone()[0] for w in self.words]
        self.cid = self.store.create_class({"name": "Private classroom"})["id"]

    def write(self, relative, data):
        path = self.assets / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    def draft(self):
        draft = self.store.preview(self.cid, {"count": 5})
        return self.store.patch_draft(draft["id"], {"revision": draft["revision"], "word_ids": self.ids})

    def lesson(self):
        draft = self.draft()
        return self.store.confirm_draft(draft["id"], {"revision": draft["revision"]})

    def test_confirm_preserves_reviewed_assets_even_if_catalog_changes(self):
        draft = self.draft()
        self.write("catalog.json", {"schema_version": 1, "words": {}})
        lesson = self.store.confirm_draft(draft["id"], {"revision": draft["revision"]})
        for before, after in zip(draft["words"], lesson["words"]):
            self.assertEqual(before, {k: v for k, v in after.items() if k != "result"})
        self.assertEqual(len(lesson["words"][0]["images"]), 1)
        self.assertEqual(lesson["words"][1]["images"], [])

    def test_attach_versions_snapshot_and_keep_words_and_print_order(self):
        original = self.lesson()
        updated = self.store.attach_materials(original["course_code"], "test-v1")
        self.assertNotEqual(original["course_code"], updated["course_code"])
        self.assertEqual(updated["number"], original["number"])
        self.assertEqual([w["id"] for w in updated["words"]], self.ids)
        self.assertEqual(updated["config"]["worksheet_order"], original["config"]["worksheet_order"])
        self.assertEqual(self.store.attach_materials(updated["course_code"], "test-v1")["version_id"], updated["version_id"])
        self.assertTrue(self.store.lesson(original["id"], original["version_id"])["read_only"])
        self.assertEqual(self.store.lesson(original["id"], original["version_id"])["materials"], {})
        self.bundle["story"]["title_zh"] = "后来修改的文件"
        self.write("lessons/test-v1/manifest.json", self.bundle)
        restarted = Store(self.store.path, seed=None, asset_root=self.assets)
        self.assertEqual(restarted.lesson(updated["id"])["materials"]["story"]["title_zh"], "农场的一天")
        with self.assertRaises(UserError):
            self.store.attach_materials(original["course_code"], "test-v1")

    def test_wrong_word_order_and_broken_file_roll_back_without_new_version(self):
        lesson = self.lesson()
        self.bundle["word_order"] = list(reversed(self.words))
        self.write("lessons/test-v1/manifest.json", self.bundle)
        with self.assertRaises(UserError):
            self.store.attach_materials(lesson["course_code"], "test-v1")
        self.bundle["word_order"] = self.words
        self.write("lessons/test-v1/manifest.json", self.bundle)
        (self.assets / self.picture["file"]).write_bytes(b"changed")
        with self.assertRaises(UserError):
            self.store.attach_materials(lesson["course_code"], "test-v1")
        current = self.store.lesson(lesson["id"])
        self.assertEqual(current["version_id"], lesson["version_id"])
        self.assertEqual(len(current["versions"]), 1)

    def test_story_validation_coverage_and_page_budget(self):
        validate_library(self.assets)
        self.bundle["story"]["covered_words"] = ["lizard"]
        self.write("lessons/test-v1/manifest.json", self.bundle)
        with self.assertRaises(UserError):
            load_bundle("test-v1", [{"word": w, "level": "KET"} for w in self.words], self.assets)
        self.bundle["story"]["covered_words"] = ["farm"]
        self.bundle["story"]["scenes"][0]["en"] = "farm " * 100
        self.write("lessons/test-v1/manifest.json", self.bundle)
        with self.assertRaises(UserError):
            validate_library(self.assets)

    def test_story_pack_accepts_confirmed_words_from_mixed_libraries(self):
        path = self.assets / self.mapping["KET:song"]
        record = json.loads(path.read_text())
        record["levels"].append("PET")
        path.write_text(json.dumps(record))
        self.bundle["word_assets"]["PET:song"] = self.bundle["word_assets"].pop("KET:song")
        self.write("lessons/test-v1/manifest.json", self.bundle)
        words = [{"word": w, "level": "PET" if w == "song" else "KET"} for w in self.words]
        enriched, materials = load_bundle("test-v1", words, self.assets)
        self.assertEqual([w["level"] for w in enriched], [w["level"] for w in words])
        self.assertEqual(materials["story"]["level"], "KET")

    def test_images_and_private_brief_over_real_http(self):
        lesson = self.lesson()
        server = make_server(self.store, 0, self.root)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        def request(path):
            client = HTTPConnection("127.0.0.1", server.server_port)
            try:
                client.request("GET", path)
                response = client.getresponse()
                return response.status, response.getheader("Content-Type"), response.read()
            finally:
                client.close()
        status, kind, raw = request(lesson["words"][0]["images"][0]["src"])
        self.assertEqual((status, kind), (200, "image/png"))
        self.assertEqual(hashlib.sha256(raw).hexdigest(), self.picture["sha256"])
        for path in ("/assets/../classroom.sqlite3", "/assets/%2e%2e/classroom.sqlite3", "/assets/catalog.json"):
            self.assertGreaterEqual(request(path)[0], 400)
        brief = json.loads(request("/api/courses/" + lesson["course_code"].lower() + "/brief")[2])
        self.assertEqual(brief["word_order"], self.words)
        self.assertNotIn("class_name", brief)
        self.assertNotIn("notes", brief)
        self.assertNotIn("Private classroom", json.dumps(brief))

    def test_asset_paths_cannot_escape_through_symlinks(self):
        secret = self.root / "outside.png"
        secret.write_bytes(b"private")
        (self.assets / "link.png").symlink_to(secret)
        for path in ("../outside.png", "link.png", str(secret)):
            with self.assertRaises(UserError):
                asset_path(path, self.assets)
