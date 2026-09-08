'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  Play,
  Layers,
  Pencil,
  Printer,
  RefreshCw,
  Volume2,
  Eye,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  CheckCircle2,
  Loader2,
  BookMarked,
  Save,
  Image as ImageIcon,
  Copy,
  Download,
  Trash2,
  MoreHorizontal,
  StickyNote,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  bands,
  kinds,
  date,
  speak,
  type Lesson,
  type Word,
} from '@/lib/classroom';
import { LessonPlayer } from './lesson-player';
import { buildSlides, cardPages } from '@/lib/slides';
import { TeachingPicture, TargetText } from './teaching-picture';
import { AudioPreparation, SpeakButton } from './audio-tools';
import { stopSpeech } from '@/lib/audio';
import { WordStudyPage } from './word-study';
import { WordCards } from './word-cards';
import { Workbook } from './workbook';
type SaveFn = (data: unknown, action?: string) => Promise<Lesson | undefined>;
const steps = [
  { id: 'preview', label: '认识单词', icon: BookOpen },
  { id: 'scenes', label: '情景图文故事', icon: ImageIcon },
  { id: 'practice', label: '课堂互动练习', icon: Pencil },
  { id: 'workbook', label: '材料打印', icon: Printer },
];
export function LessonRoom({
  lesson,
  busy,
  onSave,
  onVersion,
  onRegenerate,
  onDelete,
  notify,
}: {
  lesson: Lesson;
  busy: boolean;
  onSave: SaveFn;
  onVersion: (id: string) => Promise<void>;
  onRegenerate: () => void;
  onDelete: () => void;
  notify: (s: string) => void;
}) {
  const [player, setPlayer] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  useEffect(() => {
    stopSpeech();
    return stopSpeech;
  }, [lesson.version_id]);
  const [startAt, setStartAt] = useState('welcome');
  const closePlayer = useCallback(() => setPlayer(false), []);
  const deck = buildSlides(lesson);
  const savedPage = deck.findIndex(
    (s) => s.id === lesson.config.presentation_slide,
  );
  function startLecture(resume = false) {
    stopSpeech();
    setStartAt(
      resume ? lesson.config.presentation_slide || 'welcome' : 'welcome',
    );
    setPlayer(true);
    // Invoke in the click gesture; the dialog renders inside the fullscreen document.
    if (document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  }
  const [stage, setStage] = useState(
      lesson.stage === 'roots' ? 'preview' : lesson.stage,
    ),
    [pending, setPending] = useState(false),
    [complete, setComplete] = useState(false),
    [notes, setNotes] = useState(lesson.notes);
  const remembered = lesson.words.filter(
      (w) => w.result === 'remembered',
    ).length,
    again = lesson.words.filter((w) => w.result === 'again').length;
  async function changeStage(id: string) {
    stopSpeech();
    setStage(id);
    if (!lesson.read_only) await onSave({ stage: id });
  }
  async function finish() {
    setPending(true);
    try {
      if (notes !== lesson.notes && !(await onSave({ notes }))) return;
      const l = await onSave({}, '/complete');
      if (l) {
        setComplete(false);
        notify('已结课。本班已学词和复习计划已更新，课堂原貌已保存。');
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="lesson-room">
      <section className="course-heading" aria-label="课程概览与操作">
        <div className="course-heading-top">
          <div className="course-heading-identity">
            <span className="course-level">{lesson.level}</span>
            <h1>{lesson.title}</h1>
            <span
              className={
                'status-badge ' +
                (lesson.status === 'completed' ? 'complete' : '')
              }
            >
              {!lesson.is_current
                ? '历史版本'
                : lesson.status === 'completed'
                  ? '已结课'
                  : '进行中'}
            </span>
          </div>
          <div className="course-heading-tools">
            <button
              className={
                'btn course-notes-button' +
                (notes !== lesson.notes ? ' has-changes' : '')
              }
              onClick={() => setNotesOpen(true)}
              aria-label="打开课堂笔记"
            >
              <StickyNote size={17} />
              课堂笔记
              {notes !== lesson.notes && (
                <span className="unsaved-dot" aria-label="有未保存的修改" />
              )}
            </button>
            <Select
              value={lesson.version_id}
              onValueChange={(v) => v && void onVersion(String(v))}
            >
              <SelectTrigger
                aria-label="查看课程版本"
                className="version-picker"
                disabled={busy || pending}
              >
                <SelectValue>版本 {lesson.version_number}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {lesson.versions.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    版本 {v.number} · {date(v.created_at)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="icon-btn course-more"
                aria-label="更多课程操作"
                disabled={busy || pending}
              >
                <MoreHorizontal size={20} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="course-overflow-menu">
                <DropdownMenuItem
                  render={
                    <a
                      aria-label="下载素材任务"
                      href={'/api/courses/' + lesson.course_code + '/brief'}
                      download
                    />
                  }
                >
                  <Download size={16} />
                  下载素材任务
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!lesson.is_current}
                  onClick={onRegenerate}
                >
                  <RefreshCw size={16} />
                  重新生成课程
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <Trash2 size={16} />
                  删除本节课
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="course-facts">
          <span>{lesson.words.length} 个单词</span>
          <span>
            {bands[lesson.config.difficulty_min]}—
            {bands[lesson.config.difficulty_max]}
          </span>
          <span>{date(lesson.created_at)}</span>
          <button
            className="course-code"
            aria-label={'复制课程编号 ' + lesson.course_code}
            onClick={() => {
              void navigator.clipboard.writeText(lesson.course_code).then(
                () => notify('课程编号已复制'),
                () => notify('复制失败，请选中课程编号手动复制。'),
              );
            }}
          >
            <span>{lesson.course_code}</span>
            <Copy size={13} />
          </button>
        </div>
        <div className="course-controls">
          <div className="course-primary-actions">
            <button
              className="btn primary"
              disabled={busy || pending}
              onClick={() => startLecture()}
            >
              <Play size={17} fill="currentColor" />
              开始讲课
            </button>
            {savedPage > 0 && (
              <button
                className="btn ghost course-resume"
                disabled={busy || pending}
                onClick={() => startLecture(true)}
              >
                继续第 {savedPage + 1} 页<ArrowRight size={15} />
              </button>
            )}
            <button
              className="btn secondary"
              onClick={() => void changeStage('workbook')}
            >
              <Printer size={16} />
              材料打印
            </button>
            {!lesson.read_only && (
              <button
                className="btn ghost"
                disabled={busy || pending}
                onClick={() => setComplete(true)}
              >
                <CheckCircle2 size={17} />
                结束课程
              </button>
            )}
          </div>
          <AudioPreparation versionId={lesson.version_id} compact />
        </div>
        <div className="course-overview-bottom">
          <div className="course-mastery">
            <span>
              <strong>{remembered}</strong> / {lesson.words.length} 词已记住
            </span>
            <Progress
              value={
                lesson.words.length
                  ? (remembered / lesson.words.length) * 100
                  : 0
              }
              aria-label="本课单词掌握进度"
            />
            {again > 0 && <span>{again} 词待巩固</span>}
          </div>
          <span className="course-asset-counts">
            {deck.length} 页课件 ·{' '}
            {lesson.words.filter((w) => w.images?.length).length} 词配图 ·{' '}
            {lesson.materials.story?.scenes.length || 0} 页故事
          </span>
        </div>
      </section>
      {!lesson.is_current && (
        <div className="archive-note">
          <BookMarked size={17} />
          正在查看历史版本，内容与记录只读。
        </div>
      )}
      <Tabs
        value={stage}
        onValueChange={(v) => void changeStage(String(v))}
        className="lesson-tabs"
      >
        <TabsList className="lesson-tab-list">
          {steps.map((s, i) => (
            <TabsTrigger value={s.id} key={s.id}>
              <span className="step-index">
                {String(i + 1).padStart(2, '0')}
              </span>
              <s.icon size={17} />
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="preview">
          <WordPreview words={lesson.words} notify={notify} />
          <div className="step-footer">
            <span>读懂例句，发现来历，再走进今天的故事。</span>
            <button
              className="btn primary"
              onClick={() => void changeStage('scenes')}
            >
              走进图文故事
              <ArrowRight size={17} />
            </button>
          </div>
        </TabsContent>
        <TabsContent value="scenes">
          {lesson.materials.story ? (
            <div className="story-workspace">
              <div className="story-workspace-heading">
                <span className="eyebrow">STORY TIME</span>
                <h2>{lesson.materials.story.title_zh}</h2>
                <p lang="en">{lesson.materials.story.title_en}</p>
              </div>
              {lesson.materials.story.scenes.map((scene, i) => (
                <article className="story-preview-page" key={scene.id}>
                  <TeachingPicture images={scene.image ? [scene.image] : []} />
                  <div>
                    <span className="eyebrow">
                      {String(i + 1).padStart(2, '0')} /{' '}
                      {lesson.materials.story?.scenes.length}
                    </span>
                    <h3>{scene.title}</h3>
                    <p lang="en">
                      <TargetText
                        text={scene.en}
                        words={lesson.materials.story?.covered_words || []}
                      />
                      <SpeakButton
                        text={scene.en}
                        label="朗读故事"
                        notify={notify}
                      />
                    </p>
                    <details>
                      <summary>看看中文</summary>
                      <p>{scene.zh}</p>
                    </details>
                    <div className="story-preview-question">
                      <strong>{scene.question.en}</strong>
                      <SpeakButton
                        text={scene.question.en}
                        label="朗读故事问题"
                        notify={notify}
                      />
                      <p>{scene.question.zh}</p>
                      <details>
                        <summary>揭晓答案</summary>
                        <p>
                          {scene.question.answer_en}
                          <SpeakButton
                            text={scene.question.answer_en}
                            label="朗读故事答案"
                            notify={notify}
                          />
                          <br />
                          {scene.question.answer_zh}
                        </p>
                      </details>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="panel story-empty">
              <ImageIcon size={32} />
              <h2>这节课还没有图文故事</h2>
              <p>
                使用上方课程编号和素材任务补充故事，保存后即可在大屏幕中讲读。
              </p>
            </div>
          )}
          <div className="step-footer">
            <span>把故事讲给同伴听，再试试这些单词。</span>
            <button
              className="btn primary"
              onClick={() => void changeStage('practice')}
            >
              开始课堂互动
              <ArrowRight size={17} />
            </button>
          </div>
        </TabsContent>
        <TabsContent value="practice">
          <Practice lesson={lesson} onSave={onSave} notify={notify} />
        </TabsContent>
        <TabsContent value="workbook">
          <Workbook key={lesson.version_id} lesson={lesson} />
        </TabsContent>
      </Tabs>
      <Dialog open={notesOpen} onOpenChange={setNotesOpen}>
        <DialogContent className="classroom-notes-dialog">
          <DialogHeader>
            <DialogTitle>课堂笔记</DialogTitle>
            <DialogDescription>
              {lesson.title} · 版本 {lesson.version_number}
              {lesson.read_only ? ' · 只读' : ''}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="课堂笔记"
            placeholder="记录易错词、例子或下次复习重点…"
            value={notes}
            maxLength={5000}
            readOnly={lesson.read_only}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="notes-dialog-actions">
            <span>{notes === lesson.notes ? '已保存' : '有未保存的修改'}</span>
            {!lesson.read_only && (
              <button
                className="btn primary"
                disabled={busy || pending || notes === lesson.notes}
                onClick={async () => {
                  setPending(true);
                  try {
                    if (await onSave({ notes })) notify('课堂笔记已保存');
                  } finally {
                    setPending(false);
                  }
                }}
              >
                <Save size={16} />
                {pending ? '正在保存…' : '保存笔记'}
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {player && (
        <LessonPlayer
          lesson={lesson}
          startAt={startAt}
          onSave={onSave}
          onExit={closePlayer}
        />
      )}
      <Dialog open={complete} onOpenChange={setComplete}>
        <DialogContent className="finish-dialog">
          <DialogHeader>
            <DialogTitle>给这节课画一个句号</DialogTitle>
            <DialogDescription>
              本课原貌和练习记录会保留，单词将加入本班的复习计划。
            </DialogDescription>
          </DialogHeader>
          <div className="finish-numbers">
            <div>
              <strong>{remembered}</strong>
              <span>已记住 · 3 天后起复习</span>
            </div>
            <div>
              <strong>{lesson.words.length - remembered}</strong>
              <span>待巩固 · 明天起复习</span>
            </div>
          </div>
          <p className="caption">
            未标记的词按“再练一次”处理。复习时间是课堂建议，重复复习后间隔会延长。
          </p>
          <button
            className="btn primary large"
            disabled={pending}
            onClick={() => void finish()}
          >
            {pending ? (
              <Loader2 className="spin" size={17} />
            ) : (
              <CheckCircle2 size={17} />
            )}
            确认结课
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function WordPreview({
  words,
  notify,
}: {
  words: Word[];
  notify: (s: string) => void;
}) {
  const [hide, setHide] = useState(false),
    [open, setOpen] = useState<Record<string, boolean>>({});
  const [studyWord, setStudyWord] = useState<Word | null>(null);
  return (
    <div className="stage-body">
      <div className="section-toolbar">
        <div>
          <h2>先认识今天的新朋友</h2>
          <p>一起读一读，再藏起中文，看看你还记得多少。</p>
        </div>
        <label className="inline-switch">
          <Switch checked={hide} onCheckedChange={setHide} />
          隐藏中文释义
        </label>
      </div>
      <div className="word-grid">
        {words.map((w, i) => {
          const visible = !hide || open[w.id];
          return (
            <article
              className="word-card"
              key={w.id}
              style={
                {
                  '--card-delay': Math.min(i, 9) * 25 + 'ms',
                } as React.CSSProperties
              }
            >
              <div className="word-card-top">
                <span className="word-index">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="topic-tag">{w.topic}</span>
                <button
                  className="icon-btn"
                  aria-label={'朗读 ' + w.word}
                  onClick={() => speak(w.word, notify)}
                >
                  <Volume2 size={18} />
                </button>
              </div>
              <h3 lang="en">{w.display_word || w.word}</h3>
              <p className="word-phonetic">
                <span>{w.pos}</span>
                {w.phonetic && <span>/{w.phonetic}/</span>}
              </p>
              <button
                className={'meaning-reveal ' + (!visible ? 'concealed' : '')}
                onClick={() =>
                  hide && setOpen((s) => ({ ...s, [w.id]: !s[w.id] }))
                }
                disabled={!hide}
              >
                {visible ? (
                  w.meaning_zh
                ) : (
                  <>
                    <Eye size={15} />
                    想好了吗？点这里揭晓
                  </>
                )}
              </button>
              {w.example && (
                <div className="word-example">
                  <div className="example-with-audio">
                    <p lang="en">{w.example}</p>
                    <SpeakButton text={w.example} notify={notify} />
                  </div>
                  {visible && w.example_zh && (
                    <p className="example-zh">{w.example_zh}</p>
                  )}
                </div>
              )}
              {(w.extra_examples || []).map((example, index) => (
                <div className="word-example extra-example" key={index}>
                  <div className="example-with-audio">
                    <p lang="en">{example.en}</p>
                    <SpeakButton
                      text={example.en}
                      label={'朗读补充例句 ' + (index + 1)}
                      notify={notify}
                    />
                  </div>
                  {visible && <p className="example-zh">{example.zh}</p>}
                </div>
              ))}
              {visible && (
                <button
                  className="word-study-open"
                  onClick={() => setStudyWord(w)}
                >
                  <Layers size={15} /> 来源和构成 <ChevronRight size={15} />
                </button>
              )}
              <div className="word-card-bottom">
                <span className={'difficulty d' + w.difficulty}>
                  {bands[w.difficulty]}
                </span>
                <span className="caption">
                  {w.word_study ? '读例句 · 找联系' : '完整记忆 · 理解用法'}
                </span>
              </div>
            </article>
          );
        })}
      </div>
      <Dialog
        open={!!studyWord}
        onOpenChange={(value) => {
          if (!value) {
            setStudyWord(null);
            stopSpeech();
          }
        }}
      >
        <DialogContent className="word-study-modal">
          <DialogTitle className="sr-only">
            {studyWord?.word} · 来源和构成
          </DialogTitle>
          <DialogDescription className="sr-only">
            查看单词构成、相关单词与例句。
          </DialogDescription>
          {studyWord && (
            <WordStudyPage
              key={studyWord.id}
              word={studyWord}
              compact
              onSpeak={(text) => speak(text, notify)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function Practice({
  lesson,
  onSave,
  notify,
}: {
  lesson: Lesson;
  onSave: SaveFn;
  notify: (s: string) => void;
}) {
  const [mode, setMode] = useState('recall');
  return (
    <div className="stage-body">
      <div className="section-toolbar">
        <div>
          <h2>先回忆，再看看答案</h2>
          <p>先独立回忆，再和同伴轮流出题，一起核对。</p>
        </div>
      </div>
      <Tabs
        value={mode}
        onValueChange={(v) => {
          stopSpeech();
          setMode(String(v));
        }}
      >
        <TabsList className="practice-modes">
          <TabsTrigger value="recall">
            <RotateCcw size={16} />
            翻卡回忆
          </TabsTrigger>
          <TabsTrigger value="spelling">
            <Pencil size={16} />
            课堂填空
          </TabsTrigger>
          <TabsTrigger value="roots">
            <Layers size={16} />
            构词快问
          </TabsTrigger>
        </TabsList>
        <TabsContent value="recall">
          <Recall lesson={lesson} onSave={onSave} notify={notify} />
        </TabsContent>
        <TabsContent value="spelling">
          <Spelling lesson={lesson} onSave={onSave} />
        </TabsContent>
        <TabsContent value="roots">
          <RootChallenge lesson={lesson} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
function Recall({
  lesson,
  onSave,
  notify,
}: {
  lesson: Lesson;
  onSave: SaveFn;
  notify: (s: string) => void;
}) {
  const pages = cardPages(lesson.words);
  const [page, setPage] = useState(() =>
    Math.max(
      0,
      pages.findIndex((words) =>
        words.some((w) => w.id === lesson.words[lesson.cursor || 0]?.id),
      ),
    ),
  );
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);
  async function go(next: number) {
    stopSpeech();
    const n = Math.max(0, Math.min(next, pages.length - 1));
    setPage(n);
    setRevealed(false);
    if (!lesson.read_only)
      await onSave({
        cursor: lesson.words.findIndex((w) => w.id === pages[n][0].id),
      });
  }
  return (
    <div className="recall-pages">
      <WordCards
        key={page}
        words={pages[page]}
        revealed={revealed}
        readOnly={lesson.read_only}
        onSpeak={(text) => speak(text, notify)}
        onRate={async (word, result) => {
          setPending(true);
          try {
            if (!(await onSave({ word_id: word.id, result })))
              notify('标记没有保存成功，请重试。');
          } finally {
            setPending(false);
          }
        }}
      />
      <div className="recall-page-controls">
        <button
          className="btn secondary"
          disabled={!page || pending}
          onClick={() => void go(page - 1)}
        >
          <ChevronLeft size={18} />
          上一组
        </button>
        <span>
          第 {page + 1} / {pages.length} 组
        </span>
        <button
          className="btn secondary"
          onClick={() => setRevealed(!revealed)}
        >
          {revealed ? '全部盖上' : '全部翻开'}
        </button>
        <button
          className="btn primary"
          disabled={page === pages.length - 1 || pending}
          onClick={() => void go(page + 1)}
        >
          下一组
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
function Spelling({ lesson, onSave }: { lesson: Lesson; onSave: SaveFn }) {
  const [answers, setAnswers] = useState<Record<string, string>>(lesson.draft),
    [pending, setPending] = useState(false),
    [saved, setSaved] = useState(JSON.stringify(lesson.draft)),
    [message, setMessage] = useState('');
  const latest = lesson.attempts[0];
  async function submit() {
    setPending(true);
    try {
      const complete = Object.fromEntries(
        lesson.words.map((w) => [String(w.id), answers[w.id] || '']),
      );
      const l = await onSave({ answers: complete }, '/attempts');
      if (l) {
        setSaved(JSON.stringify(complete));
        setAnswers(complete);
        setMessage('练习结果已保存。空白答案按未答对记录。');
      }
    } finally {
      setPending(false);
    }
  }
  function cloze(w: Word) {
    return w.cloze_type === 'context' ? w.cloze : '';
  }

  return (
    <form
      className="spelling-area"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="exercise-instruction">
        根据中文和句子线索填写本课单词。请先自己回忆，再一起核对。
      </p>
      <div className="spelling-grid">
        {lesson.words.map((w, i) => (
          <label className="spelling-row" key={w.id}>
            <span className="word-index">{String(i + 1).padStart(2, '0')}</span>
            <span>
              <strong>{w.meaning_zh}</strong>
              <small>
                {w.pos}
                {cloze(w) && (
                  <span className="cloze" lang="en">
                    {cloze(w)}
                  </span>
                )}
              </small>
            </span>
            <Input
              aria-label={'第 ' + (i + 1) + ' 题 ' + w.meaning_zh}
              value={answers[w.id] || ''}
              onChange={(e) => {
                setMessage('');
                setAnswers((a) => ({ ...a, [w.id]: e.target.value }));
              }}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={pending}
              placeholder="填写英文"
              maxLength={200}
            />
          </label>
        ))}
      </div>
      <div className="spelling-footer">
        <output className="caption">
          {message ||
            (JSON.stringify(answers) === saved
              ? '草稿已保存'
              : '答案有修改，可保存草稿后稍后继续')}
        </output>
        <div>
          {!lesson.read_only && (
            <button
              className="btn secondary"
              type="button"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                const l = await onSave({ draft: answers });
                if (l) {
                  setSaved(JSON.stringify(answers));
                  setMessage('草稿已保存');
                }
                setPending(false);
              }}
            >
              <Save size={16} />
              保存草稿
            </button>
          )}
          <button className="btn primary" type="submit" disabled={pending}>
            {pending ? (
              <Loader2 className="spin" size={17} />
            ) : (
              <CheckCircle2 size={17} />
            )}
            核对并保存结果
          </button>
        </div>
      </div>
      {latest && (
        <section className="quiz-results">
          <div>
            <h3>最近一次练习</h3>
            <strong>
              {latest.correct}
              <small> / {latest.total}</small>
            </strong>
            <span>
              {date(latest.created_at)} · 共记录 {lesson.attempts.length} 次
            </span>
          </div>
          {latest.correct === latest.total ? (
            <p>全部答对了！再试着用其中三个词说一句话吧。</p>
          ) : (
            <div className="corrections">
              {latest.data
                .filter((x) => !x.correct)
                .map((x) => (
                  <p key={x.id}>
                    <span>{x.answer || '未作答'}</span>
                    <ArrowRight size={14} />
                    <strong lang="en">{x.word}</strong>
                  </p>
                ))}
            </div>
          )}
          <p className="caption">
            {lesson.read_only
              ? '历史练习结果已留存；如需更新复习计划，可新建到期复习课。'
              : '结课时会根据本课最后的掌握标记安排复习。'}
          </p>
        </section>
      )}
    </form>
  );
}
function RootChallenge({ lesson }: { lesson: Lesson }) {
  const [index, setIndex] = useState(0),
    [show, setShow] = useState(false),
    [answer, setAnswer] = useState(''),
    [example, setExample] = useState('');
  const group = lesson.groups[index];
  if (!group)
    return (
      <div className="empty-state">
        本课没有构词拆分，可先练习翻卡和单词填空。
      </div>
    );
  return (
    <div className="root-challenge">
      <span className="eyebrow">YOUR TURN / TALK TOGETHER</span>
      <span className="root-question-index">
        {index + 1} / {lesson.groups.length}
      </span>
      <h3 lang="en">{group.text}</h3>
      <p>这个{kinds[group.kind]}是什么意思？能举出一个本课单词吗？</p>
      <div className="root-inputs">
        <Input
          aria-label="构词成分中文意思"
          placeholder="用中文写出你的理解"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
        <Input
          aria-label="本课单词举例"
          placeholder="写出一个本课单词"
          value={example}
          onChange={(e) => setExample(e.target.value)}
          spellCheck={false}
        />
      </div>
      {show ? (
        <div className="challenge-answer">
          <strong>{group.meaning}</strong>
          <p>{group.words.map((w) => w.word).join(' · ')}</p>
          <small>
            意思相近的中文表达也可以。说说你的理由，和大家一起核对。
          </small>
        </div>
      ) : (
        <button className="btn primary" onClick={() => setShow(true)}>
          <Eye size={17} />
          说完了，一起看答案
        </button>
      )}
      <div className="challenge-footer">
        <button
          className="btn ghost"
          onClick={() => {
            setIndex((index + 1) % lesson.groups.length);
            setShow(false);
            setAnswer('');
            setExample('');
          }}
        >
          换一个构词成分
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
