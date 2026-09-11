'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Volume2, Lightbulb, ArrowRight, Undo2 } from 'lucide-react';
import {
  currentRecall,
  shuffled,
  type GameAction,
  type StudyGame,
} from '@/lib/student-game';

export function StudentRecall({
  game,
  disabled,
  onAction,
  onPlay,
}: {
  game: StudyGame;
  disabled: boolean;
  onAction: (action: GameAction) => void;
  onPlay: (text: string) => void;
}) {
  const task = currentRecall(game)!;
  const word = game.words.find((w) => w.key === task.word)!;
  const [answer, setAnswer] = useState('');
  const [letters] = useState(() =>
    shuffled(Array.from(word.word.toLowerCase())),
  );
  const hint = game.adaptive!.hint;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (task.skill !== 'spelling' || disabled) return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [disabled, hint, task.retry, task.skill, task.word]);
  function returnToInput() {
    requestAnimationFrame(() => input.current?.focus());
  }
  return (
    <section
      className="recall-card"
      aria-label={task.skill === 'spelling' ? '中文回忆英文' : '听音辨义'}
    >
      <span className="recall-kind">
        {task.retry ? '再想一次 · ' : ''}
        {task.skill === 'spelling' ? '中文 → 英文' : '听音 → 中文'}
      </span>
      {task.skill === 'spelling' ? (
        <>
          <div className="recall-prompt">
            {word.image && (
              <Image
                unoptimized
                width={600}
                height={400}
                src={word.image}
                alt=""
                className="recall-image"
                onError={(e) => {
                  e.currentTarget.hidden = true;
                }}
              />
            )}
            <h2>{word.meaning}</h2>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!disabled && answer.trim())
                onAction({ kind: 'answer', answer });
            }}
          >
            <input
              ref={input}
              aria-label="填写英文单词"
              lang="en"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={160}
              disabled={disabled}
              placeholder="英文单词"
            />
            {hint > 0 && (
              <p className="recall-hint" lang="en" aria-live="polite">
                {word.word.slice(0, 1)}
                {Array.from(word.word)
                  .slice(1)
                  .map((c) => (c === ' ' ? '   ' : ' _'))
                  .join('')}
              </p>
            )}
            {hint > 1 && (
              <div className="letter-bank" aria-label="字母提示">
                {letters.map((letter, index) => (
                  <button
                    type="button"
                    key={index}
                    disabled={disabled}
                    aria-label={
                      letter === ' ' ? '添加空格' : '添加字母 ' + letter
                    }
                    onClick={() => {
                      setAnswer((value) => (value + letter).slice(0, 160));
                      returnToInput();
                    }}
                  >
                    {letter === ' ' ? '␣' : letter}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={disabled || !answer}
                  aria-label="删除最后一个字母"
                  onClick={() => {
                    setAnswer(Array.from(answer).slice(0, -1).join(''));
                    returnToInput();
                  }}
                >
                  <Undo2 size={19} />
                </button>
              </div>
            )}
            <div className="recall-actions">
              <button
                className="btn secondary"
                type="button"
                disabled={disabled || hint >= 2}
                onClick={() => onAction({ kind: 'hint' })}
              >
                <Lightbulb size={19} />
                {hint === 0 ? '首字母提示' : '字母提示'}
              </button>
              <button
                className="btn primary"
                type="submit"
                disabled={disabled || !answer.trim()}
              >
                确认 <ArrowRight size={19} />
              </button>
            </div>
          </form>
        </>
      ) : (
        <>
          <button
            className="listen-prompt"
            onClick={() => onPlay(word.word)}
            aria-label="播放本题单词"
          >
            <Volume2 size={42} />
            <span>再听一次</span>
          </button>
          <div className="listen-options">
            {task.options.map((key) => (
              <button
                key={key}
                disabled={disabled}
                onClick={() => onAction({ kind: 'answer', answer: key })}
              >
                {game.words.find((w) => w.key === key)!.meaning}
              </button>
            ))}
          </div>
        </>
      )}
      <button
        className="btn ghost recall-defer"
        disabled={disabled}
        onClick={() => onAction({ kind: 'defer' })}
      >
        还没想起，看看答案
      </button>
    </section>
  );
}
