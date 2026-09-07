import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSlides, textPages, sectionFor } from '../lib/slides.ts';

const words = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  word: 'word' + i,
  display_word: 'word' + i,
  meaning_zh: '单词 ' + i + ' 的含义',
  pos: 'n.',
  example: 'This is a simple example.',
  example_zh: '这是一个简单的例子。',
  story_zh: '小乐走进花园。她看到一棵树，又想起朋友讲过的小故事。',
  parts: [],
  accepted: [],
  extra_examples:
    i === 0
      ? Array.from({ length: 4 }, () => ({
          en: 'Here is another example.',
          zh: '另一个例子。',
        }))
      : [],
}));
const groups = [
  {
    id: 'family',
    text: '-er',
    kind: 'suffix',
    meaning: '做事的人',
    story: '有来历的构词线索。'.repeat(40),
    words: words.map((w) => ({ word: w.word })),
  },
];
const lesson = { title: 'A real class', words, groups };
void test('a 50-word lecture pairs each word with one study page and preserves every sentence exercise', () => {
  const slides = buildSlides(lesson);
  assert.equal(slides[0].kind, 'welcome');
  assert.equal(slides.at(-1).kind, 'finish');
  assert.equal(new Set(slides.map((s) => s.id)).size, slides.length);
  for (const w of words) {
    assert.ok(slides.some((s) => s.kind === 'word' && s.word.id === w.id));
    assert.ok(slides.some((s) => s.kind === 'study' && s.word.id === w.id));
    assert.ok(slides.some((s) => s.kind === 'practice' && s.word.id === w.id));
  }
  assert.equal(
    slides
      .filter((s) => s.kind === 'word' && s.word.id === 1)
      .flatMap((s) => s.examples).length,
    5,
  );
  assert.equal(slides.filter(s => s.kind === 'study').length, words.length);
  for (const w of words) {
    const own = slides.filter(s => s.word?.id === w.id && ['word', 'study'].includes(s.kind));
    assert.equal(own.at(-1).kind, 'study');
    assert.equal(slides[slides.indexOf(own.at(-1)) - 1].word.id, w.id);
  }
  const cards = slides.filter(s => s.kind === 'cards');
  assert.deepEqual(cards.flatMap(s => s.words).map(w => w.id), words.map(w => w.id));
  assert.ok(cards.every(s => s.words.length > 0 && s.words.length <= 4));
  assert.ok(!slides.some(s => ['story', 'root', 'family', 'whole'].includes(s.kind)));
  assert.deepEqual(
    buildSlides(structuredClone(lesson)).map((s) => s.id),
    slides.map((s) => s.id),
  );
});
void test('long bilingual stories are paginated without dropping text or splitting ordinary English words', () => {
  const text = '小乐说：I have a beautiful notebook. 她记下今天的故事。'.repeat(
    25,
  );
  const pages = textPages(text);
  assert.ok(pages.length > 1);
  assert.ok(pages.every((p) => Array.from(p).length <= 135));
  assert.equal(pages.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  assert.ok(pages.every((p) => !p.endsWith('note')));
});
void test('word definitions paginate to leave space for pictures without dropping meaning', () => {
  const word = {
    ...words[2],
    meaning_zh: '完整的中文释义需要分页保留。'.repeat(10),
  };
  const slides = buildSlides({ ...lesson, words: [word], groups: [] }).filter(
    (s) => s.kind === 'word',
  );
  assert.ok(slides.length > 1);
  assert.ok(slides.every((s) => s.meaning.length <= 40));
  assert.equal(slides.map((s) => s.meaning).join(''), word.meaning_zh);
  assert.deepEqual(
    slides.flatMap((s) => s.examples),
    [{ en: word.example, zh: word.example_zh }],
  );
});
void test('a whole-word lesson still has a complete route through every chapter', () => {
  const slides = buildSlides({ ...lesson, groups: [] });
  assert.equal(slides.filter(s => s.kind === 'study').length, 50);
  assert.deepEqual(
    [...new Set(slides.map((s) => s.chapter))],
    ['welcome', 'words', 'practice', 'finish'],
  );
});
void test('illustrated story and questions follow word studies and precede vocabulary practice', () => {
  const scenes = Array.from({ length: 4 }, (_, i) => ({
    id: 'scene-' + i,
    title: 'A new friend',
    en: 'We visit a farm.',
    zh: '我们参观农场。',
    image: i ? null : { id: 'farm', src: '/assets/words/farm/image.png' },
    question: {
      en: 'Where are we?',
      zh: '我们在哪里？',
      answer_en: 'On a farm.',
      answer_zh: '在农场。',
    },
  }));
  const slides = buildSlides({ ...lesson, materials: { story: { scenes } } });
  assert.deepEqual(
    [...new Set(slides.map((s) => s.chapter))],
    ['welcome', 'words', 'scenes', 'practice', 'finish'],
  );
  const story = slides.filter((s) => s.kind === 'scene');
  assert.deepEqual(
    story.map((s) => s.scene),
    scenes,
  );
  assert.equal(slides.filter((s) => s.kind === 'scene-question').length, 4);
  story.forEach((slide) => {
    assert.equal(sectionFor(slide), 'scenes');
    assert.equal(slides[slides.indexOf(slide) + 1].kind, 'scene-question');
  });
  assert.equal(new Set(slides.map((s) => s.id)).size, slides.length);
});
void test('the final recap contains all 50 words, meanings and every bilingual example in lesson order', () => {
  const recap = buildSlides(lesson).filter((s) => s.kind === 'finish');
  assert.equal(recap[0].id, 'finish');
  assert.ok(recap.length > 1);
  assert.ok(recap.every((s) => s.recap.length >= 1 && s.recap.length <= 2));
  const entries = recap.flatMap((s) => s.recap);
  assert.deepEqual(
    [...new Set(entries.map((e) => e.word.id))],
    words.map((w) => w.id),
  );
  for (const word of words) {
    const own = entries.filter((e) => e.word.id === word.id);
    assert.ok(own.every((e) => e.meaning === word.meaning_zh));
    assert.deepEqual(
      own.map((e) => ({ en: e.en, zh: e.zh })),
      [{ en: word.example, zh: word.example_zh }, ...word.extra_examples],
    );
  }
});
void test('long recap definitions and examples continue onto readable pages with no missing text', () => {
  const word = {
    ...words[1],
    meaning_zh: '很长但必须完整保留的中文释义。'.repeat(15),
    example: 'We have a beautiful notebook. '.repeat(15),
    example_zh: '我们有一个漂亮的笔记本。'.repeat(20),
  };
  const pages = buildSlides({ ...lesson, words: [word], groups: [] }).filter(
    (s) => s.kind === 'finish',
  );
  assert.ok(pages.length > 1);
  assert.ok(pages.every((s) => s.recap.length === 1));
  const entries = pages.flatMap((s) => s.recap);
  for (const [source, field] of [
    ['meaning_zh', 'meaning'],
    ['example', 'en'],
    ['example_zh', 'zh'],
  ]) {
    assert.equal(
      entries
        .map((e) => e[field])
        .join('')
        .replace(/\s/g, ''),
      word[source].replace(/\s/g, ''),
    );
  }
});
void test('long word phrases receive a whole recap page instead of shrinking the type', () => {
  const phrases = ['tourist information centre', 'public transport'];
  const longWords = phrases.map((word, i) => ({
    ...words[i],
    word,
    display_word: word,
    extra_examples: [],
  }));
  const recap = buildSlides({ ...lesson, words: longWords, groups: [] }).filter(
    (slide) => slide.kind === 'finish',
  );
  assert.equal(recap.length, 2);
  assert.ok(recap.every((slide) => slide.recap.length === 1));
});
