'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Download, Loader2, Square, Volume2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { api } from '@/lib/classroom';
import {
  onAudioCached,
  prepareAudio,
  speak,
  speechPlayer,
  stopSpeech,
  type AudioInventory,
} from '@/lib/audio';

export function SpeakButton({
  text,
  label = '朗读例句',
  notify,
}: {
  text: string;
  label?: string;
  notify: (message: string) => void;
}) {
  const state = useSyncExternalStore(
    speechPlayer.subscribe,
    speechPlayer.snapshot,
    speechPlayer.serverSnapshot,
  );
  const active =
    state.text === text.trim().replace(/\s+/g, ' ').normalize('NFC') &&
    state.phase !== 'idle';
  return (
    <button
      type="button"
      className={'inline-sound ' + (active ? 'active' : '')}
      onClick={() => speak(text, notify)}
      aria-label={active ? '停止朗读' : label}
      title="AI 合成语音"
      aria-pressed={active}
    >
      {active && state.phase === 'loading' ? (
        <Loader2 size={16} className="spin" />
      ) : active ? (
        <Square size={16} />
      ) : (
        <Volume2 size={16} />
      )}
    </button>
  );
}

export function StopAudioButton({
  className = 'btn secondary',
}: {
  className?: string;
}) {
  const state = useSyncExternalStore(
    speechPlayer.subscribe,
    speechPlayer.snapshot,
    speechPlayer.serverSnapshot,
  );
  return (
    <button
      type="button"
      className={className}
      onClick={stopSpeech}
      disabled={state.phase === 'idle'}
      aria-label="停止朗读"
      title="停止 AI 合成语音"
    >
      {state.phase === 'loading' ? (
        <Loader2 size={18} className="spin" />
      ) : (
        <Square size={18} />
      )}
    </button>
  );
}

export function AudioPreparation({
  versionId,
  compact = false,
}: {
  versionId: string;
  compact?: boolean;
}) {
  const [inventory, setInventory] = useState<AudioInventory | null>(null);
  const [error, setError] = useState('');
  const [warming, setWarming] = useState(false);
  const run = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    void api<AudioInventory>('/versions/' + versionId + '/audio')
      .then((data) => {
        if (!active) return;
        setInventory(data);
        for (const item of data.items)
          if (item.url) speechPlayer.remember(item.text, item.url);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    const unsubscribe = onAudioCached((text, clip) => {
      setInventory((current) => {
        if (!current) return current;
        const items = current.items.map((item) =>
          item.text === text ? { ...item, cached: true, url: clip.url } : item,
        );
        return {
          ...current,
          items,
          cached: items.filter((item) => item.cached).length,
        };
      });
    });
    return () => {
      active = false;
      run.current?.abort();
      run.current = null;
      unsubscribe();
    };
  }, [versionId]);
  async function warm() {
    if (run.current) return;
    const controller = new AbortController();
    run.current = controller;
    setWarming(true);
    setError('');
    try {
      const current = await api<AudioInventory>(
        '/versions/' + versionId + '/audio',
      );
      if (controller.signal.aborted) return;
      setInventory(current);
      for (const item of current.items) {
        if (controller.signal.aborted) break;
        if (!item.cached) await prepareAudio(item.text, controller.signal);
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : '缓存没有完成，请重试。');
    } finally {
      if (run.current === controller) {
        run.current = null;
        setWarming(false);
      }
    }
  }
  const ready = !!inventory && inventory.total === inventory.cached;
  const content = (
    <section className="audio-preparation" aria-label="本课语音">
      <Volume2 size={21} />
      <div className="audio-preparation-copy">
        <strong>{inventory?.configuration.label || '课堂语音'}</strong>
        <p>AI 合成语音 · 首次联网合成，之后复用已存录音</p>
        <output aria-live="polite">
          {inventory
            ? `${inventory.cached} / ${inventory.total} 段已保存${ready ? ' · 本课语音已准备齐全' : ' · 单词、例句、故事与问答'}`
            : '正在读取录音…'}
        </output>
        {inventory && (
          <Progress
            value={
              inventory.total ? (inventory.cached / inventory.total) * 100 : 0
            }
            aria-label="本课语音缓存进度"
          />
        )}
        {(error || inventory?.configuration.message) && (
          <output className="audio-error">
            {error || inventory?.configuration.message}
          </output>
        )}
      </div>
      <StopAudioButton />
      {warming ? (
        <button
          type="button"
          className="btn secondary"
          onClick={() => run.current?.abort()}
        >
          <Loader2 size={16} className="spin" />
          暂停缓存
        </button>
      ) : (
        <button
          type="button"
          className={'btn ' + (ready ? 'secondary' : 'primary')}
          onClick={() => void warm()}
          disabled={!inventory || ready || !inventory.configuration.configured}
        >
          {ready ? <Check size={16} /> : <Download size={16} />}
          {ready ? '本课语音已齐' : '课前缓存本课语音'}
        </button>
      )}
    </section>
  );
  if (!compact) return content;
  // Keep the cache controller mounted when the dialog closes. Switching lessons
  // still aborts it in the effect cleanup, while closing only hides the panel.
  return (
    <Dialog>
      <DialogTrigger className="btn ghost course-audio-button">
        {warming ? (
          <Loader2 size={16} className="spin" />
        ) : (
          <Volume2 size={16} />
        )}
        课前语音
        <span>
          {error
            ? '读取失败'
            : inventory
              ? `${inventory.cached}/${inventory.total}`
              : '…'}
        </span>
      </DialogTrigger>
      <DialogContent className="course-audio-dialog">
        <DialogHeader>
          <DialogTitle>课前语音</DialogTitle>
          <DialogDescription>
            AI 合成语音 · 关闭此窗口后缓存会继续，可随时暂停。
          </DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
