import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(
  readFileSync(new URL('../lib/student-game.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { newGame, advanceGame, scheduleReview, duelQuestions } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
);
const words = ['farm', 'song', 'stamp', 'suit'].map((word, i) => ({
  key: word,
  word,
  meaning: '释义' + i,
  example: '',
  example_zh: '',
  source_version: 'v1',
}));
function passMatches(game) {
  for (const w of game.words)
    if (!game.removed.includes(w.key))
      game = advanceGame(game, { kind: 'match', en: w.key, zh: w.key });
  return game;
}
function passDuel(game) {
  while (game.stage === 2 && !game.needs_retry) {
    const q = game.questions[game.cursor];
    game = advanceGame(game, {
      kind: 'judge',
      correct: q.word === q.candidate,
    });
  }
  return game;
}
void test('a mismatch removes both complete word pairs and counts both mistakes', () => {
  const original = newGame(words);
  const g = advanceGame(original, { kind: 'match', en: 'farm', zh: 'song' });
  assert.deepEqual(g.removed, ['farm', 'song']);
  assert.deepEqual(g.errors, { farm: 1, song: 1 });
  assert.equal(g.round_errors, 1);
  assert.deepEqual(original.removed, []);
  assert.throws(() =>
    advanceGame(g, { kind: 'match', en: 'farm', zh: 'stamp' }),
  );
  const ended = passMatches(g);
  assert.equal(ended.stage, 1);
  assert.equal(ended.needs_retry, true);
  assert.throws(() => advanceGame(ended, { kind: 'judge', correct: true }));
  const retry = advanceGame(ended, { kind: 'retry' });
  assert.equal(retry.round, 2);
  assert.equal(retry.removed.length, 0);
  assert.equal(retry.words.length, 4);
  assert.deepEqual(retry.errors, { farm: 1, song: 1 });
  assert.equal(passMatches(retry).stage, 2);
});
void test('duel contains every word in both directions and mixes corresponding/noncorresponding pairs', () => {
  const questions = duelQuestions(words);
  assert.equal(questions.length, 8);
  for (const direction of ['en', 'zh']) {
    const qs = questions.filter((q) => q.direction === direction);
    assert.deepEqual(
      qs.map((q) => q.word).sort(),
      words.map((w) => w.key).sort(),
    );
    assert(qs.some((q) => q.word === q.candidate));
    assert(qs.some((q) => q.word !== q.candidate));
  }
});
void test('a mistaken judgment counts the two involved words; the rest of the round must still be completed', () => {
  let g = passMatches(newGame(words));
  while (g.questions[g.cursor].word === g.questions[g.cursor].candidate)
    g = advanceGame(g, { kind: 'judge', correct: true });
  const q = g.questions[g.cursor];
  g = advanceGame(g, { kind: 'judge', correct: true });
  assert.equal(g.errors[q.word], 1);
  assert.equal(g.errors[q.candidate], 1);
  if (!g.needs_retry) assert.throws(() => advanceGame(g, { kind: 'retry' }));
  g = passDuel(g);
  assert.equal(g.stage, 2);
  assert.equal(g.needs_retry, true);
  g = advanceGame(g, { kind: 'retry' });
  assert.equal(g.round, 2);
  assert.equal(g.cursor, 0);
  assert.equal(g.questions.length, 8);
  g = passDuel(g);
  assert.equal(g.stage, 'done');
  assert.equal(Object.keys(g.errors).length, 2);
  assert.throws(() => advanceGame(g, { kind: 'retry' }));
});
void test('one remaining eligible word is a valid two-direction group', () => {
  const g = passMatches(newGame(words.slice(0, 1)));
  assert.equal(g.questions.length, 2);
  assert(g.questions.every((q) => q.word === q.candidate));
  assert.equal(passDuel(g).stage, 'done');
});
void test('an early extra group never advances the review interval, while errors bring review forward', () => {
  const at = '2026-09-08T00:00:00.000Z';
  const first = scheduleReview(undefined, 0, at);
  assert.equal(first.due_at, '2026-09-08T00:10:00.000Z');
  const extra = scheduleReview(first, 0, '2026-09-08T00:02:00.000Z');
  assert.equal(extra.step, 0);
  assert.equal(extra.due_at, first.due_at);
  assert.equal(extra.reviews, 2);
  const next = scheduleReview(extra, 0, first.due_at);
  assert.equal(next.step, 1);
  assert.equal(next.due_at, '2026-09-09T00:10:00.000Z');
  const miss = scheduleReview(next, 2, '2026-09-08T00:12:00.000Z');
  assert.equal(miss.step, 0);
  assert.equal(miss.due_at, '2026-09-08T00:17:00.000Z');
  assert.equal(miss.lapses, 2);
});
void test('remembered intervals are bounded and stable across serialized history', () => {
  let memory;
  let at = '2026-09-08T00:00:00.000Z';
  for (let i = 0; i < 12; i++) {
    memory = scheduleReview(memory, 0, at);
    memory = JSON.parse(JSON.stringify(memory));
    at = memory.due_at;
  }
  assert.equal(memory.step, 6);
  assert.equal(memory.reviews, 12);
  assert.equal(memory.lapses, 0);
});
