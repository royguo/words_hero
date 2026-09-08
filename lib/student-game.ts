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
  kind: 'match' | 'judge';
};
export type StudyGame = {
  schema_version: 1 | 2;
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
};
export type GameAction =
  | { kind: 'match'; en: string; zh: string }
  | { kind: 'judge'; correct: boolean }
  | { kind: 'retry' }
  | { kind: 'acknowledge' };
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
};
export function scheduleReview(
  previous: WordMemory | undefined,
  errors: number,
  at: string,
): WordMemory {
  const early = previous && Date.parse(previous.due_at) > Date.parse(at);
  const step = errors
    ? Math.max(0, (previous?.step || 0) - 1)
    : !previous
      ? 0
      : early
        ? previous.step
        : Math.min(REVIEW_MINUTES.length - 1, previous.step + 1);
  const due_at =
    !errors && early
      ? previous.due_at
      : new Date(
          Date.parse(at) + (errors ? 5 : REVIEW_MINUTES[step]) * 60000,
        ).toISOString();
  return {
    step,
    due_at,
    reviews: (previous?.reviews || 0) + 1,
    lapses: (previous?.lapses || 0) + errors,
    last_reviewed: at,
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
    : memory.step >= MASTERY_STEP
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
};
