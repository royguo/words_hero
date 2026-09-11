/* oxlint-disable next/no-img-element -- Static PNG brand assets require no remote image service. */
'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Users,
  Plus,
  ArrowRight,
  ArrowLeft,
  Download,
  Library,
  Loader2,
  RefreshCw,
  Check,
  ChevronRight,
  Upload,
  ChartNoAxesCombined,
  Trash2,
  LogOut,
  Copy,
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
import { toast } from '@/components/ui/toast';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
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
import { AuthGate } from './auth-gate';
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
      <img className="brand-image" src="/favicon.png?v=2" alt="" />
      <div>
        风筝单词<small>KiteDance</small>
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
  return (
    <AuthGate>
      <Classrooms />
    </AuthGate>
  );
}
function Classrooms() {
  const [state, setState] = useState<State>(empty),
    [classId, setClassId] = useState<string | null>(null),
    [lesson, setLesson] = useState<Lesson | null>(null);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [setup, setSetup] = useState<'new' | 'regenerate' | null>(null),
    [manager, setManager] = useState(false);
  const [deletion, setDeletion] = useState<{
    kind: 'class' | 'lesson';
    id: string;
    name: string;
  } | null>(null);
  const navigation = useRef(0);
  const [copying, setCopying] = useState<{
    id: string;
    name: string;
    lesson_count: number;
    request_id: string;
  } | null>(null);
  const [copyName, setCopyName] = useState('');
  const copyNameInput = useRef<HTMLInputElement>(null);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const current = state.classes.find((c) => c.id === classId);
  function setNotice(message: string) {
    if (message) toast.add({ title: message, type: 'info' });
  }
  useEffect(() => {
    let live = true;
    const requested = new URLSearchParams(window.location.search).get('class');
    async function load() {
      try {
        const value = await api<State>(
          '/state' +
            (requested ? '?class_id=' + encodeURIComponent(requested) : ''),
        );
        const first = value.lessons[0];
        const selected =
          requested && first ? await api<Lesson>('/lessons/' + first.id) : null;
        if (!live) return;
        setState(value);
        if (requested && value.classes.some((c) => c.id === requested)) {
          setClassId(requested);
          setLesson(selected);
          setSetup(first ? null : 'new');
        }
      } catch (e) {
        if (live) setNotice(e instanceof Error ? e.message : '读取失败');
      } finally {
        if (live) setLoading(false);
      }
    }
    void load();
    return () => {
      live = false;
    };
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
  async function copyClass() {
    if (!copying) return;
    await run(async () => {
      await writes.current.catch(() => {});
      const c = await api<{ id: string }>('/classes/' + copying.id + '/copy', {
        name: copyName,
        request_id: copying.request_id,
      });
      const s = await api<State>('/state?class_id=' + c.id);
      const first = [...s.lessons].sort((a, b) => a.number - b.number)[0];
      const l = first ? await api<Lesson>('/lessons/' + first.id) : null;
      navigation.current++;
      setState(s);
      setClassId(c.id);
      setLesson(l);
      setSetup(l ? null : 'new');
      setCopying(null);
      setNotice('已复制 ' + s.lessons.length + ' 节课程，教学进度已重置。');
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
  async function deleteRecord() {
    if (!deletion) return;
    await run(async () => {
      await writes.current.catch(() => {});
      navigation.current += 1;
      await api(
        '/' +
          (deletion.kind === 'class' ? 'classes' : 'lessons') +
          '/' +
          deletion.id,
        {},
        'DELETE',
      );
      if (deletion.kind === 'class') {
        setClassId(null);
        setLesson(null);
        setSetup(null);
        setState(await api<State>('/state'));
      } else {
        const s = await api<State>('/state?class_id=' + classId);
        setState(s);
        setLesson(
          s.lessons[0]
            ? await api<Lesson>('/lessons/' + s.lessons[0].id)
            : null,
        );
        setSetup(s.lessons.length ? null : 'new');
      }
      setDeletion(null);
      setNotice('已删除课堂记录；单词、图片和语音素材仍可复用。');
    });
  }
  const deletionDialog = (
    <Dialog
      open={!!deletion}
      onOpenChange={(open) => {
        if (!open && !busy) setDeletion(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            删除{deletion?.kind === 'class' ? '班级' : '课程'}？
          </DialogTitle>
          <DialogDescription>
            “{deletion?.name}”
            {deletion?.kind === 'class' ? '及其中全部课程' : ''}
            将从课堂记录中移除。关联的图片、音频和词汇素材会保留。
          </DialogDescription>
        </DialogHeader>
        <div className="delete-actions">
          <button
            className="btn secondary"
            disabled={busy}
            onClick={() => setDeletion(null)}
          >
            取消
          </button>
          <button
            className="btn danger"
            disabled={busy}
            onClick={() => void deleteRecord()}
          >
            {busy ? '正在删除…' : '确认删除'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
  if (!classId)
    return (
      <div className="class-home">
        <header className="home-header">
          <Brand />
          <div className="header-tools">
            <button
              className="btn ghost"
              onClick={() => window.dispatchEvent(new Event('kite-logout'))}
            >
              <LogOut size={16} />
              退出
            </button>
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
          <div className="section-intro">
            <h1>班级</h1>
            <span className="class-count">{state.classes.length} 个班级</span>
          </div>
          {loading ? (
            <div className="empty-state">
              <Loader2 className="spin" />
              正在打开课堂…
            </div>
          ) : (
            <div className="class-grid">
              {state.classes.map((c, i) => (
                <div className="class-card-wrap" key={c.id}>
                  <button
                    className="class-card"
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
                  <button
                    className="copy-class icon-btn"
                    aria-label={'复制班级 ' + c.name}
                    title="复制班级与课程"
                    disabled={busy}
                    onClick={() => {
                      setCopying({ ...c, request_id: crypto.randomUUID() });
                      setCopyName(c.name.slice(0, 46) + ' 副本');
                    }}
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    className="delete-class icon-btn"
                    aria-label={'删除班级 ' + c.name}
                    disabled={busy}
                    onClick={() =>
                      setDeletion({ kind: 'class', id: c.id, name: c.name })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <NewClass
                busy={busy}
                focusName={!state.classes.length}
                onCreate={createClass}
              />
            </div>
          )}
        </main>
        {deletionDialog}
        <Dialog
          open={!!copying}
          onOpenChange={(open) => {
            if (!open && !busy) setCopying(null);
          }}
        >
          <DialogContent
            className="copy-class-dialog"
            initialFocus={copyNameInput}
          >
            <DialogHeader>
              <DialogTitle>复制班级</DialogTitle>
              <DialogDescription>
                复制「{copying?.name}」的 {copying?.lesson_count}{' '}
                节课，保留每课最新内容和公共素材引用。教学进度、课堂笔记及学生名单从空白开始。
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void copyClass();
              }}
            >
              <label htmlFor="copy-class-name">新班级名称</label>
              <Input
                ref={copyNameInput}
                id="copy-class-name"
                value={copyName}
                onChange={(e) => setCopyName(e.target.value)}
                maxLength={50}
                required
                disabled={busy}
              />
              <div className="delete-actions">
                <button
                  className="btn secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => setCopying(null)}
                >
                  取消
                </button>
                <button
                  className="btn primary"
                  disabled={busy || !copyName.trim()}
                >
                  {busy ? '正在复制…' : '复制班级'}
                </button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
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
      style={{ '--sidebar-width': '248px' } as React.CSSProperties}
    >
      <CourseSidebar
        state={state}
        classId={classId}
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
                  : '课程'}
            </strong>
          </div>
          <div className="header-tools">
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
              onDelete={() =>
                setDeletion({
                  kind: 'lesson',
                  id: lesson.id,
                  name: lesson.title,
                })
              }
            />
          )}
        </div>
      </main>
      {deletionDialog}
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
  focusName,
  onCreate,
}: {
  busy: boolean;
  focusName: boolean;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusName) return;
    const frame = requestAnimationFrame(() => nameInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusName]);
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
        ref={nameInput}
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
  lessonId,
  busy,
  onHome,
  onNew,
  onChoose,
  onLibrary,
  classId,
}: {
  state: State;
  lessonId?: string;
  busy: boolean;
  onHome: () => void;
  onNew: () => void;
  onChoose: (id: string) => Promise<void>;
  onLibrary: () => void;
  classId: string;
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
        <button
          className="btn sidebar-new"
          onClick={() => {
            onNew();
            setOpenMobile(false);
          }}
          disabled={busy}
        >
          <Plus size={18} />
          新建课程
        </button>
      </SidebarHeader>
      <SidebarContent>
        <div className="nav-caption">
          课程 <span>{state.lessons.length}</span>
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
          {!state.lessons.length && <p className="sidebar-empty">暂无课程</p>}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <div className="sidebar-stats">
          <span>
            已学 <strong>{state.learned}</strong> 词
          </span>
          <span>
            待复习 <strong>{state.due}</strong> 词
          </span>
        </div>
        <nav className="sidebar-tools" aria-label="班级工具">
          <Tooltip>
            <TooltipTrigger
              render={
                <a
                  aria-label="学生管理"
                  href={'/students?class=' + encodeURIComponent(classId)}
                />
              }
              className="sidebar-tool"
              aria-label="学生管理"
            >
              <Users size={20} />
            </TooltipTrigger>
            <TooltipContent>学生管理</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              className="sidebar-tool"
              onClick={onLibrary}
              aria-label="词库管理"
            >
              <Library size={20} />
            </TooltipTrigger>
            <TooltipContent>词库管理</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              className="sidebar-tool"
              aria-disabled="true"
              aria-label="班级进度（暂未开放）"
            >
              <ChartNoAxesCombined size={20} />
            </TooltipTrigger>
            <TooltipContent>班级进度 · 暂未开放</TooltipContent>
          </Tooltip>
        </nav>
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
  const titleInput = useRef<HTMLInputElement>(null);
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
  useEffect(() => {
    if (restoring || draft || existing) return;
    const frame = requestAnimationFrame(() => titleInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [draft, existing, restoring]);
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
            第 {String(number).padStart(2, '0')} 课 · 设置范围 → 确认词单
          </p>
          <h1>{existing ? '重新选词' : '新建课程'}</h1>
          <p className="muted">生成候选词单后可增删调整，确认后保存课程。</p>
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
          <label className="field">
            课程名称
            <Input
              ref={titleInput}
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
            <small>
              推荐每课 10 个单词，也可选择 20、30、50 个或自定义数量。
            </small>
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
              现有版本会保留。确认新版本后，本课需再次结课才会开放给学生。
            </p>
          )}
        </form>
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
    [busy, setBusy] = useState(false),
    [rev, setRev] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  function setMessage(message: string) {
    toast.add({ title: message, type: 'info' });
  }
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
      <DialogContent className="vocab-dialog" initialFocus={queryInput}>
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
            ref={queryInput}
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
