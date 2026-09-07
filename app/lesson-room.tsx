'use client';
import { useCallback, useRef, useState } from 'react';
import {
  BookOpen,
  Play,
  Presentation,
  Layers,
  Pencil,
  Printer,
  RefreshCw,
  Volume2,
  Eye,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Lightbulb,
  CheckCircle2,
  Loader2,
  BookMarked,
  Save,
  ArrowUpRight,
  Image as ImageIcon,
  Copy,
  Download,
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
import { buildSlides } from '@/lib/slides';
import { TeachingPicture, TargetText } from './teaching-picture';
type SaveFn = (data: unknown, action?: string) => Promise<Lesson | undefined>;
const steps = [
  { id: 'preview', label: '认识单词', icon: BookOpen },
  { id: 'roots', label: '词根和词汇', icon: Layers },
  { id: 'scenes', label: '情景图文故事', icon: ImageIcon },
  { id: 'practice', label: '课堂互动练习', icon: Pencil },
  { id: 'workbook', label: '练习册打印', icon: Printer },
];
export function LessonRoom({
  lesson,
  busy,
  onSave,
  onVersion,
  onRegenerate,
  notify,
}: {
  lesson: Lesson;
  busy: boolean;
  onSave: SaveFn;
  onVersion: (id: string) => Promise<void>;
  onRegenerate: () => void;
  notify: (s: string) => void;
}) {
  const [player, setPlayer] = useState(false);
  const [startAt, setStartAt] = useState('welcome');
  const closePlayer = useCallback(() => setPlayer(false), []);
  const deck = buildSlides(lesson);
  const savedPage = deck.findIndex(
    (s) => s.id === lesson.config.presentation_slide,
  );
  function startLecture(resume = false) {
    setStartAt(
      resume ? lesson.config.presentation_slide || 'welcome' : 'welcome',
    );
    setPlayer(true);
    // Invoke in the click gesture; the dialog renders inside the fullscreen document.
    if (document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  }
  const [stage, setStage] = useState(lesson.stage),
    [pending, setPending] = useState(false),
    [complete, setComplete] = useState(false),
    [notes, setNotes] = useState(lesson.notes),
    [rootId, setRootId] = useState('');
  const remembered = lesson.words.filter(
      (w) => w.result === 'remembered',
    ).length,
    again = lesson.words.filter((w) => w.result === 'again').length;
  async function changeStage(id: string) {
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
      <div className="lesson-title">
        <div>
          <p className="eyebrow">
            {lesson.level} / LESSON {String(lesson.number).padStart(2, '0')}
          </p>
          <h1>
            {lesson.title}
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
          </h1>
          <p className="lesson-meta">
            {lesson.words.length} 个单词 <span>·</span>{' '}
            {bands[lesson.config.difficulty_min]}—
            {bands[lesson.config.difficulty_max]} <span>·</span>{' '}
            {lesson.groups.length} 个构词成分 <span>·</span>{' '}
            {date(lesson.created_at)} 生成
          </p>
        </div>
        <div className="lesson-actions">
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
          <button
            className="btn secondary"
            disabled={lesson.read_only || busy || pending}
            onClick={onRegenerate}
          >
            <RefreshCw size={16} />
            重新生成
          </button>
          <button
            className="btn secondary"
            onClick={() => void changeStage('workbook')}
          >
            <Printer size={16} />
            课前打印
          </button>
        </div>
      </div>
      {!lesson.is_current && (
        <div className="archive-note">
          <BookMarked size={18} />
          正在回看旧版本。讲义、单词和课堂记录均保留当时内容。
        </div>
      )}
      <section className="lesson-materials-bar" aria-label="课程编号与素材">
        <div>
          <span className="muted">课程编号</span>{' '}
          <strong>{lesson.course_code}</strong>
          <button
            className="material-copy"
            aria-label="复制课程编号"
            onClick={() => {
              void navigator.clipboard.writeText(lesson.course_code).then(
                () => notify('课程编号已复制'),
                () => notify('复制失败，请选中课程编号手动复制。'),
              );
            }}
          >
            <Copy size={16} />
          </button>
        </div>
        <span>
          {lesson.words.filter((w) => w.images?.length).length} /{' '}
          {lesson.words.length} 词有配图 <span>·</span>{' '}
          {lesson.materials.story?.scenes.length || 0} 页故事
        </span>
        <a
          className="btn secondary"
          href={'/api/courses/' + lesson.course_code + '/brief'}
          download
        >
          <Download size={15} />
          下载素材任务
        </a>
      </section>
      <section className="lecture-launch">
        <div className="lecture-launch-icon">
          <Presentation size={29} />
        </div>
        <div className="lecture-launch-copy">
          <p className="eyebrow">READY FOR CLASS</p>
          <h2>把今天的单词，搬上大屏幕</h2>
          <p>
            认识单词 <span>→</span> 构词线索 <span>→</span> 情景故事{' '}
            <span>→</span> 一起练习 <span>·</span> {deck.length} 页
          </p>
        </div>
        <div className="lecture-launch-actions">
          <button
            className="btn lecture-start"
            disabled={busy || pending}
            onClick={() => startLecture()}
          >
            <Play size={19} fill="currentColor" />
            开始讲课
          </button>
          {savedPage > 0 && (
            <button
              className="lecture-resume"
              disabled={busy || pending}
              onClick={() => startLecture(true)}
            >
              继续第 {savedPage + 1} 页 <ArrowRight size={14} />
            </button>
          )}
        </div>
      </section>
      <div className="lesson-progress">
        <div>
          <strong>{remembered}</strong>
          <span> / {lesson.words.length} 词已记住</span>
        </div>
        <Progress
          value={(remembered / lesson.words.length) * 100}
          aria-label="本课单词掌握进度"
        />
        <span>
          {again ? again + ' 词再练一次' : '一步一步来，不必急着记住全部'}
        </span>
      </div>
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
          <WordPreview
            words={lesson.words}
            notify={notify}
            onRoot={(id) => {
              setRootId(id);
              void changeStage('roots');
            }}
          />
          <div className="step-footer">
            <span>读过一遍，再寻找单词之间的关系。</span>
            <button
              className="btn primary"
              onClick={() => void changeStage('roots')}
            >
              看看构词规律
              <ArrowRight size={17} />
            </button>
          </div>
        </TabsContent>
        <TabsContent value="roots">
          <Roots
            lesson={lesson}
            selectedId={rootId}
            onSelected={setRootId}
            notify={notify}
          />
          <div className="step-footer">
            <span>试着解释这条线索，再用本课单词举例。</span>
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
                    </p>
                    <details>
                      <summary>看看中文</summary>
                      <p>{scene.zh}</p>
                    </details>
                    <div className="story-preview-question">
                      <strong>{scene.question.en}</strong>
                      <p>{scene.question.zh}</p>
                      <details>
                        <summary>揭晓答案</summary>
                        <p>
                          {scene.question.answer_en}
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
          <Workbook lesson={lesson} />
        </TabsContent>
      </Tabs>
      <footer className="lesson-record panel">
        <div>
          <h3>
            <Pencil size={18} />
            课堂记录
          </h3>
          <p className="muted">记录容易混淆的词、有效的例子和下次复习重点。</p>
        </div>
        <Textarea
          aria-label="课堂记录"
          placeholder="例如：-er 的意思理解得很好，拼写还需要多练一次……"
          value={notes}
          maxLength={5000}
          readOnly={lesson.read_only}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="record-actions">
          <span className="caption">
            {lesson.read_only
              ? '已保存的课堂记录'
              : notes === lesson.notes
                ? '课堂记录已保存'
                : '记录有修改，记得保存'}
          </span>
          <div>
            {!lesson.read_only && (
              <button
                className="btn secondary"
                disabled={pending || notes === lesson.notes}
                onClick={async () => {
                  setPending(true);
                  await onSave({ notes });
                  setPending(false);
                }}
              >
                <Save size={16} />
                保存记录
              </button>
            )}
            <button
              className="btn primary"
              disabled={lesson.read_only || pending}
              onClick={() => setComplete(true)}
            >
              <CheckCircle2 size={17} />
              {lesson.status === 'completed'
                ? '这节课已完成'
                : '结束并保存本课'}
            </button>
          </div>
        </div>
      </footer>
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
  onRoot,
}: {
  words: Word[];
  notify: (s: string) => void;
  onRoot: (id: string) => void;
}) {
  const [hide, setHide] = useState(false),
    [open, setOpen] = useState<Record<string, boolean>>({});
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
                  <p lang="en">{w.example}</p>
                  {visible && w.example_zh && (
                    <p className="example-zh">{w.example_zh}</p>
                  )}
                </div>
              )}
              {w.extra_examples?.[0] && (
                <div className="word-example extra-example">
                  <p lang="en">{w.extra_examples[0].en}</p>
                  {visible && (
                    <p className="example-zh">{w.extra_examples[0].zh}</p>
                  )}
                </div>
              )}
              {w.story_zh && visible && (
                <details className="memory-story">
                  <summary>
                    <BookMarked size={15} /> 单词里的小故事
                  </summary>
                  <p>{w.story_zh}</p>
                  <small>
                    {w.student_prompt || '换成你的经历，试着用这个词说一句话。'}
                  </small>
                </details>
              )}
              <div className="word-card-bottom">
                <span className={'difficulty d' + w.difficulty}>
                  {bands[w.difficulty]}
                </span>
                {w.parts.length ? (
                  <button onClick={() => onRoot(w.parts[0].text)}>
                    <Layers size={13} />
                    {w.parts.map((p) => p.text).join(' + ')}
                    <ArrowRight size={13} />
                  </button>
                ) : (
                  <span className="caption">整体记忆</span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
function Roots({
  lesson,
  selectedId,
  onSelected,
  notify,
}: {
  lesson: Lesson;
  selectedId: string;
  onSelected: (id: string) => void;
  notify: (s: string) => void;
}) {
  const [show, setShow] = useState(true);
  const group =
    lesson.groups.find((g) => g.id === selectedId || g.text === selectedId) ||
    lesson.groups[0];
  if (!group)
    return (
      <div className="empty-roots">
        <Layers size={40} />
        <h2>这组词，先从整体记忆开始</h2>
        <p>
          这些词适合完整记忆。把它们放进例句和生活场景，找到自己的记忆线索。
        </p>
        <div className="whole-word-prompt">
          课堂小任务：挑三个词，说一说它们会出现在生活中的什么地方。
        </div>
      </div>
    );
  const related = lesson.words.filter((w) =>
    group.words.some((g) => g.word === w.word),
  );
  return (
    <div className="stage-body">
      <div className="section-toolbar">
        <div>
          <h2>找到线索，让单词连起来</h2>
          <p>
            词基承载核心意思，词缀改变含义或词性；合成词把熟悉的成分组合起来。
          </p>
        </div>
        <label className="inline-switch">
          <Switch checked={!show} onCheckedChange={(v) => setShow(!v)} />
          先猜意思
        </label>
      </div>
      <div className="roots-layout">
        <aside className="root-list" aria-label="本课构词成分">
          {lesson.groups.map((g) => (
            <button
              key={g.id}
              className={g.id === group.id ? 'active' : ''}
              onClick={() => onSelected(g.id)}
            >
              <strong lang="en">{g.text}</strong>
              <span>
                {kinds[g.kind]} <em>{g.words.length} 词</em>
              </span>
            </button>
          ))}
        </aside>
        <div className="root-exploration" key={group.id}>
          <div className="root-feature">
            <span className="root-kind">{kinds[group.kind]}</span>
            <h3 lang="en">{group.text}</h3>
            <p>{show ? group.meaning : '这个成分表达什么意思？'}</p>
            {!show && (
              <button className="btn light" onClick={() => setShow(true)}>
                <Eye size={16} />
                一起揭晓
              </button>
            )}
            <span className="root-connections">
              {related.length} 个本课单词与它相连 ↓
            </span>
          </div>
          <div className="related-words">
            {related.map((w) => (
              <article key={w.id}>
                <div className="decomposition">
                  {w.parts.map((p, i) => (
                    <span key={i}>
                      {i > 0 && <em> + </em>}
                      <strong
                        className={p.text === group.text ? 'highlight' : ''}
                      >
                        {p.text}
                      </strong>
                    </span>
                  ))}
                </div>
                <div className="related-result">
                  <h4 lang="en">{w.word}</h4>
                  <button
                    className="icon-btn"
                    aria-label={'朗读 ' + w.word}
                    onClick={() => speak(w.word, notify)}
                  >
                    <Volume2 size={17} />
                  </button>
                </div>
                <p>{show ? w.meaning_zh : '先用自己的话猜猜词义'}</p>
                <div className="family-example-inline">
                  <p lang="en">{w.example}</p>
                  {show && <small>{w.example_zh}</small>}
                </div>
                {show && <small>{w.note}</small>}
              </article>
            ))}
          </div>
          <div className="root-story">
            <Lightbulb size={23} />
            <div>
              <h3>{group.story ? '构词小故事' : '理解这条线索'}</h3>
              <p>
                {group.story ||
                  (group.kind === 'compound'
                    ? '合成词把已有的词组合起来表达新事物。找出哪个成分告诉我们“是什么”，哪个成分补充它的特征。'
                    : '这里标出的成分来自已整理的现代英语构词关系。相同字母不一定来自相同词根，请结合完整词义判断。')}
              </p>
              {group.source && group.source.startsWith('https://') && (
                <a href={group.source} target="_blank" rel="noreferrer">
                  查看来历出处 <ArrowUpRight size={13} />
                </a>
              )}
            </div>
          </div>
          <div className="teacher-cue">
            <span>轮到你来讲</span>
            <p>
              选一个单词，说说它与 <strong>{group.text}</strong>{' '}
              的联系，再用它说一句自己的话。
            </p>
          </div>
        </div>
      </div>
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
      <Tabs value={mode} onValueChange={(v) => setMode(String(v))}>
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
  const [cursor, setCursor] = useState(lesson.cursor || 0),
    [flipped, setFlipped] = useState(false),
    [reverse, setReverse] = useState(false),
    [pending, setPending] = useState(false);
  const w = lesson.words[cursor];
  async function move(next: number, result?: string) {
    setPending(true);
    const n = (next + lesson.words.length) % lesson.words.length;
    try {
      if (!lesson.read_only) {
        const updated = await onSave({
          cursor: n,
          ...(result ? { word_id: w.id, result } : {}),
        });
        if (!updated) return;
      }
      setCursor(n);
      setFlipped(false);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="recall-area">
      <div className="recall-toolbar">
        <span>
          单词 <strong>{cursor + 1}</strong> / {lesson.words.length}
        </span>
        <label className="inline-switch">
          <Switch
            checked={reverse}
            onCheckedChange={(v) => {
              setReverse(v);
              setFlipped(false);
            }}
          />
          看中文，想英文
        </label>
      </div>
      <button
        className={'flashcard ' + (flipped ? 'is-flipped' : '')}
        onClick={() => setFlipped(!flipped)}
        aria-label={flipped ? '隐藏答案，继续回忆' : '翻开卡片，查看答案'}
      >
        <span className="flash-face front" aria-hidden={flipped}>
          <span className="eyebrow">
            {reverse ? 'SAY IT IN ENGLISH' : 'WHAT DOES IT MEAN?'}
          </span>
          <strong lang={reverse ? 'zh-CN' : 'en'}>
            {reverse ? w.meaning_zh : w.display_word || w.word}
          </strong>
          <span className="muted">{w.pos}</span>
          <span className="flip-hint">
            <RotateCcw size={16} />
            先说出答案，再翻开卡片
          </span>
        </span>
        <span className="flash-face back" aria-hidden={!flipped}>
          <span className="eyebrow">LET&apos;S CHECK</span>
          <strong lang={reverse ? 'en' : 'zh-CN'}>
            {reverse ? w.display_word || w.word : w.meaning_zh}
          </strong>
          <span className="flash-parts">
            {w.parts.length
              ? w.parts.map((p) => p.text + '（' + p.meaning + '）').join(' + ')
              : '把它放进自己的生活场景里记忆'}
          </span>
          {w.example && <span lang="en">{w.example}</span>}
        </span>
      </button>
      <div className="recall-actions">
        <button
          className="icon-btn"
          onClick={() => void move(cursor - 1)}
          disabled={pending}
          aria-label="上一个单词"
        >
          <ChevronLeft />
        </button>
        <button
          className="btn secondary"
          disabled={pending || lesson.read_only}
          onClick={() => void move(cursor + 1, 'again')}
        >
          <RotateCcw size={17} />
          再练一次
        </button>
        <button
          className="btn success"
          disabled={pending || lesson.read_only}
          onClick={() => void move(cursor + 1, 'remembered')}
        >
          <Check size={18} />
          记住了
        </button>
        <button
          className="icon-btn"
          onClick={() => void move(cursor + 1)}
          disabled={pending}
          aria-label="下一个单词"
        >
          <ChevronRight />
        </button>
      </div>
      <button
        className="btn ghost recall-sound"
        onClick={() => speak(w.word, notify)}
      >
        <Volume2 size={17} />
        听听发音
      </button>
      <p className="caption">
        {lesson.read_only
          ? '历史课可以继续翻卡复习，当时的掌握标记会保留。'
          : '每次标记会自动保存，并切换到下一个单词。'}
        {w.result === 'remembered'
          ? ' 上次标记：记住了。'
          : w.result === 'again'
            ? ' 上次标记：再练一次。'
            : ''}
      </p>
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
function Workbook({ lesson }: { lesson: Lesson }) {
  const [kind, setKind] = useState('classroom'),
    [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const src = '/api/versions/' + lesson.version_id + '/worksheet?kind=' + kind;
  function print() {
    frame.current?.contentWindow?.focus();
    frame.current?.contentWindow?.print();
  }
  return (
    <div className="stage-body workbook">
      <div className="section-toolbar">
        <div>
          <h2>纸上的练习，也准备好了</h2>
          <p>
            课前打印随堂跟写纸，课后发放填空练习。两份材料都对应本课版本{' '}
            {lesson.version_number}。
          </p>
        </div>
      </div>
      <Tabs
        value={kind}
        onValueChange={(v) => {
          setReady(false);
          setKind(String(v));
        }}
      >
        <TabsList className="print-kind-tabs">
          <TabsTrigger value="classroom">
            <Pencil size={16} />
            随堂跟写
          </TabsTrigger>
          <TabsTrigger value="homework">
            <BookMarked size={16} />
            课后填空
          </TabsTrigger>
          <TabsTrigger value="answers">
            <CheckCircle2 size={16} />
            教师答案
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="print-toolbar">
        <div>
          <span className="a4-badge">A4</span>
          <span>
            {kind === 'classroom'
              ? '课堂跟读 · 连续书写 · 下课收取'
              : kind === 'homework'
                ? '构词理解 · 单词举例 · 双向填空'
                : '教师核对使用，请与学生练习分开打印'}
          </span>
        </div>
        <div>
          <a
            className="btn secondary"
            href={src}
            target="_blank"
            rel="noreferrer"
          >
            单独打开
            <ArrowUpRight size={15} />
          </a>
          <button className="btn primary" disabled={!ready} onClick={print}>
            <Printer size={17} />
            打印这份材料
          </button>
        </div>
      </div>
      <iframe
        key={src}
        ref={frame}
        src={src}
        title={
          kind === 'classroom'
            ? '随堂跟写 A4 打印预览'
            : kind === 'homework'
              ? '课后填空 A4 打印预览'
              : '教师答案 A4 打印预览'
        }
        className="worksheet-preview"
        onLoad={() => setReady(true)}
      />
      <p className="caption">
        可先在预览中填写姓名、年龄和时间，也可打印后手写。选择 A4
        纵向，建议关闭页眉页脚。
      </p>
    </div>
  );
}
