'use client';
import { useEffect, useState } from 'react';
import { Coins, History, BookOpen, ArrowLeft, Loader2 } from 'lucide-react';
import { api } from '@/lib/classroom';
import {
  memoryLevel,
  type PointsEntry,
  type PointsSummary,
  type StudyWord,
  type WordMemory,
  type WordReview,
} from '@/lib/student-game';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export const recordTime = (date: string) =>
  new Date(date).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
export type PointsData = {
  points: PointsSummary;
  entries: PointsEntry[];
  next: string | null;
};
type HistoryData = {
  words: (StudyWord & { memory: WordMemory | null; available?: boolean })[];
  archived_count: number;
  recent: { id: string; completed_at: string; words: number; errors: number }[];
  next: string | null;
};
const levels = {
  fresh: '还没练',
  learning: '初识',
  consolidating: '巩固中',
  mastered: '已记熟',
};
export function PointsLedger({ entries }: { entries: PointsEntry[] }) {
  return entries.length ? (
    <ul className="points-ledger">
      {entries.map((entry) => (
        <li key={entry.id}>
          <div>
            <strong>
              {entry.reason}
              {entry.word_key ? ' · ' + entry.word_key : ''}
            </strong>
            <small>
              {recordTime(entry.created_at)} ·{' '}
              {
                {
                  mastery: '记熟奖励',
                  bonus: '老师加分',
                  redeem: '兑换奖励',
                  adjustment: '余额调整',
                }[entry.kind]
              }
            </small>
          </div>
          <b className={entry.amount >= 0 ? 'positive' : 'deduction'}>
            {entry.amount > 0 ? '+' : ''}
            {entry.amount}
          </b>
        </li>
      ))}
    </ul>
  ) : (
    <p className="record-empty">还没有积分记录。</p>
  );
}

