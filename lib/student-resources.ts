import type { StudyWord } from './student-game';
import { prepareAudio, type AudioClip } from './audio.ts';
import {
  downloadResources,
  ensureMediaWorker,
  openMediaCache,
  type CourseResource,
  type ResourceProgress,
} from './course-resources.ts';

export type StudentResourceProgress = {
  phase: 'preparing' | 'downloading' | 'ready';
  done: number;
  total: number;
  bytes: number;
  label: string;
};
export type PreparedStudentResources = {
  audio: Map<string, string>;
  items: CourseResource[];
  bytes: number;
};
type Dependencies = {
  ensureWorker: typeof ensureMediaWorker;
  openCache: typeof openMediaCache;
  prepare: typeof prepareAudio;
  download: typeof downloadResources;
};
const defaults: Dependencies = {
  ensureWorker: ensureMediaWorker,
  openCache: openMediaCache,
  prepare: prepareAudio,
  download: downloadResources,
};
const clean = (text: string) =>
  text.trim().replace(/\s+/g, ' ').normalize('NFC');

export function studentResourceTexts(words: StudyWord[]) {
  return [
    ...new Set(
      words
        .flatMap((word) => [word.word, word.example])
        .map(clean)
        .filter(Boolean),
    ),
  ];
}

/**
 * Prepare and hash-check every resource needed by one student group.
 * The caller must not reveal questions until this promise resolves.
 */
export async function prepareStudentResources(
  words: StudyWord[],
  signal: AbortSignal,
  onProgress: (progress: StudentResourceProgress) => void,
  dependencies: Dependencies = defaults,
): Promise<PreparedStudentResources> {
  await dependencies.ensureWorker();
  signal.throwIfAborted();
  const cache = await dependencies.openCache();
  const texts = studentResourceTexts(words);
  const audio = new Map<string, string>();
  let prepared = 0;
  const reportPreparation = (label = '正在准备真人感 AI 发音…') =>
    onProgress({
      phase: 'preparing',
      done: prepared,
      total: texts.length,
      bytes: 0,
      label,
    });
  reportPreparation();
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, Math.max(texts.length, 1)) }, async () => {
      while (!signal.aborted) {
        const text = texts[cursor++];
        if (!text) return;
        const clip: AudioClip = await dependencies.prepare(text, signal);
        signal.throwIfAborted();
        audio.set(text, clip.url);
        prepared++;
        reportPreparation(`正在准备发音 · ${text}`);
      }
    }),
  );
  signal.throwIfAborted();
  const items = new Map<string, CourseResource>();
  for (const word of words)
    if (word.image) items.set(word.image, { url: word.image, kind: 'image' });
  for (const url of audio.values()) items.set(url, { url, kind: 'audio' });
  const resources = [...items.values()];
  const reportDownload = (state: ResourceProgress) =>
    onProgress({
      phase: 'downloading',
      done: state.cached.length,
      total: resources.length,
      bytes: state.bytes,
      label: state.failed.length ? '部分资源需要重试' : '正在下载本组资源…',
    });
  const result = await dependencies.download(
    resources,
    cache,
    signal,
    reportDownload,
  );
  signal.throwIfAborted();
  if (result.failed.length || result.cached.length !== resources.length)
    throw new Error(
      `还有 ${Math.max(result.failed.length, resources.length - result.cached.length)} 个资源未下载完成，请检查网络后重试。`,
    );
  const ready = {
    phase: 'ready' as const,
    done: resources.length,
    total: resources.length,
    bytes: result.bytes,
    label: '资源准备完成',
  };
  onProgress(ready);
  return { audio, items: resources, bytes: result.bytes };
}
