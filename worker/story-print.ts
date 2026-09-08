import type { StoryScene } from '../lib/classroom';
import { textPages } from '../lib/slides.ts';
import { targetSegments } from '../lib/word-presentation.ts';
import type { Course, Word } from './model';

const esc = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
      })[c]!,
  );

// Reuse the saved scenes. Long text continues on another sheet without dropping
// words, changing scene order, or modifying the course's content snapshot.
export function storyPrintPages(lesson: Course) {
  const story = lesson.materials?.story;
  return (story?.scenes || []).flatMap((scene, index) => {
    return textPages(scene.en, 500).map((text, part) => ({
      scene,
      number: index + 1,
      text,
      continuation: part > 0,
    }));
  });
}

function illustration(scene: StoryScene, number: number) {
  // Only use the app's immutable public image assets, never a stored external URL
  // or a Chinese caption/alt string in this English reading handout.
  const src = scene.image?.src;
  if (
    !src ||
    !/^\/assets\/(?:words|lessons)\/(?:[a-zA-Z0-9_-]+\/)+[a-f0-9]{64}\.(?:png|jpe?g|webp)$/.test(
      src,
    )
  )
    return '';
  return `<img class="story-print-image" src="${esc(src)}" alt="Story illustration ${number}" loading="eager" decoding="async">`;
}

function englishText(text: string, words: Word[]) {
  const segments = words.reduce(
    (parts, word) =>
      parts.flatMap((part) =>
        part.target ? [part] : targetSegments(part.text, word),
      ),
    [{ text, target: false }],
  );
  return segments
    .map((part) =>
      part.target ? `<strong>${esc(part.text)}</strong>` : esc(part.text),
    )
    .join('');
}

export function renderStory(lesson: Course) {
  const pages = storyPrintPages(lesson);
  const title = lesson.materials?.story?.title_en.trim() || 'Picture Story';
  return pages
    .map(
      (
        page,
        i,
      ) => `<section class="paper-page story-print-page" lang="en" data-page="${i + 1}" data-scene="${esc(page.scene.id)}">
    <header class="paper-header"><div class="paper-brand">KiteDance / Picture Story</div><h1>${esc(title)}</h1><div class="paper-identity"><label>Name <input data-field="name" aria-label="Name" autocomplete="off"></label><label>Age <input data-field="age" aria-label="Age" autocomplete="off"></label><label>Date <input data-field="time" aria-label="Date" autocomplete="off"></label></div></header>
    <div class="story-print-scene"><h2>Scene ${page.number}${page.continuation ? ' / continued' : ''}</h2>${illustration(page.scene, page.number)}<p class="story-print-text">${englishText(page.text, lesson.words)}</p></div>
    <footer class="paper-footer"><span>${esc(lesson.course_code)}</span><span>kitedance.com</span><span>${i + 1} / ${pages.length}</span></footer>
  </section>`,
    )
    .join('');
}

export const storyPrintCSS = `
.wg-worksheet .story-print-page{font-family:Arial,sans-serif}
.wg-worksheet .story-print-page h1{font:700 28px/1.3 Arial,sans-serif;margin:3mm 0 0;overflow-wrap:anywhere}
.wg-worksheet .story-print-page .paper-header{margin-bottom:6mm}
.wg-worksheet .story-print-scene h2{font:600 13px/1.5 Arial,sans-serif;color:#52626a;margin:0 0 4mm}
.wg-worksheet .story-print-image{display:block;width:100%;height:124mm;object-fit:contain;border-radius:2mm;margin:0 0 7mm}
.wg-worksheet .story-print-text{font:22px/1.65 Arial,sans-serif;color:#111;white-space:pre-line;overflow-wrap:anywhere}
.wg-worksheet .story-print-text strong{font-weight:750;text-decoration:underline;text-decoration-thickness:.3mm;text-underline-offset:1mm}
.wg-worksheet .story-print-page .paper-footer{gap:4mm;align-items:end}
@media print{
  .wg-worksheet .story-print-page{display:flex;flex-direction:column;min-height:273mm;break-inside:avoid}
  .wg-worksheet .story-print-page .paper-footer{margin-top:auto;padding-top:6mm}
}
`;
