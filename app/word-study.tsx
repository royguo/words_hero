'use client';
import { useState } from 'react';
import { Eye, Volume2 } from 'lucide-react';
import type { Word } from '@/lib/classroom';
import {
  componentLabels,
  formationLabels,
  relationLabels,
  studyFor,
} from '@/lib/word-study';

export function WordStudyPage({
  word,
  compact = false,
  onSpeak,
}: {
  word: Word;
  compact?: boolean;
  onSpeak: (text: string) => void;
}) {
  const study = studyFor(word);
  const [revealed, setRevealed] = useState(false);
  return (
    <section className={'word-study ' + (compact ? 'study-compact' : '')}>
      <header className="study-header">
        <div>
          <span className="study-eyebrow">来源和构成</span>
          <h2 lang="en">{word.display_word || word.word}</h2>
        </div>
        <span className="study-type">{formationLabels[study.formation]}</span>
      </header>
      <div className="study-columns">
        <div className="study-main">
          <h3>看看它是怎么组成的</h3>
          <div className="study-components">
            {study.components.length ? (
              study.components.map((part, i) => (
                <div key={i}>
                  {i > 0 && <span className="study-plus">+</span>}
                  <span className="study-component">
                    <strong lang="en">{part.text}</strong>
                    <span>{part.meaning_zh}</span>
                    <small>{componentLabels[part.kind]}</small>
                  </span>
                </div>
              ))
            ) : (
              <strong className="study-whole" lang="en">
                {study.construction}
              </strong>
            )}
          </div>
          {study.components.length > 0 && (
            <p className="study-equation" lang="en">
              {study.construction}
            </p>
          )}
          <p className="study-explanation">{study.explanation_zh}</p>
          {study.schema_version === 2 && study.origin_zh && (
            <div className="study-origin">
              <h3>它从哪里来？</h3>
              <p>{study.origin_zh}</p>
            </div>
          )}
          {!word.word_study && word.parts.length > 0 && (
            <div className="study-legacy">
              <h3>已经认识的构词线索</h3>
              {word.parts.map((part, i) => (
                <p key={i}>
                  <strong lang="en">{part.text}</strong> · {part.meaning}
                </p>
              ))}
            </div>
          )}
        </div>
        <div className="study-family">
          <h3>
            {study.family.length ? '顺着线索，认识更多词' : '把单词放进生活'}
          </h3>
          {study.family.length ? (
            study.family.map((related) => (
              <article key={related.word}>
                <div className="study-family-title">
                  <strong lang="en">{related.word}</strong>
                  <button
                    aria-label={'朗读 ' + related.word}
                    onClick={() => onSpeak(related.word)}
                  >
                    <Volume2 />
                  </button>
                  <span>{relationLabels[related.relation]}</span>
                </div>
                <p className="study-family-meaning">{related.meaning_zh}</p>
                <p className="study-connection">{related.connection_zh}</p>
                <p className="study-family-example" lang="en">
                  {related.example.en}
                  <button
                    aria-label={'朗读例句 ' + related.word}
                    onClick={() => onSpeak(related.example.en)}
                  >
                    <Volume2 />
                  </button>
                </p>
                <p className="study-family-zh">{related.example.zh}</p>
              </article>
            ))
          ) : (
            <article>
              <p className="study-family-example" lang="en">
                {word.example}
              </p>
              <p className="study-family-zh">{word.example_zh}</p>
              <p className="study-connection">
                想一想：换成你或你的朋友，这句话可以怎样说？
              </p>
            </article>
          )}
        </div>
      </div>
      <button
        className={'study-challenge ' + (revealed ? 'revealed' : '')}
        onClick={() => setRevealed(!revealed)}
        aria-expanded={revealed}
      >
        <Eye />
        <span>
          {revealed ? study.challenge.answer_zh : study.challenge.prompt_zh}
        </span>
        <small>{revealed ? '再想一遍' : '想好再揭晓'}</small>
      </button>
      {study.sources.length > 0 && (
        <div className="study-sources">
          来历与构词参考：
          {study.sources.map((source, i) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer"
            >
              {i + 1}. {source.title}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
