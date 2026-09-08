import type { Word } from './classroom';
import { pronunciations } from '../data/pronunciations.ts';

export function phoneticFor(word: Word): string {
  const curated = pronunciations[word.word.trim().toLowerCase()]?.ipa;
  const value = (curated || word.phonetic || '')
    .trim()
    .replace(/^[/[]|[/\]]$/g, '')
    .replace(/ә/g, 'ə')
    .replace(/'/g, 'ˈ')
    .replace(/:/g, 'ː');
  return value ? '/' + value + '/' : '';
}

export function constructionFor(word: Word): {
  parts: string[];
  whole: boolean;
} {
  const study = word.word_study;
  if (study)
    return (study.components?.length || 0) > 1
      ? { parts: study.components.map((part) => part.text), whole: false }
      : { parts: [word.display_word || word.word], whole: true };
  const parts = (word.parts || []).map((p) => p.text);
  // Legacy lists may only name one suffix. Do not invent the missing roots.
  const spelling = (value: string) => value.replace(/[-\s]/g, '').toLowerCase();
  if (parts.length > 1 && spelling(parts.join('')) === spelling(word.word))
    return { parts, whole: false };
  return { parts: [word.display_word || word.word], whole: true };
}

/** Highlight complete target spellings/accepted forms, preserving every character. */
export function targetSegments(
  text: string,
  word: Word,
): { text: string; target: boolean }[] {
  const terms = [
    ...new Set(
      [
        word.word,
        word.display_word,
        word.cloze_answer,
        ...(word.accepted || []),
      ].filter((x): x is string => !!x?.trim()),
    ),
  ].sort((a, b) => b.length - a.length);
  if (!terms.length) return [{ text, target: false }];
  const pattern = terms
    .map((s) =>
      s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'),
    )
    .join('|');
  const matcher = new RegExp('\\b(' + pattern + ')\\b', 'gi');
  return text
    .split(matcher)
    .map((piece, i) => ({ text: piece, target: i % 2 === 1 }));
}
