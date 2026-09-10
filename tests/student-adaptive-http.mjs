// Exercise authoritative adaptive grading and delayed checkpoint acknowledgements on local D1 only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const input = JSON.parse(readFileSync(0, 'utf8'));
assert.equal(new URL(input.base).hostname, '127.0.0.1');
const uri = (s) =>
  'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
const compile = (file) =>
  ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
const gameURI = uri(compile('../lib/student-game.ts'));
const { currentRecall } = await import(gameURI);
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
    mode: 'adaptive',
    extra: true,
    count: input.count || 10,
  })
).session;
assert.equal(base.game.schema_version, 3);
let p = new StudentProgress(input.studentId, base, () => storage),
  missed = null,
  writes = 0;
const path = 'sessions/' + base.id + '/actions';
function answer() {
  const g = p.session.game;
  if (g.adaptive.correction) p.choose({ kind: 'acknowledge' });
  else if (g.stage === 1) {
    const key = g.en_order.find((k) => !g.removed.includes(k));
    p.choose({ kind: 'match', en: key, zh: key });
  } else {
    const q = currentRecall(g);
    if (input.miss && !missed && q.skill === 'spelling') {
      missed = q.word;
      p.choose({ kind: 'answer', answer: 'not-the-answer' });
    } else
      p.choose({
        kind: 'answer',
        answer:
          q.skill === 'spelling'
            ? g.words.find((w) => w.key === q.word).word
            : q.word,
      });
  }
}
let guard = 0;
while (p.session.game.stage === 1) {
  assert(guard++ < 100);
  answer();
}
if (p.pending) {
  const payload = p.beginCheckpoint();
  const request = send(path, payload);
  answer(); // The next answer happens before awaiting the previous phase's database update.
  const local = structuredClone(p.session.game);
  const saved = await request;
  writes++;
  assert.equal(saved.game.adaptive.cursor, 0);
  assert.equal(p.pending.actions.length, payload.actions.length + 1);
  // Simulate refresh after the server committed but its acknowledgement was lost.
  p = new StudentProgress(input.studentId, saved, () => storage);
  assert.deepEqual(p.session.game, local);
  assert.deepEqual((await send(path, payload)).game, saved.game);
  await send(path, { ...payload, actions: [] }, 409);
}
while (p.session.game.stage !== 'done') {
  assert(guard++ < 160);
  answer();
}
const payload = p.beginCheckpoint();
const saved = await send(path, payload);
writes++;
assert.deepEqual(saved.game, p.session.game);
const again = await send(path, payload);
assert.equal(again.revision, saved.revision);
p.accept(again);
assert.equal(p.pending, null);
const keys = base.game.words.map((w) => w.key);
if (missed)
  keys.splice(0, keys.length, missed, ...keys.filter((k) => k !== missed));
const history = await send('memory?word=' + encodeURIComponent(keys[0]));
assert(
  history.reviews[0].evidence.spelling || history.reviews[0].evidence.listening,
);
if (missed) assert.equal(history.reviews[0].evidence.spelling.grade, 'wrong');
console.log(
  JSON.stringify({
    session_id: base.id,
    keys,
    writes,
    state: await send('state'),
  }),
);
