import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSlides, textPages } from '../lib/slides.ts';

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
test('a 50-word lecture preserves every word, question, story and family example', () => {
  const slides = buildSlides(lesson);
  assert.equal(slides[0].kind, 'welcome');
  assert.equal(slides.at(-1).kind, 'finish');
  assert.equal(new Set(slides.map((s) => s.id)).size, slides.length);
  for (const w of words) {
    assert.ok(slides.some((s) => s.kind === 'word' && s.word.id === w.id));
    assert.ok(slides.some((s) => s.kind === 'story' && s.word.id === w.id));
    assert.ok(slides.some((s) => s.kind === 'practice' && s.word.id === w.id));
  }
  assert.equal(
    slides
      .filter((s) => s.kind === 'word' && s.word.id === 1)
      .flatMap((s) => s.examples).length,
    5,
  );
  assert.equal(
    slides.filter((s) => s.kind === 'family').flatMap((s) => s.words).length,
    50,
  );
  assert.ok(
    slides.filter((s) => s.kind === 'family').every((s) => s.words.length <= 2),
  );
  assert.equal(
    slides
      .filter((s) => s.kind === 'root')
      .map((s) => s.text)
      .join(''),
    groups[0].story,
  );
  assert.deepEqual(
    buildSlides(structuredClone(lesson)).map((s) => s.id),
    slides.map((s) => s.id),
  );
});
test('long bilingual stories are paginated without dropping text or splitting ordinary English words', () => {
  const text = '小乐说：I have a beautiful notebook. 她记下今天的故事。'.repeat(
    25,
  );
  const pages = textPages(text);
  assert.ok(pages.length > 1);
  assert.ok(pages.every((p) => Array.from(p).length <= 135));
  assert.equal(pages.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  assert.ok(pages.every((p) => !p.endsWith('note')));
});
test('a whole-word lesson still has a complete route through every chapter', () => {
  const slides = buildSlides({ ...lesson, groups: [] });
  assert.ok(slides.some((s) => s.kind === 'whole'));
  assert.deepEqual(
    [...new Set(slides.map((s) => s.chapter))],
    ['welcome', 'words', 'roots', 'practice', 'finish'],
  );
});
test('the final recap contains all 50 words, meanings and every bilingual example in lesson order', () => {
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
test('long recap definitions and examples continue onto readable pages with no missing text', () => {
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
test('long word phrases receive a whole recap page instead of shrinking the type', () => {
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
