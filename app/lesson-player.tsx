'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Layers,
  List,
  Maximize,
  Minimize,
  RotateCcw,
  Volume2,
  X,
  PencilLine,
  Loader2,
  StickyNote,
} from 'lucide-react';
import { TemporaryNotes, type NotePosition } from './temporary-notes';
import { TeachingPicture, TargetText } from './teaching-picture';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  buildSlides,
  chapters,
  sectionFor,
  wordLabel,
  type Slide,
} from '@/lib/slides';
import { kinds, speak, type Lesson, type Word } from '@/lib/classroom';
import { stopSpeech } from '@/lib/audio';
import { StopAudioButton } from './audio-tools';
import { WordStudyPage } from './word-study';
import { WordCards } from './word-cards';
import { phoneticFor } from '@/lib/word-presentation';

type SaveFn = (data: unknown, action?: string) => Promise<Lesson | undefined>;

function Sentence({ text, word }: { text: string; word: Word }) {
  const candidates = [word.word, ...(word.accepted || [])].sort(
    (a, b) => b.length - a.length,
  );
  const pattern = new RegExp(
    '(?<![a-zA-Z])(' +
      candidates
        .map((x) => x.replace(/[.*+?^{}()|[\]\\$]/g, '\\$&'))
        .join('|') +
      ')(?![a-zA-Z])',
    'gi',
  );
  return (
    <>
      {text
        .split(pattern)
        .map((s, i) => (i % 2 ? <mark key={i}>{s}</mark> : s))}
    </>
  );
}
export function LessonPlayer({
  lesson,
  startAt,
  onSave,
  onExit,
}: {
  lesson: Lesson;
  startAt: string;
  onSave: SaveFn;
  onExit: () => void;
}) {
  useEffect(() => {
    stopSpeech();
    return stopSpeech;
  }, []);
  const slides = useMemo(() => buildSlides(lesson), [lesson]);
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      slides.findIndex((s) => s.id === startAt),
    ),
  );
  const [revealed, setRevealed] = useState(false);
  const [outline, setOutline] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [notePosition, setNotePosition] = useState<NotePosition | null>(null);
  const notesToggle = useRef<HTMLButtonElement>(null);
  const hideNotes = () => {
    setNotesOpen(false);
    notesToggle.current?.focus();
  };
  const [full, setFull] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [scale, setScale] = useState(1);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLElement>(null);
  const outlineCurrent = useRef<HTMLButtonElement>(null);
  const wasFull = useRef(false);
  const slide = slides[index] || slides[0];
  const chapter = chapters.find((c) => c.id === slide.chapter)!;
  const visibleChapters = chapters.filter((c) =>
    slides.some((s) => s.chapter === c.id),
  );
  const canReveal = [
    'word',
    'cards',
    'practice',
    'scene',
    'scene-question',
  ].includes(slide.kind);
  const close = useCallback(() => {
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
    stopSpeech();
    onExit();
  }, [onExit]);
  useEffect(() => {
    const element = viewport;
    if (!element) return;
    const resize = () =>
      setScale(
        Math.min(element.clientWidth / 1600, element.clientHeight / 900),
      );
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewport]);
  useEffect(() => {
    const changed = () => {
      const active = Boolean(document.fullscreenElement);
      setFull(active);
      if (active) wasFull.current = true;
      else if (wasFull.current) onExit();
    };
    changed();
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, [onExit]);
  useEffect(() => {
    if (outline) outlineCurrent.current?.scrollIntoView({ block: 'center' });
  }, [outline]);

  const go = useCallback(
    (next: number) => {
      const n = Math.max(0, Math.min(next, slides.length - 1));
      if (n === index) {
        setOutline(false);
        return;
      }
      stopSpeech();
      setIndex(n);
      setRevealed(false);
      setOutline(false);
      setMessage('');
      if (!lesson.read_only)
        void onSave({
          presentation_slide: slides[n].id,
          stage: sectionFor(slides[n]),
        }).then((saved) => {
          if (!saved) setMessage('翻页位置没有保存成功，请检查本地服务。');
        });
    },
    [index, slides, lesson.read_only, onSave],
  );
  const advance = useCallback(() => {
    if (outline || pending) return;
    if (canReveal && !revealed) setRevealed(true);
    else go(index + 1);
  }, [outline, pending, canReveal, revealed, go, index]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing)
        return;
      const target = event.target as HTMLElement;
      if (
        target.closest(
          'input,textarea,select,[contenteditable="true"],[data-player-notes]',
        )
      )
        return;
      if (target.closest('button') && [' ', 'Enter'].includes(event.key))
        return;
      if (outline || pending) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        advance();
      }
      if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        go(index - 1);
      }
      if (event.key === 'Home') {
        event.preventDefault();
        event.stopPropagation();
        go(0);
      }
      if (event.key === 'End') {
        event.preventDefault();
        event.stopPropagation();
        go(slides.length - 1);
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [advance, go, index, outline, pending, close, slides.length]);
  async function fullScreen() {
    try {
      await document.documentElement.requestFullscreen();
      setMessage('');
    } catch {
      setMessage('已铺满网页窗口。浏览器全屏不可用时，可使用系统的全屏按钮。');
    }
  }
  async function rate(result: 'remembered' | 'again') {
    if (!slide.word || lesson.read_only || pending) return;
    setPending(true);
    try {
      const updated = await onSave({ word_id: slide.word.id, result });
      setMessage(
        updated
          ? result === 'remembered'
            ? '已记住，继续前进。'
            : '没关系，我们再练一次。'
          : '没有保存成功，请重试。',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (!open) {
          if (notesOpen) {
            details.cancel();
            hideNotes();
          } else if (outline) {
            details.cancel();
            setOutline(false);
          } else close();
        }
      }}
    >
      <DialogContent
        className="lesson-player"
        showCloseButton={false}
        initialFocus={canvas}
        style={{ translate: 'none', scale: 'none' }}
      >
        <DialogTitle className="sr-only">{lesson.title} · 课堂放映</DialogTitle>
        <DialogDescription className="sr-only">
          每次显示一页。方向键或空格先揭晓再翻页，左方向键返回，Esc 退出。
        </DialogDescription>
        <header className="player-topbar">
          <button className="player-icon" onClick={close} aria-label="退出讲课">
            <ArrowLeft size={19} />
          </button>
          <span className="player-lesson">
            {lesson.class_name}
            <i>/</i>第 {lesson.number} 课
          </span>
          <nav className="player-chapters" aria-label="讲课章节">
            {visibleChapters.map((c) => (
              <button
                key={c.id}
                className={c.id === slide.chapter ? 'active' : ''}
                aria-current={c.id === slide.chapter ? 'step' : undefined}
                onClick={() => go(slides.findIndex((s) => s.chapter === c.id))}
              >
                <span>{c.number}</span>
                {c.short}
              </button>
            ))}
          </nav>
          <StopAudioButton className="player-icon" />
          <button
            className="player-icon"
            onClick={() => (full ? close() : void fullScreen())}
            aria-label={full ? '退出全屏讲课' : '进入浏览器全屏'}
          >
            {full ? <Minimize size={19} /> : <Maximize size={19} />}
          </button>
        </header>
        <div className="player-viewport" ref={setViewport}>
          <main
            ref={canvas}
            tabIndex={-1}
            className={'slide-canvas chapter-' + slide.chapter}
            style={{ transform: 'translate(-50%, -50%) scale(' + scale + ')' }}
            aria-label={'第 ' + (index + 1) + ' 页：' + slide.title}
          >
            <div className="slide-heading">
              <span>
                {chapter.number} / {chapter.label}
              </span>
              <span>
                {lesson.level}
                <i>·</i>
                {slide.part && slide.total && slide.total > 1
                  ? slide.part + ' / ' + slide.total
                  : 'KiteDance'}
              </span>
            </div>
            <div className="slide-body" key={slide.id}>
              <SlideBody
                slide={slide}
                lesson={lesson}
                revealed={revealed}
                onReveal={() => setRevealed(!revealed)}
                onSpeak={(word) => speak(word, setMessage)}
                onRate={async (word, result) => {
                  if (lesson.read_only) return;
                  const saved = await onSave({ word_id: word.id, result });
                  setMessage(
                    saved ? '课堂标记已保存。' : '标记未保存，请重试。',
                  );
                }}
              />
            </div>
            <div className="slide-baseline">
              <span>
                {slide.kind === 'practice' || slide.kind === 'cards'
                  ? '先想一想 · 说一说 · 写下来'
                  : '看见联系，记住单词'}
              </span>
              <span>
                {String(index + 1).padStart(2, '0')} / {slides.length}
              </span>
            </div>
          </main>
        </div>
        <footer className="player-controls">
          <button
            ref={notesToggle}
            data-player-notes-toggle
            className={
              'player-tool notes-toggle ' + (notesOpen ? 'selected' : '')
            }
            aria-expanded={notesOpen}
            onClick={() => setNotesOpen(!notesOpen)}
          >
            <StickyNote size={19} />
            <span>临时笔记</span>
          </button>
          <button
            className={'player-tool ' + (outline ? 'selected' : '')}
            onClick={() => setOutline(!outline)}
            aria-expanded={outline}
            disabled={pending}
          >
            <List size={19} />
            <span>课程目录</span>
          </button>
          <output className="player-feedback">
            {message ||
              (lesson.read_only
                ? '复习放映 · AI 合成语音'
                : 'AI 合成语音 · ← 返回 · → / 空格 揭晓与翻页')}
          </output>
          {slide.kind === 'practice' && revealed && !lesson.read_only && (
            <div className="player-ratings">
              <button
                className="player-tool"
                onClick={() => void rate('again')}
                disabled={pending}
              >
                <RotateCcw size={17} />
                再练一次
              </button>
              <button
                className="player-tool positive"
                onClick={() => void rate('remembered')}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="spin" size={17} />
                ) : (
                  <Check size={17} />
                )}
                记住了
              </button>
            </div>
          )}
          <div className="player-navigation">
            <button
              className="player-icon"
              aria-label="上一页"
              onClick={() => go(index - 1)}
              disabled={!index || pending}
            >
              <ChevronLeft />
            </button>
            <span>
              {index + 1}
              <i>/ {slides.length}</i>
            </span>
            <button
              className="player-next"
              onClick={index === slides.length - 1 ? close : advance}
              disabled={pending}
            >
              {index === slides.length - 1
                ? '结束放映'
                : canReveal && !revealed
                  ? '一起揭晓'
                  : '下一页'}
              {canReveal && !revealed ? (
                <Eye size={18} />
              ) : (
                <ChevronRight size={19} />
              )}
            </button>
          </div>
        </footer>
        <div className="player-progress" aria-hidden="true">
          <span style={{ width: ((index + 1) / slides.length) * 100 + '%' }} />
        </div>
        {outline && (
          <section className="player-outline" aria-label="课程逐页目录">
            <header>
              <div>
                <h2>今天的学习旅程</h2>
                <p>{slides.length} 页 · 点击任意一页继续</p>
              </div>
              <button
                className="player-icon"
                onClick={() => setOutline(false)}
                aria-label="关闭课程目录"
              >
                <X />
              </button>
            </header>
            <div className="outline-scroll">
              {visibleChapters.map((c) => (
                <section key={c.id}>
                  <h3>
                    {c.number} / {c.label}
                  </h3>
                  <div className="outline-grid">
                    {slides.map(
                      (s, i) =>
                        s.chapter === c.id && (
                          <button
                            key={s.id}
                            ref={i === index ? outlineCurrent : undefined}
                            className={i === index ? 'active' : ''}
                            onClick={() => go(i)}
                            aria-label={'跳到第 ' + (i + 1) + ' 页 ' + s.title}
                          >
                            <small>
                              {String(i + 1).padStart(2, '0')}
                              <span>{slideLabel(s)}</span>
                            </small>
                            <strong>{s.title}</strong>
                          </button>
                        ),
                    )}
                  </div>
                </section>
              ))}
            </div>
          </section>
        )}
        {notesOpen && (
          <TemporaryNotes
            text={noteText}
            onText={setNoteText}
            position={notePosition}
            onPosition={setNotePosition}
            onClose={hideNotes}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
function slideLabel(slide: Slide) {
  return {
    welcome: '出发',
    word: '单词',
    study: '来源与构成',
    cards: '翻卡回忆',
    practice: '句子填空',
    finish: '回顾',
    scene: '图文故事',
    'scene-question': '故事互动',
  }[slide.kind];
}
function SlideBody({
  slide,
  lesson,
  revealed,
  onReveal,
  onSpeak,
  onRate,
}: {
  slide: Slide;
  lesson: Lesson;
  revealed: boolean;
  onReveal: () => void;
  onSpeak: (v: string) => void;
  onRate: (word: Word, result: 'remembered' | 'again') => Promise<void>;
}) {
  const w = slide.word;
  if (slide.kind === 'welcome')
    return (
      <div className="slide-welcome">
        <div className="welcome-number">
          {String(lesson.number).padStart(2, '0')}
        </div>
        <p className="slide-kicker">LET&apos;S LEARN TOGETHER</p>
        <h1>{lesson.title}</h1>
        <p className="slide-lead">
          今天，让 {lesson.words.length} 个单词和生活连起来。
        </p>
        <div className="slide-agenda">
          <div>
            <BookOpen />
            <strong>认识与理解</strong>
            <span>读例句，发现单词的来历</span>
          </div>
          <div>
            <Layers />
            <strong>发现联系</strong>
            <span>用单词，一起讲故事</span>
          </div>
          <div>
            <PencilLine />
            <strong>回忆与表达</strong>
            <span>说出来，也写下来</span>
          </div>
        </div>
        <p className="slide-invitation">准备好随堂练习纸，一起出发吧。</p>
      </div>
    );
  if (slide.kind === 'word' && w) {
    const examples = slide.examples || [{ en: w.example, zh: w.example_zh }];
    return (
      <div className="slide-word-layout">
        <div className="slide-word-main">
          <span className="slide-kicker">{w.topic} / SAY IT ALOUD</span>
          <h1 className={wordLabel(w).length > 18 ? 'long-word' : ''} lang="en">
            {wordLabel(w)}
          </h1>
          <div className="slide-phonetic">
            <span>
              {w.pos}
              {phoneticFor(w) ? ' ' + phoneticFor(w) : ''}
            </span>
            <button
              className="slide-sound"
              onClick={() => onSpeak(w.word)}
              aria-label="朗读单词"
            >
              <Volume2 />
            </button>
          </div>
          <button
            className={'slide-meaning ' + (revealed ? 'revealed' : '')}
            onClick={onReveal}
          >
            {revealed ? (
              slide.meaning || w.meaning_zh
            ) : (
              <>
                <Eye /> 读一读，猜猜它的意思
              </>
            )}
          </button>
          <div className="slide-parts">
            {w.parts.map((p, i) => (
              <span key={i}>
                {p.text}
                <small>{kinds[p.kind]}</small>
              </span>
            ))}
          </div>
          <TeachingPicture images={w.images} className="word-picture" />
        </div>
        <div className="slide-examples">
          {examples.map((e, i) => (
            <article key={i}>
              <div className="example-number">
                0{i + 1}
                <button
                  onClick={() => onSpeak(e.en)}
                  className="slide-sound"
                  aria-label={'朗读例句 ' + (i + 1)}
                >
                  <Volume2 />
                </button>
              </div>
              <p lang="en">
                <Sentence text={e.en} word={w} />
              </p>
              <p
                className={
                  'slide-translation ' + (!revealed ? 'is-concealed' : '')
                }
              >
                {revealed ? e.zh : '先从句子里找线索'}
              </p>
            </article>
          ))}
          <p className="slide-question">这个词，让你想到了什么？</p>
        </div>
      </div>
    );
  }
  if (
    (slide.kind === 'scene' || slide.kind === 'scene-question') &&
    slide.scene
  ) {
    const scene = slide.scene;
    const question = slide.kind === 'scene-question';
    return (
      <div className={'scene-spread ' + (question ? 'scene-challenge' : '')}>
        <div className="scene-visual">
          <p className="slide-kicker">{lesson.materials.story?.title_en}</p>
          <TeachingPicture
            images={scene.image ? [scene.image] : []}
            className="scene-picture"
          />
          <p className="scene-caption">
            {lesson.materials.story?.title_zh} · {slide.part} / {slide.total}
          </p>
        </div>
        <div className="scene-copy">
          <p className="slide-kicker">
            {question ? 'YOUR TURN · 轮到你了' : 'STORY TIME · 一起读故事'}
          </p>
          <h1>
            {question ? '你发现了吗？' : scene.title}
            {question && (
              <span className="scene-question-sounds">
                <button
                  className="slide-sound"
                  aria-label="朗读故事问题"
                  onClick={() => onSpeak(scene.question.en)}
                >
                  <Volume2 />
                </button>
                {revealed && (
                  <button
                    className="slide-sound"
                    aria-label="朗读故事答案"
                    onClick={() => onSpeak(scene.question.answer_en)}
                  >
                    <Volume2 />
                  </button>
                )}
              </span>
            )}
          </h1>
          {question ? (
            <>
              <p className="scene-english" lang="en">
                {scene.question.en}
              </p>
              <p className="scene-chinese">{scene.question.zh}</p>
              <button
                className={'scene-answer ' + (revealed ? 'revealed' : '')}
                onClick={onReveal}
              >
                {revealed ? (
                  <>
                    <span lang="en">{scene.question.answer_en}</span>
                    <small>{scene.question.answer_zh}</small>
                  </>
                ) : (
                  <>
                    <Eye /> 先说一说，再揭晓
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <div className="scene-reading" aria-live="polite">
                {revealed ? (
                  <p className="scene-chinese full-translation">{scene.zh}</p>
                ) : (
                  <p className="scene-english" lang="en">
                    <TargetText
                      text={scene.en}
                      words={lesson.materials.story?.covered_words || []}
                    />
                  </p>
                )}
              </div>
              <div className="scene-tools">
                <button onClick={onReveal}>
                  <Eye size={24} />
                  {revealed ? '返回英文' : '看看中文'}
                </button>
                <button onClick={() => onSpeak(scene.en)}>
                  <Volume2 size={24} />
                  听故事
                </button>
              </div>
              <p className="scene-read-hint">
                分角色读一读，试着把画面演出来。
              </p>
            </>
          )}
        </div>
      </div>
    );
  }
  if (slide.kind === 'study' && w)
    return <WordStudyPage word={w} onSpeak={onSpeak} />;
  if (slide.kind === 'cards')
    return (
      <WordCards
        words={slide.words || []}
        revealed={revealed}
        readOnly={lesson.read_only}
        onSpeak={onSpeak}
        onRate={onRate}
      />
    );
  if (slide.kind === 'practice' && w)
    return (
      <div className="slide-practice">
        <p className="slide-kicker">YOUR TURN / 句子填空 · {w.pos}</p>
        <h1 className="cloze-question" lang="en">
          {w.cloze_type === 'context' ? w.cloze : w.meaning_zh}
        </h1>
        <p className="practice-clue">
          {w.cloze_type === 'context' ? w.cloze_zh : '写出词表中的目标单词'}
        </p>
        <div className={'practice-reveal ' + (revealed ? 'revealed' : '')}>
          {revealed ? (
            <>
              <strong lang="en">{w.cloze_answer}</strong>
              <p>{w.meaning_zh}</p>
            </>
          ) : (
            <>
              <PencilLine />
              <span>想好了，就把答案写下来。</span>
            </>
          )}
        </div>
      </div>
    );
  return (
    <div className="slide-recap">
      <header>
        <div>
          <p className="slide-kicker">WORDS TO TAKE WITH YOU</p>
          <h1>再读一遍，带走今天的单词。</h1>
        </div>
        <span>
          全课 {lesson.words.length} 词<br />
          回顾 {slide.part} / {slide.total}
        </span>
      </header>
      <div
        className={
          'recap-entries ' + (slide.recap?.length === 1 ? 'single' : '')
        }
      >
        {slide.recap?.map((entry, i) => (
          <article className="recap-entry" key={i} data-word-id={entry.word.id}>
            <div className="recap-word">
              <span className="recap-index">
                {String(entry.position).padStart(2, '0')} /{' '}
                {lesson.words.length}
                <span>
                  {entry.word.level} · {entry.word.pos}
                </span>
              </span>
              <h2 lang="en">
                {wordLabel(entry.word)}
                <button
                  className="slide-sound"
                  onClick={() => onSpeak(entry.word.word)}
                  aria-label={'朗读 ' + entry.word.word}
                >
                  <Volume2 />
                </button>
              </h2>
              <p className="recap-meaning">{entry.meaning}</p>
            </div>
            <div className="recap-example">
              <span className="recap-example-label recap-audio-label">
                例句 {entry.exampleNumber} / {entry.exampleTotal}
                {entry.continuation ? ' · 分段阅读' : ''}
                <button
                  className="slide-sound"
                  aria-label="朗读完整例句"
                  onClick={() =>
                    onSpeak(
                      entry.exampleNumber === 1
                        ? entry.word.example
                        : entry.word.extra_examples?.[entry.exampleNumber - 2]
                            ?.en || entry.en,
                    )
                  }
                >
                  <Volume2 />
                </button>
              </span>
              {entry.en && (
                <p lang="en">
                  <Sentence text={entry.en} word={entry.word} />
                </p>
              )}
              {entry.zh && <p className="recap-translation">{entry.zh}</p>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
