'use client';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import Image from 'next/image';
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
  Coins,
  History,
  Maximize,
  Minimize,
} from 'lucide-react';
import { api, ApiError } from '@/lib/classroom';
import { StudentAudio } from '@/lib/student-audio';
import { StudentProgress, ProgressConflict } from '@/lib/student-progress';
import { StudentRecords } from './student-records';
import { StudentRecall } from './student-recall';
import {
  currentRecall,
  hasCorrection,
  studentVoiceTexts,
} from '@/lib/student-game';
import type {
  GameAction,
  GameFeedback,
  StudentDashboard,
  StudentSession,
} from '@/lib/student-game';

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
const englishOnScreen = studentVoiceTexts;
export function StudentLearning() {
  const [dashboard, setDashboard] = useState<StudentDashboard | null>(null),
    [session, setSession] = useState<StudentSession | null>(null);
  const [records, setRecords] = useState<'words' | 'history' | 'points' | null>(
      null,
    ),
    [practiceMode, setPracticeMode] = useState<'adaptive' | 'challenge'>(
      'adaptive',
    );
  const [groupSize, setGroupSize] = useState(10);
  const [mode, setMode] = useState<'home' | 'play'>('home'),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [voice, setVoice] = useState(true),
    [effects, setEffects] = useState(true),
    [audioNotice, setAudioNotice] = useState(''),
    [full, setFull] = useState(false);
  const [selected, setSelected] = useState<{
      side: 'en' | 'zh';
      key: string;
    } | null>(null),
    [flash, setFlash] = useState<GameFeedback | null>(null);
  const [failedSave, setFailedSave] = useState(false),
    [saving, setSaving] = useState(false),
    [storageNotice, setStorageNotice] = useState('');
  const progress = useRef<StudentProgress | null>(null);
  const syncFlight = useRef<Promise<boolean> | null>(null);
  const correctionTitle = useRef<HTMLHeadingElement | null>(null);
  const audio = useRef<StudentAudio | null>(null),
    lock = useRef(false),
    alive = useRef(true);
  const load = useCallback(async () => {
    const value = await api<StudentDashboard>('/student/state');
    if (alive.current) {
      progress.current = value.session
        ? new StudentProgress(value.student.id, value.session)
        : null;
      const restored = progress.current?.session || null;
      setDashboard({ ...value, session: restored });
      setSession(restored);
      setStorageNotice(
        progress.current && !progress.current.storageAvailable
          ? '浏览器无法暂存进度，刷新将回到上次保存的位置。'
          : '',
      );
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
  useEffect(() => {
    const changed = () => setFull(Boolean(document.fullscreenElement));
    changed();
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => {
    if (mode !== 'play') return;
    const root = document.documentElement,
      body = document.body;
    root.classList.add('student-practice-active');
    body.classList.add('student-practice-active');
    return () => {
      root.classList.remove('student-practice-active');
      body.classList.remove('student-practice-active');
    };
  }, [mode]);
  const game = session?.game;
  const correctionPage =
    mode === 'play' && !records && game && hasCorrection(game)
      ? `${session?.id}:${game.answers}`
      : '';
  useEffect(() => {
    if (correctionPage) correctionTitle.current?.focus();
  }, [correctionPage]);
  const voicePage =
    mode === 'play' && game && !records
      ? `${session.id}:${game.stage}:${game.round}:${game.adaptive ? (game.stage === 1 ? game.adaptive.board : game.adaptive.cursor) : game.stage === 2 ? game.cursor : 'board'}:${game.needs_retry}:${hasCorrection(game)}`
      : '';
  const onVoicePage = useEffectEvent(() => {
    if (voice && mode === 'play' && game && !records)
      void audio.current?.play(englishOnScreen(game));
    else audio.current?.stop();
  });
  useEffect(() => {
    onVoicePage();
    return () => audio.current?.stop();
  }, [voicePage, voice]);
  function enterPracticeFullscreen() {
    if (
      !document.fullscreenElement &&
      document.documentElement.requestFullscreen
    )
      void document.documentElement.requestFullscreen().catch(() => {});
  }
  function leavePracticeFullscreen() {
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
  }
  function togglePracticeFullscreen() {
    if (document.fullscreenElement) leavePracticeFullscreen();
    else enterPracticeFullscreen();
  }
  async function start(extra = false) {
    if (lock.current) return;
    // Keep this inside the student's click gesture so supporting browsers can
    // enter presentation mode before the first network request completes.
    enterPracticeFullscreen();
    lock.current = true;
    setBusy(true);
    setError('');
    audio.current?.unlock();
    try {
      if (progress.current?.pending) {
        if (progress.current.session.game.stage !== 'done') {
          setSession(progress.current.session);
          setMode('play');
          if (progress.current.needsCheckpoint) void saveProgress();
          return;
        }
        if (!(await saveProgress(true))) return;
      }
      const value = await api<{ session: StudentSession | null }>(
        '/student/sessions',
        { count: groupSize, extra, mode: practiceMode },
      );
      if (!alive.current) return;
      if (value.session) {
        progress.current = new StudentProgress(
          dashboard!.student.id,
          value.session,
        );
        setSession(progress.current.session);
        setSelected(null);
        setFlash(null);
        setFailedSave(false);
        setMode('play');
        if (progress.current.needsCheckpoint) void saveProgress();
      } else {
        await load();
        setMode('home');
        leavePracticeFullscreen();
      }
    } catch (e) {
      if (mode !== 'play') leavePracticeFullscreen();
      setError(e instanceof Error ? e.message : '开始失败，请重试');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function saveProgress(force = false): Promise<boolean> {
    if (syncFlight.current) {
      const ok = await syncFlight.current;
      return ok && force && progress.current?.pending ? saveProgress(true) : ok;
    }
    const current = progress.current;
    if (!current?.pending) return true;
    const job = async () => {
      setSaving(true);
      try {
        do {
          const payload = current.beginCheckpoint();
          if (!payload) break;
          const controller = new AbortController();
          const timeout = window.setTimeout(() => controller.abort(), 15000);
          let result: StudentSession;
          try {
            result = await api<StudentSession>(
              '/student/sessions/' + current.session.id + '/actions',
              payload,
              'POST',
              controller.signal,
            );
          } finally {
            window.clearTimeout(timeout);
          }
          if (!alive.current || progress.current !== current) return false;
          current.accept(result);
          // Answers entered while this request was in flight remain on screen and in the next batch.
          setSession(current.session);
          setFailedSave(false);
          setError('');
        } while (current.pending && (force || current.needsCheckpoint));
        if (current.session.completed_at && !current.pending) {
          void api<StudentDashboard>('/student/state')
            .then((latest) => {
              if (alive.current && progress.current === current)
                setDashboard(latest);
            })
            .catch(() => {
              /* Statistics can refresh later; never hold the saved result. */
            });
        }
        return true;
      } catch (e) {
        if (!alive.current || progress.current !== current) return false;
        if (
          e instanceof ProgressConflict ||
          (e instanceof ApiError && e.status === 409)
        ) {
          current.discard();
          setFailedSave(false);
          setSelected(null);
          setFlash(null);
          audio.current?.stop();
          try {
            await load();
          } catch {
            /* Keep a visible recovery message. */
          }
          setMode('home');
          leavePracticeFullscreen();
          setError('练习或课堂词表已更新，请继续最新进度。');
        } else {
          setFailedSave(true);
          setError('进度已暂存在本机，可以继续答题；联网后会重试同步。');
        }
        return false;
      } finally {
        if (alive.current) setSaving(false);
      }
    };
    const promise = job();
    syncFlight.current = promise;
    try {
      return await promise;
    } finally {
      if (syncFlight.current === promise) syncFlight.current = null;
    }
  }
  function retrySave() {
    return saveProgress(true);
  }
  const syncOnReconnect = useEffectEvent(() => {
    if (progress.current?.pending) void saveProgress(true);
  });
  useEffect(() => {
    const online = () => syncOnReconnect();
    window.addEventListener('online', online);
    const timer = failedSave
      ? window.setInterval(() => {
          if (navigator.onLine) online();
        }, 15000)
      : undefined;
    return () => {
      window.removeEventListener('online', online);
      window.clearInterval(timer);
    };
  }, [failedSave]);
  useEffect(() => {
    const flush = () => {
      const current = progress.current,
        payload = current?.beginCheckpoint();
      if (!current || !payload) return;
      const body = JSON.stringify(payload);
      if (new TextEncoder().encode(body).length > 55000) return;
      void fetch('/api/student/sessions/' + current.session.id + '/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        keepalive: true,
        body,
      }).catch(() => {});
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);
  async function submit(action: GameAction) {
    if (!progress.current || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const current = progress.current;
      const previousStage = current.session.game.stage,
        alreadyDue = current.needsCheckpoint;
      const result = current.choose(action),
        feedback = result.game.feedback;
      setStorageNotice(
        current.storageAvailable
          ? ''
          : '浏览器无法暂存进度，刷新将回到上次保存的位置。',
      );
      if (
        action.kind !== 'retry' &&
        action.kind !== 'acknowledge' &&
        action.kind !== 'hint' &&
        feedback
      ) {
        setFlash(feedback);
        if (effects) audio.current?.effect(feedback.correct);
        if (!feedback.correct && voice && !result.game.practice)
          void audio.current?.play(
            feedback.keys.map(
              (key) => result.game.words.find((w) => w.key === key)!.word,
            ),
          );
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            feedback.correct
              ? 220
              : result.game.practice || result.game.adaptive
                ? 180
                : 1100,
          ),
        );
      }
      if (alive.current) {
        setSession(current.session);
        setSelected(null);
        setFlash(null);
        if (
          current.session.game.stage !== previousStage ||
          (!alreadyDue && current.needsCheckpoint)
        )
          void saveProgress();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '请重新选择');
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function pick(side: 'en' | 'zh', key: string) {
    if (!game || busy || hasCorrection(game) || game.removed.includes(key))
      return;
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
  async function home(logout = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    audio.current?.stop();
    try {
      if (logout && !(await saveProgress(true))) return;
      if (logout) window.dispatchEvent(new Event('kite-logout'));
      else {
        setMode('home');
        leavePracticeFullscreen();
        setSelected(null);
        setFlash(null);
        if (progress.current?.pending) {
          setDashboard((value) =>
            value ? { ...value, session: progress.current!.session } : value,
          );
          void saveProgress(true);
        } else {
          setFailedSave(false);
          setError('');
          await load();
        }
      }
      if (logout) leavePracticeFullscreen();
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败');
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
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
          {mode === 'play' && (
            <button
              className="icon-btn"
              aria-label={full ? '退出浏览器全屏' : '进入浏览器全屏'}
              aria-pressed={full}
              onClick={togglePracticeFullscreen}
            >
              {full ? <Minimize size={19} /> : <Maximize size={19} />}
            </button>
          )}
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
            onClick={() => void home(true)}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      {error && (
        <div className="learner-error" role="alert">
          {error}
          {failedSave ? (
            <button disabled={busy} onClick={() => void retrySave()}>
              重试保存
            </button>
          ) : (
            <button disabled={busy} onClick={() => void home()}>
              刷新
            </button>
          )}
        </div>
      )}
      {dashboard && (
        <div className="learner-progress-strip">
          <button
            disabled={busy}
            onClick={() => setRecords('words')}
            className="mastery-progress"
          >
            <span>
              已记熟 <b>{dashboard.mastered}</b> / {dashboard.total} 词
            </span>
            <progress
              value={dashboard.mastered}
              max={Math.max(dashboard.total, 1)}
              aria-label="记熟单词进度"
            />
            <small>
              初识{' '}
              {dashboard.practiced -
                dashboard.mastered -
                dashboard.consolidating}{' '}
              · 巩固中 {dashboard.consolidating} · 待复习 {dashboard.due}
            </small>
          </button>
          <button
            className="points-badge"
            disabled={busy}
            onClick={() => setRecords('points')}
          >
            <Coins size={23} />
            <b>{dashboard.points.balance}</b>
            <span>积分</span>
          </button>
          <button
            className="btn ghost"
            disabled={busy}
            onClick={() => setRecords('history')}
          >
            <History size={17} />
            学习记录
          </button>
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
                      ? `每组 ${groupSize} 词`
                      : '本次复习已完成'}
                </h2>
                <p>
                  {dashboard.session
                    ? dashboard.session.game.stage === 'done'
                      ? '本组已完成，等待同步'
                      : `第 ${dashboard.session.game.stage} 阶段 · ${progress.current?.pending ? '本机已暂存' : '进度已保存'}`
                    : canStudy
                      ? practiceMode === 'adaptive'
                        ? '词义热身 → 回忆与听音'
                        : '中英消消乐 → 中英对决'
                      : dashboard.next_due
                        ? `下次复习：${when(dashboard.next_due)}`
                        : '暂无到期单词'}
                </p>
              </div>
              {!dashboard.session && (
                <div className="practice-options">
                  <label className="practice-mode">
                    模式
                    <select
                      value={practiceMode}
                      onChange={(e) =>
                        setPracticeMode(
                          e.target.value as 'adaptive' | 'challenge',
                        )
                      }
                      disabled={busy}
                    >
                      <option value="adaptive">日常练习 · 按薄弱项出题</option>
                      <option value="challenge">挑战模式 · 整轮全对</option>
                    </select>
                  </label>
                  <label className="practice-mode">
                    数量
                    <select
                      value={groupSize}
                      disabled={busy}
                      onChange={(e) => setGroupSize(Number(e.target.value))}
                    >
                      <option value={5}>5 个词</option>
                      <option value={10}>10 个词</option>
                    </select>
                  </label>
                </div>
              )}
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
        <section className="learning-game" data-answers={game.answers}>
          {game.stage === 'done' ? (
            <div className="session-done">
              <Confetti />
              <CheckCheck className="done-icon" />
              <h1>本组完成</h1>
              <p>
                {game.words.length} 个单词 ·{' '}
                {session?.completed_at ? '进度已保存' : '已完成，进度待同步'}
              </p>
              {!!game.adaptive?.deferred.length && (
                <p>
                  还有 {game.adaptive.deferred.length} 个词需要巩固，下次继续。
                </p>
              )}
              {!!session?.earned?.points && (
                <p className="earned-reward">
                  <Coins size={24} />
                  新记熟 {session.earned.words} 个词，获得{' '}
                  <b>+{session.earned.points}</b> 积分
                </p>
              )}
              <div className="done-word-grid">
                {game.words.map((w) => (
                  <div key={w.key}>
                    <strong lang="en">{w.word}</strong>
                    <span>{w.meaning}</span>
                    {game.errors[w.key] ? (
                      <small>记错 {game.errors[w.key]} 次 · 5 分钟后再练</small>
                    ) : (
                      <small>
                        {Object.values(
                          game.adaptive?.evidence[w.key] || {},
                        ).some((e) => e.grade === 'hinted')
                          ? '提示后答对 · 稍后再巩固'
                          : session?.completed_at
                            ? '已安排下次复习'
                            : '等待同步复习安排'}
                      </small>
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
                  disabled={busy || saving || !!progress.current?.pending}
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
                      1 {game.adaptive ? '词义热身' : '消消乐'}
                    </span>
                    <i />
                    <span className={game.stage === 2 ? 'current' : ''}>
                      2 {game.adaptive ? '回忆与听音' : '中英对决'}
                    </span>
                  </div>
                  <h1>
                    {game.stage === 1
                      ? '中英消消乐'
                      : game.adaptive
                        ? '想一想，记起来'
                        : '中英对决'}
                  </h1>
                </div>
                <div className="round-counter">
                  <strong>
                    {game.adaptive
                      ? '按你的薄弱项练习'
                      : game.practice
                        ? game.round > 1
                          ? '错词补练'
                          : '日常练习'
                        : `挑战 · 第 ${game.round} 轮`}
                  </strong>
                  <span>
                    {game.adaptive
                      ? game.stage === 1
                        ? `${Math.min(game.adaptive.board * 5 + game.removed.length, game.adaptive.warmup.length)} / ${game.adaptive.warmup.length} 词`
                        : `${game.adaptive.cursor} / ${game.adaptive.tasks.length} 题`
                      : game.stage === 1
                        ? `${game.practice ? game.practice.passed.length : game.removed.length} / ${game.words.length} 词已通过`
                        : `${game.practice ? game.practice.directions.length : game.cursor} / ${game.practice ? game.words.length * 2 : game.questions.length} 题已通过`}
                  </span>
                </div>
              </div>
              <div className="game-instruction">
                <span>
                  {game.stage === 1
                    ? '选一个英文，再选对应中文，也可以反过来。'
                    : game.adaptive
                      ? currentRecall(game)?.skill === 'spelling'
                        ? '先试着想起英文，需要时可以用提示。'
                        : '听单词，选出对应的中文。'
                      : '英文和中文是否对应？'}
                </span>
                {(!game.adaptive ||
                  game.stage === 1 ||
                  currentRecall(game)?.skill === 'listening' ||
                  hasCorrection(game)) && (
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
                )}
              </div>
              {audioNotice && (
                <output className="audio-notice">{audioNotice}</output>
              )}
              {hasCorrection(game) ? (
                <section className="correction-panel" aria-label="看清正确答案">
                  <h2 ref={correctionTitle} tabIndex={-1}>
                    {game.feedback?.keys.length === 1
                      ? '记住这个词的意思'
                      : '一起看清这两个词的区别'}
                  </h2>
                  <div className="correction-grid">
                    {game.feedback?.keys.map((key) => {
                      const w = wordsByKey.get(key)!;
                      return (
                        <article key={key}>
                          {w.image && (
                            <Image
                              unoptimized
                              width={600}
                              height={400}
                              src={w.image}
                              alt={w.meaning}
                              onError={(e) => {
                                e.currentTarget.hidden = true;
                              }}
                            />
                          )}
                          <div>
                            <h3 lang="en">
                              {w.word}
                              <button
                                className="icon-btn"
                                aria-label={'朗读 ' + w.word}
                                onClick={() => {
                                  audio.current?.unlock();
                                  void audio.current?.play([w.word]);
                                }}
                              >
                                <Volume2 size={22} />
                              </button>
                            </h3>
                            {w.phonetic && (
                              <small lang="en">{w.phonetic}</small>
                            )}
                            <strong>{w.meaning}</strong>
                            {w.example && (
                              <>
                                <p lang="en">
                                  {w.example}
                                  <button
                                    className="icon-btn"
                                    aria-label={'朗读例句 ' + w.word}
                                    onClick={() => {
                                      audio.current?.unlock();
                                      void audio.current?.play([w.example]);
                                    }}
                                  >
                                    <Volume2 size={18} />
                                  </button>
                                </p>
                                <p className="example-translation">
                                  {w.example_zh}
                                </p>
                              </>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  <button
                    className="btn primary large"
                    disabled={busy}
                    onClick={() => void submit({ kind: 'acknowledge' })}
                  >
                    看清了，继续 <ArrowRight size={20} />
                  </button>
                </section>
              ) : game.needs_retry ? (
                <div className="round-retry">
                  <RefreshCw />
                  <h2>
                    {game.practice
                      ? '把刚才的错词再试一次'
                      : `本轮有 ${game.round_errors} 次错误`}
                  </h2>
                  <p>
                    {game.practice
                      ? '答对的进度已经保留，只练还没通过的部分。'
                      : '重新练习本阶段，整轮全对后继续。'}
                  </p>
                  <button
                    className="btn primary"
                    disabled={busy}
                    onClick={() => void submit({ kind: 'retry' })}
                  >
                    {game.practice ? '开始补练' : '重试本阶段'}
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
                                disabled={gone || busy}
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
              ) : game.adaptive && currentRecall(game) ? (
                <StudentRecall
                  key={`${session.id}:${game.adaptive.cursor}`}
                  game={game}
                  disabled={busy}
                  onAction={(action) => void submit(action)}
                  onPlay={(text) => {
                    audio.current?.unlock();
                    void audio.current?.play([text]);
                  }}
                />
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
                      disabled={busy}
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
                      disabled={busy}
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
                  : saving
                    ? '正在同步本阶段…'
                    : game.adaptive
                      ? hasCorrection(game)
                        ? '看清后再继续，不用着急。'
                        : ''
                      : game.practice
                        ? game.practice.correction
                          ? '看清后再继续，不用着急。'
                          : '答对的进度会保留，错词稍后再练。'
                        : game.round_errors
                          ? `本轮已记错 ${game.round_errors} 次，做完后重来本阶段`
                          : game.stage === 1
                            ? '整轮全对后进入下一阶段'
                            : '整轮全对后完成本组'}
              </output>
            </>
          )}
          <footer className="learner-foot" aria-live="polite">
            {storageNotice ||
              (saving
                ? '正在同步进度…'
                : failedSave
                  ? '进度已暂存，等待同步'
                  : '本机暂存进度 · 阶段结束自动同步')}
            {' · AI 合成语音'}
          </footer>
        </section>
      ) : null}
      {records && (
        <StudentRecords initialTab={records} onClose={() => setRecords(null)} />
      )}
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
