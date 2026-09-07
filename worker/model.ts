import type { Lesson, Word, Group, Config } from '../lib/classroom';
export type { Word, Group };
export type Question = {
  id: string;
  word_id: number;
  prompt: string;
  hint: string;
  answer: string;
};
export type WorksheetPlan = {
  schema_version: 2;
  copying: Component[];
  components: Component[];
  connections: Question[];
  sentences: Question[];
};
export type Component = {
  word: string;
  kind: string;
  meaning: string;
  example?: string;
};
export type Course = Omit<Lesson, 'versions' | 'attempts' | 'config'> & {
  config: Config & {
    root_groups?: Group[];
    worksheets?: WorksheetPlan;
    worksheet_order?: Record<string, number[]>;
    [key: string]: unknown;
  };
  versions?: Lesson['versions'];
  attempts?: Lesson['attempts'];
};
export type Classroom = {
  id: string;
  name: string;
  created_at: string;
  revision: number;
  deleted_at: string | null;
};
export type LessonRow = {
  id: string;
  class_id: string;
  number: number;
  title: string;
  created_at: string;
  active_version: string;
  deleted_at: string | null;
};
export type Draft = {
  id: string;
  class_id: string;
  lesson_id: string | null;
  base_version_id: string | null;
  config: Config;
  words: Word[];
  title: string;
  revision: number;
  created_at: string;
  updated_at: string;
  committed_version: string | null;
};
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const uid = () => crypto.randomUUID().replaceAll('-', '');
export const now = () => new Date().toISOString();
export const normalize = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ');
export function integer(v: unknown, min: number, max: number, label: string) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
    throw new AppError(label + '不正确');
  return v;
}
export function string(
  v: unknown,
  max: number,
  label: string,
  allowEmpty = false,
) {
  if (typeof v !== 'string' || v.length > max || (!allowEmpty && !v.trim()))
    throw new AppError(label + '不正确');
  return v.trim();
}
export const levels = ['KET', 'PET', 'CET-4', 'CET-6'];
export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const n = new Uint32Array(1);
    crypto.getRandomValues(n);
    const j = n[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function rootGroups(words: Word[]): Group[] {
  const groups = new Map<string, Group>();
  for (const w of words)
    for (const p of w.parts || []) {
      const k = [p.text, p.kind, p.meaning].join(':');
      let g = groups.get(k);
      if (!g) {
        g = { ...p, id: 'group-' + groups.size, words: [] };
        groups.set(k, g);
      }
      if (!g.words.some((x) => x.word === w.word))
        g.words.push({
          word: w.word,
          display_word: w.display_word,
          meaning_zh: w.meaning_zh,
        });
    }
  return [...groups.values()];
}
