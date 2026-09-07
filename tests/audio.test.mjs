import assert from 'node:assert/strict';
import test from 'node:test';
import { SpeechPlayer } from '../lib/audio.ts';

const clip = (word) => ({
  key: word,
  url: '/assets/audio/' + word + '.mp3',
  bytes: 2000,
  cached: false,
});
function fixture(request = async (text) => clip(text), play = async () => {}) {
  const recordings = [];
  const notices = [];
  const player = new SpeechPlayer(request, () => {
    const media = {
      src: '',
      paused: false,
      play,
      pause() {
        this.paused = true;
      },
      removeAttribute() {
        this.src = '';
      },
      load() {},
    };
    recordings.push(media);
    return media;
  });
  return {
    player,
    recordings,
    notices,
    notify: (message) => notices.push(message),
  };
}
void test('a late download never starts the previous word after a new click', async () => {
  const requests = new Map();
  const f = fixture(
    (text, signal) =>
      new Promise((resolve) => requests.set(text, { resolve, signal })),
  );
  const first = f.player.speak('farm', f.notify);
  const second = f.player.speak('lizard', f.notify);
  assert.equal(requests.get('farm').signal.aborted, true);
  requests.get('farm').resolve(clip('farm'));
  await first;
  assert.equal(f.recordings.length, 0);
  requests.get('lizard').resolve(clip('lizard'));
  await second;
  assert.equal(f.recordings.length, 1);
  assert.equal(f.player.snapshot().text, 'lizard');
  f.player.stop();
});
void test('navigation cancels a pending fetch and prevents late playback', async () => {
  let resolve;
  const f = fixture(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = f.player.speak('farm', f.notify);
  f.player.stop();
  resolve(clip('farm'));
  await pending;
  assert.deepEqual(f.player.snapshot(), { phase: 'idle', text: '' });
  assert.equal(f.recordings.length, 0);
});
void test('repeated click toggles off, and later playback reuses the local URL', async () => {
  let requests = 0;
  const f = fixture(async (text) => {
    requests++;
    return clip(text);
  });
  await f.player.speak('farm', f.notify);
  const first = f.recordings[0];
  await f.player.speak('farm', f.notify);
  assert.equal(first.paused, true);
  assert.equal(f.player.snapshot().phase, 'idle');
  await f.player.speak(' farm ', f.notify);
  assert.equal(requests, 1);
  assert.equal(f.recordings.length, 2);
  f.player.stop();
});
void test('a blocked autoplay retains the recording for a second user gesture', async () => {
  let calls = 0;
  let requests = 0;
  const f = fixture(
    async (text) => {
      requests++;
      return clip(text);
    },
    async () => {
      if (!calls++)
        throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
    },
  );
  await f.player.speak('farm', f.notify);
  assert.match(f.notices.at(-1), /再点一次/);
  await f.player.speak('farm', f.notify);
  assert.equal(f.player.snapshot().phase, 'playing');
  assert.equal(requests, 1);
  f.player.stop();
});
void test('media failure invalidates the transient URL and a retry checks the server', async () => {
  let requests = 0;
  const f = fixture(async (text) => {
    requests++;
    return clip(text);
  });
  await f.player.speak('farm', f.notify);
  f.recordings[0].onerror();
  assert.equal(f.player.snapshot().phase, 'idle');
  await f.player.speak('farm', f.notify);
  assert.equal(requests, 2);
  f.recordings[1].onended();
  assert.equal(f.player.snapshot().phase, 'idle');
});
void test('an unavailable service reports the error without system speech fallback', async () => {
  const f = fixture(async () => {
    throw new Error('Service unavailable');
  });
  await f.player.speak('farm', f.notify);
  assert.equal(f.recordings.length, 0);
  assert.equal(f.player.snapshot().phase, 'idle');
  assert.equal(f.notices.at(-1), 'Service unavailable');
});
