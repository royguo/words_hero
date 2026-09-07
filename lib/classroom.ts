import type { WordStudy } from './word-study';
export type Part = {
  text: string;
  kind: string;
  meaning: string;
  story?: string;
  source?: string;
};
export type TeachingImage = {
  id: string;
  src: string;
  sha256: string;
  alt: string;
  caption: string;
};
export type StoryScene = {
  id: string;
  title: string;
  en: string;
  zh: string;
  image?: TeachingImage | null;
  question: { en: string; zh: string; answer_en: string; answer_zh: string };
};
export type LessonMaterials = {
  bundle_id?: string;
  bundle_digest?: string;
  story?: {
    title_en: string;
    title_zh: string;
    level: string;
    covered_words: string[];
    scenes: StoryScene[];
  };
};
export type Word = {
  id: number;
  word: string;
  display_word?: string;
  level: string;
  difficulty: number;
  meaning_zh: string;
  pos: string;
  topic: string;
  example: string;
  example_zh: string;
  story_title: string;
  story_zh: string;
  teacher_prompt: string;
  student_prompt?: string;
  extra_examples?: { en: string; zh: string }[];
  cloze: string;
  cloze_answer: string;
  cloze_zh: string;
  cloze_type: 'context' | 'headword';
  materials_version: string;
  parts: Part[];
  word_study?: WordStudy;
  note: string;
  is_basic: boolean;
  phonetic?: string;
  result: 'remembered' | 'again' | null;
  accepted: string[];
  seen?: boolean;
  reserved?: boolean;
  asset_id?: string;
  images?: TeachingImage[];
};
export type Group = Part & {
  id: string;
  words: { word: string; display_word?: string; meaning_zh: string }[];
};
export type Config = {
  level: string;
  count: number;
  difficulty_min: number;
  difficulty_max: number;
  exclude_basic: boolean;
  exclude_seen: boolean;
  mode: string;
  presentation_slide?: string;
  requested_count?: number;
  new_count?: number;
  review_count?: number;
};
export type Attempt = {
  id: string;
  created_at: string;
  correct: number;
  total: number;
  data: { id: number; word: string; answer: string; correct: boolean }[];
};
export type SelectionDraft = {
  id: string;
  class_id: string;
  lesson_id: string | null;
  title: string;
  config: Config;
  words: Word[];
  revision: number;
};
export type Lesson = {
  id: string;
  class_id: string;
  class_name: string;
  number: number;
  title: string;
  level: string;
  version_id: string;
  version_number: number;
  course_code: string;
  materials: LessonMaterials;
  status: string;
  is_current: boolean;
  read_only: boolean;
  created_at: string;
  completed_at: string | null;
  stage: string;
  cursor: number;
  notes: string;
  config: Config;
  draft: Record<string, string>;
  words: Word[];
  groups: Group[];
  attempts: Attempt[];
  versions: {
    id: string;
    number: number;
    created_at: string;
    status: string;
  }[];
};
export type State = {
  classes: {
    id: string;
    name: string;
    lesson_count: number;
    learned: number;
  }[];
  levels: { id: string; total: number }[];
  lessons: {
    id: string;
    title: string;
    number: number;
    status: string;
    level: string;
    word_count: number;
    remembered: number;
    version_count: number;
    active_version: string;
  }[];
  learned: number;
  due: number;
  database: string;
};
export const defaults: Config = {
  level: 'KET',
  count: 10,
  difficulty_min: 1,
  difficulty_max: 3,
  exclude_basic: true,
  exclude_seen: true,
  mode: 'new',
};
export const bands: Record<number, string> = {
  1: '基础',
  2: '进阶',
  3: '挑战',
};
export const kinds: Record<string, string> = {
  root: '词基',
  prefix: '前缀',
  suffix: '后缀',
  compound: '合成成分',
};
export const date = (s: string) =>
  new Date(s).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
export async function api<T>(
  path: string,
  data?: unknown,
  method = 'POST',
): Promise<T> {
  const response = await fetch('/api' + path, {
    method: data === undefined ? 'GET' : method,
    headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = (await response.json()) as { error?: string };
  if (response.status===401&&typeof window!=='undefined')window.dispatchEvent(new Event('kite-auth-required'));
  if (!response.ok) throw new Error(result.error || '请求失败，请重试');
  return result as T;
}
export { speak } from './audio';
