import csv,io,json,unittest
from unittest.mock import patch
from content import UserError,parse_csv,worksheet
from tests import test_classroom as fixtures

class MaterialCase(unittest.TestCase):
    def setUp(self):
        fixtures.StoreCase.setUp(self)

    def test_materials_are_snapshot_and_not_regenerated_on_read(self):
        lesson=self.store.generate(self.cid,dict(fixtures.BASE,count=100))
        original_words=lesson["words"]
        original_groups=lesson["groups"]
        with self.store.connect() as db:
            edited=[]
            for word in original_words:
                item=dict(word,story_zh="A new story for future classes",example="A new example.")
                edited.append(item)
            self.store.import_words(db,edited)
        with patch("storage.root_groups",side_effect=AssertionError("Reading must use the stored packet")):
            reopened=self.store.lesson(lesson["id"])
        self.assertEqual(reopened["words"],original_words)
        self.assertEqual(reopened["groups"],original_groups)

    def test_question_order_is_saved_and_stable_after_progress_updates(self):
        lesson=self.store.generate(self.cid,dict(fixtures.BASE,count=20))
        ids={w["id"] for w in lesson["words"]}
        order=lesson["config"]["worksheet_order"]
        self.assertEqual(set(order["english_to_chinese"]),ids)
        self.assertEqual(set(order["chinese_to_english"]),ids)
        before=worksheet(lesson,"homework")
        after=self.store.patch(lesson["version_id"],{"word_id":lesson["words"][0]["id"],
                                                      "result":"remembered","notes":"Saved"})
        self.assertEqual(worksheet(after,"homework"),before)

    def test_wrong_cloze_is_rejected_but_retired_per_word_stories_are_optional(self):
        source=fixtures.csv_text(fixtures.rows_for()[:1])
        rows=list(csv.DictReader(io.StringIO(source)))
        for key,value in (("cloze","No blank here"),
                          ("cloze_answer","wrong"),("cloze_type","unknown")):
            row=dict(rows[0]);row[key]=value
            buf=io.StringIO();out=csv.DictWriter(buf,fieldnames=list(row))
            out.writeheader();out.writerow(row)
            with self.assertRaises(UserError):parse_csv(buf.getvalue())

    def test_presentation_position_is_saved_without_changing_materials(self):
        lesson=self.store.generate(self.cid,dict(fixtures.BASE,count=5))
        sid="practice:"+str(lesson["words"][0]["id"])
        updated=self.store.patch(lesson["version_id"],{"presentation_slide":sid})
        self.assertEqual(self.store.lesson(lesson["id"])["config"]["presentation_slide"],sid)
        self.assertEqual(updated["words"],lesson["words"])
        self.assertEqual(updated["config"]["root_groups"],lesson["config"]["root_groups"])
        self.assertEqual(worksheet(updated,"homework"),worksheet(lesson,"homework"))
        with self.assertRaises(UserError):
            self.store.patch(lesson["version_id"],{"presentation_slide":"<script>"})
        self.store.complete(lesson["version_id"])
        with self.assertRaises(UserError):
            self.store.patch(lesson["version_id"],{"presentation_slide":"welcome"})

    def test_additional_examples_are_validated_and_snapshotted(self):
        source=fixtures.csv_text(fixtures.rows_for()[:1])
        row=list(csv.DictReader(io.StringIO(source)))[0]
        row["examples_json"]=json.dumps([{"en":"Another short sentence.","zh":"另一个短句。"}])
        row["student_prompt"]="你也试着说一句吧。"
        def csv_one(item):
            buf=io.StringIO();out=csv.DictWriter(buf,fieldnames=list(item))
            out.writeheader();out.writerow(item);return buf.getvalue()
        parsed=parse_csv(csv_one(row))[0]
        self.assertEqual(parsed["extra_examples"][0]["zh"],"另一个短句。")
        self.assertEqual(parsed["student_prompt"],row["student_prompt"])
        for value in ("not-json",'{"en":"not a list"}','[{"en":"missing translation"}]'):
            with self.assertRaises(UserError):
                parse_csv(csv_one(dict(row,examples_json=value)))
        # A syntactically valid cloze cannot ask for an unrelated word:
        # grading must accept the stored answer.
        invalid=dict(row,example="This is wrong.",cloze="This is __________.",cloze_answer="wrong")
        with self.assertRaises(UserError):parse_csv(csv_one(invalid))

    def test_copywriting_reserves_wide_cells_for_long_phrases(self):
        lesson=self.store.generate(self.cid,dict(fixtures.BASE,count=5))
        for i,word in enumerate(("cat","air conditioning","tourist information centre")):
            lesson["words"][i].update(word=word,display_word=word)
        lesson["config"].pop("worksheets")
        html=worksheet(lesson,"classroom")
        self.assertIn("<h1>随堂跟写练习</h1>",html)
        self.assertIn('1. cat</td>'+('<td colspan="1"><div class="writing-line"></div></td>'*4),html)
        self.assertIn('2. air conditioning</td>'+('<td colspan="2"><div class="writing-line"></div></td>'*2),html)
        self.assertIn('3. tourist information centre</td><td colspan="4">',html)

    def test_same_affix_different_usage_is_distinguished_on_paper(self):
        lesson=self.store.generate(self.cid,dict(fixtures.BASE,count=5))
        lesson["words"][0].update(word="quickly",display_word="quickly",parts=[{"text":"-ly","kind":"suffix","meaning":"以某种方式（构成副词）"}])
        lesson["words"][1].update(word="friendly",display_word="friendly",parts=[{"text":"-ly","kind":"suffix","meaning":"具有某种特点（构成形容词）"}])
        lesson["config"].pop("worksheets")
        paper=worksheet(lesson,"homework")
        answers=worksheet(lesson,"answers")
        self.assertIn("quickly 中的 -ly",paper)
        self.assertIn("friendly 中的 -ly",paper)
        self.assertIn("以某种方式（构成副词）",answers)
        self.assertIn("具有某种特点（构成形容词）",answers)
