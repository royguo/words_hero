import type { Course, Word } from './model';

export const CARDS_PER_SHEET = 6;
type Card = { number: number; word: Word };
export type CardSheet = { front: (Card | null)[]; back: (Card | null)[] };

// A4 portrait, duplex along the long edge: swap columns on the reverse.
// Pad BEFORE mirroring so a partial sheet has identical cutting positions.
export function flashcardSheets(words: Word[]): CardSheet[] {
  const sheets: CardSheet[] = [];
  for (let start = 0; start < words.length; start += CARDS_PER_SHEET) {
    const front = Array.from({ length: CARDS_PER_SHEET }, (_, i) =>
      words[start + i]
        ? { number: start + i + 1, word: words[start + i] }
        : null,
    );
    const back = front.map((_, i) => front[i % 2 === 0 ? i + 1 : i - 1]);
    sheets.push({ front, back });
  }
  return sheets;
}

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

function cardMarkup(card: Card | null, side: 'front' | 'back') {
  if (!card)
    return '<article class="flashcard flashcard-blank" data-card="blank" aria-hidden="true"></article>';
  const { word, number } = card;
  const explanation =
    word.word_study?.explanation_zh ||
    (word.parts?.length
      ? word.parts.map((p) => `${p.text}：${p.meaning}`).join('；')
      : '结合例句，记住这个词在句子中的意思。');
  return `<article class="flashcard" data-card="${number}">
    <div class="flashcard-label"><span>${String(number).padStart(2, '0')}</span><span>${side === 'front' ? 'ENGLISH' : '中文 · 释义'}</span></div>
    ${
      side === 'front'
        ? `<div class="flashcard-front"><h2 lang="en">${esc(word.display_word || word.word)}</h2><p lang="en">${esc(word.example)}</p></div>`
        : `<div class="flashcard-back"><h2>${esc(word.meaning_zh)}</h2><p class="flashcard-translation">${esc(word.example_zh)}</p><div class="flashcard-explanation"><span>理解与记忆</span><p>${esc(explanation)}</p></div></div>`
    }
  </article>`;
}

export function renderFlashcards(lesson: Course) {
  const sheets = flashcardSheets(lesson.words);
  return sheets
    .flatMap((sheet, i) =>
      (['front', 'back'] as const).map(
        (side, j) =>
          `<section class="paper-page flashcard-page" data-page="${i * 2 + j + 1}" data-side="${side}" data-sheet="${i + 1}">
      <header class="flashcard-header"><strong>风筝单词 / 单词卡片</strong><span>第 ${i + 1} / ${sheets.length} 张纸 · ${side === 'front' ? '正面 · 英文' : '反面 · 中文'}</span></header>
      <div class="flashcard-grid">${sheet[side].map((card) => cardMarkup(card, side)).join('')}</div>
      <footer class="flashcard-footer"><span>${esc(lesson.class_name)} · ${esc(lesson.title)} · 版本 ${lesson.version_number}</span><span>${esc(lesson.course_code)} · ${i * 2 + j + 1}/${sheets.length * 2}</span></footer>
    </section>`,
      ),
    )
    .join('');
}

export const flashcardCSS = `
.wg-worksheet .flashcard-page{height:297mm;min-height:297mm;overflow:visible}
.wg-worksheet .flashcard-header{display:flex;justify-content:space-between;align-items:center;gap:4mm;height:10mm;flex:none;margin-bottom:4mm;font-size:11px;color:#222}
.wg-worksheet .flashcard-header strong{font-weight:600}
.wg-worksheet .flashcard-grid{display:grid;grid-template-columns:repeat(2,93mm);grid-template-rows:repeat(3,82mm);width:186mm;height:246mm;flex:none;border-top:.2mm dashed #999;border-left:.2mm dashed #999}
.wg-worksheet .flashcard{box-sizing:border-box;min-width:0;min-height:0;padding:5mm 6mm;border-right:.2mm dashed #999;border-bottom:.2mm dashed #999;color:#111;background:#fff;break-inside:avoid;overflow-wrap:anywhere}
.wg-worksheet .flashcard-label{display:flex;justify-content:space-between;align-items:center;font-size:10px;line-height:4mm;color:#666;letter-spacing:.2px;margin-bottom:5mm}
.wg-worksheet .flashcard-label span:first-child{font-variant-numeric:tabular-nums}
.wg-worksheet .flashcard-front{height:58mm;display:flex;flex-direction:column;justify-content:center;gap:6mm;text-align:center}
.wg-worksheet .flashcard-front h2{font:700 28px/1.15 Arial,sans-serif;margin:0;letter-spacing:-.3px}
.wg-worksheet .flashcard-front p{font:18px/1.5 Arial,sans-serif;margin:0}
.wg-worksheet .flashcard-back h2{font-size:21px;line-height:1.4;margin:0 0 3mm;font-weight:700}
.wg-worksheet .flashcard-translation{font-size:14px;line-height:1.6;margin:0 0 4mm;color:#333}
.wg-worksheet .flashcard-explanation{border-top:.2mm solid #ddd;padding-top:3mm}
.wg-worksheet .flashcard-explanation>span{font-size:10px;color:#666}
.wg-worksheet .flashcard-explanation p{font-size:13px;line-height:1.6;margin:1mm 0 0}
.wg-worksheet .flashcard-footer{display:flex;justify-content:space-between;gap:4mm;align-items:end;margin-top:auto;height:8mm;flex:none;font-size:9px;line-height:1.4;color:#666}
.wg-worksheet .flashcard-footer>span:first-child{max-width:118mm;overflow-wrap:anywhere}
.wg-worksheet .flashcard-footer>span:last-child{white-space:nowrap}
@media print{
  .wg-worksheet .flashcard-page{display:flex;flex-direction:column;width:186mm;height:273mm;min-height:273mm;padding:0;margin:0;box-shadow:none;break-inside:avoid;break-after:page}
  .wg-worksheet .flashcard-page:last-child{break-after:auto}
}
`;