export function StudentRecords({
  initialTab,
  onClose,
}: {
  initialTab: 'words' | 'history' | 'points';
  onClose: () => void;
}) {
  const [stamp] = useState(() => Date.now());
  const [tab, setTab] = useState(initialTab),
    [history, setHistory] = useState<HistoryData | null>(null),
    [points, setPoints] = useState<PointsData | null>(null);
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [more, setMore] = useState(false);
  const [word, setWord] = useState<HistoryData['words'][number] | null>(null),
    [reviews, setReviews] = useState<{
      reviews: WordReview[];
      next: string | null;
    } | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([
      api<HistoryData>('/student/history'),
      api<PointsData>('/student/points'),
    ])
      .then(([h, p]) => {
        if (live) {
          setHistory(h);
          setPoints(p);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!word) return;
    let live = true;
    void api<{ reviews: WordReview[]; next: string | null }>(
      '/student/memory?word=' + encodeURIComponent(word.key),
    )
      .then((r) => {
        if (live) setReviews(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [word]);
  async function loadMore() {
    if (more) return;
    setMore(true);
    setError('');
    try {
      if (word && reviews?.next) {
        const next = await api<typeof reviews>(
          '/student/memory?word=' +
            encodeURIComponent(word.key) +
            '&before=' +
            reviews.next,
        );
        setReviews({ ...next, reviews: [...reviews.reviews, ...next.reviews] });
      } else if (tab === 'history' && history?.next) {
        const next = await api<HistoryData>(
          '/student/history?before=' + history.next,
        );
        setHistory({ ...next, recent: [...history.recent, ...next.recent] });
      } else if (tab === 'points' && points?.next) {
        const next = await api<PointsData>(
          '/student/points?before=' + points.next,
        );
        setPoints({ ...next, entries: [...points.entries, ...next.entries] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败');
    } finally {
      setMore(false);
    }
  }
  const visible =
    history?.words.filter(
      (w) =>
        (w.word.toLowerCase().includes(query.trim().toLowerCase()) ||
          w.meaning.includes(query.trim())) &&
        (filter === 'all' || filter === memoryLevel(w.memory || undefined)),
    ) || [];
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="student-record-dialog">
        <DialogTitle>我的学习记录</DialogTitle>
        <DialogDescription>
          每个单词都有自己的复习时间，答错后会提前再练。
        </DialogDescription>
        <div className="record-tabs" role="tablist" aria-label="学习记录">
          <button
            role="tab"
            aria-selected={tab === 'words'}
            onClick={() => {
              setTab('words');
              setWord(null);
            }}
          >
            <BookOpen size={17} />
            单词进度
          </button>
          <button
            role="tab"
            aria-selected={tab === 'history'}
            onClick={() => {
              setTab('history');
              setWord(null);
            }}
          >
            <History size={17} />
            练习历史
          </button>
          <button
            role="tab"
            aria-selected={tab === 'points'}
            onClick={() => {
              setTab('points');
              setWord(null);
            }}
          >
            <Coins size={17} />
            积分明细
          </button>
        </div>
        {error && (
          <p role="alert">
            {error}
            <button className="btn ghost" onClick={onClose}>
              关闭后重试
            </button>
          </p>
        )}
        {loading ? (
          <p className="record-empty">
            <Loader2 className="spin" />
            读取记录…
          </p>
        ) : (
          <div className="record-scroll">
            {tab === 'words' &&
              (word ? (
                <>
                  <button className="btn ghost" onClick={() => setWord(null)}>
                    <ArrowLeft size={16} />
                    所有单词
                  </button>
                  <h2 className="record-word-title" lang="en">
                    {word.word}
                  </h2>
                  <p>{word.meaning}</p>
                  {word.memory ? (
                    <>
                      <div className="memory-summary">
                        <b>{levels[memoryLevel(word.memory)]}</b>
                        <span>练过 {word.memory.reviews} 组</span>
                        <span>累计错 {word.memory.lapses} 次</span>
                      </div>
                      <p>
                        下次复习：{recordTime(word.memory.due_at)}
                        {Date.parse(word.memory.due_at) <= stamp
                          ? '（已到期）'
                          : ''}
                      </p>
                      <ol className="memory-path" aria-label="当前间隔复习进度">
                        {[
                          '10 分钟',
                          '1 天',
                          '3 天',
                          '7 天',
                          '14 天',
                          '30 天',
                          '60 天',
                        ].map((label, i) => (
                          <li
                            key={label}
                            className={
                              i === word.memory!.step
                                ? 'current'
                                : i < word.memory!.step
                                  ? 'passed'
                                  : ''
                            }
                            aria-current={
                              i === word.memory!.step ? 'step' : undefined
                            }
                          >
                            <i />
                            {label}
                          </li>
                        ))}
                      </ol>
                      <small className="record-note">
                        显示本次复习后的间隔；到期答对会延长，答错后 5
                        分钟再练。7 天及以上视为“记熟”。
                      </small>
                    </>
                  ) : (
                    <p className="record-empty">
                      首次完成一组后，就会安排下次复习。
                    </p>
                  )}
                  <h3>这个词的复习历史</h3>
                  {reviews ? (
                    reviews.reviews.length ? (
                      <ul className="word-review-list">
                        {reviews.reviews.map((r) => (
                          <li key={r.session_id}>
                            <span>{recordTime(r.created_at)}</span>
                            <b>
                              {r.errors
                                ? '补练过 ' + r.errors + ' 次'
                                : '全部答对'}
                            </b>
                            <small>下次：{recordTime(r.due_at)}</small>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="record-note">
                        暂无逐词明细。旧版累计次数保留在上方，新版开始记录每次复习。
                      </p>
                    )
                  ) : (
                    <p>读取中…</p>
                  )}
                  {reviews?.next && (
                    <button
                      className="btn secondary"
                      disabled={more}
                      onClick={() => void loadMore()}
                    >
                      更早的复习
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="record-filters">
                    <input
                      aria-label="搜索已学单词"
                      placeholder="搜索单词或中文"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <select
                      aria-label="掌握程度"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">全部程度</option>
                      {Object.entries(levels).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="memory-word-list">
                    {visible.map((w) => (
                      <button
                        key={w.key}
                        aria-label={w.word + ' 的记忆记录'}
                        onClick={() => {
                          setReviews(null);
                          setWord(w);
                          setError('');
                        }}
                      >
                        <div>
                          <strong lang="en">{w.word}</strong>
                          <span>{w.meaning}</span>
                        </div>
                        <div>
                          <b
                            className={
                              'memory-label ' +
                              memoryLevel(w.memory || undefined)
                            }
                          >
                            {levels[memoryLevel(w.memory || undefined)]}
                          </b>
                          <small>
                            {w.available === false
                              ? '已移出课堂词库 · 保留记录'
                              : w.memory
                                ? Date.parse(w.memory.due_at) <= stamp
                                  ? '待复习'
                                  : recordTime(w.memory.due_at) + ' 复习'
                                : '尚未开始'}
                          </small>
                        </div>
                      </button>
                    ))}
                  </div>
                  {!visible.length && (
                    <p className="record-empty">没有符合条件的单词。</p>
                  )}
                </>
              ))}
            {tab === 'history' && (
              <>
                {history?.recent.length ? (
                  <ul className="word-review-list">
                    {history.recent.map((r) => (
                      <li key={r.id}>
                        <span>{recordTime(r.completed_at)}</span>
                        <b>{r.words} 个词</b>
                        <small>
                          {r.errors
                            ? r.errors + ' 次错词记录，已完成补练'
                            : '全部答对'}
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="record-empty">
                    完成一组后，记录就会出现在这里。
                  </p>
                )}
                {history?.next && (
                  <button
                    className="btn secondary"
                    disabled={more}
                    onClick={() => void loadMore()}
                  >
                    更早的练习
                  </button>
                )}
              </>
            )}
            {tab === 'points' && points && (
              <>
                <div className="points-total">
                  <Coins />
                  <strong>{points.points.balance}</strong>
                  <span>可用积分</span>
                </div>
                <p className="record-note">
                  每个单词首次记熟可得 {points.points.points_per_word}{' '}
                  分，已奖励 {points.points.earned_words} 个词。找老师兑换奖励。
                </p>
                <PointsLedger entries={points.entries} />
                {points.next && (
                  <button
                    className="btn secondary"
                    disabled={more}
                    onClick={() => void loadMore()}
                  >
                    更早的明细
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
