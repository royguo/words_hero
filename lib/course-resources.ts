import type { Lesson } from './classroom';
import type { AudioInventory } from './audio';
import {
  MEDIA_CACHE,
  isStoredMedia,
  mediaHash,
  pruneMedia,
} from '../public/course-media-cache.js';

export type CourseResource = { url: string; kind: 'image' | 'audio' };
export type ResourcePlan = { items: CourseResource[]; missingAudio: number };
export type ResourceProgress = {
  cached: string[];
  bytes: number;
  failed: string[];
};

export function courseResourcePlan(
  lesson: Lesson,
  audio: AudioInventory,
): ResourcePlan {
  const items = new Map<string, CourseResource>();
  const add = (url: string, kind: CourseResource['kind']) => {
    if (!mediaHash(url))
      throw new Error('课程中有无法预下载的素材地址，请先检查课程素材。');
    items.set(url, { url, kind });
  };
  for (const word of lesson.words)
    for (const image of word.images || []) add(image.src, 'image');
  for (const scene of lesson.materials.story?.scenes || [])
    if (scene.image) add(scene.image.src, 'image');
  let missingAudio = 0;
  for (const item of audio.items) {
    if (item.cached && item.url) add(item.url, 'audio');
    else missingAudio++;
  }
  return { items: [...items.values()], missingAudio };
}

export function localResourceSupport() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'caches' in window &&
    !!window.crypto?.subtle
  );
}

let workerReady: Promise<void> | null = null;
export function ensureMediaWorker(): Promise<void> {
  if (!localResourceSupport())
    return Promise.reject(
      new Error(
        '当前浏览器不支持本机预下载，请使用 HTTPS 网站或本地预览，并允许网站存储。',
      ),
    );
  if (workerReady) return workerReady;
  workerReady = new Promise<void>((resolve, reject) => {
    const service = navigator.serviceWorker;
    const controlled = () =>
      service.controller?.scriptURL ===
      new URL('/course-media-sw.js', location.href).href;
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      service.removeEventListener('controllerchange', changed);
      if (error) reject(error);
      else resolve();
    };
    const changed = () => {
      if (controlled()) finish();
    };
    const timeout = setTimeout(
      () => finish(new Error('本机缓存启动超时，请刷新页面后重试。')),
      15_000,
    );
    service.addEventListener('controllerchange', changed);
    void service
      .register('/course-media-sw.js', {
        scope: '/',
        type: 'module',
        updateViaCache: 'none',
      })
      .then(changed)
      .catch(() =>
        finish(
          new Error('本机缓存未能启动，请检查网络或浏览器的网站存储设置。'),
        ),
      );
    if (controlled()) finish();
  }).catch((error) => {
    workerReady = null;
    throw error;
  });
  return workerReady;
}

export async function openMediaCache() {
  try {
    const cache = await caches.open(MEDIA_CACHE);
    await pruneMedia(cache);
    return cache;
  } catch {
    throw new Error('浏览器无法保存资源，请检查网站存储权限或剩余空间。');
  }
}

export async function inspectResources(
  items: CourseResource[],
  cache: Cache,
): Promise<ResourceProgress> {
  const cached: string[] = [];
  let bytes = 0;
  for (const item of items) {
    const response = await cache.match(item.url);
    if (isStoredMedia(response, item.url)) {
      cached.push(item.url);
      bytes += Number(response!.headers.get('Content-Length'));
    }
  }
  return { cached, bytes, failed: [] };
}

async function saveResource(
  item: CourseResource,
  cache: Cache,
  signal: AbortSignal,
  request: typeof fetch,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(abort, 45_000);
  try {
    const response = await request(item.url, {
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'no-cache',
    });
    if (response.status !== 200)
      throw new Error(`下载失败（${response.status}）`);
    const mime =
      response.headers.get('Content-Type')?.split(';')[0].trim() || '';
    if (!(item.kind === 'audio' ? /^audio\// : /^image\//).test(mime))
      throw new Error('素材格式不正确');
    const body = await response.arrayBuffer();
    if (!body.byteLength || body.byteLength > 32 * 1024 * 1024)
      throw new Error('素材大小异常');
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', body))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    if (sha !== mediaHash(item.url)) throw new Error('素材下载不完整，请重试');
    controller.signal.throwIfAborted();
    const headers = new Headers({
      'Content-Type': mime,
      'Content-Length': String(body.byteLength),
      'X-Kite-Cached-At': String(Date.now()),
      'X-Kite-SHA256': sha,
      ETag: `"${sha}"`,
    });
    await cache.put(item.url, new Response(body, { headers }));
    return body.byteLength;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}

/** Bounded downloads; a file only counts after a complete, hash-checked cache write.
 * Re-inspect on every run, so retries, other courses and reloads reuse actual bytes.
 */
export async function downloadResources(
  items: CourseResource[],
  cache: Cache,
  signal: AbortSignal,
  onProgress: (state: ResourceProgress) => void,
  request: typeof fetch = fetch,
): Promise<ResourceProgress> {
  const state = await inspectResources(items, cache);
  const emit = () =>
    onProgress({
      ...state,
      cached: [...state.cached],
      failed: [...state.failed],
    });
  const known = new Set(state.cached);
  const pending = items.filter((item) => !known.has(item.url));
  emit();
  let index = 0;
  let fatal: unknown;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (!signal.aborted && !fatal) {
        const item = pending[index++];
        if (!item) return;
        try {
          const bytes = await saveResource(item, cache, signal, request);
          state.cached.push(item.url);
          state.bytes += bytes;
        } catch (error) {
          if (!signal.aborted) {
            state.failed.push(item.url);
            if (
              error instanceof Error &&
              [
                'QuotaExceededError',
                'SecurityError',
                'NotAllowedError',
              ].includes(error.name)
            )
              fatal = error;
          }
        }
        emit();
      }
    }),
  );
  if (fatal)
    throw new Error(
      '浏览器存储空间不足或不允许保存；已下载的资源仍保留，可以清理空间后继续。',
    );
  return state;
}

export async function resourceAudioInventory(
  versionId: string,
  signal: AbortSignal,
): Promise<AudioInventory> {
  const response = await fetch(
    '/api/versions/' + encodeURIComponent(versionId) + '/audio',
    {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    },
  );
  const result = (await response.json()) as AudioInventory & { error?: string };
  if (!response.ok)
    throw new Error(result.error || '无法读取本课资源，请检查网络后重试。');
  return result;
}
