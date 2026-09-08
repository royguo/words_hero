import assert from 'node:assert/strict';
import test from 'node:test';
import { renderStory, storyPrintPages } from '../worker/story-print.ts';

const scenes = Array.from({ length: 4 }, (_, i) => ({
  id: 'scene-' + (i + 1),
  title: '不要打印中文情节名',
  en: `Scene ${i + 1}: A kitten is in the backpack. The kittens are happy.`,
  zh: '不要打印中文译文',
  image: {
    src: `/assets/words/backpack/v1/${String(i).repeat(64)}.png`,
    alt: '不要打印中文图片说明',
    caption: '不要打印中文标题',
  },
  question: { en: 'Where is the kitten?', zh: '不要打印问题译文' },
}));
const lesson = {
  title: '不要打印中文课程名',
  class_name: '不要打印中文班级名',
  course_code: 'WG-STORY',
  words: [{ word: 'kitten', accepted: ['kittens'] }, { word: 'backpack' }],
  materials: {
    story: {
      title_en: 'The Little Camper',
      title_zh: '不要打印中文故事名',
      scenes,
    },
  },
};

void test('each saved scene gets an English illustrated sheet and a domain footer, without changing the lesson', () => {
  const before = structuredClone(lesson);
  const html = renderStory(lesson);
  const pages = html.split('<section').slice(1);
  assert.equal(pages.length, 4);
  assert.doesNotMatch(html, /\p{Script=Han}/u);
  for (const [i, page] of pages.entries()) {
    assert.ok(page.includes('data-scene="' + scenes[i].id + '"'));
    assert.ok(page.includes(scenes[i].image.src));
    assert.ok(page.includes('The Little Camper'));
    assert.ok(page.includes('kitedance.com'));
    assert.ok(page.includes('WG-STORY'));
    for (const field of ['name', 'age', 'time'])
      assert.ok(page.includes('data-field="' + field + '"'));
    assert.ok(page.includes('<strong>kitten</strong>'));
    assert.ok(page.includes('<strong>kittens</strong>'));
    assert.ok(page.includes('<strong>backpack</strong>'));
  }
  assert.deepEqual(lesson, before);
  assert.equal(renderStory(lesson), html);
});

void test('long scenes continue without losing or reordering English words or replacing their illustration', () => {
  const text = Array.from(
    { length: 35 },
    (_, i) => `Sentence ${i + 1}: The little kitten is in the backpack.`,
  ).join(' ');
  const extended = {
    ...lesson,
    materials: {
      story: {
        ...lesson.materials.story,
        scenes: [{ ...scenes[0], en: text }, scenes[1]],
      },
    },
  };
  const pages = storyPrintPages(extended);
  assert.ok(pages.length > 2);
  const first = pages.filter((page) => page.number === 1);
  assert.equal(
    first
      .map((page) => page.text)
      .join(' ')
      .replace(/\s+/g, ' '),
    text,
  );
  assert.ok(first.every((page) => page.text.length <= 500));
  assert.ok(
    first
      .slice(1)
      .every(
        (page) =>
          page.continuation && page.scene.image.src === scenes[0].image.src,
      ),
  );
  assert.equal(pages.at(-1).text, scenes[1].en);
});

void test('missing pictures keep the full story readable, and untrusted image URLs cannot create remote requests or HTML', () => {
  for (const src of [
    undefined,
    'javascript:alert(1)',
    '//other.invalid/image.png',
    'https://other.invalid/picture.png',
    '/assets/../api/backup',
    '/assets/words/a/v1/x.png" onerror="alert(1)',
  ]) {
    const html = renderStory({
      ...lesson,
      materials: {
        story: {
          ...lesson.materials.story,
          scenes: [{ ...scenes[0], image: src ? { src } : null }],
        },
      },
    });
    assert.ok(
      html.includes(
        'A <strong>kitten</strong> is in the <strong>backpack</strong>',
      ),
    );
    assert.doesNotMatch(html, /<img|onerror|javascript:|other\.invalid/);
  }
});

void test('English content is escaped, and an absent English title uses an English fallback', () => {
  const html = renderStory({
    ...lesson,
    materials: {
      story: {
        ...lesson.materials.story,
        title_en: '',
        scenes: [
          {
            ...scenes[0],
            en: '<img src=x onerror=alert(1)> "A & B"',
            image: null,
          },
        ],
      },
    },
  });
  assert.ok(html.includes('Picture Story'));
  assert.ok(
    html.includes('&lt;img src=x onerror=alert(1)&gt; &quot;A &amp; B&quot;'),
  );
  assert.doesNotMatch(html, /<img|\p{Script=Han}/u);
});
