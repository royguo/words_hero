import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const compiled = (file) =>
  ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
const uri = (code) =>
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const gameURI = uri(compiled('../lib/student-game.ts'));
export const { newGame, replayActions } = await import(gameURI);
export const { StudentProgress } = await import(
  uri(
    compiled('../lib/student-progress.ts').replace(
      "'./student-game'",
      JSON.stringify(gameURI),
    ),
  )
);
export const words = ['farm', 'song', 'stamp', 'suit'].map((word, i) => ({
  key: word,
  word,
  meaning: '释义' + i,
  example: '',
  example_zh: '',
  source_version: 'v1',
}));
export function storageMock() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}
export function passRound(progress) {
  while (
    progress.session.game.stage !== 'done' &&
    !progress.session.game.needs_retry
  ) {
    const g = progress.session.game,
      stage = g.stage;
    if (stage === 1) {
      const key = g.en_order.find((k) => !g.removed.includes(k));
      progress.choose({ kind: 'match', en: key, zh: key });
    } else {
      const q = g.questions[g.cursor];
      progress.choose({ kind: 'judge', correct: q.word === q.candidate });
    }
    if (progress.session.game.stage !== stage) break;
  }
}
const server = () => ({
  id: 'test-session',
  revision: 1,
  game: newGame(words),
  completed_at: null,
});
void test('answers and failed rounds stay local; full stage replays identically on server', () => {
  const base = server(),
    storage = storageMock(),
    p = new StudentProgress('alice', base, () => storage);
  p.choose({ kind: 'match', en: 'farm', zh: 'song' });
  assert.equal(p.needsCheckpoint, false);
  passRound(p);
  assert.equal(p.session.game.needs_retry, true);
  assert.equal(p.needsCheckpoint, false);
  p.choose({ kind: 'retry' });
  passRound(p);
  assert.equal(p.needsCheckpoint, true);
  assert.equal(p.session.game.stage, 2);
  assert.equal(base.game.answers, 0);
  assert.deepEqual(
    replayActions(base.game, p.payload().actions),
    p.session.game,
  );
  const synced = { ...base, revision: 2, game: p.session.game };
  p.accept(synced);
  assert.equal(p.pending, null);
  assert.equal(p.needsCheckpoint, false);
  assert.deepEqual(
    new StudentProgress('alice', synced, () => storage).session,
    synced,
  );
});
void test('refresh restores answers before animation finishes; other students and revisions cannot reuse them', () => {
  const base = server(),
    storage = storageMock(),
    p = new StudentProgress('alice', base, () => storage);
  p.choose({ kind: 'match', en: 'farm', zh: 'song' });
  const resumed = new StudentProgress('alice', base, () => storage);
  assert.deepEqual(resumed.session, p.session);
  assert.deepEqual(resumed.payload(), p.payload());
  assert.equal(
    new StudentProgress('bob', base, () => storage).session.game.answers,
    0,
  );
  const updated = { ...base, revision: 2 };
  assert.deepEqual(
    new StudentProgress('alice', updated, () => storage).session,
    updated,
  );
});
void test('a lost response preserves the exact request; separate tabs do not reuse its ID for changed actions', () => {
  const base = server(),
    storage = storageMock(),
    p = new StudentProgress('alice', base, () => storage);
  p.choose({ kind: 'match', en: 'farm', zh: 'farm' });
  const tab = new StudentProgress('alice', base, () => storage);
  assert.deepEqual(tab.payload(), p.payload());
  tab.choose({ kind: 'match', en: 'song', zh: 'song' });
  assert.notEqual(tab.payload().request_id, p.payload().request_id);
  // The earlier tab must not erase the later tab's pending draft.
  p.accept({ ...base, revision: 2, game: p.session.game });
  assert.deepEqual(
    new StudentProgress('alice', base, () => storage).payload(),
    tab.payload(),
  );
});
void test('duel mistakes, retries, question order and final score survive one batch and refresh', () => {
  const base = server(),
    storage = storageMock(),
    p = new StudentProgress('alice', base, () => storage);
  passRound(p);
  const stage2 = { ...base, revision: 2, game: p.session.game };
  p.accept(stage2);
  const q = p.session.game.questions[0];
  p.choose({ kind: 'judge', correct: q.word !== q.candidate });
  passRound(p);
  p.choose({ kind: 'retry' });
  const restored = new StudentProgress('alice', stage2, () => storage);
  assert.deepEqual(restored.session.game, p.session.game);
  passRound(restored);
  assert.equal(restored.session.game.stage, 'done');
  assert.deepEqual(
    replayActions(stage2.game, restored.payload().actions),
    restored.session.game,
  );
  assert(restored.session.game.errors[q.word] > 0);
  assert.equal(restored.needsCheckpoint, true);
});
void test('invalid batches cannot partly advance a session and storage failure does not block answers', () => {
  const base = server();
  assert.throws(() => replayActions(base.game, []));
  assert.throws(() =>
    replayActions(base.game, [
      { kind: 'match', en: 'farm', zh: 'farm' },
      { kind: 'judge', correct: true },
    ]),
  );
  assert.equal(base.game.answers, 0);
  const p = new StudentProgress('alice', base, () => {
    throw new Error('disabled');
  });
  p.choose({ kind: 'match', en: 'farm', zh: 'song' });
  assert.equal(p.session.game.answers, 1);
  assert.equal(p.storageAvailable, false);
  assert.equal(p.payload().actions.length, 1);
});
void test('normal correction and targeted retries survive refresh with no checkpoint before phase completion', () => {
  const base = { ...server(), game: newGame(words, Math.random, 'practice') },
    storage = storageMock();
  let p = new StudentProgress('friendly', base, () => storage);
  p.choose({ kind: 'match', en: 'farm', zh: 'farm' });
  p.choose({ kind: 'match', en: 'song', zh: 'stamp' });
  const restored = new StudentProgress('friendly', base, () => storage);
  assert.deepEqual(restored.session, p.session);
  assert(!restored.needsCheckpoint);
  p = restored;
  p.choose({ kind: 'acknowledge' });
  passRound(p);
  assert(!p.needsCheckpoint);
  p.choose({ kind: 'retry' });
  assert.equal(p.session.game.en_order.length, 2);
  passRound(p);
  assert(p.needsCheckpoint);
  assert.deepEqual(
    replayActions(base.game, p.payload().actions),
    p.session.game,
  );
  const next = { ...p.session, revision: 2 };
  p.accept(next);
  const q = p.session.game.questions[0];
  p.choose({ kind: 'judge', correct: q.word !== q.candidate });
  p.choose({ kind: 'acknowledge' });
  passRound(p);
  if (p.session.game.needs_retry) {
    p.choose({ kind: 'retry' });
    passRound(p);
  }
  assert.equal(p.session.game.stage, 'done');
  assert.deepEqual(
    replayActions(next.game, p.payload().actions),
    p.session.game,
  );
  assert(p.needsCheckpoint);
});

