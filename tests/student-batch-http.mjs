// Invoked by the isolated Wrangler acceptance runner; never targets production.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const input = JSON.parse(readFileSync(0, 'utf8'));
assert.equal(new URL(input.base).hostname, '127.0.0.1');
const uri = (code) =>
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const compiled = (file) =>
  ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
const gameURI = uri(compiled('../lib/student-game.ts'));
const { StudentProgress } = await import(
  uri(
    compiled('../lib/student-progress.ts').replace(
      "'./student-game'",
      JSON.stringify(gameURI),
    ),
  )
);
const data = new Map();
const storage = {
  getItem: (key) => data.get(key) ?? null,
  setItem: (key, value) => data.set(key, value),
  removeItem: (key) => data.delete(key),
};
async function send(path, payload, status = 200) {
  const response = await fetch(input.base + '/api/student/' + path, {
    method: payload ? 'POST' : 'GET',
    headers: { Cookie: input.cookie, 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  return result;
}
function passRound(p) {
  const stage = p.session.game.stage;
  while (p.session.game.stage === stage && !p.session.game.needs_retry) {
    const g = p.session.game;
    if (stage === 1) {
      const key = g.en_order.find((k) => !g.removed.includes(k));
      p.choose({ kind: 'match', en: key, zh: key });
    } else {
      const q = g.questions[g.cursor];
      p.choose({ kind: 'judge', correct: q.word === q.candidate });
    }
  }
}
const initial = (await send('sessions', {})).session;
const p = new StudentProgress(input.studentId, initial, () => storage);
const [a, b] = p.session.game.words.map((w) => w.key);
p.choose({ kind: 'match', en: a, zh: b });
passRound(p);
assert.equal(p.needsCheckpoint, false);
p.choose({ kind: 'retry' });
passRound(p);
assert.equal(p.needsCheckpoint, true);
const before = await send('state');
assert.equal(before.session.revision, 1);
assert.equal(before.session.game.answers, 0);
const path = 'sessions/' + initial.id + '/actions';
const phase1 = p.payload();
const saved1 = await send(path, phase1);
assert.equal(saved1.revision, 2);
assert.deepEqual(saved1.game, p.session.game);
assert.equal((await send('state')).practiced, 0);
// An identical retry is harmless; reusing its ID with changed actions is rejected.
assert.equal((await send(path, phase1)).revision, 2);
await send(path, { ...phase1, actions: phase1.actions.slice(1) }, 409);
await send(path, { ...phase1, request_id: crypto.randomUUID() }, 409);
p.accept(saved1);
const phase2Base = p.session;
const invalid = {
  revision: 2,
  request_id: crypto.randomUUID(),
  actions: [
    { kind: 'judge', correct: true },
    { kind: 'match', en: a, zh: a },
  ],
};
await send(path, invalid, 400);
assert.deepEqual((await send('state')).session.game, phase2Base.game);
// Stage 2 retries are shuffled identically by browser and Worker.
while (
  p.session.game.questions[p.session.game.cursor].word ===
  p.session.game.questions[p.session.game.cursor].candidate
)
  p.choose({ kind: 'judge', correct: true });
p.choose({ kind: 'judge', correct: true });
passRound(p);
assert.equal(p.needsCheckpoint, false);
p.choose({ kind: 'retry' });
passRound(p);
assert.equal(p.session.game.stage, 'done');
const phase2 = p.payload();
const saved2 = await send(path, phase2);
assert.equal(saved2.revision, 3);
assert.deepEqual(saved2.game, p.session.game);
// Simulate losing the acknowledgement, then recovering the exact request after refresh.
const restored = new StudentProgress(
  input.studentId,
  phase2Base,
  () => storage,
);
assert.deepEqual(restored.payload(), phase2);
restored.accept(await send(path, restored.payload()));
assert.equal(restored.pending, null);
const finished = await send('state');
assert.equal(finished.completed_groups, 1);
assert.equal(finished.practiced, 10);
assert.equal(finished.recent[0].errors, 4);
// A deliberate return midway can checkpoint a partial stage without marking completion.
const extra = (await send('sessions', { extra: true })).session;
const partial = new StudentProgress(input.studentId, extra, () => storage);
const key = extra.game.words[0].key;
partial.choose({ kind: 'match', en: key, zh: key });
const paused = await send(
  'sessions/' + extra.id + '/actions',
  partial.payload(),
);
assert.equal(paused.game.answers, 1);
assert.equal(paused.game.stage, 1);
assert.equal((await send('state')).completed_groups, 1);
console.log(JSON.stringify({ session_id: initial.id }));
