'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CircleHelp, Loader2, X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { api, kinds, type Lesson } from '@/lib/classroom';
import { exampleTerms, type RootCheck } from '@/lib/root-examples';

export function RootChallenge({ lesson }: { lesson: Lesson }) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<RootCheck | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const group = lesson.groups[index];
  useEffect(() => {
    if (!group) return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [group]);
  if (!group)
    return (
      <div className="empty-state">
        本课没有构词拆分，可先练习翻卡和单词填空。
      </div>
    );
  async function check() {
    const answers = exampleTerms(answer);
    if (
      !answers.length ||
      answers.length > 20 ||
      answers.some((w) => w.length > 80)
    ) {
      setError('请填写 1–20 个英文单词或词组，每个不超过 80 个字符。');
      return;
    }
    const current = ++request.current;
    setPending(true);
    setError('');
    try {
      const checked = await api<RootCheck>(
        '/versions/' + lesson.version_id + '/root-check',
        { group_id: group.id, answers },
      );
      if (current === request.current) setResult(checked);
    } catch (e) {
      if (current === request.current)
        setError(e instanceof Error ? e.message : '核对失败，请重试');
    } finally {
      if (current === request.current) setPending(false);
    }
  }
  return (
    <form
      className="root-challenge"
      onSubmit={(e) => {
        e.preventDefault();
        void check();
      }}
    >
      <span className="root-question-index">
        {index + 1} / {lesson.groups.length}
      </span>
      <h3 lang="en">{group.text}</h3>
      <p>
        写出含有这个{kinds[group.kind] || '构词成分'}
        的单词或词组，可以来自任意词库。
      </p>
      <Textarea
        ref={input}
        data-primary-input
        aria-label="构词单词举例"
        placeholder="写下想到的英文单词或词组…"
        value={answer}
        maxLength={1600}
        autoCapitalize="none"
        spellCheck={false}
        onChange={(e) => {
          request.current++;
          setAnswer(e.target.value);
          setResult(null);
          setError('');
          setPending(false);
        }}
      />
      <p className="root-input-help">
        多个举例用逗号或换行分隔，词组保留空格。
      </p>
      {error && (
        <p className="root-check-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="btn primary"
        disabled={pending || !answer.trim()}
        type="submit"
      >
        {pending ? <Loader2 size={17} className="spin" /> : <Check size={17} />}
        {pending ? '正在查词库…' : '核对单词'}
      </button>
      {result && (
        <div className="root-check-results" aria-live="polite">
          {result.results.map((item) => (
            <div
              key={item.answer}
              className={
                'root-check-item ' +
                (!item.found
                  ? 'missing'
                  : item.matched
                    ? 'matched'
                    : 'unverified')
              }
            >
              {item.matched ? (
                <Check size={19} />
              ) : item.found ? (
                <CircleHelp size={19} />
              ) : (
                <X size={19} />
              )}
              <div>
                <strong lang="en">{item.answer}</strong>
                <span>
                  {!item.found
                    ? '词库未收录，请检查拼写'
                    : item.matched
                      ? '举例正确 · 构词关系匹配'
                      : '拼写已收录 · 构词关系需核对'}
                </span>
                {item.meaning_zh && <p>{item.meaning_zh}</p>}
                {item.found && !item.matched && (
                  <small>
                    {item.component_meaning
                      ? '词库中的构词含义：' + item.component_meaning
                      : '词库尚无对应构词说明，请结合释义和老师一起核对。'}
                  </small>
                )}
              </div>
            </div>
          ))}
          <div className="challenge-answer">
            <strong>本课参考答案</strong>
            <p>
              {group.text}：{result.reference.meaning}
            </p>
            <p lang="en">
              {result.reference.words
                .map((w) => w.display_word || w.word)
                .join(' · ')}
            </p>
          </div>
        </div>
      )}
      <div className="challenge-footer">
        <button
          className="btn ghost"
          type="button"
          onClick={() => {
            request.current++;
            setIndex((index + 1) % lesson.groups.length);
            setAnswer('');
            setResult(null);
            setError('');
            setPending(false);
          }}
        >
          换一个构词成分
          <ArrowRight size={16} />
        </button>
      </div>
    </form>
  );
}
