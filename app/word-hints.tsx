import type { Word } from '@/lib/classroom';
import { constructionFor, phoneticFor } from '@/lib/word-presentation';

export function WordHints({ word }: { word: Word }) {
  const construction = constructionFor(word);
  const ipa = phoneticFor(word);
  return (
    <span className="card-word-hints">
      {ipa && (
        <span className="card-ipa" lang="en">
          {ipa}
        </span>
      )}
      <span
        className="card-construction"
        aria-label={construction.whole ? '整体记忆' : '单词构成'}
      >
        {construction.parts.map((part, i) => (
          <span className="card-part-group" key={i}>
            {i > 0 && <span className="card-plus">+</span>}
            <span className={'card-part part-tone-' + (i % 3)} lang="en">
              {part}
            </span>
          </span>
        ))}
        {construction.whole && (
          <span className="card-whole-label">整体记忆</span>
        )}
      </span>
    </span>
  );
}
