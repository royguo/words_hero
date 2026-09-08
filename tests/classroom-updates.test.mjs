import assert from 'node:assert/strict';
import test from 'node:test';
import { resetCourseForCopy } from '../worker/class-copy.ts';
import { checkRootExamples, exampleTerms } from '../lib/root-examples.ts';
import {
  constructionFor,
  phoneticFor,
  targetSegments,
} from '../lib/word-presentation.ts';

void test('copy resets every learning state and identity without changing shared content or source', () => {
  const source = {
    id: 'old',
    class_id: 'old-class',
    class_name: '旧班级',
    number: 5,
    title: '固定课程',
    version_id: 'v3',
    version_number: 3,
    course_code: 'WG-OLD',
    created_at: 'yesterday',
    status: 'completed',
    read_only: true,
    is_current: true,
    completed_at: 'today',
    stage: 'practice',
    cursor: 2,
    notes: 'private',
    draft: { 7: 'farm' },
    versions: [{ id: 'v1' }],
    attempts: [{ correct: 2 }],
    config: {
      count: 1,
      new_count: 0,
      review_count: 1,
      presentation_slide: 'review:2',
      worksheets: { sentences: [{ answer: 'farm' }] },
      worksheet_order: { english_to_chinese: [7] },
    },
    words: [
      {
        id: 7,
        word: 'farm',
        result: 'remembered',
        seen: true,
        reserved: true,
        asset_id: 'farm-v2',
        images: [{ src: '/assets/words/farm/v2/photo.webp', sha256: 'hash' }],
        word_study: { components: [{ text: 'farm' }] },
        example: 'A farm.',
      },
    ],
    groups: [{ id: 'farm', words: ['farm'] }],
    materials: {
      bundle_id: 'farm-friend-v2',
      story: { scenes: [{ image: { src: '/assets/story.webp' } }] },
    },
  };
  const before = structuredClone(source);
  const target = {
    classId: 'new-class',
    className: '新班级',
    lessonId: 'new',
    versionId: 'new-v1',
    code: 'WG-NEW',
    createdAt: 'tomorrow',
  };
  const copy = resetCourseForCopy(source, target);
  assert.deepEqual(source, before);
  assert.equal(copy.class_id, target.classId);
  assert.equal(copy.id, target.lessonId);
  assert.equal(copy.version_id, target.versionId);
  assert.equal(copy.course_code, target.code);
  assert.equal(copy.class_name, target.className);
  assert.equal(copy.created_at, target.createdAt);
  assert.equal(copy.number, 5);
  assert.equal(copy.version_number, 1);
  assert.equal(copy.title, source.title);
  assert.equal(copy.status, 'active');
  assert.equal(copy.read_only, false);
  assert.equal(copy.is_current, true);
  assert.equal(copy.completed_at, null);
  assert.equal(copy.stage, 'preview');
  assert.equal(copy.cursor, 0);
  assert.equal(copy.notes, '');
  assert.deepEqual(copy.draft, {});
  assert.equal(copy.config.new_count, 1);
  assert.equal(copy.config.review_count, 0);
  for (const key of ['versions', 'attempts']) assert.ok(!(key in copy));
  assert.ok(!('presentation_slide' in copy.config));
  assert.equal(copy.words[0].result, null);
  for (const key of ['seen', 'reserved']) assert.ok(!(key in copy.words[0]));
  for (const key of ['id', 'asset_id', 'images', 'example', 'word_study'])
    assert.deepEqual(copy.words[0][key], source.words[0][key]);
  assert.deepEqual(copy.materials, source.materials);
  assert.deepEqual(copy.groups, source.groups);
  assert.deepEqual(copy.config.worksheets, source.config.worksheets);
  assert.deepEqual(copy.config.worksheet_order, source.config.worksheet_order);
  copy.words[0].images[0].src = 'different';
  assert.deepEqual(source, before);
});

