'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Replace,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { api, bands, type SelectionDraft, type Word } from '@/lib/classroom';
import { wordLabel } from '@/lib/slides';

export function WordSelection({
  draft,
  number,
  busy,
  onDraft,
  onBack,
  onReroll,
  onConfirm,
}: {
  draft: SelectionDraft;
  number: number;
  busy: boolean;
  onDraft: (draft: SelectionDraft) => void;
  onBack: () => void;
  onReroll: () => Promise<void>;
  onConfirm: (id: string, revision: number) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [results, setResults] = useState<Word[]>([]);
  const [searching, setSearching] = useState(true);
  const [searchError, setSearchError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [replacing, setReplacing] = useState<Word | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const pending = busy || saving;
  const selected = new Set(
    draft.words
      .filter((w) => w.id !== replacing?.id)
      .map((w) => w.word.toLowerCase()),
  );
  const levels = [...new Set(draft.words.map((w) => w.level))];
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchError('');
      void api<Word[]>(
        '/vocabulary?level=ALL&class_id=' +
          draft.class_id +
          '&q=' +
          encodeURIComponent(query.trim()) +
          '&offset=' +
          offset,
      )
        .then((words) => {
          if (active) setResults(words);
        })
        .catch((e) => {
          if (active) {
            setResults([]);
            setSearchError(e.message);
          }
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, offset, draft.class_id]);
  async function saveWords(ids: number[]) {
    if (lock.current || busy) return false;
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      onDraft(
        await api<SelectionDraft>(
          '/drafts/' + draft.id,
          { revision: draft.revision, word_ids: ids },
          'PATCH',
        ),
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '没有保存成功，请重试。');
      return false;
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  async function add(word: Word) {
    const ids = replacing
      ? draft.words.map((w) => (w.id === replacing.id ? word.id : w.id))
      : [...draft.words.map((w) => w.id), word.id];
    if (await saveWords(ids)) setReplacing(null);
  }
  async function remove(word: Word) {
    if (
      await saveWords(
        draft.words.filter((w) => w.id !== word.id).map((w) => w.id),
      )
    ) {
      if (replacing?.id === word.id) setReplacing(null);
    }
  }
  function move(index: number, direction: number) {
    const ids = draft.words.map((w) => w.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    void saveWords(ids);
  }
  return (
    <div className="selection-page">
      <div className="title-row">
        <div>
          <p className="eyebrow">
            第 {String(number).padStart(2, '0')} 课 · 确认词单
          </p>
          <h1>确认单词列表</h1>
          <p className="muted">
            {draft.title} · 确认后，按这里的顺序保存例句、故事、课件和练习。
          </p>
        </div>
        <button className="btn ghost" onClick={onBack} disabled={pending}>
          <ArrowLeft size={17} />
          调整抽词条件
        </button>
      </div>
      <div className="selection-grid">
        <section className="panel selected-panel" aria-label="本课候选单词">
          <header className="selection-heading">
            <div>
              <h2>
                本课词表 <span>{draft.words.length}</span>
              </h2>
              <p>
                {levels.length ? levels.join(' + ') : '还没有选择单词'} · 最多
                100 词
              </p>
            </div>
            <button
              className="btn ghost"
              disabled={pending}
              onClick={() => {
                setReplacing(null);
                void onReroll();
              }}
            >
              <RefreshCw size={16} />
              重新抽选
            </button>
          </header>
          <ol className="selected-words">
            {draft.words.map((word, index) => (
              <li
                key={word.id}
                className={replacing?.id === word.id ? 'replacing' : ''}
                data-word-id={word.id}
              >
                <span className="selected-number">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="selected-word-copy">
                  <div>
                    <strong lang="en">{wordLabel(word)}</strong>
                    <span className="word-source">
                      {word.level} · {bands[word.difficulty]}
                    </span>
                  </div>
                  <p>
                    {word.pos} {word.meaning_zh}
                  </p>
                  <p className="selection-example" lang="en">
                    {word.example}
                  </p>
                </div>
                <div className="selection-row-actions">
                  <div>
                    <button
                      className="icon-btn"
                      aria-label={'上移 ' + wordLabel(word)}
                      disabled={pending || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={'下移 ' + wordLabel(word)}
                      disabled={pending || index === draft.words.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                  <div>
                    <button
                      className="icon-btn"
                      aria-label={'替换 ' + wordLabel(word)}
                      disabled={pending}
                      onClick={() => {
                        setReplacing(word);
                        setQuery('');
                        setOffset(0);
                        input.current?.focus();
                        input.current?.scrollIntoView({
                          block: 'center',
                          behavior: 'smooth',
                        });
                      }}
                    >
                      <Replace size={17} />
                    </button>
                    <button
                      className="icon-btn selection-remove"
                      aria-label={'删除 ' + wordLabel(word)}
                      disabled={pending}
                      onClick={() => void remove(word)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {!draft.words.length && (
            <div className="selection-empty">
              <Search size={30} />
              <h3>从右侧搜索，添加想教的单词。</h3>
              <p>至少选择 1 个单词即可创建课程。</p>
            </div>
          )}
        </section>
        <aside className="panel word-search" aria-label="从全部词库选词">
          <div className="selection-heading">
            <div>
              <h2>
                <Search size={20} />
                从全部词库选词
              </h2>
              <p>输入英文或中文，搜索所有已导入词库。</p>
            </div>
          </div>
          <div className="selection-search-input">
            <Input
              ref={input}
              aria-label="搜索全部词库"
              placeholder="搜索英文或中文，例如 journey / 旅行"
              maxLength={80}
              value={query}
              onChange={(event) => {
                setSearching(true);
                setQuery(event.target.value);
                setOffset(0);
              }}
            />
          </div>
          {replacing && (
            <div className="replacement-banner">
              <span>
                选择一个词，替换 <strong>{wordLabel(replacing)}</strong>
              </span>
              <button
                className="icon-btn"
                aria-label="取消替换"
                disabled={pending}
                onClick={() => setReplacing(null)}
              >
                <X size={17} />
              </button>
            </div>
          )}
          <p className="selection-hint">
            手动选词可跨词表和难度，也可选已学词；同一英文单词只保留一次。
          </p>
          <div
            className="search-results"
            aria-live="polite"
            aria-busy={searching}
          >
            {searching ? (
              <p className="search-status">
                <Loader2 className="spin" size={18} />
                正在搜索词库…
              </p>
            ) : searchError ? (
              <p className="selection-error">{searchError}</p>
            ) : !results.length ? (
              <p className="search-status">
                没有找到，试试更短的英文或中文关键词。
              </p>
            ) : (
              results.map((word) => {
                const picked = selected.has(word.word.toLowerCase());
                return (
                  <article key={word.id} data-word-id={word.id}>
                    <div>
                      <strong lang="en">{wordLabel(word)}</strong>
                      <span className="word-source">
                        {word.level} · {bands[word.difficulty]}
                      </span>
                      <p>
                        {word.pos} {word.meaning_zh}
                      </p>
                      {(word.seen || word.reserved || word.is_basic) && (
                        <small>
                          {[
                            word.seen && '本班已学',
                            word.reserved && '进行中课程已选',
                            word.is_basic && '基础常见词',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      )}
                    </div>
                    <button
                      className={'btn ' + (picked ? 'ghost' : 'secondary')}
                      disabled={
                        pending ||
                        picked ||
                        (!replacing && draft.words.length >= 100)
                      }
                      onClick={() => void add(word)}
                      aria-label={
                        (picked ? '已选择 ' : replacing ? '使用 ' : '添加 ') +
                        wordLabel(word) +
                        ' · ' +
                        word.level
                      }
                    >
                      {picked ? (
                        <Check size={16} />
                      ) : replacing ? (
                        <Replace size={16} />
                      ) : (
                        <Plus size={16} />
                      )}
                      {picked ? '已选' : replacing ? '替换' : '添加'}
                    </button>
                  </article>
                );
              })
            )}
          </div>
          <div className="selection-search-pages">
            <button
              className="btn ghost"
              disabled={searching || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 40))}
            >
              上一页
            </button>
            <span>第 {offset / 40 + 1} 页</span>
            <button
              className="btn ghost"
              disabled={searching || results.length < 40}
              onClick={() => setOffset(offset + 40)}
            >
              下一页
            </button>
          </div>
        </aside>
      </div>
      <footer className="selection-confirm">
        <div>
          <output>
            {error ? (
              <span className="selection-error">{error}</span>
            ) : saving ? (
              <>
                <Loader2 className="spin" size={18} />
                正在保存选词…
              </>
            ) : (
              <>
                <CheckCircle2 size={18} />
                词表草稿已保存
              </>
            )}
          </output>
          <p>
            已选 {draft.words.length} 词 ·{' '}
            {draft.lesson_id
              ? '确认后保存为新版本，原版本保留。'
              : '确认后才创建课程，刷新可继续选词。'}
          </p>
        </div>
        <button
          className="btn primary large"
          disabled={pending || !draft.words.length}
          onClick={() => void onConfirm(draft.id, draft.revision)}
        >
          {busy ? <Loader2 className="spin" size={19} /> : <Check size={19} />}
          {draft.lesson_id
            ? '确认并保存新版本'
            : '确认并创建第 ' + number + ' 课'}
          <ArrowRight size={18} />
        </button>
      </footer>
    </div>
  );
}
