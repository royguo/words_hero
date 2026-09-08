"""Behavioral regression checks against isolated SQLite files and real loopback HTTP."""
import csv
import io
import json
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch

from content import ROOT, UserError, parse_csv, root_groups, worksheet
from storage import Store
from server import Handler, make_server

BASE = dict(level="KET", count=5, difficulty_min=1, difficulty_max=3,
            exclude_basic=True, exclude_seen=True, mode="new")
WORDS = """airport adventure actor actress apartment article autumn bicycle bridge
    brother business careful careless celebrate celebration cinema collect collection
    comfortable conversation dangerous difficult discovery driver enjoyable environment
    expensive experiment friendly helpful hopeless hospital important information
    interesting journey kindness library musician national newspaper painter payment
    peaceful photograph pollution reporter science singer slowly successful theatre
    tourist useful village wonderful""".split()
FIELDS = ["word", "level", "meaning_zh", "pos", "topic", "difficulty",
          "is_basic", "example", "example_zh", "parts_json", "accepted", "display_word", "story_zh", "cloze", "cloze_answer", "cloze_zh", "cloze_type"]


def csv_text(rows):
    f = io.StringIO()
    w = csv.DictWriter(f, fieldnames=FIELDS)
    w.writeheader()
    for row in rows:
        row = dict(row)
        word=row["word"]
        row.update(example="We use the word "+word+".", example_zh="我们使用这个词。", story_zh="小乐想起了课堂画面："+word,
                   cloze="We use the word __________.",cloze_answer=word,cloze_zh="我们使用这个词。",cloze_type="context")
        w.writerow(row)
    return f.getvalue()


def rows_for(level="KET"):
    rows = []
    for i, word in enumerate(WORDS):
        parts = []
        if word in ("careful", "careless"):
            parts = [{"text": "care", "kind": "root", "meaning": "关心；小心"},
                     {"text": "-ful" if word == "careful" else "-less", "kind": "suffix",
                      "meaning": "充满" if word == "careful" else "缺少"}]
        rows.append(dict(word=word, level=level, meaning_zh="课堂释义 " + word,
                         pos="n.", topic="测试主题", difficulty=i % 3 + 1, is_basic=0,
                         example="We use the word " + word + ".", example_zh="课堂例句。",
                         parts_json=json.dumps(parts), accepted="theater" if word == "theatre" else "",
                         display_word=word))
    rows += [dict(word=w, level=level, meaning_zh="基础词", pos="det.", topic="基础",
                  difficulty=1, is_basic=0, example="", example_zh="", parts_json="[]",
                  accepted="", display_word=w) for w in ["a", "an", "lot", "many"]]
    return rows


class StoreCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        # Fixture roots must not change when the public teaching catalog grows.
        self.store = Store(Path(self.tmp.name) / "classroom.sqlite3", seed=None,
                           asset_root=Path(self.tmp.name) / "assets")
        with self.store.connect() as db:
            self.store.import_words(db, parse_csv(csv_text(rows_for())))
            self.store.import_words(db, parse_csv(csv_text(rows_for("PET"))))
        self.cid = self.store.create_class({"name": "周六班"})["id"]

    def generate(self, **options):
        return self.store.generate(self.cid, dict(BASE, **options))

    def test_scope_difficulty_filter_and_honest_shortage(self):
        lesson = self.generate(level="PET", difficulty_min=2, difficulty_max=2, count=100)
        self.assertEqual({w["level"] for w in lesson["words"]}, {"PET"})
        self.assertEqual({w["difficulty"] for w in lesson["words"]}, {2})
        self.assertTrue(all(not w["is_basic"] for w in lesson["words"]))
        self.assertLess(len(lesson["words"]), 100)
        self.assertEqual(lesson["config"]["requested_count"], 100)
        self.assertEqual(lesson["config"]["new_count"], len(lesson["words"]))
        with self.assertRaises(UserError):
            self.generate(level="CET-4")
        self.assertEqual(len(self.store.state(self.cid)["lessons"]), 1)

    def test_class_isolation_and_active_reservations(self):
        first = self.generate()
        second = self.generate()
        a = {w["word"] for w in first["words"]}
        b = {w["word"] for w in second["words"]}
        self.assertFalse(a & b)
        self.assertEqual([first["number"], second["number"]], [1, 2])
        other = self.store.create_class({"name": "周日班"})["id"]
        self.assertGreater(self.store.pool(other, BASE)["available"],
                           self.store.pool(self.cid, BASE)["available"])
        self.store.complete(first["version_id"])
        self.assertEqual(self.store.state(other)["learned"], 0)
        self.assertEqual(self.store.state(self.cid)["learned"], 5)

    def test_cross_level_reservations_and_shared_progress(self):
        ket = self.generate()
        learned = {w["word"] for w in ket["words"]}
        pet = self.generate(level="PET")
        self.assertFalse(learned & {w["word"] for w in pet["words"]})
        self.store.complete(ket["version_id"])
        with patch("storage.now", return_value="2100-01-01T00:00:00+00:00"):
            review = self.generate(level="PET", mode="review")
            self.assertEqual({w["word"] for w in review["words"]}, learned)
            for w in review["words"]:
                self.store.patch(review["version_id"], {"word_id": w["id"], "result": "remembered"})
            self.store.complete(review["version_id"])
        self.assertEqual(self.store.state(self.cid)["learned"], 5)
        with self.store.connect() as db:
            self.assertEqual({r["reviews"] for r in db.execute("SELECT * FROM progress")}, {2})
            self.assertEqual({r["seen_at"] for r in db.execute("SELECT * FROM progress")},
                             {"2100-01-01T00:00:00+00:00"})

    def test_regeneration_is_versioned_and_failed_generation_atomic(self):
        old = self.generate()
        self.store.patch(old["version_id"], {"notes": "原课堂笔记", "stage": "roots"})
        before = self.store.lesson(old["id"])
        fresh = self.store.generate(self.cid, BASE, old["id"])
        self.assertEqual(fresh["version_number"], 2)
        self.assertFalse({w["id"] for w in fresh["words"]} & {w["id"] for w in old["words"]})
        archived = self.store.lesson(old["id"], old["version_id"])
        self.assertEqual(archived["words"], before["words"])
        self.assertEqual(archived["notes"], "原课堂笔记")
        self.assertEqual(archived["stage"], "roots")
        self.assertTrue(archived["read_only"])
        with self.assertRaises(UserError):
            self.store.patch(old["version_id"], {"notes": "覆盖"})
        with self.assertRaises(UserError):
            self.store.complete(old["version_id"])
        with self.assertRaises(UserError):
            self.store.generate(self.cid, dict(BASE, level="CET-6"), old["id"])
        self.assertEqual(self.store.lesson(old["id"])["version_id"], fresh["version_id"])
        self.assertEqual(len(self.store.lesson(old["id"])["versions"]), 2)
        # Abandoned revision words are available again, only the current revision reserves.
        with self.store.connect() as db:
            available = {r["word"] for r in self.store.candidates(db, self.cid, BASE)}
        self.assertTrue({w["word"] for w in old["words"]} <= available)

    def test_snapshot_immutable_after_import_and_restart(self):
        old = self.generate()
        newrows = rows_for()
        for row in newrows:
            row["meaning_zh"] = "后来修改的释义"
        with self.store.connect() as db:
            self.store.import_words(db, parse_csv(csv_text(newrows)))
        reopened = Store(self.store.path, seed=None)
        self.assertEqual(reopened.lesson(old["id"])["words"], old["words"])
        with reopened.connect() as db:
            self.assertTrue(all(json.loads(r[0])["meaning_zh"] == "后来修改的释义"
                                for r in db.execute("SELECT data FROM vocabulary WHERE level='KET'")))

    def test_draft_confirmation_preserves_exact_mixed_selection_and_is_idempotent(self):
        draft=self.store.preview(self.cid,dict(BASE,title="确认选词"))
        self.assertEqual(self.store.state(self.cid)["lessons"],[])
        original_pool=self.store.pool(self.cid,BASE)
        chosen=draft["words"][:-1]
        other=next(w for w in self.store.vocabulary("PET") if w["word"] not in {w["word"] for w in chosen})
        selected=list(reversed([w["id"] for w in chosen]+[other["id"]]))
        draft=self.store.patch_draft(draft["id"],dict(revision=draft["revision"],word_ids=selected))
        self.assertEqual(self.store.pool(self.cid,BASE),original_pool)
        reopened=Store(self.store.path,seed=None)
        self.assertEqual(reopened.latest_draft(self.cid)["draft"],draft)
        # Importing revised materials does not silently change the reviewed draft.
        with self.store.connect() as db:
            self.store.import_words(db,parse_csv(csv_text([{**r,"meaning_zh":"新的词库释义"} for r in rows_for("PET")])))
        with ThreadPoolExecutor(max_workers=2) as executor:
            results=list(executor.map(lambda _: self.store.confirm_draft(draft["id"],{"revision":draft["revision"]}),range(2)))
        lesson=results[0]
        self.assertEqual(results[0]["id"],results[1]["id"])
        self.assertEqual(len(self.store.state(self.cid)["lessons"]),1)
        self.assertEqual(lesson["level"],"KET + PET")
        self.assertEqual(lesson["config"]["count"],len(selected))
        self.assertEqual([w["id"] for w in lesson["words"]],selected)
        self.assertEqual([{k:v for k,v in w.items() if k!="result"} for w in lesson["words"]],draft["words"])
        self.assertIsNone(self.store.latest_draft(self.cid)["draft"])
        self.assertEqual(set(lesson["config"]["worksheet_order"]["english_to_chinese"]),set(selected))
        self.assertIn("KET + PET",worksheet(lesson,"classroom"))
        self.assertEqual(lesson["groups"],root_groups(draft["words"]))

    def test_draft_edits_validate_duplicates_and_conflicts_without_partial_writes(self):
        draft=self.store.preview(self.cid,BASE)
        ids=[w["id"] for w in draft["words"]]
        duplicate=next(w for w in self.store.vocabulary("PET",draft["words"][0]["word"]) if w["word"]==draft["words"][0]["word"])
        for invalid in ([ids[0],ids[0]],[ids[0],duplicate["id"]],[9999999],[True],[10**25],ids*21):
            with self.assertRaises(UserError):
                self.store.patch_draft(draft["id"],dict(revision=draft["revision"],word_ids=invalid))
            self.assertEqual(self.store.latest_draft(self.cid)["draft"],draft)
        empty=self.store.patch_draft(draft["id"],dict(revision=draft["revision"],word_ids=[]))
        with self.assertRaises(UserError):self.store.confirm_draft(empty["id"],{"revision":empty["revision"]})
        self.assertEqual(self.store.state(self.cid)["lessons"],[])
        with self.assertRaises(UserError):self.store.patch_draft(empty["id"],dict(revision=draft["revision"],word_ids=ids))
        one=self.store.patch_draft(empty["id"],dict(revision=empty["revision"],word_ids=ids[:1]))
        lesson=self.store.confirm_draft(one["id"],{"revision":one["revision"]})
        self.assertEqual(len(lesson["words"]),1)

    def test_regeneration_preview_keeps_current_version_until_confirmation(self):
        original=self.generate()
        draft=self.store.preview(self.cid,dict(BASE,count=10),original["id"])
        self.assertEqual(self.store.lesson(original["id"]),original)
        other=self.store.create_class({"name":"另一个班"})["id"]
        self.assertIsNone(self.store.latest_draft(other)["draft"])
        with self.assertRaises(UserError):self.store.latest_draft(other,original["id"])
        self.assertEqual(self.store.latest_draft(self.cid,original["id"])["draft"],draft)
        revised=self.store.confirm_draft(draft["id"],{"revision":draft["revision"]})
        self.assertEqual(revised["version_number"],2)
        self.assertEqual(self.store.lesson(original["id"],original["version_id"])["words"],original["words"])
        stale=self.store.preview(self.cid,BASE,original["id"])
        self.store.generate(self.cid,BASE,original["id"])
        with self.assertRaises(UserError):self.store.confirm_draft(stale["id"],{"revision":stale["revision"]})
        self.assertIsNone(self.store.latest_draft(self.cid,original["id"])["draft"])

    def test_search_all_libraries_includes_basic_seen_and_cross_level_words(self):
        words=self.store.vocabulary("ALL","airport",cid=self.cid)
        self.assertEqual({w["level"] for w in words},{"KET","PET"})
        self.assertEqual(len(self.store.vocabulary("KET","airport")),1)
        self.assertTrue(self.store.vocabulary("ALL","基础词"))
        self.assertEqual(self.store.vocabulary("ALL","%"),[])
        lesson=self.generate()
        name=lesson["words"][0]["word"]
        self.assertTrue(all(w["reserved"] for w in self.store.vocabulary("ALL",name,cid=self.cid) if w["word"]==name))
        self.store.complete(lesson["version_id"])
        self.assertTrue(all(w["seen"] for w in self.store.vocabulary("ALL",name,cid=self.cid) if w["word"]==name))
        draft=self.store.preview(self.cid,BASE)
        basic=next(w for w in self.store.vocabulary("ALL","many") if w["level"]=="PET")
        draft=self.store.patch_draft(draft["id"],{"revision":draft["revision"],"word_ids":[basic["id"],lesson["words"][0]["id"]]})
        confirmed=self.store.confirm_draft(draft["id"],{"revision":draft["revision"]})
        self.assertTrue(confirmed["words"][0]["is_basic"])
        self.assertEqual(confirmed["config"]["review_count"],1)

    def test_completion_idempotent_and_spaced_review(self):
        lesson = self.generate()
        vid = lesson["version_id"]
        wid = lesson["words"][0]["id"]
        self.store.patch(vid, {"word_id": wid, "result": "remembered"})
        complete = self.store.complete(vid)
        self.store.complete(vid)
        self.assertEqual(complete["status"], "completed")
        self.assertTrue(complete["read_only"])
        with self.store.connect() as db:
            progress = list(db.execute("SELECT * FROM progress"))
        self.assertEqual(len(progress), 5)
        self.assertTrue(all(p["reviews"] == 1 for p in progress))
        for p in progress:
            expected = 3 if p["word_id"] == wid else 1
            self.assertEqual(p["interval_days"], expected)
            self.assertEqual(datetime.fromisoformat(p["due_at"]) -
                             datetime.fromisoformat(p["seen_at"]), timedelta(days=expected))
        self.assertEqual(self.store.pool(self.cid, dict(BASE, mode="review"))["available"], 0)
        with self.assertRaises(UserError):
            self.store.generate(self.cid, BASE, lesson["id"])
        with patch("storage.now", return_value="2100-01-01T00:00:00+00:00"):
            mixed = self.generate(mode="mixed", count=10)
        self.assertEqual(mixed["config"]["review_count"], 2)
        self.assertEqual(mixed["config"]["new_count"], 8)
        self.assertEqual(len({w["word"] for w in mixed["words"]}), 10)

    def test_persistent_answers_notes_and_atomic_validation(self):
        lesson = self.generate(count=100, exclude_basic=False)
        vid = lesson["version_id"]
        theatre = next(w for w in lesson["words"] if w["word"] == "theatre")
        answers = {str(w["id"]): " " + w["word"].upper() + " " for w in lesson["words"]}
        answers[str(theatre["id"])] = "  THEATER  "
        with self.assertRaises(UserError):
            self.store.patch(vid, {"stage": "workbook", "word_id": 9999999, "result": "again"})
        self.assertEqual(self.store.lesson(lesson["id"])["stage"], "preview")
        self.store.patch(vid, {"notes": "留给下一节课", "cursor": 3, "stage": "practice", "draft": answers})
        result = self.store.attempt(vid, {"answers": answers})
        self.assertEqual(result["attempts"][0]["correct"], len(lesson["words"]))
        reopened = Store(self.store.path, seed=None).lesson(lesson["id"])
        self.assertEqual(reopened["draft"], answers)
        self.assertEqual(reopened["notes"], "留给下一节课")
        self.assertEqual(reopened["cursor"], 3)
        self.assertEqual(len(reopened["attempts"]), 1)
        with self.assertRaises(UserError):
            self.store.attempt(vid, {"answers": {}})
        self.assertEqual(len(self.store.lesson(lesson["id"])["attempts"]), 1)
        self.store.complete(vid)
        result = self.store.attempt(vid, {"answers": {k: "" for k in answers}})
        self.assertEqual(result["attempts"][0]["correct"], 0)
        self.assertTrue(all(w["result"] == "remembered" for w in result["words"]))

    def test_concurrent_generation_has_unique_numbers_and_words(self):
        with ThreadPoolExecutor(max_workers=4) as executor:
            lessons = list(executor.map(lambda _: self.generate(), range(4)))
        self.assertEqual({l["number"] for l in lessons}, {1, 2, 3, 4})
        words = [w["word"] for l in lessons for w in l["words"]]
        self.assertEqual(len(words), len(set(words)))

    def test_worksheet_snapshot_content_and_separation(self):
        lesson = self.generate(count=100, exclude_basic=False)
        lesson["class_name"] = "<script>alert('x')</script>"
        copy = worksheet(lesson, "classroom")
        homework = worksheet(lesson, "homework")
        answers = worksheet(lesson, "answers")
        for doc in (copy, homework, answers):
            self.assertIn("size:A4 portrait", doc)
            self.assertIn("break-inside:avoid", doc)
            for label in ("姓名", "年龄", "时间"):
                self.assertIn('aria-label="' + label + '"', doc)
            self.assertNotIn("<script>alert", doc)
            self.assertIn("&lt;script&gt;", doc)
            self.assertIn("window.print()", doc)
        self.assertIn("连续书写练习", copy)
        self.assertNotIn("课堂释义 ", copy)
        self.assertIn("看中文，写英文", homework)
        self.assertNotIn("连续书写练习", homework)
        self.assertIn("教师答案", answers)
        self.assertEqual(homework, worksheet(lesson, "homework"))
        self.assertEqual(len(lesson["groups"]), 3)
        self.assertEqual(len(next(g for g in lesson["groups"] if g["text"] == "care")["words"]), 2)
        self.assertIn("careful", answers)
        self.assertIn("把单词放回句子", homework)
        self.assertEqual(lesson["config"]["worksheets"]["schema_version"], 2)
        self.assertGreaterEqual(homework.count('class="paper-page"'), 2)
        with self.assertRaises(UserError):
            worksheet(lesson, "invalid")

    def test_csv_validation_is_atomic(self):
        original = self.store.pool(self.cid, BASE)["available"]
        badrows = rows_for()
        badrows[-1]["parts_json"] = '{"not":"a list"}'
        with self.assertRaises(UserError):
            parsed = parse_csv(csv_text(badrows))
            with self.store.connect() as db:
                self.store.import_words(db, parsed)
        self.assertEqual(self.store.pool(self.cid, BASE)["available"], original)
        for bad in (
            csv_text([rows_for()[0], rows_for()[0]]),
            csv_text([dict(rows_for()[0], difficulty=4)]),
            csv_text([dict(rows_for()[0], parts_json='[{"text":"x","kind":[],"meaning":"x"}]')]),
            "word,word,level,meaning_zh,pos,topic,difficulty\nx,x,KET,x,n,x,1",
        ):
            with self.assertRaises(UserError):
                parse_csv(bad)
        with self.assertRaises(UserError):
            parse_csv(csv_text(rows_for("PET")), "KET")
        for bad in (True, 4, 101, "5.5"):
            with self.assertRaises(UserError):
                self.generate(count=bad)


