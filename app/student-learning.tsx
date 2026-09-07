'use client';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  X,
  Volume2,
  VolumeX,
  LogOut,
  Loader2,
  RefreshCw,
  CheckCheck,
} from 'lucide-react';
import { api, ApiError } from '@/lib/classroom';
import { StudentAudio } from '@/lib/student-audio';
import type {
  GameAction,
  GameFeedback,
  StudentDashboard,
  StudentSession,
  StudyGame,
} from '@/lib/student-game';

type PendingAction = {
  revision: number;
  request_id: string;
  action: GameAction;
};
const when = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '';
function englishOnScreen(game: StudyGame) {
  if (game.needs_retry) return [];
  if (game.stage === 'done') return game.words.map((word) => word.word);
  if (game.stage === 1)
    return game.en_order
      .filter((key) => !game.removed.includes(key))
      .map((key) => game.words.find((w) => w.key === key)!.word);
  const q = game.questions[game.cursor];
  return q
    ? [
        game.words.find(
          (w) => w.key === (q.direction === 'en' ? q.word : q.candidate),
        )!.word,
      ]
    : [];
}
export function StudentLearning() {
  const [dashboard, setDashboard] = useState<StudentDashboard | null>(null),
    [session, setSession] = useState<StudentSession | null>(null);
  const [mode, setMode] = useState<'home' | 'play'>('home'),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [voice, setVoice] = useState(true),
    [effects, setEffects] = useState(true),
    [audioNotice, setAudioNotice] = useState('');
  const [selected, setSelected] = useState<{
      side: 'en' | 'zh';
      key: string;
    } | null>(null),
    [flash, setFlash] = useState<GameFeedback | null>(null);
  const [failedAction, setFailedAction] = useState<PendingAction | null>(null);
  const audio = useRef<StudentAudio | null>(null),
    lock = useRef(false),
    alive = useRef(true);
  const load = useCallback(async () => {
    const value = await api<StudentDashboard>('/student/state');
    if (alive.current) {
      setDashboard(value);
      setSession(value.session);
    }
    return value;
  }, []);
  useEffect(() => {
    alive.current = true;
    audio.current = new StudentAudio(setAudioNotice);
    void load()
      .then(() => {
        setVoice(localStorage.getItem('kite.student.voice') !== 'off');
        setEffects(localStorage.getItem('kite.student.effects') !== 'off');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    return () => {
      alive.current = false;
      audio.current?.dispose();
    };
  }, [load]);
  const game = session?.game;
  const voicePage =
    mode === 'play' && game
      ? `${session.id}:${game.stage}:${game.round}:${game.stage === 2 ? game.cursor : 'board'}:${game.needs_retry}`
      : '';
  const onVoicePage = useEffectEvent(() => {
    if (voice && mode === 'play' && game)
      void audio.current?.play(englishOnScreen(game));
    else audio.current?.stop();
  });
  useEffect(() => {
    onVoicePage();
    return () => audio.current?.stop();
  }, [voicePage, voice]);
  async function start(extra = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    audio.current?.unlock();
    try {
      const value = await api<{ session: StudentSession | null }>(
        '/student/sessions',
        { count: 10, extra },
      );
      if (!alive.current) return;
      if (value.session) {
        setSession(value.session);
        setSelected(null);
        setFlash(null);
        setFailedAction(null);
        setMode('play');
      } else {
        await load();
        setMode('home');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '开始失败，请重试');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function submit(action: GameAction, retry?: PendingAction) {
    if (!session || lock.current || (failedAction && !retry)) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const payload = retry || {
      revision: session.revision,
      request_id: crypto.randomUUID(),
      action,
    };
    try {
      const result = await api<
        StudentSession & { feedback: GameFeedback | null }
      >('/student/sessions/' + session.id + '/actions', payload);
      if (!alive.current) return;
      setFailedAction(null);
      if (action.kind !== 'retry' && result.feedback) {
        setFlash(result.feedback);
        if (effects) audio.current?.effect(result.feedback.correct);
        if (!result.feedback.correct && voice)
          void audio.current?.play(
            result.feedback.keys.map(
              (key) => session.game.words.find((w) => w.key === key)!.word,
            ),
          );
        await new Promise((resolve) =>
          setTimeout(resolve, result.feedback!.correct ? 350 : 1450),
        );
      }
      if (alive.current) {
        setSession(result);
        setSelected(null);
        setFlash(null);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setFailedAction(null);
        setSelected(null);
        setFlash(null);
        audio.current?.stop();
        try {
          const value = await load();
          if (!value.session) setMode('home');
        } catch {
          setMode('home');
        }
      } else setFailedAction(payload);
      setError(e instanceof Error ? e.message : '进度尚未保存，请重试');
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const onRetryTimer = useEffectEvent(() => {
    if (!document.hidden) void submit({ kind: 'retry' });
  });
  const retryPage = game?.needs_retry
    ? `${session?.id}:${game.stage}:${game.round}`
    : '';
  useEffect(() => {
    if (!retryPage || busy || failedAction || mode !== 'play') return;
    const timer = setTimeout(() => onRetryTimer(), 1600);
    return () => clearTimeout(timer);
  }, [retryPage, busy, failedAction, mode]);
  function pick(side: 'en' | 'zh', key: string) {
    if (!game || busy || failedAction || game.removed.includes(key)) return;
    audio.current?.stop();
    if (side === 'en' && voice)
      void audio.current?.play([game.words.find((w) => w.key === key)!.word]);
    if (!selected || selected.side === side) {
      setSelected(
        selected?.key === key && selected.side === side ? null : { side, key },
      );
      return;
    }
    const en = side === 'en' ? key : selected.key,
      zh = side === 'zh' ? key : selected.key;
    void submit({ kind: 'match', en, zh });
  }
  async function home() {
    if (busy) return;
    audio.current?.stop();
    setMode('home');
    setSelected(null);
    setFlash(null);
    setFailedAction(null);
    setError('');
    try {
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败');
    }
  }
  const wordsByKey = new Map(game?.words.map((w) => [w.key, w]) || []);
  const q = game?.stage === 2 ? game.questions[game.cursor] : undefined;
  const prompt = q ? wordsByKey.get(q.word)! : null,
    candidate = q ? wordsByKey.get(q.candidate)! : null;
  const canStudy =
    !!dashboard && (dashboard.due + dashboard.fresh > 0 || !!dashboard.session);
  return (
    <main className={'learner-page ' + (mode === 'play' ? 'in-session' : '')}>
      <header className="learner-header">
        <div className="learner-identity">
          {mode === 'play' ? (
            <button
              className="btn ghost"
              disabled={busy}
              onClick={() => void home()}
            >
              <ArrowLeft size={17} />
              返回
            </button>
          ) : (
            <strong>风筝单词</strong>
          )}
          <span>{dashboard?.student.name}</span>
          <small>{dashboard?.student.class_name}</small>
        </div>
        <div className="learner-tools">
          <button
            className="icon-btn"
            aria-label={voice ? '关闭自动朗读' : '开启自动朗读'}
            aria-pressed={voice}
            onClick={() => {
              audio.current?.unlock();
              setVoice(!voice);
              localStorage.setItem('kite.student.voice', voice ? 'off' : 'on');
            }}
          >
            {voice ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <label>
            <input
              type="checkbox"
              checked={effects}
              onChange={(e) => {
                audio.current?.unlock();
                setEffects(e.target.checked);
                localStorage.setItem(
                  'kite.student.effects',
                  e.target.checked ? 'on' : 'off',
                );
              }}
            />
            音效
          </label>
          <button
            className="icon-btn"
            aria-label="退出学生登录"
            disabled={busy}
            onClick={() => {
              audio.current?.stop();
              window.dispatchEvent(new Event('kite-logout'));
            }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      {error && (
        <div className="learner-error" role="alert">
          {error}
          {failedAction ? (
            <button
              disabled={busy}
              onClick={() => void submit(failedAction.action, failedAction)}
            >
              重试保存
            </button>
          ) : (
            <button disabled={busy} onClick={() => void home()}>
              刷新
            </button>
          )}
        </div>
      )}
      {loading ? (
        <div className="empty-state">
          <Loader2 className="spin" />
          正在读取记忆记录…
        </div>
      ) : mode === 'home' && dashboard ? (
        <section className="learner-home">
          <h1>单词复习</h1>
          <div className="learner-stats">
            <div>
              <span>待复习</span>
              <strong>{dashboard.due}</strong>
            </div>
            <div>
              <span>新单词</span>
              <strong>{dashboard.fresh}</strong>
            </div>
            <div>
              <span>已练过 / 课堂词汇</span>
              <strong>
                {dashboard.practiced}
                <small> / {dashboard.total}</small>
              </strong>
            </div>
          </div>
          {dashboard.total === 0 ? (
            <div className="learner-empty">
              老师结束课程后，单词会出现在这里。
            </div>
          ) : (
            <div className="study-start-panel">
              <div>
                <h2>
                  {dashboard.session
                    ? '继续上次练习'
                    : canStudy
                      ? '每组 10 词'
                      : '本次复习已完成'}
                </h2>
                <p>
                  {dashboard.session
                    ? `第 ${dashboard.session.game.stage} 阶段 · 第 ${dashboard.session.game.round} 轮，进度已保存`
                    : canStudy
                      ? '中英消消乐 → 中英对决'
                      : dashboard.next_due
                        ? `下次复习：${when(dashboard.next_due)}`
                        : '暂无到期单词'}
                </p>
              </div>
              <button
                className="btn primary large"
                disabled={busy}
                onClick={() => void start(!canStudy)}
              >
                {busy ? (
                  <Loader2 className="spin" size={20} />
                ) : (
                  <ArrowRight size={20} />
                )}
                {dashboard.session
                  ? '继续练习'
                  : canStudy
                    ? '开始一组'
                    : '再练一组'}
              </button>
            </div>
          )}
          {dashboard.recent.length > 0 && (
            <section className="student-history">
              <h2>
                最近练习 <small>共 {dashboard.completed_groups} 组</small>
              </h2>
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>单词</th>
                    <th>错误次数</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.recent.map((r, i) => (
                    <tr key={i}>
                      <td>{when(r.completed_at)}</td>
                      <td>{r.words} 词</td>
                      <td>{r.errors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </section>
      ) : mode === 'play' && game ? (
        <section className="learning-game">
          {game.stage === 'done' ? (
            <div className="session-done">
              <Confetti />
              <CheckCheck className="done-icon" />
              <h1>本组完成</h1>
              <p>{game.words.length} 个单词 · 两阶段通过</p>
              <div className="done-word-grid">
                {game.words.map((w) => (
                  <div key={w.key}>
                    <strong lang="en">{w.word}</strong>
                    <span>{w.meaning}</span>
                    {game.errors[w.key] ? (
                      <small>记错 {game.errors[w.key]} 次 · 5 分钟后再练</small>
                    ) : (
                      <small>已安排下次复习</small>
                    )}
                  </div>
                ))}
              </div>
              <div className="done-actions">
                <button className="btn secondary" onClick={() => void home()}>
                  返回复习
                </button>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void start()}
                >
                  <ArrowRight size={18} />
                  下一组
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="game-heading">
                <div>
                  <div className="game-steps">
                    <span className={game.stage === 1 ? 'current' : 'passed'}>
                      1 消消乐
                    </span>
                    <i />
                    <span className={game.stage === 2 ? 'current' : ''}>
                      2 中英对决
                    </span>
                  </div>
                  <h1>{game.stage === 1 ? '中英消消乐' : '中英对决'}</h1>
                </div>
                <div className="round-counter">
                  <strong>第 {game.round} 轮</strong>
                  <span>
                    {game.stage === 1
                      ? `${game.removed.length} / ${game.words.length} 词`
                      : `${game.cursor} / ${game.questions.length} 题`}
                  </span>
                </div>
              </div>
              <div className="game-instruction">
                <span>
                  {game.stage === 1
                    ? '选一个英文，再选对应中文，也可以反过来。'
                    : '英文和中文是否对应？'}
                </span>
                <button
                  className="btn ghost"
                  onClick={() => {
                    audio.current?.unlock();
                    void audio.current?.play(englishOnScreen(game));
                  }}
                >
                  <Volume2 size={16} />
                  朗读
                </button>
              </div>
              {audioNotice && (
                <output className="audio-notice">{audioNotice}</output>
              )}
              {game.needs_retry ? (
                <div className="round-retry">
                  <RefreshCw />
                  <h2>本轮有 {game.round_errors} 次错误</h2>
                  <p>重新练习本阶段，整轮全对后继续。</p>
                  <button
                    className="btn primary"
                    disabled={busy || !!failedAction}
                    onClick={() => void submit({ kind: 'retry' })}
                  >
                    重试本阶段
                  </button>
                </div>
              ) : game.stage === 1 ? (
                <div className="matching-board">
                  {(['en', 'zh'] as const).map((side) => (
                    <div className="match-column" key={side}>
                      <h2>{side === 'en' ? '英文' : '中文'}</h2>
                      <div className="match-grid">
                        {game[side === 'en' ? 'en_order' : 'zh_order'].map(
                          (key) => {
                            const w = wordsByKey.get(key)!,
                              gone = game.removed.includes(key),
                              flashing = flash?.keys.includes(key);
                            return (
                              <button
                                key={key}
                                lang={side === 'en' ? 'en' : 'zh'}
                                className={
                                  'match-tile ' +
                                  (gone ? 'removed' : '') +
                                  (selected?.side === side &&
                                  selected.key === key
                                    ? ' selected'
                                    : '') +
                                  (flashing
                                    ? flash?.correct
                                      ? ' tile-pop'
                                      : ' tile-miss'
                                    : '')
                                }
                                aria-pressed={
                                  selected?.side === side &&
                                  selected.key === key
                                }
                                aria-label={
                                  (side === 'en' ? '英文 ' : '中文 ') +
                                  (side === 'en' ? w.word : w.meaning)
                                }
                                aria-hidden={gone}
                                tabIndex={gone ? -1 : 0}
                                disabled={gone || busy || !!failedAction}
                                onClick={() => pick(side, key)}
                              >
                                <span>
                                  {side === 'en' ? w.word : w.meaning}
                                </span>
                                {flashing && (
                                  <i className="tile-sparks" aria-hidden="true">
                                    {flash?.correct ? '✦' : '×'}
                                  </i>
                                )}
                              </button>
                            );
                          },
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : q && prompt && candidate ? (
                <div
                  className={
                    'duel-area ' +
                    (flash
                      ? flash.correct
                        ? 'duel-correct'
                        : 'duel-wrong'
                      : '')
                  }
                >
                  <div
                    className="duel-card"
                    key={`${game.round}:${game.cursor}`}
                  >
                    <span className="duel-direction">
                      {q.direction === 'en' ? '英文 → 中文' : '中文 → 英文'}
                    </span>
                    <h2 lang={q.direction === 'en' ? 'en' : 'zh'}>
                      {q.direction === 'en' ? prompt.word : prompt.meaning}
                    </h2>
                    <div className="duel-divider" />
                    <p lang={q.direction === 'en' ? 'zh' : 'en'}>
                      {q.direction === 'en'
                        ? candidate.meaning
                        : candidate.word}
                    </p>
                  </div>
                  <div className="duel-answers">
                    <button
                      className="answer-no"
                      disabled={busy || !!failedAction}
                      aria-label="不对应"
                      onClick={() =>
                        void submit({ kind: 'judge', correct: false })
                      }
                    >
                      <X />
                      不对应
                    </button>
                    <button
                      className="answer-yes"
                      disabled={busy || !!failedAction}
                      aria-label="对应"
                      onClick={() =>
                        void submit({ kind: 'judge', correct: true })
                      }
                    >
                      <Check />
                      对应
                    </button>
                  </div>
                </div>
              ) : null}
              <output
                className={
                  'game-feedback ' +
                  (flash ? (flash.correct ? 'right' : 'wrong') : '')
                }
                aria-live="polite"
              >
                {flash
                  ? flash.correct
                    ? '正确'
                    : flash.keys
                        .map((key) => {
                          const w = wordsByKey.get(key)!;
                          return `${w.word} · ${w.meaning}`;
                        })
                        .join('　/　')
                  : busy
                    ? '正在保存…'
                    : game.round_errors
                      ? `本轮已记错 ${game.round_errors} 次，做完后重来本阶段`
                      : game.stage === 1
                        ? '整轮全对后进入下一阶段'
                        : '整轮全对后完成本组'}
              </output>
            </>
          )}
          <footer className="learner-foot">进度自动保存 · AI 合成语音</footer>
        </section>
      ) : null}
    </main>
  );
}
function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 32 }, (_, i) => (
        <i
          key={i}
          style={
            {
              '--x': `${(i * 37) % 100}%`,
              '--delay': `${(i % 7) * 0.08}s`,
              '--hue': String((i * 53) % 360),
              '--drift': `${(i % 2 ? 1 : -1) * (40 + i * 3)}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
