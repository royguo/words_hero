import type { Group, Word } from './classroom';

export type RootCheck = {
  reference: { meaning: string; words: Group['words'] };
  results: {
    answer: string;
    found: boolean;
    matched: boolean;
    word?: string;
    meaning_zh?: string;
    component_meaning?: string;
  }[];
};
const normalized = (text: string) =>
  text
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ');
const partKey = (text: string) => normalized(text).replace(/^-+|-+$/g, '');
const partKind = (kind: string) =>
  ['base', 'word', 'compound'].includes(kind) ? 'word' : kind;

export function exampleTerms(text: string) {
  return [
    ...new Set(
      text
        .split(/[,，;；\n]+/)
        .map(normalized)
        .filter(Boolean),
    ),
  ];
}

/** Exact dictionary lookup is separate from evidence of a morphological link. */
export function checkRootExamples(
  group: Group,
  answers: string[],
  candidates: Word[],
): RootCheck {
  const reference = new Set(
    group.words.flatMap((w) => [
      normalized(w.word),
      normalized(w.display_word || w.word),
    ]),
  );
  return {
    reference: { meaning: group.meaning, words: group.words },
    results: answers.map((answer) => {
      const hits = candidates.filter((w) =>
        [normalized(w.word), normalized(w.display_word || w.word)].includes(
          normalized(answer),
        ),
      );
      if (!hits.length) return { answer, found: false, matched: false };
      const checked = hits.map((word) => {
        const parts = [
          ...(word.parts || []).map((p) => ({
            text: p.text,
            kind: p.kind,
            meaning: p.meaning,
          })),
          ...(word.word_study?.components || []).map((p) => ({
            text: p.text,
            kind: p.kind,
            meaning: p.meaning_zh,
          })),
        ];
        const component = parts.find(
          (p) =>
            partKey(p.text) === partKey(group.text) &&
            partKind(p.kind) === partKind(group.kind),
        );
        // Identical letters alone are never evidence: 'mother' is not '-er'.
        const matched =
          reference.has(normalized(word.word)) ||
          (!!component &&
            normalized(component.meaning) === normalized(group.meaning));
        return { word, component, matched };
      });
      const best =
        checked.find((x) => x.matched) ||
        checked.find((x) => x.component) ||
        checked[0];
      return {
        answer,
        found: true,
        matched: best.matched,
        word: best.word.display_word || best.word.word,
        meaning_zh: best.word.meaning_zh,
        component_meaning: best.component?.meaning,
      };
    }),
  };
}
