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
const {
  newAdaptiveGame,
  advanceGame,
  replayActions,
  currentRecall,
  studentVoiceTexts,
  scheduleReview,
  memoryLevel,
} = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
);
const words = [
  'farm',
  'song',
  'stamp',
  'suit',
  'bag',
  'cat',
  'fox',
  'box',
  'egg',
  'sun',
].map((word) => ({
  key: word,
  word,
  meaning: '释义' + word,
  source_version: 'v1',
  example: '',
  example_zh: '',
}));
const at = '2026-09-10T00:00:00.000Z';
const evidence = (grade = 'independent') => ({
  spelling: {
    grade,
    attempts: 1,
    errors: grade === 'wrong' ? 1 : 0,
    hints: grade === 'hinted' ? 1 : 0,
  },
});
function solve(g) {
  if (g.adaptive.correction) return { kind: 'acknowledge' };
  if (g.stage === 1) {
    const key = g.en_order.find((k) => !g.removed.includes(k));
    return { kind: 'match', en: key, zh: key };
  }
  const q = currentRecall(g);
  return {
    kind: 'answer',
    answer:
      q.skill === 'spelling'
        ? g.words.find((w) => w.key === q.word).word
        : q.word,
  };
}
const warmup = (g) => {
  while (g.stage === 1) g = advanceGame(g, solve(g));
  return g;
};
void test('fresh ten-word task uses five-pair screens and deterministic local/server replay', () => {
  const initial = newAdaptiveGame(words, new Map(), at);
  let g = initial;
  const actions = [];
  while (g.stage !== 'done') {
    assert(g.en_order.length <= 5);
    assert(actions.length < 100);
    const action = solve(g);
    actions.push(action);
    g = advanceGame(g, action);
  }
  assert.deepEqual(replayActions(initial, actions), g);
  for (const word of words) {
    assert.equal(g.adaptive.evidence[word.key].spelling.grade, 'independent');
    assert.equal(g.adaptive.evidence[word.key].listening.grade, 'independent');
  }
});
void test('a known spelling with weak listening gets listening only, while another student gets warmup', () => {
  const skill = {
    reviews: 4,
    independent: 4,
    lapses: 0,
    last_grade: 'independent',
    last_at: at,
  };
  const m = {
    step: 4,
    due_at: at,
    reviews: 4,
    lapses: 0,
    last_reviewed: '2026-09-09T00:00:00.000Z',
    retained_recall: true,
    skills: {
      meaning: skill,
      spelling: skill,
      listening: { ...skill, last_grade: 'wrong' },
    },
  };
  const g = newAdaptiveGame(words, new Map(words.map((w) => [w.key, m])), at);
  assert.equal(g.stage, 2);
  assert.equal(g.adaptive.tasks.length, words.length);
  assert(g.adaptive.tasks.every((t) => t.skill === 'listening'));
  assert.equal(newAdaptiveGame(words, new Map(), at).stage, 1);
});
void test('spelling prompts and hints never auto-read the answer; one-word groups still test recall', () => {
  let g = warmup(newAdaptiveGame(words.slice(0, 1), new Map(), at));
  assert.equal(currentRecall(g).skill, 'spelling');
  assert.deepEqual(studentVoiceTexts(g), []);
  g = advanceGame(g, { kind: 'hint' });
  g = advanceGame(g, { kind: 'hint' });
  assert.deepEqual(studentVoiceTexts(g), []);
  assert.throws(() => advanceGame(g, { kind: 'hint' }));
  g = advanceGame(g, { kind: 'answer', answer: ' FARM ' });
  assert.equal(g.stage, 'done');
  assert.equal(g.adaptive.evidence.farm.spelling.grade, 'hinted');
  assert.equal(g.adaptive.evidence.farm.spelling.hints, 2);
});
void test('wrong answers retain correction, interleave a retry, and cannot erase the first mistake', () => {
  let g = warmup(newAdaptiveGame(words, new Map(), at));
  const q = currentRecall(g);
  const wrong =
    q.skill === 'spelling'
      ? 'wrong answer'
      : q.options.find((w) => w !== q.word);
  g = advanceGame(g, { kind: 'answer', answer: wrong });
  assert(g.adaptive.correction);
  assert.deepEqual(studentVoiceTexts(g), [
    words.find((w) => w.key === q.word).word,
  ]);
  assert.throws(() => advanceGame(g, { kind: 'answer', answer: q.word }));
  assert.equal(g.adaptive.tasks[4].word, q.word);
  assert(g.adaptive.tasks[4].retry);
  while (g.stage !== 'done') g = advanceGame(g, solve(g));
  assert.equal(g.adaptive.evidence[q.word][q.skill].grade, 'wrong');
  assert.equal(g.errors[q.word], 1);
});
void test('two failed attempts or defer can finish a task without falsely passing the word', () => {
  let g = warmup(newAdaptiveGame(words.slice(0, 1), new Map(), at));
  for (let i = 0; i < 2; i++) {
    g = advanceGame(g, { kind: 'answer', answer: 'no' });
    assert(g.adaptive.correction);
    g = advanceGame(g, { kind: 'acknowledge' });
  }
  assert.equal(g.stage, 'done');
  assert.deepEqual(g.adaptive.deferred, ['farm']);
  assert.equal(g.errors.farm, 2);
  let skipped = warmup(newAdaptiveGame(words.slice(0, 1), new Map(), at));
  skipped = advanceGame(skipped, { kind: 'defer' });
  skipped = advanceGame(skipped, { kind: 'acknowledge' });
  assert.equal(skipped.stage, 'done');
  assert.equal(skipped.adaptive.evidence.farm.spelling.grade, 'skipped');
});
void test('a forgotten sixty-day word must rebuild its interval after five-minute correction', () => {
  const old = {
    step: 6,
    due_at: at,
    reviews: 15,
    lapses: 0,
    last_reviewed: '2026-07-12T00:00:00.000Z',
  };
  const missed = scheduleReview(old, 1, at, evidence('wrong'));
  assert(missed.relearning);
  assert.equal(missed.due_at, '2026-09-10T00:05:00.000Z');
  const corrected = scheduleReview(missed, 0, missed.due_at, evidence());
  assert.equal(corrected.due_at, '2026-09-11T00:05:00.000Z');
  assert.equal(memoryLevel(corrected), 'consolidating');
  assert(!corrected.retained_recall);
});
void test('mastery needs a real seven-day gap plus unhinted recall, not a future seven-day appointment', () => {
  let m = scheduleReview(undefined, 0, at, evidence());
  for (let i = 0; i < 3; i++) m = scheduleReview(m, 0, m.due_at, evidence());
  assert.equal(m.step, 3);
  assert.equal(memoryLevel(m), 'consolidating');
  const mastered = scheduleReview(m, 0, m.due_at, evidence());
  assert.equal(memoryLevel(mastered), 'mastered');
  assert.equal(
    memoryLevel(scheduleReview(m, 0, m.due_at, evidence('hinted'))),
    'learning',
  );
  assert.equal(memoryLevel(scheduleReview(m, 0, m.due_at)), 'consolidating');
});
void test('early practice or delayed upload cannot manufacture long-term recall evidence', () => {
  const m = {
    step: 3,
    due_at: '2026-09-17T00:00:00.000Z',
    reviews: 4,
    lapses: 0,
    last_reviewed: at,
  };
  const uploaded = scheduleReview(
    m,
    0,
    '2026-09-20T00:00:00.000Z',
    evidence(),
    at,
  );
  assert.equal(uploaded.step, 3);
  assert.equal(uploaded.due_at, m.due_at);
  assert(!uploaded.retained_recall);
  const early = scheduleReview(m, 0, at, evidence());
  assert.equal(early.due_at, m.due_at);
});
