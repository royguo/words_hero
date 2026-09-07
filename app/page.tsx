'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Sprout,
  Users,
  Plus,
  ArrowRight,
  ArrowLeft,
  BookOpen,
  Download,
  Library,
  Loader2,
  RefreshCw,
  Check,
  Layers,
  ChevronRight,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  api,
  bands,
  defaults,
  type Config,
  type State,
  type Lesson,
  type Word,
  type SelectionDraft,
} from '@/lib/classroom';
import { LessonRoom } from './lesson-room';
import { WordSelection } from './word-selection';

const empty: State = {
  classes: [],
  levels: [],
  lessons: [],
  learned: 0,
  due: 0,
  database: 'classroom.sqlite3',
};
function Brand() {
  return (
    <div className="brand">
      <span className="brand-symbol">
        <Sprout size={25} />
      </span>
      <div>
        词芽课堂<small>WORD GARDEN</small>
      </div>
    </div>
  );
}
function Choice({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string;
  items: { value: string; label: string; disabled?: boolean }[];
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(String(v))}>
      <SelectTrigger className="select-control" aria-label={label}>
        <SelectValue>
          {items.find((x) => x.value === value)?.label || label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((x) => (
          <SelectItem key={x.value} value={x.value} disabled={x.disabled}>
            {x.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export default function Home() {
  const [state, setState] = useState<State>(empty),
    [classId, setClassId] = useState<string | null>(null),
    [lesson, setLesson] = useState<Lesson | null>(null);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(''),
    [setup, setSetup] = useState<'new' | 'regenerate' | null>(null),
    [manager, setManager] = useState(false);
  const navigation = useRef(0);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const current = state.classes.find((c) => c.id === classId);
  useEffect(() => {
    api<State>('/state')
      .then(setState)
      .catch((e) => setNotice(e.message))
      .finally(() => setLoading(false));
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [lesson?.version_id, classId, setup]);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '操作没有完成，请重试。');
    } finally {
      setBusy(false);
    }
  }
  async function chooseClass(id: string) {
    navigation.current += 1;
    await run(async () => {
      const s = await api<State>('/state?class_id=' + id);
      const first = s.lessons[0];
      const l = first ? await api<Lesson>('/lessons/' + first.id) : null;
      setState(s);
      setClassId(id);
      setLesson(l);
      setSetup(first ? null : 'new');
    });
  }
  async function chooseLesson(id: string, version?: string) {
    navigation.current += 1;
    await run(async () => {
      const l = await api<Lesson>(
        '/lessons/' + id + (version ? '?version=' + version : ''),
      );
      setLesson(l);
      setSetup(null);
    });
  }
  async function save(data: unknown, action = ''): Promise<Lesson | undefined> {
    if (!lesson) return;
    const vid = lesson.version_id;
    const epoch = navigation.current;
    const job = writes.current
      .catch(() => {})
      .then(() =>
        api<Lesson>(
          '/versions/' + vid + action,
          data,
          action ? 'POST' : 'PATCH',
        ),
      );
    writes.current = job;
    try {
      const l = await job;
      if (epoch !== navigation.current) return l;
      setLesson((old) => (old?.version_id === vid ? l : old));
      setState((old) => ({
        ...old,
        lessons: old.lessons.map((item) =>
          item.id === l.id && item.active_version === vid && l.is_current
            ? {
                ...item,
                remembered: l.words.filter((w) => w.result === 'remembered')
                  .length,
                status: l.status,
              }
            : item,
        ),
      }));
      if (action === '/complete') {
        const updated = await api<State>('/state?class_id=' + l.class_id);
        if (epoch === navigation.current) setState(updated);
      }
      return l;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '没有保存成功，请重试。');
      return undefined;
    }
  }
  async function createClass(name: string) {
    navigation.current += 1;
    await run(async () => {
      const c = await api<{ id: string }>('/classes', { name });
      const s = await api<State>('/state?class_id=' + c.id);
      setState(s);
      setClassId(c.id);
      setLesson(null);
      setSetup('new');
    });
  }
  async function generate(draftId: string, revision: number) {
    await run(async () => {
      const l = await api<Lesson>('/drafts/' + draftId + '/confirm', {
        revision,
      });
      setLesson(l);
      setSetup(null);
      setState(await api<State>('/state?class_id=' + classId));
      setNotice(
        '已按确认词表保存 ' +
          l.words.length +
          ' 个词及完整教材。打印随堂练习纸后，点击“开始讲课”进入全屏课堂。',
      );
    });
  }
  const banner = notice && (
    <output className="notice">
      <span>{notice}</span>
      <button aria-label="关闭提示" onClick={() => setNotice('')}>
        ×
      </button>
    </output>
  );
  if (!classId)
    return (
      <div className="class-home">
        <header className="home-header">
          <Brand />
          <div className="header-tools">
            <span className="local-dot">本地课堂</span>
            <button className="btn ghost" onClick={() => setManager(true)}>
              <Library size={17} />
              词库
            </button>
            <a className="btn ghost" href="/api/backup" download>
              <Download size={17} />
              备份
            </a>
          </div>
        </header>
        <main className="class-main">
          {banner}
          <div className="section-intro">
            <p className="eyebrow">YOUR CLASSROOMS</p>
            <h1>今天，和哪个班一起学？</h1>
            <p>每个班拥有自己的课程、单词进度和复习记录。</p>
          </div>
          {loading ? (
            <div className="empty-state">
              <Loader2 className="spin" />
              正在打开课堂…
            </div>
          ) : (
            <div className="class-grid">
              {state.classes.map((c, i) => (
                <button
                  className="class-card"
                  key={c.id}
                  disabled={busy}
                  onClick={() => void chooseClass(c.id)}
                >
                  <span className={'class-icon color-' + (i % 3)}>
                    <Users />
                  </span>
                  <h2>{c.name}</h2>
                  <p>
                    {c.lesson_count} 节课程 <span>·</span> {c.learned}{' '}
                    个已学单词
                  </p>
                  <span className="class-enter">
                    进入班级 <ArrowRight size={18} />
                  </span>
                </button>
              ))}
              <NewClass busy={busy} onCreate={createClass} />
            </div>
          )}
          <div className="home-foot">
            <BookOpen size={18} />
            <span>选词备课 → 先打印随堂练习 → 师生一起练 → 带走课后练习</span>
          </div>
        </main>
        <VocabManager
          open={manager}
          onOpenChange={setManager}
          levels={state.levels}
          onRefresh={async () => setState(await api<State>('/state'))}
        />
      </div>
    );
  return (
    <SidebarProvider
      style={{ '--sidebar-width': '264px' } as React.CSSProperties}
    >
      <CourseSidebar
        state={state}
        className={current?.name || ''}
        lessonId={!setup ? lesson?.id : undefined}
        busy={busy}
        onHome={() => {
          navigation.current += 1;
          setClassId(null);
          setLesson(null);
          setSetup(null);
          void api<State>('/state')
            .then(setState)
            .catch((e) => setNotice(e.message));
        }}
        onNew={() => {
          navigation.current += 1;
          setSetup('new');
          setNotice('');
        }}
        onChoose={chooseLesson}
        onLibrary={() => setManager(true)}
      />
      <main className="workspace">
        <header className="workspace-header">
          <div className="breadcrumb">
            <SidebarTrigger
              className="mobile-toggle"
              aria-label="打开课程目录"
            />
            <Users size={16} />
            <span>{current?.name}</span>
            <ChevronRight size={14} />
            <strong>
              {setup === 'new'
                ? '准备新课'
                : setup === 'regenerate'
                  ? '重新选词'
                  : lesson?.title}
            </strong>
          </div>
          <div className="header-tools">
            <span className="local-dot">课程保存在本机</span>
            <a
              href="/api/backup"
              download
              className="icon-btn"
              aria-label="备份全部班级和课程"
            >
              <Download size={18} />
            </a>
          </div>
        </header>
        <div className="workspace-inner">
          {banner}
          {setup || !lesson ? (
            <Setup
              key={(setup || 'new') + lesson?.id}
              classId={classId}
              levelOptions={state.levels}
              existing={setup === 'regenerate' ? lesson : null}
              nextNumber={
                Math.max(0, ...state.lessons.map((l) => l.number)) + 1
              }
              busy={busy}
              onGenerate={generate}
              onCancel={lesson ? () => setSetup(null) : undefined}
            />
          ) : (
            <LessonRoom
              key={lesson.version_id}
              lesson={lesson}
              busy={busy}
              onSave={save}
              onVersion={(v) => chooseLesson(lesson.id, v)}
              onRegenerate={() => setSetup('regenerate')}
              notify={setNotice}
            />
          )}
        </div>
      </main>
      <VocabManager
        open={manager}
        onOpenChange={setManager}
        levels={state.levels}
        onRefresh={async () =>
          setState(await api<State>('/state?class_id=' + classId))
        }
      />
    </SidebarProvider>
  );
}
function NewClass({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  return (
    <form
      className="class-card create-class"
      onSubmit={(e) => {
        e.preventDefault();
        void onCreate(name);
      }}
    >
      <span className="class-icon">
        <Plus />
      </span>
      <h2>新建一个班级</h2>
      <label htmlFor="class-name" className="sr-only">
        班级名称
      </label>
      <Input
        id="class-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="例如：周六 KET 提升班"
        maxLength={50}
        required
      />
      <button
        className="btn primary"
        type="submit"
        disabled={busy || !name.trim()}
      >
        {busy ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
        创建班级
      </button>
    </form>
  );
}
function CourseSidebar({
  state,
  className,
  lessonId,
  busy,
  onHome,
  onNew,
  onChoose,
  onLibrary,
}: {
  state: State;
  className: string;
  lessonId?: string;
  busy: boolean;
  onHome: () => void;
  onNew: () => void;
  onChoose: (id: string) => Promise<void>;
  onLibrary: () => void;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <Sidebar className="course-sidebar">
      <SidebarHeader>
        <Brand />
        <button className="back-classes" onClick={onHome} disabled={busy}>
          <ArrowLeft size={15} />
          所有班级
        </button>
        <div className="sidebar-class">
          <span>当前班级</span>
          <strong>{className}</strong>
        </div>
        <button
          className="btn sidebar-new"
          onClick={() => {
            onNew();
            setOpenMobile(false);
          }}
          disabled={busy}
        >
          <Plus size={18} />
          新建一课
        </button>
      </SidebarHeader>
      <SidebarContent>
        <div className="nav-caption">
          课程记录 <span>{state.lessons.length}</span>
        </div>
        <nav aria-label="本班课程">
          {state.lessons.map((l) => (
            <button
              key={l.id}
              className={'lesson-nav ' + (l.id === lessonId ? 'selected' : '')}
              aria-current={l.id === lessonId ? 'page' : undefined}
              disabled={busy}
              onClick={() => {
                void onChoose(l.id);
                setOpenMobile(false);
              }}
            >
              <span className="lesson-number">
                {String(l.number).padStart(2, '0')}
              </span>
              <span className="lesson-nav-copy">
                <strong>{l.title}</strong>
                <small>
                  {l.level} · {l.word_count} 词 ·{' '}
                  {l.status === 'completed' ? '已结课' : '进行中'}
                </small>
              </span>
              {l.status === 'completed' && <Check size={14} />}
            </button>
          ))}
          {!state.lessons.length && (
            <p className="sidebar-empty">
              从第一节课开始，
              <br />
              留下共同学习的足迹。
            </p>
          )}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <div className="class-progress">
          <span>
            本班已学 <strong>{state.learned}</strong> 词
          </span>
          <span>
            到期复习 <strong>{state.due}</strong> 词
          </span>
        </div>
        <button className="sidebar-library" onClick={onLibrary}>
          <Library size={17} />
          管理词库
          <ChevronRight size={16} />
        </button>
        <p className="sidebar-note">一点一滴，让单词生根。</p>
      </SidebarFooter>
    </Sidebar>
  );
}
function Setup({
  classId,
  levelOptions,
  existing,
  nextNumber,
  busy,
  onGenerate,
  onCancel,
}: {
  classId: string;
  levelOptions: State['levels'];
  existing: Lesson | null;
  nextNumber: number;
  busy: boolean;
  onGenerate: (draftId: string, revision: number) => Promise<void>;
  onCancel?: () => void;
}) {
  const [config, setConfigState] = useState<Config>(
      existing?.config || defaults,
    ),
    [title, setTitle] = useState(
      existing?.title || '第 ' + String(nextNumber).padStart(2, '0') + ' 课',
    );
  const [pool, setPool] = useState<{
      available: number;
      new: number;
      due: number;
    } | null>(null),
    [error, setError] = useState('');
  const [draft, setDraft] = useState<SelectionDraft | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const previewLock = useRef(false);
  const sourceLessonId = existing?.id;
  useEffect(() => {
    let active = true;
    void api<{ draft: SelectionDraft | null }>(
      '/drafts?class_id=' +
        classId +
        (sourceLessonId ? '&lesson_id=' + sourceLessonId : ''),
    )
      .then((result) => {
        if (active && result.draft) {
          setDraft(result.draft);
          setConfigState(result.draft.config);
          setTitle(result.draft.title);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [classId, sourceLessonId]);
  async function preview() {
    if (previewLock.current || busy) return;
    previewLock.current = true;
    setPreparing(true);
    setError('');
    try {
      setDraft(
        await api<SelectionDraft>('/preview', {
          ...config,
          title,
          class_id: classId,
          lesson_id: existing?.id,
        }),
      );
      window.scrollTo({ top: 0, left: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : '选词没有完成，请重试。');
    } finally {
      previewLock.current = false;
      setPreparing(false);
    }
  }
  function setConfig(value: Config | ((c: Config) => Config)) {
    setPool(null);
    setError('');
    setConfigState(value);
  }
  function change<K extends keyof Config>(key: K, value: Config[K]) {
    setConfig((c) => ({ ...c, [key]: value }));
  }
  useEffect(() => {
    let active = true;
    void api<{ available: number; new: number; due: number }>('/pool', {
      ...config,
      class_id: classId,
      lesson_id: existing?.id,
    })
      .then((p) => {
        if (active) setPool(p);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [classId, config, existing?.id]);
  const opts = levelOptions.map((l) => ({
    value: l.id,
    label:
      l.id +
      (l.id === 'KET'
        ? ' · A2 Key'
        : l.id === 'PET'
          ? ' · B1 Preliminary'
          : '') +
      (l.total ? '' : ' · 待导入'),
    disabled: !l.total,
  }));
  const number = existing?.number || nextNumber;
  if (restoring)
    return (
      <div className="empty-state">
        <Loader2 className="spin" />
        正在读取选词草稿…
      </div>
    );
  if (draft)
    return (
      <>
        {error && <output className="notice">{error}</output>}
        <WordSelection
          draft={draft}
          number={number}
          busy={busy || preparing}
          onDraft={setDraft}
          onBack={() => {
            setDraft(null);
            setError('');
            window.scrollTo({ top: 0 });
          }}
          onReroll={preview}
          onConfirm={onGenerate}
        />
      </>
    );
  return (
    <div className="setup-page">
      <div className="title-row">
        <div>
          <p className="eyebrow">
            LESSON {String(number).padStart(2, '0')} / 01 设置范围
          </p>
          <h1>
            {existing
              ? '为这节课，换一组新单词。'
              : '一节新课，从选好单词开始。'}
          </h1>
          <p className="muted">
            先生成候选词表，调整并确认后，再保存完整课程。
          </p>
        </div>
        {onCancel && (
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            <ArrowLeft size={16} />
            返回课程
          </button>
        )}
      </div>
      <div className="setup-grid">
        <form
          className="panel setup-form"
          onSubmit={(e) => {
            e.preventDefault();
            void preview();
          }}
        >
          <div className="panel-heading">
            <SlidersHorizontal size={20} />
            <h2>设置本课词汇</h2>
          </div>
          <label className="field">
            课程名称
            <Input
              value={title}
              readOnly={!!existing}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
          <label className="field">
            词表范围
            <Choice
              label="词表范围"
              value={config.level}
              items={opts}
              onChange={(v) => change('level', v)}
            />
          </label>
          <div className="field">
            难度范围
            <div className="difficulty-range">
              <Choice
                label="最低难度"
                value={String(config.difficulty_min)}
                items={[1, 2, 3].map((n) => ({
                  value: String(n),
                  label: bands[n],
                }))}
                onChange={(v) =>
                  setConfig((c) => ({
                    ...c,
                    difficulty_min: +v,
                    difficulty_max: Math.max(+v, c.difficulty_max),
                  }))
                }
              />
              <span>至</span>
              <Choice
                label="最高难度"
                value={String(config.difficulty_max)}
                items={[1, 2, 3].map((n) => ({
                  value: String(n),
                  label: bands[n],
                  disabled: n < config.difficulty_min,
                }))}
                onChange={(v) => change('difficulty_max', +v)}
              />
            </div>
            <small>词库内的教学分级，非官方考试等级。</small>
          </div>
          <div className="field">
            每课单词数
            <div className="count-line">
              <Input
                aria-label="每课单词数"
                type="number"
                min={5}
                max={100}
                value={config.count || ''}
                onChange={(e) => change('count', Number(e.target.value))}
                required
              />
              <span>个</span>
              {[10, 20, 30, 50].map((n) => (
                <button
                  className={
                    'count-preset ' + (config.count === n ? 'active' : '')
                  }
                  type="button"
                  key={n}
                  aria-pressed={config.count === n}
                  onClick={() => change('count', n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <small>推荐每课 10 个单词，也可选择 20、30、50 个或自定义数量。</small>
          </div>
          <div className="field">
            本课目标
            <RadioGroup
              value={config.mode}
              onValueChange={(v) => change('mode', String(v))}
              className="mode-options"
            >
              {[
                ['new', '学习新词', '默认避开本班已经学过的词'],
                ['mixed', '新词 + 复习', '约 20% 到期复习词，其余为新词'],
                ['review', '到期复习', '集中回顾需要复习的单词'],
              ].map(([v, t, d]) => (
                <label key={v}>
                  <RadioGroupItem value={v} />
                  <span>
                    <strong>{t}</strong>
                    <small>{d}</small>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>
          <div className="switch-row">
            <label htmlFor="basic-filter">
              过滤最基础的常见词<small>例如 a、an、lot、many</small>
            </label>
            <Switch
              id="basic-filter"
              checked={config.exclude_basic}
              onCheckedChange={(v) => change('exclude_basic', v)}
            />
          </div>
          {config.mode === 'new' && (
            <div className="switch-row">
              <label htmlFor="seen-filter">避开本班已学词</label>
              <Switch
                id="seen-filter"
                checked={config.exclude_seen}
                onCheckedChange={(v) => change('exclude_seen', v)}
              />
            </div>
          )}
          <output className="pool-info">
            {error ||
              (!pool ? (
                '正在核对可用词汇…'
              ) : (
                <>
                  当前条件可用 <strong>{pool.available}</strong> 词，本次生成{' '}
                  <strong>{Math.min(config.count, pool.available)}</strong> 词。
                </>
              ))}
          </output>
          <button
            className="btn primary large"
            disabled={
              busy ||
              preparing ||
              !pool ||
              config.count < 5 ||
              config.count > 100
            }
            type="submit"
          >
            {busy || preparing ? (
              <Loader2 className="spin" size={19} />
            ) : existing ? (
              <RefreshCw size={19} />
            ) : (
              <Plus size={19} />
            )}{' '}
            生成候选词表
            <ArrowRight size={18} />
          </button>
          {existing && (
            <p className="caption">
              现有版本会保留。新内容生成成功后，才切换到新版本。
            </p>
          )}
        </form>
        <aside className="preparation-note">
          <div className="lesson-plan-board">
            <span className="board-eyebrow">ONE LESSON, FOUR LITTLE STEPS</span>
            <h2>
              看懂关联，
              <br />
              记住单词。
            </h2>
            <div className="step-outline">
              {[
                ['01', '认识单词', '读单词、看释义，在例句中认识它'],
                ['02', '词根和词汇', '找出构词规律，把相关单词连起来'],
                ['03', '课堂互动练习', '先回忆，再揭晓，和老师一起查漏'],
                ['04', '练习册打印', '随堂跟写与课后填空，各有一份'],
              ].map(([n, t, d]) => (
                <div key={n}>
                  <span>{n}</span>
                  <div>
                    <strong>{t}</strong>
                    <p>{d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="print-reminder">
            <Layers size={23} />
            <div>
              <h3>先备课，也先备好纸笔</h3>
              <p>
                生成后即可打印随堂跟写纸。学生边听边写；课后再用另一份填空练习巩固。
              </p>
            </div>
          </div>
          <p className="caption">
            KET、PET
            已提供本地词表。先按范围随机抽词，确认时可从全部词库搜索添加或替换。构词成分会随最终词表汇总，没有明确拆分的词按整体记忆学习。
          </p>
        </aside>
      </div>
    </div>
  );
}
function VocabManager({
  open,
  onOpenChange,
  levels,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  levels: State['levels'];
  onRefresh: () => Promise<void>;
}) {
  const [level, setLevel] = useState('KET'),
    [query, setQuery] = useState(''),
    [offset, setOffset] = useState(0),
    [words, setWords] = useState<Word[]>([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [rev, setRev] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const t = setTimeout(() => {
      void api<Word[]>(
        '/vocabulary?level=' +
          level +
          '&q=' +
          encodeURIComponent(query) +
          '&offset=' +
          offset,
      )
        .then((w) => {
          if (active) setWords(w);
        })
        .catch((e) => {
          if (active) setMessage(e.message);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [open, level, query, offset, rev]);
  async function importFile(f?: File) {
    if (!f) return;
    setBusy(true);
    try {
      const r = await api<{ imported: number }>('/import', {
        csv: await f.text(),
        level,
      });
      await onRefresh();
      setRev((r) => r + 1);
      setMessage('已导入 ' + r.imported + ' 个词。已有课程的内容保留不变。');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '导入失败');
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="vocab-dialog">
        <DialogHeader>
          <DialogTitle>本地词库</DialogTitle>
          <DialogDescription>
            CSV
            包含释义、例句、故事与练习。课程保存完整素材快照，后续导入不改写旧课。
          </DialogDescription>
        </DialogHeader>
        <div className="vocab-tools">
          <Choice
            label="管理词库范围"
            value={level}
            onChange={(v) => {
              setLevel(v);
              setOffset(0);
            }}
            items={['KET', 'PET', 'CET-4', 'CET-6'].map((v) => ({
              value: v,
              label:
                v +
                ' · ' +
                (levels.find((l) => l.id === v)?.total || 0) +
                ' 词',
            }))}
          />
          <Input
            value={query}
            placeholder="查找英文或中文"
            aria-label="查找词汇"
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
            }}
          />
        </div>
        <div className="import-tools">
          <a className="btn secondary" href={'/api/seed.csv?level=' + level}>
            <Download size={16} />
            下载 CSV
          </a>
          <button
            className="btn secondary"
            disabled={busy}
            onClick={() => file.current?.click()}
          >
            <Upload size={16} />
            导入到 {level}
          </button>
          <input
            type="file"
            accept=".csv,text/csv"
            hidden
            ref={file}
            onChange={(e) => void importFile(e.target.files?.[0])}
          />
          <span className="caption">CET-4 / CET-6 导入后可选用</span>
        </div>
        {message && <output className="notice">{message}</output>}
        <div className="vocab-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>单词</TableHead>
                <TableHead>中文</TableHead>
                <TableHead>难度</TableHead>
                <TableHead>内容</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {words.map((w) => (
                <TableRow key={w.id}>
                  <TableCell>
                    <strong lang="en">{w.word}</strong>
                    <small>{w.pos}</small>
                  </TableCell>
                  <TableCell>{w.meaning_zh}</TableCell>
                  <TableCell>
                    {bands[w.difficulty]}
                    {w.is_basic && <small>默认过滤</small>}
                  </TableCell>
                  <TableCell>
                    {w.parts.length ? '构词关联' : ''}
                    {w.parts.length && w.example ? ' · ' : ''}
                    {w.example ? '例句' : !w.parts.length ? '整体记忆' : ''}
                    {w.story_zh ? ' · 故事' : ''}
                    {w.cloze ? ' · 练习' : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!words.length && (
            <div className="empty-state">
              没有匹配的词条。可以换个词查找，或导入 CSV。
            </div>
          )}
        </div>
        <div className="pagination">
          <button
            className="btn ghost"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 40))}
          >
            上一页
          </button>
          <span>第 {offset / 40 + 1} 页</span>
          <button
            className="btn ghost"
            disabled={words.length < 40}
            onClick={() => setOffset(offset + 40)}
          >
            下一页
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
