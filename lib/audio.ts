export type AudioClip = {
  key: string;
  url: string;
  bytes: number;
  cached: boolean;
};
export type AudioInventory = {
  configuration: {
    provider: string;
    voice: string;
    label: string;
    configured: boolean;
    message: string;
    synthetic: boolean;
  };
  items: {
    key: string;
    text: string;
    kind: string;
    cached: boolean;
    url: string | null;
  }[];
  total: number;
  cached: number;
};
type Notify = (message: string) => void;
type AudioState = { phase: 'idle' | 'loading' | 'playing'; text: string };
const idle: AudioState = { phase: 'idle', text: '' };
const cachedListeners = new Set<(text: string, clip: AudioClip) => void>();
const normalize = (text: string) =>
  text.trim().replace(/\s+/g, ' ').normalize('NFC');

export function onAudioCached(
  listener: (text: string, clip: AudioClip) => void,
) {
  cachedListeners.add(listener);
  return () => {
    cachedListeners.delete(listener);
  };
}

export async function prepareAudio(
  text: string,
  signal?: AbortSignal,
): Promise<AudioClip> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 70_000);
  try {
    const response = await fetch('/api/audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    const clip = (await response.json()) as AudioClip & { error?: string };
    if (!response.ok) throw new Error(clip.error || '语音暂时不可用，请重试。');
    if (!/^\/assets\/audio\/v1\/[a-f0-9]{64}\.mp3$/.test(clip.url))
      throw new Error('语音文件地址不正确。');
    for (const listener of cachedListeners) listener(normalize(text), clip);
    return clip;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted)
      throw new Error('准备语音超时，请稍后重试；已经保存的录音可以继续使用。');
    if (error instanceof TypeError && !signal?.aborted)
      throw new Error('无法连接课堂服务，请检查网络后重试。');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

/** One recording at a time. Stale requests cannot start audio after navigation. */
export class SpeechPlayer {
  private generation = 0;
  private media: HTMLAudioElement | null = null;
  private controller: AbortController | null = null;
  private state: AudioState = idle;
  private listeners = new Set<() => void>();
  private urls = new Map<string, string>();
  private request: typeof prepareAudio;
  private createAudio: () => HTMLAudioElement;

  constructor(request = prepareAudio, createAudio = () => new Audio()) {
    this.request = request;
    this.createAudio = createAudio;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  serverSnapshot = () => idle;
  remember = (text: string, url: string) => {
    this.urls.set(normalize(text), url);
  };
  private update(state: AudioState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  stop = () => {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    if (this.media) {
      this.media.onended = null;
      this.media.onerror = null;
      this.media.pause();
      this.media.removeAttribute('src');
      this.media.load();
      this.media = null;
    }
    this.update(idle);
  };
  async speak(text: string, notify: Notify) {
    text = normalize(text);
    const toggleOff = this.state.phase !== 'idle' && this.state.text === text;
    this.stop();
    if (toggleOff || !text) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.update({ phase: 'loading', text });
    const loading = setTimeout(() => {
      if (generation === this.generation)
        notify('正在准备 AI 语音，首次播放会保存到本地…');
    }, 700);
    try {
      let url = this.urls.get(text);
      if (!url) {
        const clip = await this.request(text, controller.signal);
        // A fetch implementation may still resolve after cancellation.
        if (generation !== this.generation) return;
        url = clip.url;
        this.remember(text, url);
      }
      if (generation !== this.generation) return;
      const media = this.createAudio();
      this.media = media;
      media.src = url;
      media.onended = () => {
        if (generation === this.generation) {
          this.stop();
          notify('');
        }
      };
      media.onerror = () => {
        if (generation !== this.generation) return;
        this.urls.delete(text);
        this.stop();
        notify('录音未能播放，请确认本地服务仍在运行后重试。');
      };
      await media.play();
      if (generation === this.generation) {
        this.update({ phase: 'playing', text });
        notify('');
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.stop();
      notify(
        error instanceof Error && error.name === 'NotAllowedError'
          ? '录音已准备好，请再点一次播放。'
          : error instanceof Error
            ? error.message
            : '语音暂时不可用，请稍后重试。',
      );
    } finally {
      clearTimeout(loading);
    }
  }
}

export const speechPlayer = new SpeechPlayer();
onAudioCached((text, clip) => speechPlayer.remember(text, clip.url));
export const speak = (text: string, notify: Notify) => {
  void speechPlayer.speak(text, notify);
};
export const stopSpeech = speechPlayer.stop;
