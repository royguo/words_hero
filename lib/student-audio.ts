import { prepareAudio } from './audio';
const normalize = (text: string) =>
  text.trim().replace(/\s+/g, ' ').normalize('NFC');
/** Reuse the media element unlocked by the student's Start/Listen gesture. */
export class StudentAudio {
  private media: HTMLAudioElement;
  private generation = 0;
  private controller: AbortController | null = null;
  private release: (() => void) | null = null;
  private urls = new Map<string, string>();
  private context: AudioContext | null = null;
  constructor(
    private notice: (message: string) => void,
    createAudio = () => new Audio(),
  ) {
    this.media = createAudio();
  }
  stop() {
    this.generation++;
    this.controller?.abort();
    this.release?.();
    this.release = null;
    this.media.onended = null;
    this.media.onerror = null;
    this.media.pause();
    this.media.removeAttribute('src');
    this.media.load();
  }
  unlock() {
    this.stop();
    // A short silent WAV, generated in code; no external sound or tracking request.
    const bytes = new Uint8Array(844),
      view = new DataView(bytes.buffer);
    const text = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++)
        bytes[offset + i] = value.charCodeAt(i);
    };
    text(0, 'RIFF');
    view.setUint32(4, 836, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 8000, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    text(36, 'data');
    view.setUint32(40, 800, true);
    bytes.fill(128, 44);
    this.media.src =
      'data:audio/wav;base64,' + btoa(String.fromCharCode(...bytes));
    void this.media.play().catch(() => {});
    try {
      if (!this.context && typeof AudioContext !== 'undefined')
        this.context = new AudioContext();
      void this.context?.resume().catch(() => {});
    } catch {
      /* Sound effects must never prevent an exercise from starting. */
    }
  }
  remember(text: string, url: string) {
    this.urls.set(normalize(text), url);
  }
  async play(texts: string[]) {
    this.stop();
    const generation = this.generation,
      controller = new AbortController();
    this.controller = controller;
    for (const text of texts) {
      try {
        const key = normalize(text);
        let url = this.urls.get(key);
        if (!url) {
          url = (await prepareAudio(text, controller.signal)).url;
          if (generation !== this.generation) return;
          this.urls.set(key, url);
        }
        if (generation !== this.generation) return;
        this.media.src = url;
        const ended = new Promise<void>((resolve, reject) => {
          this.release = resolve;
          this.media.onended = () => resolve();
          this.media.onerror = () => {
            this.urls.delete(key);
            reject(new Error('语音未能播放，请点朗读重试'));
          };
        });
        // Observe ended errors even if play() itself rejects first.
        void ended.catch(() => {});
        await this.media.play();
        this.notice('');
        await ended;
        if (generation !== this.generation) return;
      } catch (e) {
        if (generation !== this.generation || controller.signal.aborted) return;
        this.stop();
        this.notice(
          e instanceof Error && e.name === 'NotAllowedError'
            ? '点击“朗读”开启声音'
            : '语音暂时不可用，可继续答题或点击朗读重试',
        );
        return;
      }
    }
  }
  effect(correct: boolean) {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    const t = context.currentTime;
    const notes = correct ? [660, 880, 1100] : [220, 165];
    notes.forEach((frequency, i) => {
      const oscillator = context.createOscillator(),
        volume = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(0, t + i * 0.06);
      volume.gain.linearRampToValueAtTime(0.055, t + i * 0.06 + 0.01);
      volume.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.15);
      oscillator.connect(volume);
      volume.connect(context.destination);
      oscillator.start(t + i * 0.06);
      oscillator.stop(t + i * 0.06 + 0.16);
      oscillator.onended = () => {
        oscillator.disconnect();
        volume.disconnect();
      };
    });
  }
  dispose() {
    this.stop();
    void this.context?.close().catch(() => {});
  }
}
