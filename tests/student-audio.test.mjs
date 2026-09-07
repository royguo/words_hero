import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(
  new URL('../lib/student-audio.ts', import.meta.url),
  'utf8',
).replace(
  "import { prepareAudio } from './audio';",
  'const prepareAudio = (...args) => globalThis.__kitePrepare(...args);',
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { StudentAudio } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);
const tick = () => new Promise((r) => setImmediate(r));
class AudioMock {
  src = '';
  played = [];
  onended = null;
  onerror = null;
  play() {
    this.played.push(this.src);
    return Promise.resolve();
  }
  pause() {}
  removeAttribute() {
    this.src = '';
  }
  load() {}
}
void test('an obsolete download cannot pronounce a word from the previous screen', async () => {
  let resolveOld;
  globalThis.__kitePrepare = (text) =>
    text === 'farm'
      ? new Promise((r) => (resolveOld = r))
      : Promise.resolve({ url: '/song.mp3' });
  const media = new AudioMock(),
    player = new StudentAudio(
      () => {},
      () => media,
    );
  const old = player.play(['farm']);
  const current = player.play(['song']);
  await tick();
  resolveOld({ url: '/farm.mp3' });
  await old;
  assert.deepEqual(media.played, ['/song.mp3']);
  media.onended();
  await current;
  player.dispose();
});
void test('the board reads sequentially; leaving it cancels all remaining words', async () => {
  const requested = [];
  globalThis.__kitePrepare = async (text) => {
    requested.push(text);
    return { url: '/' + text + '.mp3' };
  };
  const media = new AudioMock(),
    player = new StudentAudio(
      () => {},
      () => media,
    );
  const queue = player.play(['farm', 'song', 'stamp']);
  await tick();
  assert.deepEqual(requested, ['farm']);
  media.onended();
  await tick();
  assert.deepEqual(requested, ['farm', 'song']);
  player.stop();
  await queue;
  assert.deepEqual(requested, ['farm', 'song']);
  player.dispose();
});
void test('autoplay denial gives a listen prompt and stops the queue without a speech fallback', async () => {
  globalThis.__kitePrepare = async (text) => ({ url: '/' + text + '.mp3' });
  const messages = [];
  const media = new AudioMock();
  media.play = () =>
    Promise.reject(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    );
  const player = new StudentAudio(
    (message) => messages.push(message),
    () => media,
  );
  await player.play(['farm', 'song']);
  assert.deepEqual(messages, ['点击“朗读”开启声音']);
  player.dispose();
});
