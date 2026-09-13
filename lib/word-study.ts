import type { Word } from './classroom';

export type WordStudy = {
  schema_version: 1 | 2;
  formation: 'simple' | 'compound' | 'derived' | 'inflected' | 'phrase';
  construction: string;
  components: {
    text: string;
    kind: 'base' | 'root' | 'prefix' | 'suffix' | 'word';
    meaning_zh: string;
  }[];
  explanation_zh: string;
  origin_zh?: string;
  family: {
    word: string;
    meaning_zh: string;
    relation:
      | 'compound'
      | 'derivation'
      | 'shared_root'
      | 'word_family'
      | 'phrase'
      | 'inflection'
      | 'shared_affix';
    connection_zh: string;
    example: { en: string; zh: string };
  }[];
  challenge: { prompt_zh: string; answer_zh: string };
  sources: { title: string; url: string }[];
};
export const formationLabels = {
  simple: '整体词',
  compound: '合成词',
  derived: '派生词',
  inflected: '词形变化',
  phrase: '词组',
};
export const componentLabels = {
  base: '词基',
  root: '词根',
  prefix: '前缀',
  suffix: '后缀',
  word: '单词成分',
};
export const relationLabels = {
  compound: '合成',
  derivation: '派生',
  shared_root: '同根词',
  word_family: '词族',
  phrase: '搭配',
  inflection: '词形变化',
  shared_affix: '同词缀',
};

// Historical lessons stay readable without manufacturing a history or silently changing their snapshots.
export function studyFor(word: Word): WordStudy {
  if (word.word_study) return word.word_study;
  return {
    schema_version: 1,
    formation: 'simple',
    construction: word.display_word || word.word,
    components: [],
    explanation_zh: '先记住完整拼写，再把这个词与例句中的意思连起来。',
    origin_zh: '',
    family: [],
    sources: [],
    challenge: {
      prompt_zh: '合上释义，你能用中文解释这个词吗？',
      answer_zh: word.meaning_zh,
    },
  };
}
