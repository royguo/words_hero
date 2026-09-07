'use client';
import { useState } from 'react';
import { Check, RotateCcw, Volume2 } from 'lucide-react';
import type { Word } from '@/lib/classroom';
import { stopSpeech } from '@/lib/audio';

export function WordCards({
  words,
  revealed = false,
  readOnly = false,
  onSpeak,
  onRate,
}: {
  words: Word[];
  revealed?: boolean;
  readOnly?: boolean;
  onSpeak: (text: string) => void;
  onRate: (word: Word, result: 'remembered' | 'again') => Promise<void>;
}) {
  const [reverse, setReverse] = useState(false);
  const [flipState, setFlipState] = useState<{
    revealed: boolean;
    flips: Record<number, boolean>;
  }>({ revealed, flips: {} });
  if (flipState.revealed !== revealed) setFlipState({ revealed, flips: {} });
  const flips = flipState.revealed === revealed ? flipState.flips : {};
  const setFlips = (flips: Record<number, boolean>) =>
    setFlipState({ revealed, flips });
  const [pending, setPending] = useState(false);
  async function rate(word: Word, result: 'remembered' | 'again') {
    setPending(true);
    try {
      await onRate(word, result);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="word-card-practice">
      <header className="word-card-practice-header">
        <div>
          <h2>轮流选一张，看看谁记住了</h2>
          <p>先说答案，再点击卡片翻面。</p>
        </div>
        <button
          onClick={() => {
            stopSpeech();
            setReverse(!reverse);
            setFlips(Object.fromEntries(words.map((word) => [word.id, false])));
          }}
          className="card-direction"
        >
          {reverse ? '换成英文出题' : '换成中文出题'}
        </button>
      </header>
      <div
        className={
          'practice-card-grid ' + (words.length <= 2 ? 'few-cards' : '')
        }
      >
        {words.map((word, i) => {
          const flipped = flips[word.id] ?? revealed;
          const english = word.display_word || word.word;
          const cue = reverse ? word.meaning_zh : english;
          const answer = reverse ? english : word.meaning_zh;
          return (
            <article key={word.id} className="practice-card">
              <button
                className={'flip-button ' + (flipped ? 'is-flipped' : '')}
                onClick={() => {
                  stopSpeech();
                  setFlips({ ...flips, [word.id]: !flipped });
                }}
                aria-label={
                  '卡片 ' +
                  (i + 1) +
                  '：' +
                  cue +
                  (flipped ? '，答案：' + answer : '，点击翻面')
                }
                aria-pressed={flipped}
              >
                <span className="flip-inner">
                  <span className="flip-face flip-front" aria-hidden={flipped}>
                    <small>
                      {String(i + 1).padStart(2, '0')} /{' '}
                      {reverse ? '说出英文' : '说出中文'}
                    </small>
                    <strong lang={reverse ? 'zh-CN' : 'en'}>{cue}</strong>
                    <span>点击翻面</span>
                  </span>
                  <span className="flip-face flip-back" aria-hidden={!flipped}>
                    <small>{cue}</small>
                    <strong lang={reverse ? 'en' : 'zh-CN'}>{answer}</strong>
                    <span>你答对了吗？</span>
                  </span>
                </span>
              </button>
              <div className="practice-card-tools">
                <button
                  onClick={() => onSpeak(word.word)}
                  aria-label={'朗读 ' + english}
                >
                  <Volume2 />
                </button>
                <span>
                  {word.result === 'remembered'
                    ? '已记住'
                    : word.result === 'again'
                      ? '再练一次'
                      : ''}
                </span>
                {!readOnly && (
                  <>
                    <button
                      disabled={pending}
                      onClick={() => void rate(word, 'again')}
                      aria-label={english + ' 再练一次'}
                    >
                      <RotateCcw />
                      再练
                    </button>
                    <button
                      disabled={pending}
                      onClick={() => void rate(word, 'remembered')}
                      aria-label={english + ' 记住了'}
                    >
                      <Check />
                      记住了
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
