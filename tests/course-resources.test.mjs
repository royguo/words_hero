import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  courseResourcePlan,
  downloadResources,
  inspectResources,
} from '../lib/course-resources.ts';
import {
  MEDIA_CACHE,
  MEDIA_TTL,
  isStoredMedia,
  mediaHash,
  mediaResponse,
  pruneMedia,
} from '../public/course-media-cache.js';

const origin = 'https://kitedance.test';
class MemoryCache {
  values = new Map();
  key(input) {
    return new URL(typeof input === 'string' ? input : input.url, origin).href;
  }
  async match(input) {
    return this.values.get(this.key(input))?.clone();
  }
  async put(input, response) {
    this.values.set(this.key(input), response.clone());
  }
  async delete(input) {
    return this.values.delete(this.key(input));
  }
  async keys() {
    return [...this.values.keys()].map((url) => new Request(url));
  }
}
function resource(text = 'recording', kind = 'audio') {
  const body = Buffer.from(text);
  const hash = createHash('sha256').update(body).digest('hex');
  const url =
    kind === 'audio'
      ? `/assets/audio/v1/${hash}.mp3`
      : `/assets/words/farm/v2/${hash}.png`;
  return { url, kind, body };
}
const responseFor = (item) =>
  new Response(item.body, {
    headers: {
      'Content-Type': item.kind === 'audio' ? 'audio/mpeg' : 'image/png',
    },
  });
async function saved(item, cache = new MemoryCache()) {
  await downloadResources(
    [item],
    cache,
    new AbortController().signal,
    () => {},
    async () => responseFor(item),
  );
  return cache;
}
function worker(cache, network = async () => new Response('network')) {
  const events = new Map();
  // Execute the real worker entry with its static imports supplied by the harness.
  const source = readFileSync(
    new URL('../public/course-media-sw.js', import.meta.url),
    'utf8',
  ).replace(/^import[\s\S]*?;\s*/, '');
  runInNewContext(source, {
    self: {
      location: { origin },
      addEventListener: (name, callback) => events.set(name, callback),
    },
    caches: {
      open: async (name) => {
        assert.equal(name, MEDIA_CACHE);
        return cache;
      },
    },
    fetch: network,
    URL,
    MEDIA_CACHE,
    isStoredMedia,
    mediaHash,
    mediaResponse,
    pruneMedia,
  });
  return (path, options) => {
    /** @type {Promise<Response> | null} */
    let result = null;
    events.get('fetch')({
      request: new Request(new URL(path, origin), options),
      respondWith: (promise) => {
        result = promise;
      },
    });
    return /** @type {Promise<Response> | null} */ (result);
  };
}

void test('collects every word image and story image, deduplicates shared files, and reports ungenerated audio', () => {
  const image = resource('word image', 'image');
  const second = resource('another word image', 'image');
  const story = resource('story-only image', 'image');
  const audio = resource();
  const lesson = {
    words: [{ images: [{ src: image.url }, { src: second.url }] }, {}],
    materials: {
      story: {
        scenes: [
          { image: { src: image.url } },
          { image: { src: story.url } },
          {},
        ],
      },
    },
  };
  const inventory = {
    items: [
      { cached: true, url: audio.url },
      { cached: true, url: audio.url },
      { cached: false, url: null },
    ],
  };
  const before = structuredClone(lesson);
  assert.deepEqual(courseResourcePlan(lesson, inventory), {
    items: [image, second, story, audio].map(({ url, kind }) => ({
      url,
      kind,
    })),
    missingAudio: 1,
  });
  assert.deepEqual(lesson, before);
  lesson.words[0].images.push({ src: '/api/private-backup' });
  assert.throws(() => courseResourcePlan(lesson, inventory), /素材地址/);
});

void test('resume and another course reuse complete local files without any network request', async () => {
  const item = resource();
  const cache = await saved(item);
  const updates = [];
  const result = await downloadResources(
    [item],
    cache,
    new AbortController().signal,
    (value) => updates.push(value),
    async () => {
      assert.fail('cached media must not download twice');
    },
  );
  assert.deepEqual(result, {
    cached: [item.url],
    bytes: item.body.length,
    failed: [],
  });
  assert.equal(updates.length, 1);
  assert.deepEqual(await inspectResources([item], cache), result);
});

void test('truncated, wrong-hash, HTML errors and partial responses never count as downloaded', async () => {
  const item = resource();
  for (const invalid of [
    new Response('bad', { headers: { 'Content-Type': 'audio/mpeg' } }),
    new Response('<html>Error</html>', {
      headers: { 'Content-Type': 'text/html' },
    }),
    new Response(item.body, {
      status: 206,
      headers: { 'Content-Type': 'audio/mpeg' },
    }),
    new Response('missing', { status: 404 }),
  ]) {
    const cache = new MemoryCache();
    const result = await downloadResources(
      [item],
      cache,
      new AbortController().signal,
      () => {},
      async () => invalid,
    );
    assert.deepEqual(result.cached, []);
    assert.deepEqual(result.failed, [item.url]);
    assert.equal(await cache.match(item.url), undefined);
  }
});

