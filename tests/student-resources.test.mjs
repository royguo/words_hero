import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  prepareStudentResources,
  studentResourceTexts,
} from '../lib/student-resources.ts';

const hashUrl = (text) =>
  '/assets/audio/v1/' +
  createHash('sha256').update(text).digest('hex') +
  '.mp3';
const words = [
  {
    key: '1',
    word: 'in front of',
    meaning: '在……前面',
    example: 'The dog is in front of the box.',
    example_zh: '狗在盒子前面。',
    source_version: 'v1',
    image: '/assets/words/front/v1/' + 'a'.repeat(64) + '.png',
  },
  {
    key: '2',
    word: 'box',
    meaning: '盒子',
    example: 'The dog is in front of the box.',
    example_zh: '狗在盒子前面。',
    source_version: 'v1',
    image: '/assets/words/box/v1/' + 'b'.repeat(64) + '.png',
  },
];

void test('collects phrases, words and examples once, then downloads every image and audio file', async () => {
  assert.deepEqual(studentResourceTexts(words), [
    'in front of',
    'The dog is in front of the box.',
    'box',
  ]);
  const events = [];
  const prepared = [];
  const result = await prepareStudentResources(
    words,
    new AbortController().signal,
    (value) => events.push(value),
    {
      ensureWorker: async () => events.push('worker'),
      openCache: async () => ({ name: 'cache' }),
      prepare: async (text) => {
        prepared.push(text);
        return { key: text, url: hashUrl(text), bytes: 1, cached: true };
      },
      download: async (items, cache, _signal, onProgress) => {
        assert.deepEqual(cache, { name: 'cache' });
        onProgress({
          cached: items.map((item) => item.url),
          bytes: 1234,
          failed: [],
        });
        return {
          cached: items.map((item) => item.url),
          bytes: 1234,
          failed: [],
        };
      },
    },
  );
  assert.deepEqual(new Set(prepared), new Set(studentResourceTexts(words)));
  assert.equal(result.items.filter((item) => item.kind === 'image').length, 2);
  assert.equal(result.items.filter((item) => item.kind === 'audio').length, 3);
  assert.equal(result.audio.get('in front of'), hashUrl('in front of'));
  assert.equal(result.bytes, 1234);
  assert.equal(events.at(-1).phase, 'ready');
});

void test('one failed resource keeps the group behind the download gate', async () => {
  await assert.rejects(
    prepareStudentResources(
      words.slice(0, 1),
      new AbortController().signal,
      () => {},
      {
        ensureWorker: async () => {},
        openCache: async () => ({}),
        prepare: async (text) => ({
          key: text,
          url: hashUrl(text),
          bytes: 1,
          cached: true,
        }),
        download: async (items, _cache, _signal, onProgress) => {
          const result = {
            cached: items.slice(1).map((item) => item.url),
            bytes: 5,
            failed: [items[0].url],
          };
          onProgress(result);
          return result;
        },
      },
    ),
    /未下载完成/,
  );
});
