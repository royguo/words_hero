import type { Lesson, Word, StoryScene } from './classroom';

export const chapters = [
  { id: 'welcome', label: '今天的任务', short: '出发', number: '01' },
  { id: 'words', label: '认识单词', short: '认识单词', number: '02' },
  { id: 'scenes', label: '情景图文故事', short: '情景故事', number: '03' },
  { id: 'practice', label: '轮到你了', short: '一起练习', number: '04' },
  { id: 'finish', label: '全课单词回顾', short: '回顾', number: '05' },
] as const;
export type Chapter = (typeof chapters)[number]['id'];
export type RecapEntry = {
  word: Word;
  position: number;
  meaning: string;
  en: string;
  zh: string;
  exampleNumber: number;
  exampleTotal: number;
  continuation: boolean;
};
export type Slide = {
  id: string;
  chapter: Chapter;
  kind:
    | 'welcome'
    | 'word'
    | 'study'
    | 'scene'
    | 'scene-question'
    | 'cards'
    | 'practice'
    | 'finish';
  title: string;
  word?: Word;
  examples?: { en: string; zh: string }[];
  words?: Word[];
  recap?: RecapEntry[];
  text?: string;
  meaning?: string;
  part?: number;
  total?: number;
  scene?: StoryScene;
};
export function wordLabel(w: Pick<Word, 'word' | 'display_word'>) {
  return w.display_word || w.word;
}

// Paginate at sentence/word boundaries; never squeeze a whole class onto one slide.
export function textPages(text: string, limit = 135): string[] {
  const pieces = text.match(/[^。！？!?]+[。！？!?]?[”’]?|[。！？!?]/gu) || [
    text,
  ];
  const pages: string[] = [];
  let page = '';
  for (const piece of pieces) {
    const units = Array.from(piece);
    while (units.length) {
      const room = limit - Array.from(page).length;
      if (room === 0) {
        pages.push(page.trim());
        page = '';
        continue;
      }
      if (units.length <= room) {
        page += units.splice(0).join('');
        break;
      }
      if (page) {
        pages.push(page.trim());
        page = '';
        continue;
      }
      let end = limit;
      while (
        end > limit / 2 &&
        /[a-zA-Z]/.test(units[end - 1]) &&
        /[a-zA-Z]/.test(units[end] || '')
      )
        end--;
      page = units.splice(0, end).join('');
      pages.push(page.trim());
      page = '';
    }
  }
  if (page.trim()) pages.push(page.trim());
  return pages.length ? pages : [''];
}
export function cardPages(words: Word[]): Word[][] {
  const count = words.some(
    (w) => (w.display_word || w.word).length > 22 || w.meaning_zh.length > 40,
  )
    ? 2
    : 4;
  return Array.from({ length: Math.ceil(words.length / count) }, (_, i) =>
    words.slice(i * count, (i + 1) * count),
  );
}
export function buildSlides(lesson: Lesson): Slide[] {
  const result: Slide[] = [
    { id: 'welcome', chapter: 'welcome', kind: 'welcome', title: lesson.title },
  ];
  for (const w of lesson.words) {
    const examples = [
      { en: w.example, zh: w.example_zh },
      ...(w.extra_examples || []),
    ];
    const meanings = textPages(w.meaning_zh, 40);
    const wordPages = Math.max(Math.ceil(examples.length / 2), meanings.length);
    for (let page = 0; page < wordPages; page++) {
      const i = page * 2;
      result.push({
        id: 'word:' + w.id + (i ? ':' + i : ''),
        chapter: 'words',
        kind: 'word',
        title: wordLabel(w),
        word: w,
        examples: examples.slice(i, i + 2),
        meaning: meanings[Math.min(page, meanings.length - 1)],
        part: page + 1,
        total: wordPages,
      });
    }
    result.push({
      id: 'study:' + w.id,
      chapter: 'words',
      kind: 'study',
      title: wordLabel(w) + ' · 来源和构成',
      word: w,
    });
  }
  const story = lesson.materials?.story;
  story?.scenes.forEach((scene, i) => {
    result.push({
      id: 'scene:' + scene.id,
      chapter: 'scenes',
      kind: 'scene',
      title: scene.title,
      scene,
      part: i + 1,
      total: story.scenes.length,
    });
    result.push({
      id: 'scene-question:' + scene.id,
      chapter: 'scenes',
      kind: 'scene-question',
      title: scene.question.en,
      scene,
      part: i + 1,
      total: story.scenes.length,
    });
  });
  const cards = cardPages(lesson.words);
  cards.forEach((words, i) =>
    result.push({
      id: 'cards:' + i,
      chapter: 'practice',
      kind: 'cards',
      title: '翻卡回忆 · ' + words.map(wordLabel).join(' / '),
      words,
      part: i + 1,
      total: cards.length,
    }),
  );
  for (const w of lesson.words)
    result.push({
      id: 'practice:' + w.id,
      chapter: 'practice',
      kind: 'practice',
      title: wordLabel(w),
      word: w,
    });
  const recapPages: RecapEntry[][] = [];
  const compact = (entry: RecapEntry) =>
    wordLabel(entry.word).length <= 14 &&
    entry.meaning.length <= 20 &&
    entry.en.length <= 90 &&
    entry.zh.length <= 26 &&
    !entry.continuation;
  lesson.words.forEach((word, position) => {
    const examples = [
      { en: word.example, zh: word.example_zh },
      ...(word.extra_examples || []),
    ];
    examples.forEach((example, exampleIndex) => {
      const meaning = textPages(word.meaning_zh, 60);
      const en = textPages(example.en, 140);
      const zh = textPages(example.zh, 70);
      const count = Math.max(meaning.length, en.length, zh.length);
      for (let i = 0; i < count; i++) {
        const entry: RecapEntry = {
          word,
          position: position + 1,
          meaning: meaning.length === 1 ? meaning[0] : meaning[i] || '',
          en: en[i] || '',
          zh: zh[i] || '',
          exampleNumber: exampleIndex + 1,
          exampleTotal: examples.length,
          continuation: count > 1,
        };
        const last = recapPages.at(-1);
        if (last?.length === 1 && compact(last[0]) && compact(entry))
          last.push(entry);
        else recapPages.push([entry]);
      }
    });
  });
  recapPages.forEach((recap, i) =>
    result.push({
      // Keep the previous finish bookmark valid when an existing lesson is reopened.
      id: i ? 'finish:' + i : 'finish',
      chapter: 'finish',
      kind: 'finish',
      title:
        '单词回顾 · ' + recap.map((entry) => wordLabel(entry.word)).join(' / '),
      recap,
      part: i + 1,
      total: recapPages.length,
    }),
  );
  return result;
}
export function sectionFor(slide?: Slide) {
  if (slide?.chapter === 'scenes') return 'scenes';
  return slide?.chapter === 'practice' ? 'practice' : 'preview';
}
