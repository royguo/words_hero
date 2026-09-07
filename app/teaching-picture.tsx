'use client';
import { useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { TeachingImage } from '@/lib/classroom';

/** Stable empty space is intentional. Missing files never show a broken-image icon. */
export function TeachingPicture({
  images = [],
  className = '',
}: {
  images?: TeachingImage[];
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const available = images.filter((item) => !failed.includes(item.src));
  const current = available[index % Math.max(1, available.length)];
  return (
    <figure
      className={'teaching-picture ' + className}
      aria-hidden={!current || undefined}
    >
      {current && (
        <>
          <Image
            key={current.src}
            src={current.src}
            alt={current.alt}
            decoding="async"
            width={1536}
            height={1024}
            unoptimized
            onError={() => setFailed((old) => [...old, current.src])}
          />
          {available.length > 1 && (
            <div className="picture-controls">
              <button
                aria-label="上一张图片"
                onClick={() =>
                  setIndex((index + available.length - 1) % available.length)
                }
              >
                <ChevronLeft />
              </button>
              <span>
                {(index % available.length) + 1} / {available.length}
              </span>
              <button
                aria-label="下一张图片"
                onClick={() => setIndex((index + 1) % available.length)}
              >
                <ChevronRight />
              </button>
            </div>
          )}
        </>
      )}
    </figure>
  );
}

export function TargetText({ text, words }: { text: string; words: string[] }) {
  const terms = [...new Set(words)].sort((a, b) => b.length - a.length);
  if (!terms.length) return <>{text}</>;
  const escaped = terms.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const matcher = new RegExp('\\b(' + escaped.join('|') + ')\\b', 'gi');
  return (
    <>
      {text
        .split(matcher)
        .map((piece, i) => (i % 2 ? <mark key={i}>{piece}</mark> : piece))}
    </>
  );
}
