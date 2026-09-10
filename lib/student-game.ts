/** Shared rules: instant local feedback, with authoritative replay at checkpoints. */
export type StudyWord = {
  key: string;
  word: string;
  meaning: string;
  example: string;
  example_zh: string;
  source_version: string;
  image?: string;
  phonetic?: string;
};
export type DuelQuestion = {
  word: string;
  candidate: string;
  direction: 'en' | 'zh';
};
export type GameFeedback = {
  correct: boolean;
  keys: string[];
  kind: 'match' | 'judge' | 'answer' | 'defer';
};
export type StudySkill = 'meaning' | 'listening' | 'spelling';
export type RecallGrade = 'independent' | 'hinted' | 'wrong' | 'skipped';
export type SkillEvidence = {
  grade: RecallGrade;
  attempts: number;
  errors: number;
  hints: number;
};
export type WordEvidence = Partial<Record<StudySkill, SkillEvidence>>;
export type RecallTask = {
  word: string;
  skill: 'spelling' | 'listening';
  options: string[];
  retry: boolean;
};
export type AdaptivePractice = {
  warmup: string[];
  board: number;
  tasks: RecallTask[];
  cursor: number;
  hint: number;
  correction: boolean;
  deferred: string[];
  evidence: Record<string, WordEvidence>;
};
export type StudyGame = {
  schema_version: 1 | 2 | 3;
  words: StudyWord[];
  stage: 1 | 2 | 'done';
  round: number;
  round_errors: number;
  errors: Record<string, number>;
  removed: string[];
  en_order: string[];
  zh_order: string[];
  questions: DuelQuestion[];
  cursor: number;
  needs_retry: boolean;
  answers: number;
  feedback: GameFeedback | null;
  practice?: { passed: string[]; directions: string[]; correction: boolean };
  adaptive?: AdaptivePractice;
};
export type GameAction =
  | { kind: 'match'; en: string; zh: string }
  | { kind: 'judge'; correct: boolean }
  | { kind: 'retry' }
  | { kind: 'acknowledge' }
  | { kind: 'hint' }
  | { kind: 'answer'; answer: string }
  | { kind: 'defer' };
