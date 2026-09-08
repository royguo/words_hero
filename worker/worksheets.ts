import {
  AppError,
  type Word,
  type Course,
  type WorksheetPlan,
  type Component,
  type Question,
} from './model';
import { worksheetCSS } from './worksheet-style';
import { flashcardCSS, renderFlashcards } from './flashcards';
import { storyPrintCSS, renderStory } from './story-print';
const esc = (v: unknown) =>
  String(v).replace(
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
const labels: Record<string, string> = {
  base: '词基',
  root: '词根',
  prefix: '前缀',
  suffix: '后缀',
  word: '单词成分',
  compound: '合成成分',
};
export function worksheetPlan(
  words: Word[],
  order?: Record<string, number[]>,
): WorksheetPlan {
  const byId = new Map(words.map((w) => [w.id, w]));
  let forward = (order?.english_to_chinese || [])
    .map((id) => byId.get(id))
    .filter(Boolean) as Word[];
  if (forward.length !== words.length) forward = words;
  const connections = forward.map((w, i) => {
    const challenge = w.word_study?.challenge,
      p = w.parts?.[0];
    return {
      id: 'connection-' + (i + 1),
      word_id: w.id,
      prompt:
        challenge?.prompt_zh ||
        (p
          ? `${w.display_word || w.word} 中的 ${p.text} 是什么意思？`
          : `看中文，写英文：${w.meaning_zh}（${w.pos}）。把这个词和学过的情境连起来。`),
      hint: '',
      answer:
        challenge?.answer_zh || (p ? p.meaning : w.display_word || w.word),
    };
  });
  const components: Component[] = [],
    used = new Set<string>();
  for (const w of words) {
    const parts =
      w.word_study?.components ||
      w.parts?.map((p) => ({
        text: p.text,
        kind: p.kind,
        meaning_zh: p.meaning,
      })) ||
      [];
    for (const p of parts) {
      const key = JSON.stringify([p.text, p.kind, p.meaning_zh]);
      if (used.has(key)) continue;
      used.add(key);
      components.push({
        word: p.text,
        kind: p.kind,
        meaning: p.meaning_zh,
        example: w.display_word || w.word,
      });
    }
  }
  return {
    schema_version: 2,
    copying: words.map((w) => ({
      word: w.display_word || w.word,
      kind: 'word',
      meaning: '',
    })),
    components,
    connections,
    sentences: forward.map((w, i) => ({
      id: 'sentence-' + (i + 1),
      word_id: w.id,
      prompt: w.cloze,
      hint: w.cloze_zh,
      answer: w.cloze_answer,
    })),
  };
}
export function questionPages(items: Question[]) {
  const pages: Question[][] = [];
  let page: Question[] = [],
    used = 0;
  const width = (s: string) =>
    Array.from(s).reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
  for (const item of items) {
    const lines =
        Math.ceil(width(item.prompt) / 86) + Math.ceil(width(item.hint) / 92),
      units = Math.max(
        3,
        lines + Math.max(1, Math.ceil(width(item.answer) / 80)) + 1,
      );
    if (page.length && (used + units > 30 || page.length >= 6)) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(item);
    used += units;
  }
  if (page.length) pages.push(page);
  if (pages.length === 2 && items.length <= 12) {
    const half = Math.ceil(items.length / 2),
      balanced = [items.slice(0, half), items.slice(half)],
      weight = (x: Question) =>
        Math.max(
          3,
          Math.ceil(width(x.prompt) / 86) +
            Math.ceil(width(x.hint) / 92) +
            Math.max(1, Math.ceil(width(x.answer) / 80)) +
            1,
        );
    if (balanced.every((p) => p.reduce((n, x) => n + weight(x), 0) <= 30))
      return balanced;
  }
  return pages.length ? pages : [[]];
}
export function renderWorksheet(
  lesson: Course,
  kind = 'classroom',
  embedded = false,
) {
  if (!['classroom', 'homework', 'answers', 'cards', 'story'].includes(kind))
    throw new AppError('打印材料类型不正确');
  if (kind === 'story') {
    const story = lesson.materials?.story;
    if (!story?.scenes.length) throw new AppError('本课还没有情景故事可打印');
    if (story.scenes.some((scene) => !scene.en.trim()))
      throw new AppError('故事英文正文尚未补全');
  }
  const plan =
      lesson.config.worksheets ||
      worksheetPlan(lesson.words, lesson.config.worksheet_order),
    answers = kind === 'answers';
  const label =
    kind === 'cards'
      ? '单词卡片'
      : kind === 'classroom'
        ? '随堂跟写练习'
        : kind === 'homework'
          ? '课后巩固练习'
          : kind === 'story'
            ? 'Picture Story'
            : '课后练习 · 教师答案';
  const pages: string[] = [];
  if (kind === 'classroom') {
    for (let start = 0; start < plan.copying.length; start += 12) {
      const rows = plan.copying.slice(start, start + 12).map((item, i) => {
        const repeats =
          item.word.length > 18 ? 1 : item.word.length > 11 ? 2 : 4;
        const blank = `<td colspan="${4 / repeats}"><div class="writing-line"></div></td>`;
        return `<tr><td class="copy-word">${start + i + 1}. ${esc(item.word)}</td>${blank.repeat(repeats)}</tr>`;
      });
      pages.push(
        '<h2>01 / 单词跟写</h2><p class="paper-note">一起读一遍，再沿每一行连续书写。写完后交给老师。</p><table><colgroup><col style="width:29%"><col span="4"></colgroup><thead><tr><th>单词</th><th colspan="4">连续书写练习</th></tr></thead><tbody>' +
          rows.join('') +
          '</tbody></table>',
      );
    }
    for (
      let start = 0;
      start < Math.max(1, plan.components.length);
      start += 8
    ) {
      const rows = plan.components
        .slice(start, start + 8)
        .map(
          (item) =>
            `<tr><td class="copy-word">${esc(item.word)}<small>${esc(labels[item.kind] || item.kind)}${item.example ? ' · ' + esc(item.example) : ''}</small></td><td><div class="writing-line"></div></td><td><div class="writing-line"></div></td><td class="copy-meaning"></td></tr>`,
        );
      pages.push(
        '<h2>02 / 构词与联系</h2><p class="paper-note">跟着每个单词的讲解，写下成分，再用中文补充含义。</p>' +
          (rows.length
            ? '<table><thead><tr><th>成分</th><th>第 1 遍</th><th>第 2 遍</th><th>中文含义</th></tr></thead><tbody>' +
              rows.join('') +
              '</tbody></table>'
            : '<p class="paper-note">本课以完整单词和生活情境记忆为主。在这里写下你发现的搭配。</p>') +
          '<h2>我还发现了……</h2><div class="paper-lines"></div>',
      );
    }
  } else if (kind !== 'cards' && kind !== 'story') {
    for (const [title, help, questions] of [
      [
        '01 / 发现单词之间的联系',
        '用构词、词族或搭配线索完成题目。想一想这些词为什么能连在一起。',
        plan.connections,
      ],
      [
        '02 / 把单词放回句子',
        '根据句子和中文提示填空。每题使用本课单词，注意大小写和词形。',
        plan.sentences,
      ],
    ] as const) {
      for (const items of questionPages(questions)) {
        pages.push(
          `<h2>${title}</h2><p class="paper-note">${help}</p><ol class="paper-questions">` +
            items
              .map(
                (item) =>
                  `<li class="paper-question" data-question="${esc(item.id)}"><p class="question-text"><span class="question-number">${esc(item.id.split('-').at(-1))}.</span>${esc(item.prompt)}</p>${item.hint ? `<p class="question-hint">${esc(item.hint)}</p>` : ''}<div class="question-answer">${answers ? esc(item.answer) : '&nbsp;'}</div></li>`,
              )
              .join('') +
            '</ol>',
        );
      }
    }
  }
  const rendered =
    kind === 'cards'
      ? renderFlashcards(lesson)
      : kind === 'story'
        ? renderStory(lesson)
        : pages
            .map(
              (page, i) =>
                `<section class="paper-page" data-page="${i + 1}"><header class="paper-header"><div class="paper-brand">KiteDance / 风筝单词</div><h1>${esc(label)}</h1><div class="paper-meta">${esc(lesson.class_name)} · ${esc(lesson.title)} · ${esc(lesson.level)} · ${lesson.words.length} 词 · 版本 ${lesson.version_number}</div><div class="paper-identity"><label>姓名 <input data-field="name" aria-label="姓名" autocomplete="off"></label><label>年龄 <input data-field="age" aria-label="年龄" autocomplete="off">岁</label><label>时间 <input data-field="time" aria-label="时间" autocomplete="off" placeholder="年 / 月 / 日"></label></div></header>${page}<footer class="paper-footer"><span>${esc(lesson.course_code)}</span><span>kitedance.com</span><span>第 ${i + 1} / ${pages.length} 页 · A4</span></footer></section>`,
            )
            .join('');
  const fragment = `<style>${worksheetCSS}${kind === 'cards' ? flashcardCSS : kind === 'story' ? storyPrintCSS : ''}</style><div class="wg-worksheet" data-worksheet="${kind}">${rendered}</div>`;
  if (embedded) return fragment;
  const printHelp =
    kind === 'cards'
      ? 'A4 纵向 · 实际大小 100% · 双面打印「长边翻转」· 关闭页眉页脚 · 沿虚线裁切'
      : 'A4 纵向 · 关闭浏览器页眉和页脚';
  const title =
    kind === 'story'
      ? lesson.materials?.story?.title_en || 'Picture Story'
      : lesson.title;
  return `<!doctype html><html lang="${kind === 'story' ? 'en' : 'zh-CN'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title + ' · ' + label)}</title><style>body{margin:0;background:#edf0f2}.paper-toolbar{position:sticky;top:0;z-index:1;padding:14px;display:flex;gap:20px;justify-content:center;align-items:center;flex-wrap:wrap;background:white;font:14px sans-serif}.paper-toolbar button{padding:10px 20px;cursor:pointer}.paper-toolbar output{color:#92400e}@media print{body{background:white}.paper-toolbar{display:none}}</style></head><body><div class="paper-toolbar"><button id="paper-print">打印 / 保存为 PDF</button><span>${printHelp}</span><output id="paper-print-status" aria-live="polite"></output></div>${fragment}<script>
document.addEventListener('input',e=>{const f=e.target.dataset.field;if(f)document.querySelectorAll('input[data-field="'+f+'"]').forEach(input=>{input.value=e.target.value;});});
document.getElementById('paper-print').addEventListener('click',async()=>{
  const button=document.getElementById('paper-print'),status=document.getElementById('paper-print-status');
  button.disabled=true;status.textContent='正在准备打印…';let timer;
  try{
    await Promise.race([
      Promise.all([document.fonts.ready,...Array.from(document.querySelectorAll('.wg-worksheet img'),img=>{
        if(img.complete&&!img.naturalWidth)img.src=img.getAttribute('src');
        return img.decode();
      })]),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),30000);})
    ]);
    status.textContent='';window.print();
  }catch{status.textContent='图片尚未加载完成，请检查网络后重试打印。';}
  finally{clearTimeout(timer);button.disabled=false;}
});
</script></body></html>`;
}