class SeedCase(unittest.TestCase):
    def test_all_bundled_rows_import_and_coverage_matches(self):
        report = json.loads((ROOT / "data/coverage.json").read_text())
        seen = {}
        for level in ("KET", "PET"):
            words = parse_csv((ROOT / "data" / (level.lower() + ".csv")).read_text(encoding="utf-8-sig"), level)
            seen[level] = {w["word"] for w in words}
            self.assertEqual(len(words), report[level]["included"])
            self.assertEqual(sum(w["is_basic"] for w in words), report[level]["basic"])
            self.assertEqual(sum(bool(w["example"]) for w in words), report[level]["with_examples"])
            self.assertEqual(sum(bool(w["parts"]) for w in words), report[level]["with_morphology"])
            self.assertTrue(all(w["meaning_zh"] for w in words))
            self.assertTrue(all(w["word"] not in ("v", "sb") for w in words))
            self.assertTrue(all(w["example_zh"] and w["story_zh"] and w["cloze"] and w["cloze_answer"] for w in words))
            self.assertEqual(sum(bool(w["story_zh"]) for w in words), report[level]["with_stories"])
            self.assertTrue(all(len(w["example"].split()) <= 16 for w in words))
            for word in words:
                if word["cloze_type"] == "context":
                    self.assertEqual(word["cloze"].replace("__________", word["cloze_answer"]), word["example"])
            self.assertGreater(report[level]["teachable"], 1300 if level == "KET" else 2500)
        extension = parse_csv((ROOT / "data/pet-extension.csv").read_text(encoding="utf-8-sig"), "PET")
        self.assertFalse({w["word"] for w in extension} & seen["KET"])
        self.assertTrue(all(not w["is_basic"] for w in extension))
        self.assertEqual(len(extension), report["PET"]["extension_nonbasic"])
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "full.sqlite3"
            store = Store(path)
            self.assertEqual(store.state()["classes"], [])
            self.assertEqual([l["total"] for l in store.state()["levels"]], [1707, 3084, 0, 0])
            before = path.stat().st_size
            Store(path)  # Idempotent seed migration
            self.assertEqual(path.stat().st_size, before)
            with store.connect() as db:
                self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")


class HttpCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.store = Store(base / "private.sqlite3", seed=None)
        with self.store.connect() as db:
            self.store.import_words(db, parse_csv(csv_text(rows_for())))
        static = base / "out"
        static.mkdir()
        (static / "index.html").write_text("<!doctype html><title>Local classroom</title>")
        (base / "private.txt").write_text("not public")
        self.server = make_server(self.store, 0, static)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.quiet = patch.object(Handler, "log_message", lambda *args: None)
        self.quiet.start()
        self.addCleanup(self.quiet.stop)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)

    def request(self, path, data=None, method=None, headers=None):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            body = json.dumps(data) if data is not None else None
            h = {"Content-Type": "application/json"} if data is not None else {}
            h.update(headers or {})
            connection.request(method or ("POST" if body else "GET"), path, body=body, headers=h)
            response = connection.getresponse()
            raw = response.read()
            return response.status, dict(response.getheaders()), raw
        finally:
            connection.close()

    def test_complete_http_journey_and_backup_restore(self):
        status, _, data = self.request("/api/classes", {"name": "API 班"})
        self.assertEqual(status, 201)
        cid = json.loads(data)["id"]
        status, _, data = self.request("/api/generate", dict(BASE, class_id=cid))
        self.assertEqual(status, 201)
        lesson = json.loads(data)
        vid = lesson["version_id"]
        status, _, data = self.request("/api/versions/" + vid, {"notes": "已保存"}, "PATCH")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)["notes"], "已保存")
        for kind in ("classroom", "homework", "answers"):
            status, headers, data = self.request("/api/versions/" + vid + "/worksheet?kind=" + kind)
            self.assertEqual(status, 200)
            self.assertIn("text/html", headers["Content-Type"])
            self.assertEqual(headers["X-Frame-Options"], "SAMEORIGIN")
            self.assertIn("size:A4".encode(), data)
        status, _, data = self.request("/api/generate", dict(BASE, class_id=cid, lesson_id=lesson["id"]))
        fresh = json.loads(data)
        status, _, data = self.request("/api/lessons/" + lesson["id"] + "?version=" + vid)
        self.assertEqual(json.loads(data)["version_id"], vid)
        self.assertTrue(json.loads(data)["read_only"])
        status, headers, backup = self.request("/api/backup")
        self.assertEqual(status, 200)
        self.assertEqual(backup[:16], b"SQLite format 3\x00")
        restored = Path(self.tmp.name) / "restored.sqlite3"
        restored.write_bytes(backup)
        reopened = Store(restored, seed=None)
        self.assertEqual(reopened.lesson(lesson["id"])["version_id"], fresh["version_id"])
        self.assertEqual(reopened.lesson(lesson["id"], vid)["notes"], "已保存")
        self.assertEqual(self.request("/")[0], 200)

    def test_loopback_origin_and_static_boundary(self):
        self.assertEqual(self.request("/api/state", headers={"Host": "evil.example"})[0], 403)
        self.assertEqual(self.request("/api/classes", {"name": "x"},
                                      headers={"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request("/api/classes", {"name": "x"},
                                      headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("/api/classes", [1, 2])[0], 400)
        self.assertEqual(self.request("/api/missing")[0], 404)
        for path in ("/private.sqlite3", "/private.txt", "/../private.txt",
                     "/%2e%2e/private.txt", "/.git/config", "/data/classroom.sqlite3"):
            self.assertEqual(self.request(path)[0], 404, path)
        status, _, template = self.request("/api/seed.csv?level=CET-4")
        self.assertEqual(status, 200)
        self.assertTrue(template.endswith(b"\r\n"))
        self.assertNotIn(b"\\r\\n", template)
        self.assertEqual(self.store.state()["classes"], [])

    def test_http_review_edit_restore_and_confirm_before_lesson_creation(self):
        with self.store.connect() as db:self.store.import_words(db,parse_csv(csv_text(rows_for("PET"))))
        cid=json.loads(self.request("/api/classes",{"name":"确认流程班"})[2])["id"]
        status,_,body=self.request("/api/preview",dict(BASE,class_id=cid,title="先确认"))
        self.assertEqual(status,201)
        draft=json.loads(body)
        self.assertEqual(self.store.state(cid)["lessons"],[])
        result=json.loads(self.request("/api/vocabulary?level=ALL&q=airport&class_id="+cid)[2])
        self.assertEqual({w["level"] for w in result},{"KET","PET"})
        ids=[next(w["id"] for w in result if w["level"]=="PET")]
        status,_,body=self.request("/api/drafts/"+draft["id"],{"revision":draft["revision"],"word_ids":ids},"PATCH")
        self.assertEqual(status,200)
        updated=json.loads(body)
        self.assertEqual(json.loads(self.request("/api/drafts?class_id="+cid)[2])["draft"],updated)
        path="/api/drafts/"+draft["id"]+"/confirm"
        self.assertEqual(self.request(path,{"revision":draft["revision"]})[0],409)
        status,_,body=self.request(path,{"revision":updated["revision"]})
        self.assertEqual(status,201)
        lesson=json.loads(body)
        self.assertEqual([w["id"] for w in lesson["words"]],ids)
        self.assertEqual(lesson["words"][0]["level"],"PET")
        self.assertEqual(json.loads(self.request(path,{"revision":updated["revision"]})[2])["id"],lesson["id"])


if __name__ == "__main__":
    unittest.main()