void test('in-flight checkpoint stays immutable while answers continue, then only its prefix is acknowledged', () => {
  const base = server(),
    storage = storageMock(),
    p = new StudentProgress('async', base, () => storage);
  passRound(p);
  const first = p.beginCheckpoint();
  const stage2 = {
    ...base,
    revision: 2,
    game: replayActions(base.game, first.actions),
  };
  const q = p.session.game.questions[0];
  p.choose({ kind: 'judge', correct: q.word === q.candidate });
  assert.deepEqual(p.beginCheckpoint(), first);
  assert.deepEqual(p.payload(), first);
  const local = structuredClone(p.session.game);
  p.accept(stage2);
  assert.deepEqual(p.session.game, local);
  assert.equal(p.pending.actions.length, 1);
  assert.equal(p.pending.revision, 2);
  assert.notEqual(p.payload().request_id, first.request_id);
  assert.equal(p.needsCheckpoint, false);
  assert.deepEqual(
    new StudentProgress('async', stage2, () => storage).session.game,
    local,
  );
});
void test('refresh after a lost checkpoint reply rebases later local answers on the committed server state', () => {
  const base = server(),
    storage = storageMock(),
    p = new StudentProgress('lost', base, () => storage);
  passRound(p);
  const first = p.beginCheckpoint();
  const committed = {
    ...base,
    revision: 2,
    game: replayActions(base.game, first.actions),
  };
  passRound(p);
  assert.equal(p.session.game.stage, 'done');
  const beforeCommit = new StudentProgress('lost', base, () => storage);
  assert.deepEqual(beforeCommit.beginCheckpoint(), first);
  assert.equal(beforeCommit.session.game.stage, 'done');
  const restored = new StudentProgress('lost', committed, () => storage);
  assert.deepEqual(restored.session.game, p.session.game);
  assert.equal(restored.pending.revision, 2);
  assert(restored.needsCheckpoint);
  const second = restored.beginCheckpoint();
  assert.deepEqual(
    replayActions(committed.game, second.actions),
    p.session.game,
  );
  const done = {
    ...committed,
    revision: 3,
    game: p.session.game,
    completed_at: '2026-09-10T00:00:00.000Z',
  };
  restored.accept(done);
  assert.equal(restored.pending, null);
  assert.equal(restored.session.completed_at, done.completed_at);
});
void test('a different device state cannot acknowledge or overwrite a local answer tail', () => {
  const base = server(),
    storage = storageMock(),
    p = new StudentProgress('conflict', base, () => storage);
  p.choose({ kind: 'match', en: 'farm', zh: 'farm' });
  p.beginCheckpoint();
  const local = structuredClone(p.session);
  assert.throws(() =>
    p.accept({
      ...base,
      revision: 2,
      game: replayActions(base.game, [
        { kind: 'match', en: 'farm', zh: 'song' },
      ]),
    }),
  );
  assert.deepEqual(p.session, local);
  assert(p.pending);
});
