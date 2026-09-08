// Actual local-only Worker replay, two checkpoints, correction recovery and idempotency.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const input = JSON.parse(readFileSync(0, 'utf8'));
assert.equal(new URL(input.base).hostname, '127.0.0.1');
const uri = (source) =>
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = (name) =>
  ts.transpileModule(readFileSync(new URL(name, import.meta.url), 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
const gameURI = uri(compile('../lib/student-game.ts'));
const { StudentProgress } = await import(
  uri(
    compile('../lib/student-progress.ts').replace(
      "'./student-game'",
      JSON.stringify(gameURI),
    ),
  )
);
const draft = new Map(),
  storage = {
    getItem: (k) => draft.get(k) || null,
    setItem: (k, v) => draft.set(k, v),
    removeItem: (k) => draft.delete(k),
  };
async function send(path, payload, status = 200) {
  const r = await fetch(input.base + '/api/student/' + path, {
    method: payload ? 'POST' : 'GET',
    headers: { Cookie: input.cookie, 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await r.json();
  assert.equal(r.status, status, JSON.stringify(data));
  return data;
}
const base = (
  await send('sessions', {
    mode: 'practice',
    extra: true,
    count: input.count || 10,
  })
).session;
assert.equal(base.game.schema_version, 2);
let p = new StudentProgress(input.studentId, base, () => storage);
const keys = base.game.words.map((w) => w.key),
  path = 'sessions/' + base.id + '/actions';
if (input.miss) {
  p.choose({ kind: 'match', en: keys[0], zh: keys[1] });
  assert(p.session.game.practice.correction);
  assert(!p.needsCheckpoint);
  const recovered = new StudentProgress(input.studentId, base, () => storage);
  assert.deepEqual(recovered.session, p.session);
  p = recovered;
}
function answer() {
  const g = p.session.game;
  if (g.practice.correction) p.choose({ kind: 'acknowledge' });
  else if (g.needs_retry) p.choose({ kind: 'retry' });
  else if (g.stage === 1) {
    const key = g.en_order.find((k) => !g.removed.includes(k));
    p.choose({ kind: 'match', en: key, zh: key });
  } else {
    const q = g.questions[g.cursor];
    p.choose({ kind: 'judge', correct: q.word === q.candidate });
  }
}
let guard = 0;
while (p.session.game.stage === 1) {
  assert(guard++ < 100);
  answer();
}
assert(p.needsCheckpoint);
assert.equal((await send('state')).session.game.answers, 0);
let payload = p.payload(),
  saved = await send(path, payload);
assert.deepEqual(saved.game, p.session.game);
p.accept(saved);
assert.equal((await send(path, payload)).revision, 2);
await send(path, { ...payload, actions: [] }, 409);
if (input.miss) {
  while (p.session.game.cursor < p.session.game.questions.length - 1) answer();
  const q = p.session.game.questions.at(-1);
  p.choose({ kind: 'judge', correct: q.word !== q.candidate });
  assert(p.session.game.practice.correction);
  assert(!p.needsCheckpoint);
  p.choose({ kind: 'acknowledge' });
  assert(p.session.game.needs_retry);
  p.choose({ kind: 'retry' });
  assert(p.session.game.questions.length <= 4);
}
while (p.session.game.stage !== 'done') {
  assert(guard++ < 150);
  answer();
}
assert(p.needsCheckpoint);
payload = p.payload();
saved = await send(path, payload);
assert.deepEqual(saved.game, p.session.game);
// Lost acknowledgement is replayed without duplicate memory or reward writes.
const again = await send(path, payload);
assert.equal(again.revision, 3);
p.accept(again);
console.log(
  JSON.stringify({ session_id: base.id, keys, state: await send('state') }),
);
