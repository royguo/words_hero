import type { Group, Lesson, Word, StoryScene } from './classroom';

export const chapters = [
  { id: 'welcome', label: '今天的任务', short: '出发', number: '01' },
  { id: 'words', label: '认识单词', short: '认识单词', number: '02' },
  { id: 'roots', label: '发现构词线索', short: '词根与故事', number: '03' },
  { id: 'scenes', label: '情景图文故事', short: '情景故事', number: '04' },
  { id: 'practice', label: '轮到你了', short: '一起练习', number: '05' },
  { id: 'finish', label: '全课单词回顾', short: '回顾', number: '06' },
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
    | 'story'
    | 'scene'
    | 'scene-question'
    | 'root'
    | 'family'
    | 'root-quiz'
    | 'practice'
    | 'finish'
    | 'whole';
  title: string;
  word?: Word;
  examples?: { en: string; zh: string }[];
  group?: Group;
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
export function studentStory(word: Word): string {
  // Old lesson snapshots remain intact. Only their obsolete classroom directions are omitted on screen.
  return word.story_zh
    .replace(
      '老师和小乐做一个情境小练习。小乐先听懂画面，再试着用英语表达。',
      '',
    )
    .replace('画面是：', '')
    .replace(
      /小乐给缺课的朋友补一页课堂笔记。/g,
      '小乐和朋友聊起今天的一件事。',
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
    const pages = textPages(studentStory(w));
    pages.forEach((text, i) =>
      result.push({
        id: 'story:' + w.id + ':' + i,
        chapter: 'words',
        kind: 'story',
        title: w.story_title?.replace(' · 画面小故事', '') || wordLabel(w),
        word: w,
        text,
        part: i + 1,
        total: pages.length,
      }),
    );
  }
  if (!lesson.groups.length)
    result.push({
      id: 'whole',
      chapter: 'roots',
      kind: 'whole',
      title: '让单词和生活连起来',
      words: lesson.words.slice(0, 3),
    });
  for (const g of lesson.groups) {
    const source =
      g.story ||
      (g.kind === 'compound'
        ? '两个熟悉的成分可以组合成一个新词。先看看每一部分的意思，再想想它们放在一起会是什么。'
        : '词基带着核心意思，词缀可以改变意思或词性。观察这个成分在完整单词中的作用。相同字母未必属于同一个词根。');
    const pages = textPages(source);
    pages.forEach((text, i) =>
      result.push({
        id: 'root:' + g.id + ':' + i,
        chapter: 'roots',
        kind: 'root',
        title: g.text,
        group: g,
        text,
        part: i + 1,
        total: pages.length,
      }),
    );
    const related = lesson.words.filter((w) =>
      g.words.some((item) => item.word === w.word),
    );
    for (let i = 0; i < related.length; i += 2)
      result.push({
        id: 'family:' + g.id + ':' + i,
        chapter: 'roots',
        kind: 'family',
        title: g.text + ' 的单词家族',
        group: g,
        words: related.slice(i, i + 2),
        part: i / 2 + 1,
        total: Math.ceil(related.length / 2),
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
  for (const g of lesson.groups)
    result.push({
      id: 'root-quiz:' + g.id,
      chapter: 'practice',
      kind: 'root-quiz',
      title: g.text,
      group: g,
    });
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
  return slide?.chapter === 'roots'
    ? 'roots'
    : slide?.chapter === 'practice'
      ? 'practice'
      : 'preview';
}
