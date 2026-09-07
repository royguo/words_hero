import copy,json,tempfile,unittest
from pathlib import Path
from content import ROOT,worksheet
from storage import Store
from word_study import validate_study
from worksheets import question_pages
class WordStudyCase(unittest.TestCase):
    def setUp(self):self.study=json.loads((ROOT/'assets/words/farm/v2/manifest.json').read_text())['teaching']['word_study']
    def test_simple_word_must_not_be_arbitrarily_split(self):
        value=copy.deepcopy(self.study);value['components']=[{'text':'far','kind':'root','meaning_zh':'远'}]
        with self.assertRaises(ValueError):validate_study(value)
    def test_family_examples_and_source_links_are_required(self):
        for change in ({'family':[]},{'sources':[{'title':'bad','url':'javascript:alert(1)'}]},{'origin_zh':'字'*101}):
            with self.subTest(change=change),self.assertRaises(ValueError):validate_study(dict(self.study,**change))
    def test_balanced_paper_questions_keep_ids_and_answers(self):
        questions=[{'id':'sentence-'+str(i),'word_id':i,'prompt':'I see a __________.','hint':'我看见一只猫。','answer':'cat'} for i in range(10)]
        pages=question_pages(questions);self.assertEqual([len(p) for p in pages],[5,5]);self.assertEqual(sum(pages,[]),questions)
    def test_material_revision_does_not_rewrite_previous_lesson(self):
        with tempfile.TemporaryDirectory() as tmp:
            s=Store(Path(tmp)/'class.sqlite3');c=s.create_class({'name':'test'})['id'];pack=json.loads((ROOT/'assets/lessons/farm-friend-v2/manifest.json').read_text())
            with s.connect() as db:ids=[db.execute("SELECT id FROM vocabulary WHERE level='KET' AND word=?",(w,)).fetchone()[0] for w in pack['word_order']]
            d=s.preview(c,{'count':10});d=s.patch_draft(d['id'],{'revision':d['revision'],'word_ids':ids});l=s.confirm_draft(d['id'],{'revision':d['revision']});old=copy.deepcopy(l)
            newer=s.attach_materials(l['course_code'],'farm-friend-v2');original=s.lesson(l['id'],l['version_id'])
            self.assertEqual(original['words'],old['words']);self.assertEqual(original['config'],old['config']);self.assertEqual([w['id'] for w in newer['words']],ids)
            self.assertTrue(all(w.get('word_study') for w in newer['words']))
            paper=worksheet(newer,'homework');answers=worksheet(newer,'answers');self.assertEqual(paper.count('class="paper-page"'),4);self.assertEqual(answers.count('class="paper-page"'),4)
            self.assertNotIn('min-height:272mm',paper)