const group = {
  id: 'suffix:er',
  text: '-er',
  kind: 'suffix',
  meaning: '做某事的人',
  words: [{ word: 'farmer', meaning_zh: '农民' }],
};
const component = { text: '-er', kind: 'suffix', meaning: '做某事的人' };
const vocabulary = [
  { word: 'farmer', level: 'KET', meaning_zh: '农民', parts: [] },
  { word: 'teacher', level: 'KET', meaning_zh: '老师', parts: [] },
  { word: 'teacher', level: 'PET', meaning_zh: '教师', parts: [component] },
  {
    word: 'bigger',
    meaning_zh: '更大的',
    parts: [{ ...component, meaning: '比较级' }],
  },
  { word: 'mother', meaning_zh: '妈妈', parts: [] },
  {
    word: 'farm',
    meaning_zh: '农场',
    parts: [{ text: 'farm', kind: 'word', meaning: '农场' }],
  },
];
void test('multi-word input handles punctuation and case without splitting phrases', () => {
  assert.deepEqual(
    exampleTerms('Teacher， teacher; FARMER\nice cream；MOTHER'),
    ['teacher', 'farmer', 'ice cream', 'mother'],
  );
});
void test('cross-library lookup separates dictionary presence from root evidence and returns lesson references', () => {
  const result = checkRootExamples(
    group,
    ['farmer', 'TEACHER', 'bigger', 'mother', 'farm', 'teach', 'teechr'],
    vocabulary,
  );
  assert.deepEqual(
    result.results.map((r) => [r.found, r.matched]),
    [
      [true, true],
      [true, true],
      [true, false],
      [true, false],
      [true, false],
      [false, false],
      [false, false],
    ],
  );
  assert.equal(result.results[1].meaning_zh, '教师');
  assert.equal(result.results[2].component_meaning, '比较级');
  assert.deepEqual(result.reference, {
    meaning: group.meaning,
    words: group.words,
  });
});
void test('structured base components and phrases can provide evidence without a substring guess', () => {
  const base = {
    ...group,
    text: 'farm',
    kind: 'word',
    meaning: '农场',
    words: [],
  };
  const words = [
    {
      word: 'farm shop',
      display_word: 'farm shop',
      meaning_zh: '农场商店',
      word_study: {
        components: [{ text: 'farm', kind: 'base', meaning_zh: '农场' }],
      },
    },
  ];
  assert.equal(
    checkRootExamples(base, ['farm shop'], words).results[0].matched,
    true,
  );
});

void test('shared IPA corrects empty or legacy sample transcriptions and preserves valid brackets', () => {
  assert.equal(phoneticFor({ word: 'online', phonetic: '' }), '/ˈɒn.laɪn/');
  assert.equal(
    phoneticFor({ word: 'photographer', phonetic: "fә'tɔ^rәfә" }),
    '/fəˈtɒɡ.rə.fə(r)/',
  );
  assert.equal(phoneticFor({ word: 'test', phonetic: '[test]' }), '/test/');
  assert.equal(phoneticFor({ word: 'test', phonetic: '/test/' }), '/test/');
  assert.equal(phoneticFor({ word: 'unavailable' }), '');
});
void test('construction displays curated components but never invents a missing root', () => {
  assert.deepEqual(
    constructionFor({
      word: 'photographer',
      word_study: {
        components: [{ text: 'photo-' }, { text: 'graph' }, { text: '-er' }],
      },
    }),
    { parts: ['photo-', 'graph', '-er'], whole: false },
  );
  assert.deepEqual(
    constructionFor({ word: 'teacher', parts: [{ text: '-er' }] }),
    { parts: ['teacher'], whole: true },
  );
  assert.deepEqual(
    constructionFor({
      word: 'classmate',
      parts: [{ text: 'class' }, { text: 'mate' }],
    }),
    { parts: ['class', 'mate'], whole: false },
  );
  assert.deepEqual(
    constructionFor({
      word: 'teacher',
      word_study: { explanation_zh: 'older snapshot' },
    }),
    { parts: ['teacher'], whole: true },
  );
});
void test('target highlighting respects word boundaries, phrases and accepted forms without dropping text', () => {
  const word = { word: 'farm', accepted: ['farms'] };
  const sentence = 'Farm, farms and a farmer on the farm.';
  const parts = targetSegments(sentence, word);
  assert.equal(parts.map((s) => s.text).join(''), sentence);
  assert.deepEqual(
    parts.filter((s) => s.target).map((s) => s.text),
    ['Farm', 'farms', 'farm'],
  );
  assert.deepEqual(
    targetSegments('ICE  CREAM is nice.', { word: 'ice cream' })
      .filter((s) => s.target)
      .map((s) => s.text),
    ['ICE  CREAM'],
  );
  assert.deepEqual(
    targetSegments('a+b then ab', { word: 'a+b' })
      .filter((s) => s.target)
      .map((s) => s.text),
    ['a+b'],
  );
});
