'use client';
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { GripHorizontal, X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';

export type NotePosition = { x: number; y: number };

export function TemporaryNotes({
  text,
  onText,
  position,
  onPosition,
  onClose,
}: {
  text: string;
  onText: (text: string) => void;
  position: NotePosition | null;
  onPosition: Dispatch<SetStateAction<NotePosition | null>>;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  function bounded(next: NotePosition): NotePosition {
    const element = panel.current;
    const parent = element?.parentElement;
    if (!element || !parent) return next;
    return {
      x: Math.max(
        12,
        Math.min(next.x, parent.clientWidth - element.offsetWidth - 12),
      ),
      y: Math.max(
        12,
        Math.min(next.y, parent.clientHeight - element.offsetHeight - 12),
      ),
    };
  }
  useEffect(() => {
    const element = panel.current;
    const parent = element?.parentElement;
    if (!element || !parent) return;
    const fit = () =>
      onPosition((old) => {
        const next = bounded(
          old || { x: 22, y: parent.clientHeight - element.offsetHeight - 95 },
        );
        return old?.x === next.x && old?.y === next.y ? old : next;
      });
    fit();
    input.current?.focus();
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onPosition]);
  return (
    <section
      ref={panel}
      className="temporary-notes"
      aria-label="临时笔记窗口"
      data-player-notes
      style={{ left: position?.x ?? 22, top: position?.y ?? 80 }}
    >
      <header>
        <button
          className="notes-drag"
          aria-label="拖动临时笔记，或用方向键移动"
          title="拖动标题栏移动窗口"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const element = panel.current!;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              pointer: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              left: element.offsetLeft,
              top: element.offsetTop,
            };
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (start?.pointer !== event.pointerId) return;
            onPosition(
              bounded({
                x: start.left + event.clientX - start.x,
                y: start.top + event.clientY - start.y,
              }),
            );
          }}
          onPointerUp={(event) => {
            if (drag.current?.pointer === event.pointerId) {
              drag.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onKeyDown={(event) => {
            const move = {
              ArrowLeft: [-20, 0],
              ArrowRight: [20, 0],
              ArrowUp: [0, -20],
              ArrowDown: [0, 20],
            }[event.key];
            if (!move) return;
            event.preventDefault();
            event.stopPropagation();
            onPosition(
              bounded({
                x: panel.current!.offsetLeft + move[0],
                y: panel.current!.offsetTop + move[1],
              }),
            );
          }}
        >
          <GripHorizontal size={21} />
          <strong>临时笔记</strong>
          <span>拖动这里移动</span>
        </button>
        <button
          className="notes-close"
          onClick={onClose}
          aria-label="关闭临时笔记"
        >
          <X size={23} />
        </button>
      </header>
      <Textarea
        ref={input}
        data-primary-input
        aria-label="临时笔记内容"
        className="notes-text"
        value={text}
        onChange={(event) => onText(event.target.value)}
        placeholder="在这里打字，一起看…"
        spellCheck={false}
      />
    </section>
  );
}
