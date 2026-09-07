import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
const moduleURL = (source) =>
  'data:text/javascript;base64,' +
  Buffer.from(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText,
  ).toString('base64');
const model = moduleURL(
  readFileSync(new URL('../worker/model.ts', import.meta.url), 'utf8'),
);
const audio = await import(
  moduleURL(
    readFileSync(
      new URL('../worker/audio.ts', import.meta.url),
      'utf8',
    ).replace("from './model'", "from '" + model + "'"),
  )
);
const dir = new URL('../assets/audio/v1/', import.meta.url),
  mp3 = readFileSync(
    new URL(
      readdirSync(dir).find((f) => f.endsWith('.mp3')),
      dir,
    ),
  );
function socket(interrupted = false) {
  const ws = new EventTarget();
  ws.binaryType = 'blob';
  ws.accept = () => {
    assert.equal(
      ws.binaryType,
      'arraybuffer',
      'Workers binaryType must be explicit before accepting',
    );
  };
  ws.close = () => {};
  ws.send = (message) => {
    if (!message.includes('Path:ssml')) return;
    queueMicrotask(() => {
      if (interrupted) {
        ws.dispatchEvent(new Event('close'));
        return;
      }
      for (const part of [mp3.subarray(0, 120), mp3.subarray(120)]) {
        const header = Buffer.from('Path:audio\r\nContent-Type:audio/mpeg\r\n'),
          prefix = Buffer.alloc(2);
        prefix.writeUInt16BE(header.length);
        const frame = Buffer.concat([prefix, header, part]);
        ws.dispatchEvent(
          new MessageEvent('message', {
            data: frame.buffer.slice(
              frame.byteOffset,
              frame.byteOffset + frame.byteLength,
            ),
          }),
        );
      }
      ws.dispatchEvent(
        new MessageEvent('message', { data: 'Path:turn.end\r\n\r\n' }),
      );
    });
  };
  return ws;
}
void test('current Workers binary frames assemble into an exact complete MP3', async () => {
  const before = globalThis.fetch;
  globalThis.fetch = async () => ({ webSocket: socket() });
  try {
    const bytes = await audio.synthesize('The kite is green.');
    assert.deepEqual(Buffer.from(bytes), mp3);
    assert.equal(audio.isMP3(bytes), true);
  } finally {
    globalThis.fetch = before;
  }
});
void test('an interrupted speech stream never publishes R2 or D1 cache entries', async () => {
  const before = globalThis.fetch;
  globalThis.fetch = async () => ({ webSocket: socket(true) });
  let writes = 0;
  try {
    await assert.rejects(
      audio.prepare(
        {
          get: async () => null,
          put: async () => {
            writes++;
          },
        },
        'The kite is green.',
        'true',
        {},
      ),
      /未完整生成/,
    );
    assert.equal(writes, 0);
  } finally {
    globalThis.fetch = before;
  }
});
void test('speech identity matches Python and rejects empty/non-English text', async () => {
  const path = readdirSync(dir).find((f) => f.endsWith('.json')),
    manifest = JSON.parse(readFileSync(new URL(path, dir), 'utf8'));
  assert.equal((await audio.identity(manifest.request.text)).key, manifest.key);
  assert.throws(() => audio.normalizeText('  '));
  assert.throws(() => audio.normalizeText('中文'));
});
