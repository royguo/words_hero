'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  ImageIcon,
  Loader2,
  Pause,
  RefreshCw,
  Volume2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import type { Lesson } from '@/lib/classroom';
import { speechPlayer } from '@/lib/audio';
import {
  courseResourcePlan,
  downloadResources,
  ensureMediaWorker,
  openMediaCache,
  resourceAudioInventory,
  type ResourcePlan,
  type ResourceProgress,
} from '@/lib/course-resources';

type Phase = 'idle' | 'preparing' | 'downloading' | 'paused' | 'done' | 'error';
const empty: ResourceProgress = { cached: [], bytes: 0, failed: [] };
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function CourseResources({
  lesson,
  notify,
}: {
  lesson: Lesson;
  notify: (message: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<ResourcePlan | null>(null);
  const [progress, setProgress] = useState(empty);
  const [error, setError] = useState('');
  const run = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      run.current?.abort();
      run.current = null;
    },
    [lesson.version_id],
  );

  async function download() {
    if (run.current) return;
    const controller = new AbortController();
    run.current = controller;
    const active = () => run.current === controller;
    setPhase('preparing');
    setError('');
    try {
      await ensureMediaWorker();
      controller.signal.throwIfAborted();
      const audio = await resourceAudioInventory(
        lesson.version_id,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      // Reuse the exact URLs collected for this version when the teacher starts speaking.
      for (const item of audio.items)
        if (item.cached && item.url) speechPlayer.remember(item.text, item.url);
      const next = courseResourcePlan(lesson, audio);
      const cache = await openMediaCache();
      controller.signal.throwIfAborted();
      setPlan(next);
      setPhase('downloading');
      const result = await downloadResources(
        next.items,
        cache,
        controller.signal,
        (state) => {
          if (active()) setProgress(state);
        },
      );
      if (!active()) return;
      if (controller.signal.aborted) setPhase('paused');
      else if (result.failed.length) {
        setPhase('error');
        setError(
          `${result.failed.length} 个文件未下载成功。请检查网络后重试，已下载的文件会保留。`,
        );
      } else {
        setPhase('done');
        if (next.items.length)
          notify(
            next.missingAudio
              ? '已有图片和录音已下载，部分语音仍需课前生成。'
              : '课程资源已预下载到当前浏览器。',
          );
      }
    } catch (cause) {
      if (!active()) return;
      if (controller.signal.aborted) setPhase('paused');
      else {
        setPhase('error');
        setError(
          cause instanceof TypeError
            ? '无法连接资源服务，请检查网络后重试。'
            : cause instanceof Error && cause.name === 'TimeoutError'
              ? '读取资源清单超时，请重试。'
              : cause instanceof Error
                ? cause.message
                : '预下载未完成，请重试。',
        );
      }
    } finally {
      if (active()) run.current = null;
    }
  }
  const busy = phase === 'preparing' || phase === 'downloading';
  const total = plan?.items.length || 0;
  const complete = phase === 'done' && total > 0 && !plan?.missingAudio;
  const cached = new Set(progress.cached);
  const label =
    phase === 'preparing'
      ? '正在读取课程资源…'
      : phase === 'downloading'
        ? '正在下载到当前浏览器'
        : phase === 'paused'
          ? '下载已暂停'
          : phase === 'error'
            ? '部分资源尚未准备好'
            : complete
              ? '本课资源已在本机准备好'
              : total
                ? '已有资源下载完成'
                : '暂无可下载的图片或录音';
  return (
    <Dialog>
      <DialogTrigger
        className="btn ghost course-download-button"
        onClick={() => void download()}
      >
        {busy ? (
          <Loader2 size={16} className="spin" />
        ) : complete ? (
          <Check size={16} />
        ) : (
          <Download size={16} />
        )}
        预下载课程资源
        {(busy || complete || phase === 'paused') && total > 0 && (
          <span>
            {progress.cached.length}/{total}
          </span>
        )}
      </DialogTrigger>
      <DialogContent className="course-resources-dialog">
        <DialogHeader>
          <DialogTitle>预下载课程资源</DialogTitle>
          <DialogDescription>
            将本课图片和已有录音存到当前浏览器，讲课时优先使用。
          </DialogDescription>
        </DialogHeader>
        <div className="resource-download-status">
          <output aria-live="polite">{label}</output>
          <span>
            {progress.cached.length} / {total} 个文件 · {size(progress.bytes)}
          </span>
          <Progress
            value={total ? (progress.cached.length / total) * 100 : 0}
            aria-label="课程资源预下载进度"
          />
        </div>
        {plan && (
          <div className="resource-download-counts">
            {(['image', 'audio'] as const).map((kind) => {
              const items = plan.items.filter((item) => item.kind === kind);
              return (
                <div key={kind}>
                  {kind === 'image' ? (
                    <ImageIcon size={18} />
                  ) : (
                    <Volume2 size={18} />
                  )}
                  <span>
                    {kind === 'image'
                      ? '单词与故事配图'
                      : '单词、例句与故事录音'}
                  </span>
                  <strong>
                    {items.filter((item) => cached.has(item.url)).length} /{' '}
                    {items.length}
                  </strong>
                </div>
              );
            })}
          </div>
        )}
        {!!plan?.missingAudio && (
          <p className="resource-download-notice">
            另有 {plan.missingAudio}{' '}
            段语音尚未生成。请先在“课前语音”中准备，再回来补充下载。
          </p>
        )}
        {error && (
          <p className="resource-download-error" role="alert">
            {error}
          </p>
        )}
        <p className="resource-download-help">
          缓存保留 7
          天；清理浏览器数据或存储空间不足时可能提前移除。登录和保存课堂记录仍需联网。
        </p>
        <div className="resource-download-actions">
          <span>
            {busy
              ? '关闭窗口后继续下载；切换课程会暂停。'
              : '再次下载会自动跳过本机已有的文件。'}
          </span>
          {busy ? (
            <button
              className="btn secondary"
              onClick={() => run.current?.abort()}
            >
              <Pause size={16} />
              暂停
            </button>
          ) : (
            <button
              className={'btn ' + (complete ? 'secondary' : 'primary')}
              onClick={() => void download()}
            >
              {complete ? <RefreshCw size={16} /> : <Download size={16} />}
              {complete
                ? '重新检查'
                : phase === 'paused'
                  ? '继续下载'
                  : phase === 'error'
                    ? '重试下载'
                    : '补充下载'}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
