import assert from 'node:assert/strict';
import test from 'node:test';
import { flashcardSheets, renderFlashcards } from '../worker/flashcards.ts';

const words = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  word: 'word-' + (i + 1),
  meaning_zh: '含义-' + (i + 1),
  example: 'Here is example ' + (i + 1) + '.',
  example_zh: '这里是例句-' + (i + 1),
  parts: [],
  word_study: {
    explanation_zh: '记忆线索-' + (i + 1),
    origin_zh: '不打印的历史长词源',
  },
}));
const lesson = {
  words,
  class_name: '测试班级',
  title: '快记卡片',
  course_code: 'WG-TEST',
  version_number: 3,
};

void test('English cards include IPA, colored components and a highlighted target sentence', () => {
  const html = renderFlashcards({
    ...lesson,
    words: [
      {
        ...words[0],
        word: 'classmate',
        example: 'My classmate is here.',
        word_study: { components: [{ text: 'class' }, { text: 'mate' }] },
      },
    ],
  });
  const [front, back] = html.split('<section').slice(1);
  assert.ok(front.includes('/ˈklɑːs.meɪt/'));
  assert.ok(front.includes('class="part-tone-0">class</span>'));
  assert.ok(front.includes('class="part-tone-1">mate</span>'));
  assert.ok(
    front.includes(
      'My <strong class="flashcard-target">classmate</strong> is here.',
    ),
  );
  assert.ok(!back.includes('flashcard-ipa'));
});

for (const count of [1, 2, 5, 6, 7, 10, 20, 30, 50]) {
  void test(`${count} words: every long-edge duplex cutout has the matching back, including blanks`, () => {
    const input = words.slice(0, count);
    const before = structuredClone(input);
    const sheets = flashcardSheets(input);
    assert.equal(sheets.length, Math.ceil(count / 6));
    assert.deepEqual(
      sheets
        .flatMap((s) => s.front)
        .filter(Boolean)
        .map((c) => c.word.id),
      input.map((w) => w.id),
    );
    for (const sheet of sheets) {
      assert.equal(sheet.front.length, 6);
      assert.equal(sheet.back.length, 6);
      for (let row = 0; row < 3; row++) {
        // Viewed through a sheet after rotating about its vertical (long) edge.
        assert.deepEqual(sheet.front[row * 2], sheet.back[row * 2 + 1]);
        assert.deepEqual(sheet.front[row * 2 + 1], sheet.back[row * 2]);
      }
    }
    assert.deepEqual(
      input,
      before,
      'printing must not reorder the saved lesson',
    );
  });
}
void test('10 words produce front/back pairs on four pages; every word, sentence, meaning and explanation is present', () => {
  const html = renderFlashcards({ ...lesson, words: words.slice(0, 10) });
  assert.deepEqual(
    [...html.matchAll(/data-side="(.*?)" data-sheet="(.*?)"/g)].map((m) => [
      m[1],
      m[2],
    ]),
    [
      ['front', '1'],
      ['back', '1'],
      ['front', '2'],
      ['back', '2'],
    ],
  );
  assert.equal((html.match(/data-card="blank"/g) || []).length, 4);
  const pages = html.split('<section').slice(1);
  assert.deepEqual(
    [...pages[0].matchAll(/data-card="(.*?)"/g)].map((m) => m[1]),
    ['1', '2', '3', '4', '5', '6'],
  );
  assert.deepEqual(
    [...pages[1].matchAll(/data-card="(.*?)"/g)].map((m) => m[1]),
    ['2', '1', '4', '3', '6', '5'],
  );
  assert.deepEqual(
    [...pages[3].matchAll(/data-card="(.*?)"/g)].map((m) => m[1]),
    ['8', '7', '10', '9', 'blank', 'blank'],
  );
  for (const w of words.slice(0, 10)) {
    for (const text of [
      w.word,
      w.example,
      w.meaning_zh,
      w.example_zh,
      w.word_study.explanation_zh,
    ])
      assert.ok(html.includes(text));
  }
  assert.ok(!pages[0].includes('含义-'));
  assert.ok(!pages[1].includes('Here is example'));
  assert.ok(!html.includes('不打印的历史长词源'));
});
void test('stored text is HTML escaped, and old snapshots without word study remain printable', () => {
  const html = renderFlashcards({
    ...lesson,
    class_name: '<b>班级</b>',
    words: [
      {
        ...words[0],
        word: '<script>x</script>',
        display_word: '<em>display</em>',
        example: 'A & B say "hi".',
        meaning_zh: '大于 > 小于 <',
        example_zh: '<img src=x onerror=alert(1)>',
        word_study: undefined,
        parts: [{ text: '<base>', meaning: '词基 & 含义' }],
      },
    ],
  });
  assert.ok(html.includes('&lt;em&gt;display&lt;/em&gt;'));
  assert.ok(html.includes('A &amp; B say &quot;hi&quot;.'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&lt;base&gt;：词基 &amp; 含义'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;b&gt;班级&lt;/b&gt;'));
});
