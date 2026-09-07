/** Shared, deterministic rules; the Worker owns and persists every transition. */
export type StudyWord = {
  key: string;
  word: string;
  meaning: string;
  example: string;
  example_zh: string;
  source_version: string;
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
  schema_version: 1;
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
};
export type GameAction =
  | { kind: 'match'; en: string; zh: string }
  | { kind: 'judge'; correct: boolean }
  | { kind: 'retry' };
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
export function newGame(words: StudyWord[], random = Math.random): StudyGame {
  if (
    !words.length ||
    words.length > 20 ||
    new Set(words.map((w) => w.key)).size !== words.length
  )
    throw new Error('本组单词不正确');
  return {
    schema_version: 1,
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
  random = Math.random,
): StudyGame {
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
};