export function shuffled<T>(items: T[], random = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function duelQuestions(
  words: StudyWord[],
  random = Math.random,
): DuelQuestion[] {
  const keys = words.map((w) => w.key);
  // Every word appears in both directions. Each direction mixes true and false pairs.
  return shuffled(
    (['en', 'zh'] as const).flatMap((direction) =>
      shuffled(keys, random).map((key, i) => {
        const alternatives = words.filter(
          (w) =>
            w.key !== key &&
            w.meaning !== words.find((x) => x.key === key)!.meaning,
        );
        const candidate =
          i % 2 === 0 || !alternatives.length
            ? key
            : alternatives[Math.floor(random() * alternatives.length)].key;
        return { word: key, candidate, direction };
      }),
    ),
    random,
  );
}
export function newGame(
  words: StudyWord[],
  random = Math.random,
  mode: 'practice' | 'challenge' = 'challenge',
): StudyGame {
  if (
    !words.length ||
    words.length > 20 ||
    new Set(words.map((w) => w.key)).size !== words.length
  )
    throw new Error('本组单词不正确');
  return {
    schema_version: mode === 'practice' ? 2 : 1,
    ...(mode === 'practice'
      ? { practice: { passed: [], directions: [], correction: false } }
      : {}),
    words,
    stage: 1,
    round: 1,
    round_errors: 0,
    errors: {},
    removed: [],
    en_order: shuffled(
      words.map((w) => w.key),
      random,
    ),
    zh_order: shuffled(
      words.map((w) => w.key),
      random,
    ),
    questions: [],
    cursor: 0,
    needs_retry: false,
    answers: 0,
    feedback: null,
  };
}
export function advanceGame(
  current: StudyGame,
  action: GameAction,
  random = transitionRandom(current),
): StudyGame {
  if (current.schema_version === 3)
    return advanceAdaptive(current, action, random);
  if (current.schema_version === 2)
    return advancePractice(current, action, random);
  const game = structuredClone(current);
  if (game.stage === 'done') throw new Error('本组已完成');
  if (action.kind === 'retry') {
    if (!game.needs_retry) throw new Error('请先完成当前轮');
    game.round++;
    game.round_errors = 0;
    game.needs_retry = false;
    game.feedback = null;
    game.removed = [];
    game.cursor = 0;
    game.en_order = shuffled(
      game.words.map((w) => w.key),
      random,
    );
    game.zh_order = shuffled(
      game.words.map((w) => w.key),
      random,
    );
    if (game.stage === 2) game.questions = duelQuestions(game.words, random);
    return game;
  }
  if (game.needs_retry) throw new Error('请重新开始本阶段');
  let correct: boolean, keys: string[];
  if (game.stage === 1 && action.kind === 'match') {
    const available = (key: string) =>
      game.words.some((w) => w.key === key) && !game.removed.includes(key);
    if (!available(action.en) || !available(action.zh))
      throw new Error('这张卡片已经移除或不存在');
    correct = action.en === action.zh;
    keys = [...new Set([action.en, action.zh])];
    game.removed.push(...keys);
  } else if (
    game.stage === 2 &&
    action.kind === 'judge' &&
    typeof action.correct === 'boolean'
  ) {
    const question = game.questions[game.cursor];
    if (!question) throw new Error('题目不存在');
    correct = action.correct === (question.word === question.candidate);
    keys = [...new Set([question.word, question.candidate])];
    game.cursor++;
  } else throw new Error('当前阶段不支持这个操作');
  game.answers++;
  game.feedback = { correct, keys, kind: action.kind };
  if (!correct) {
    game.round_errors++;
    for (const key of keys) game.errors[key] = (game.errors[key] || 0) + 1;
  }
  const finished =
    game.stage === 1
      ? game.removed.length === game.words.length
      : game.cursor === game.questions.length;
  if (finished) {
    if (game.round_errors) game.needs_retry = true;
    else if (game.stage === 1) {
      game.stage = 2;
      game.round = 1;
      game.cursor = 0;
      game.questions = duelQuestions(game.words, random);
    } else game.stage = 'done';
  }
  return game;
}

/** Normal practice preserves successes. Only missing pairs/directions are retried. */
function advancePractice(
  current: StudyGame,
  action: GameAction,
  random: () => number,
): StudyGame {
  const game = structuredClone(current),
    p = game.practice!;
  if (game.stage === 'done') throw new Error('本组已完成');
  const settle = () => {
    const ended =
      game.stage === 1
        ? game.en_order.every((key) => game.removed.includes(key))
        : game.cursor === game.questions.length;
    if (!ended) return;
    if (game.stage === 1 && p.passed.length === game.words.length) {
      game.stage = 2;
      game.round = 1;
      game.round_errors = 0;
      game.cursor = 0;
      game.questions = duelQuestions(game.words, random);
    } else if (
      game.stage === 2 &&
      p.directions.length === game.words.length * 2
    )
      game.stage = 'done';
    else game.needs_retry = true;
  };
  if (action.kind === 'acknowledge') {
    if (!p.correction) throw new Error('没有待查看的纠错');
    p.correction = false;
    game.feedback = null;
    settle();
    return game;
  }
  if (p.correction) throw new Error('请先看清正确答案，再继续');
  if (action.kind === 'retry') {
    if (!game.needs_retry) throw new Error('请先完成当前轮');
    game.round++;
    game.round_errors = 0;
    game.needs_retry = false;
    game.feedback = null;
    game.removed = [];
    game.cursor = 0;
    if (game.stage === 1) {
      const remaining = game.words
        .filter((w) => !p.passed.includes(w.key))
        .map((w) => w.key);
      game.en_order = shuffled(remaining, random);
      game.zh_order = shuffled(remaining, random);
    } else
      game.questions = duelQuestions(game.words, random).filter(
        (q) => !p.directions.includes(q.direction + ':' + q.word),
      );
    return game;
  }
  if (game.needs_retry) throw new Error('请开始补练');
  let correct: boolean, keys: string[];
  if (game.stage === 1 && action.kind === 'match') {
    if (
      ![action.en, action.zh].every(
        (k) => game.en_order.includes(k) && !game.removed.includes(k),
      )
    )
      throw new Error('这张卡片已经移除或不存在');
    keys = [...new Set([action.en, action.zh])];
    correct = action.en === action.zh;
    game.removed.push(...keys);
    if (correct) p.passed.push(action.en);
  } else if (
    game.stage === 2 &&
    action.kind === 'judge' &&
    typeof action.correct === 'boolean'
  ) {
    const q = game.questions[game.cursor];
    if (!q) throw new Error('题目不存在');
    keys = [...new Set([q.word, q.candidate])];
    correct = action.correct === (q.word === q.candidate);
    if (correct) {
      const token = q.direction + ':' + q.word;
      if (!p.directions.includes(token)) p.directions.push(token);
    } else
      p.directions = p.directions.filter(
        (d) => !keys.some((k) => d === 'en:' + k || d === 'zh:' + k),
      );
    game.cursor++;
  } else throw new Error('当前阶段不支持这个操作');
  game.answers++;
  game.feedback = { correct, keys, kind: action.kind };
  if (!correct) {
    game.round_errors++;
    for (const key of keys) game.errors[key] = (game.errors[key] || 0) + 1;
    p.correction = true;
  } else settle();
  return game;
}

// Repeatable shuffles let the Worker replay a whole stage, including failed rounds,
// without accepting a client-supplied score or question list. Initial boards remain random.
function transitionRandom(game: StudyGame) {
  const input = JSON.stringify([
    game.en_order,
    game.zh_order,
    game.stage,
    game.round,
    game.answers,
  ]);
  let seed = 2166136261;
  for (let i = 0; i < input.length; i++)
    seed = Math.imul(seed ^ input.charCodeAt(i), 16777619);
  return () => {
    seed += 0x6d2b79f5;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export const MAX_BATCH_ACTIONS = 1000;
export function replayActions(current: StudyGame, actions: unknown): StudyGame {
  if (
    !Array.isArray(actions) ||
    !actions.length ||
    actions.length > MAX_BATCH_ACTIONS
  )
    throw new Error('练习操作数量不正确');
  return actions.reduce((game: StudyGame, action: unknown) => {
    if (!action || typeof action !== 'object' || Array.isArray(action))
      throw new Error('练习操作不正确');
    return advanceGame(game, action as GameAction);
  }, current);
}

// Configurable spacing inspired by spaced practice, not a universal scientific timetable.
export const REVIEW_MINUTES = [
  10, 1440, 4320, 10080, 20160, 43200, 86400,
] as const;
export type WordMemory = {
  step: number;
  due_at: string;
  reviews: number;
  lapses: number;
  last_reviewed: string;
  policy_version?: 2;
  relearning?: boolean;
  retained_recall?: boolean;
  skills?: Partial<
    Record<
      StudySkill,
      {
        reviews: number;
        independent: number;
        lapses: number;
        last_grade: RecallGrade;
        last_at: string;
      }
    >
  >;
};
export function scheduleReview(
  previous: WordMemory | undefined,
  errors: number,
  at: string,
  evidence?: WordEvidence,
  assessedAt = at,
): WordMemory {
  const early =
    previous && Date.parse(previous.due_at) > Date.parse(assessedAt);
  const supported = Object.values(evidence || {}).some(
    (e) => e.grade !== 'independent',
  );
  const step = errors
    ? 0
    : supported
      ? 0
      : !previous
        ? 0
        : early
          ? previous.step
          : previous.relearning
            ? 1
            : Math.min(REVIEW_MINUTES.length - 1, previous.step + 1);
  const due_at =
    !errors && !supported && early
      ? previous.due_at
      : new Date(
          Date.parse(at) +
            (errors ? 5 : supported ? 10 : REVIEW_MINUTES[step]) * 60000,
        ).toISOString();
  const skills = structuredClone(previous?.skills || {});
  for (const skill of ['meaning', 'listening', 'spelling'] as const) {
    const result = evidence?.[skill];
    if (!result) continue;
    const old = skills[skill];
    skills[skill] = {
      reviews: (old?.reviews || 0) + 1,
      independent:
        (old?.independent || 0) + Number(result.grade === 'independent'),
      lapses: (old?.lapses || 0) + result.errors,
      last_grade: result.grade,
      last_at: at,
    };
  }
  const delayedRecall =
    !early &&
    previous &&
    Date.parse(assessedAt) - Date.parse(previous.last_reviewed) >=
      7 * 86400000 &&
    evidence?.spelling?.grade === 'independent';
  return {
    step,
    due_at,
    reviews: (previous?.reviews || 0) + 1,
    lapses: (previous?.lapses || 0) + errors,
    last_reviewed: at,
    policy_version: 2,
    relearning: !!errors || supported || (!!early && !!previous?.relearning),
    retained_recall:
      !errors && !supported && (!!previous?.retained_recall || !!delayedRecall),
    skills,
  };
}
export type StudentSession = {
  id: string;
  revision: number;
  game: StudyGame;
  completed_at: string | null;
  earned?: { points: number; words: number };
};
export type StudentIdentity = {
  id: string;
  name: string;
  username: string;
  class_id: string;
  class_name: string;
};
export type StudentDashboard = {
  student: StudentIdentity;
  total: number;
  practiced: number;
  due: number;
  fresh: number;
  next_due: string | null;
  completed_groups: number;
  session: StudentSession | null;
  recent: { completed_at: string; words: number; errors: number }[];
  mastered: number;
  consolidating: number;
  points: PointsSummary;
};

export const MASTERY_STEP = 3;
export function memoryLevel(memory?: WordMemory) {
  return !memory
    ? 'fresh'
    : (
          memory.policy_version === 2
            ? memory.step >= 4 && memory.retained_recall && !memory.relearning
            : memory.step >= MASTERY_STEP
        )
      ? 'mastered'
      : memory.step >= 1
        ? 'consolidating'
        : 'learning';
}
/** Due first, then normalized overdue amount and weakness; early practice never advances spacing. */
export function compareMemory(
  a: WordMemory | undefined,
  b: WordMemory | undefined,
  at: string,
) {
  const stamp = Date.parse(at);
  const priority = (m?: WordMemory) =>
    !m ? 1 : Date.parse(m.due_at) <= stamp ? 0 : 2;
  const urgency = (m?: WordMemory) =>
    m
      ? Math.max(0, stamp - Date.parse(m.due_at)) /
          (REVIEW_MINUTES[m.step] * 60000) +
        (6 - m.step) * 0.2 +
        Math.min(m.lapses, 10) * 0.05
      : 0;
  return (
    priority(a) - priority(b) ||
    urgency(b) - urgency(a) ||
    (a && b ? a.due_at.localeCompare(b.due_at) : 0)
  );
}
export type PointsSummary = {
  balance: number;
  revision: number;
  earned_words: number;
  points_per_word: number;
};
export type PointsEntry = {
  id: string;
  kind: 'mastery' | 'bonus' | 'redeem' | 'adjustment';
  amount: number;
  reason: string;
  word_key: string | null;
  created_at: string;
};
export type WordReview = {
  session_id: string;
  created_at: string;
  errors: number;
  step_before: number | null;
  step_after: number;
  due_at: string;
  evidence?: WordEvidence;
};

export const skillLabels: Record<StudySkill, string> = {
  meaning: '词义',
  listening: '听音',
  spelling: '拼写回忆',
};
export const gradeLabels: Record<RecallGrade, string> = {
  independent: '独立答对',
  hinted: '提示后答对',
  wrong: '需要巩固',
  skipped: '稍后再练',
};
export function normalizeSpelling(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
/** A server-authored plan: at most five pairs on screen, then retrieval of weak skills. */
export function newAdaptiveGame(
  words: StudyWord[],
  memories: Map<string, WordMemory>,
  at: string,
  random = Math.random,
): StudyGame {
  const game = newGame(words, random, 'practice');
  const weak = (key: string, skill: StudySkill) => {
    const m = memories.get(key),
      result = m?.skills?.[skill];
    return !m || m.relearning || !result || result.last_grade !== 'independent';
  };
  const warmup = shuffled(
    words.filter((w) => weak(w.key, 'meaning')).map((w) => w.key),
    random,
  );
  const tasks: RecallTask[] = [];
  for (const w of shuffled(words, random)) {
    const m = memories.get(w.key);
    const checkRecall =
      weak(w.key, 'spelling') ||
      !m?.retained_recall ||
      Date.parse(at) - Date.parse(m.last_reviewed) >= 7 * 86400000 ||
      m.reviews % 3 === 0;
    const checkListening = words.length > 1 && weak(w.key, 'listening');
    if (checkRecall || !checkListening)
      tasks.push({ word: w.key, skill: 'spelling', options: [], retry: false });
    if (checkListening)
      tasks.push({
        word: w.key,
        skill: 'listening',
        retry: false,
        options: shuffled(
          [
            w.key,
            ...shuffled(
              words.filter((v) => v.key !== w.key).map((v) => v.key),
              random,
            ).slice(0, 3),
          ],
          random,
        ),
      });
  }
  game.schema_version = 3;
  delete game.practice;
  game.adaptive = {
    warmup,
    board: 0,
    tasks: shuffled(tasks, random),
    cursor: 0,
    hint: 0,
    correction: false,
    deferred: [],
    evidence: {},
  };
  game.stage = warmup.length ? 1 : 2;
  game.en_order = shuffled(warmup.slice(0, 5), random);
  game.zh_order = shuffled(warmup.slice(0, 5), random);
  return game;
}

export function currentRecall(game: StudyGame) {
  return game.stage === 2
    ? game.adaptive?.tasks[game.adaptive.cursor]
    : undefined;
}
export function hasCorrection(game: StudyGame) {
  return !!(game.practice?.correction || game.adaptive?.correction);
}
/** Recall prompts never speak the hidden answer. Listening prompts deliberately use audio only. */
export function studentVoiceTexts(game: StudyGame) {
  if (hasCorrection(game))
    return (game.feedback?.keys || []).map(
      (key) => game.words.find((w) => w.key === key)!.word,
    );
  if (game.needs_retry) return [];
  if (game.stage === 'done') return game.words.map((w) => w.word);
  if (game.stage === 1)
    return game.en_order
      .filter((key) => !game.removed.includes(key))
      .map((key) => game.words.find((w) => w.key === key)!.word);
  const recall = currentRecall(game);
  if (recall)
    return recall.skill === 'listening'
      ? [game.words.find((w) => w.key === recall.word)!.word]
      : [];
  const q = game.questions[game.cursor];
  return q
    ? [
        game.words.find(
          (w) => w.key === (q.direction === 'en' ? q.word : q.candidate),
        )!.word,
      ]
    : [];
}

function advanceAdaptive(
  current: StudyGame,
  action: GameAction,
  random: () => number,
): StudyGame {
  const game = structuredClone(current),
    a = game.adaptive!;
  if (game.stage === 'done') throw new Error('本组已完成');
  const settle = () => {
    if (
      game.stage === 1 &&
      game.en_order.every((key) => game.removed.includes(key))
    ) {
      a.board++;
      const board = a.warmup.slice(a.board * 5, a.board * 5 + 5);
      game.en_order = shuffled(board, random);
      game.zh_order = shuffled(board, random);
      game.removed = [];
      if (!board.length) game.stage = 2;
    } else if (game.stage === 2 && a.cursor >= a.tasks.length)
      game.stage = 'done';
  };
  const record = (
    key: string,
    skill: StudySkill,
    grade: RecallGrade,
    hints = 0,
  ) => {
    const previous = (a.evidence[key] ||= {})[skill];
    const severity = { independent: 0, hinted: 1, wrong: 2, skipped: 3 };
    a.evidence[key][skill] = {
      grade:
        previous && severity[previous.grade] > severity[grade]
          ? previous.grade
          : grade,
      attempts: (previous?.attempts || 0) + 1,
      errors:
        (previous?.errors || 0) +
        Number(grade === 'wrong' || grade === 'skipped'),
      hints: (previous?.hints || 0) + hints,
    };
    if (grade === 'wrong' || grade === 'skipped')
      game.errors[key] = (game.errors[key] || 0) + 1;
  };
  if (action.kind === 'acknowledge') {
    if (!a.correction) throw new Error('没有待查看的纠错');
    a.correction = false;
    game.feedback = null;
    settle();
    return game;
  }
  if (a.correction) throw new Error('请先看清正确答案，再继续');
  if (game.stage === 1 && action.kind === 'match') {
    if (
      ![action.en, action.zh].every(
        (key) => game.en_order.includes(key) && !game.removed.includes(key),
      )
    )
      throw new Error('这张卡片已经移除或不存在');
    const keys = [...new Set([action.en, action.zh])],
      correct = action.en === action.zh;
    for (const key of keys)
      record(key, 'meaning', correct ? 'independent' : 'wrong');
    game.removed.push(...keys);
    game.feedback = { correct, keys, kind: 'match' };
    game.answers++;
    if (correct) settle();
    else {
      a.correction = true;
      game.round_errors++;
    }
    return game;
  }
  const task = currentRecall(game);
  if (!task) throw new Error('当前阶段不支持这个操作');
  if (action.kind === 'hint') {
    if (task.skill !== 'spelling' || a.hint >= 2)
      throw new Error('没有更多提示');
    a.hint++;
    game.feedback = null;
    return game;
  }
  if (action.kind !== 'answer' && action.kind !== 'defer')
    throw new Error('请选择或填写答案');
  if (
    action.kind === 'answer' &&
    (typeof action.answer !== 'string' ||
      action.answer.length > 160 ||
      !action.answer.trim())
  )
    throw new Error('请先填写答案');
  if (
    action.kind === 'answer' &&
    task.skill === 'listening' &&
    !task.options.includes(action.answer)
  )
    throw new Error('请选择本题中的答案');
  const word = game.words.find((w) => w.key === task.word)!;
  const correct =
    action.kind === 'answer' &&
    (task.skill === 'spelling'
      ? normalizeSpelling(action.answer) === normalizeSpelling(word.word)
      : action.answer === task.word);
  record(
    task.word,
    task.skill,
    action.kind === 'defer'
      ? 'skipped'
      : !correct
        ? 'wrong'
        : a.hint
          ? 'hinted'
          : 'independent',
    a.hint,
  );
  game.answers++;
  game.feedback = { correct, keys: [task.word], kind: action.kind };
  a.cursor++;
  a.hint = 0;
  if (!correct) {
    a.correction = true;
    game.round_errors++;
    // Interleave with other prompts. At most one retry; never trap a child in an endless loop.
    if (!task.retry && action.kind !== 'defer') {
      a.tasks.splice(Math.min(a.cursor + 3, a.tasks.length), 0, {
        ...task,
        retry: true,
      });
    } else if (!a.deferred.includes(task.word)) a.deferred.push(task.word);
  } else settle();
  return game;
}