void test('pause cancels pending transfers, preserves completed files and resume downloads only missing files', async () => {
  const items = Array.from({ length: 8 }, (_, i) => resource('clip ' + i));
  const cache = await saved(items[0]);
  const controller = new AbortController();
  let requests = 0;
  const paused = await downloadResources(
    items,
    cache,
    controller.signal,
    () => {},
    async (_url, options) => {
      requests++;
      if (requests === 3) controller.abort();
      options.signal.throwIfAborted();
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        ),
      );
    },
  );
  assert.equal(requests, 3);
  assert.deepEqual(paused.cached, [items[0].url]);
  assert.deepEqual(paused.failed, []);
  const downloaded = [];
  const result = await downloadResources(
    items,
    cache,
    new AbortController().signal,
    () => {},
    async (url) => {
      downloaded.push(url);
      return responseFor(items.find((item) => item.url === url));
    },
  );
  assert.equal(result.cached.length, 8);
  assert.equal(downloaded.length, 7);
  assert.ok(!downloaded.includes(items[0].url));
});

void test('storage quota failure stops the batch and does not report unwritten bytes as cached', async () => {
  const item = resource();
  const cache = new MemoryCache();
  cache.put = async () => {
    throw new DOMException('Full', 'QuotaExceededError');
  };
  const states = [];
  await assert.rejects(
    downloadResources(
      [item],
      cache,
      new AbortController().signal,
      (state) => states.push(state),
      async () => responseFor(item),
    ),
    /存储空间/,
  );
  assert.deepEqual(states.at(-1).cached, []);
  assert.equal(states.at(-1).bytes, 0);
});

void test('expiry and changed content hashes are rechecked instead of trusting an old course completion flag', async () => {
  const item = resource();
  const cache = await saved(item);
  const current = await cache.match(item.url);
  assert.equal(isStoredMedia(current, item.url), true);
  assert.equal(isStoredMedia(current, resource('new version').url), false);
  await pruneMedia(cache, Date.now() + MEDIA_TTL);
  assert.equal((await inspectResources([item], cache)).cached.length, 0);
});

void test('cached images and recordings are served without network, including reloads and audio ranges', async () => {
  const item = resource('0123456789');
  const cache = await saved(item);
  const dispatch = worker(cache, async () => {
    assert.fail('must play offline from full cached media');
  });
  let r = await dispatch(item.url);
  assert.equal(r.headers.get('X-Kite-Media-Source'), 'browser-cache');
  assert.equal(await r.text(), '0123456789');
  for (const [range, status, body, contentRange] of [
    ['bytes=0-1', 206, '01', 'bytes 0-1/10'],
    ['bytes=6-', 206, '6789', 'bytes 6-9/10'],
    ['bytes=-3', 206, '789', 'bytes 7-9/10'],
    ['bytes=8-99', 206, '89', 'bytes 8-9/10'],
    ['bytes=99-', 416, '', 'bytes */10'],
    ['bytes=-0', 416, '', 'bytes */10'],
  ]) {
    r = await dispatch(item.url, { headers: { Range: range } });
    assert.equal(r.status, status);
    assert.equal(r.headers.get('Content-Range'), contentRange);
    assert.equal(r.headers.get('Content-Length'), String(body.length));
    assert.equal(await r.text(), body);
  }
  r = await dispatch(item.url, {
    method: 'HEAD',
    headers: { Range: 'bytes=0-1' },
  });
  assert.equal(r.status, 206);
  assert.equal(await r.text(), '');
  r = await dispatch(item.url, {
    headers: { Range: 'bytes=0-1', 'If-Range': '"different"' },
  });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '0123456789');
  const image = resource('image bytes', 'image');
  await saved(image, cache);
  assert.equal(await (await dispatch(image.url)).text(), 'image bytes');
});

void test('the service worker never intercepts login, private data, application code or unrelated URLs', () => {
  const dispatch = worker(new MemoryCache());
  for (const path of [
    '/',
    '/learn',
    '/api/auth/session',
    '/api/backup',
    '/api/versions/private',
    '/assets/app.js',
    'https://another.example' + resource().url,
    resource().url + '?query=1',
  ])
    assert.equal(dispatch(path), null, path);
  assert.equal(
    dispatch(resource().url, { method: 'POST', body: 'ignored' }),
    null,
  );
});

void test('network and storage failures leave ordinary online media fetching intact', async () => {
  const item = resource();
  const cache = new MemoryCache();
  let requests = 0;
  const dispatch = worker(cache, async () => {
    requests++;
    return responseFor(item);
  });
  assert.equal(await (await dispatch(item.url)).text(), 'recording');
  assert.equal(
    (await cache.keys()).length,
    0,
    'normal browsing never auto-saves media',
  );
  cache.match = async () => {
    throw new Error('Storage blocked');
  };
  assert.equal(await (await dispatch(item.url)).text(), 'recording');
  assert.equal(requests, 2);
});
