// Optional regression check. Always use an isolated classroom database.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildSlides } from '../lib/slides.ts';
const base = process.env.WG_QA_URL;
if (!base || !base.startsWith('http://127.0.0.1:') || base.includes(':8765'))
  throw new Error('Use the isolated QA server.');
const { chromium } = await import(
  process.env.WG_PLAYWRIGHT_MODULE || 'playwright-core'
);
const output = new URL('../tmp/ui/improvements/', import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.WG_CHROME_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const report = { errors: [], overflow: [], checks: [] };
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    reducedMotion: 'reduce',
  });
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => report.errors.push(error.message));
  const get = async (path) => (await fetch(base + 'api/' + path)).json();
  const act = async (path, action) => {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(path) &&
        ['POST', 'PATCH'].includes(r.request().method()),
    );
    await action();
    const result = await response;
    assert.ok(result.ok(), await result.text());
    return result.json();
  };
  await page.goto(base);
  const name = '确认与大屏检查 ' + Date.now();
  await page.getByLabel('班级名称', { exact: true }).fill(name);
  const classroom = await act('/api/classes', () =>
    page.getByRole('button', { name: '创建班级', exact: true }).click(),
  );
  await page.getByRole('button', { name: '50', exact: true }).click();
  let draft = await act('/api/preview', () =>
    page.getByRole('button', { name: '生成候选词表', exact: true }).click(),
  );
  assert.equal(draft.words.length, 50);
  assert.equal((await get('state?class_id=' + classroom.id)).lessons.length, 0);
  const removed = draft.words[0];
  draft = await act('/api/drafts/' + draft.id, () =>
    page
      .locator('.selected-words > li')
      .first()
      .getByRole('button', {
        name: '删除 ' + (removed.display_word || removed.word),
        exact: true,
      })
      .click(),
  );
  const pet = (await get('vocabulary?level=PET')).find(
    (w) =>
      !w.is_basic && !draft.words.some((selected) => selected.word === w.word),
  );
  assert.ok(pet);
  await page.getByLabel('搜索全部词库', { exact: true }).fill(pet.word);
  draft = await act('/api/drafts/' + draft.id, () =>
    page
      .locator('.search-results article[data-word-id="' + pet.id + '"]')
      .getByRole('button')
      .click(),
  );
  assert.equal(draft.words.at(-1).id, pet.id);
  assert.equal(draft.words.length, 50);
  const replacing = draft.words[1];
  await page
    .locator('.selected-words > li')
    .nth(1)
    .getByRole('button', {
      name: '替换 ' + (replacing.display_word || replacing.word),
      exact: true,
    })
    .click();
  const replacement = (await get('vocabulary?level=KET')).find(
    (w) => !draft.words.some((selected) => selected.word === w.word),
  );
  await page.getByLabel('搜索全部词库', { exact: true }).fill(replacement.word);
  draft = await act('/api/drafts/' + draft.id, () =>
    page
      .locator('.search-results article[data-word-id="' + replacement.id + '"]')
      .getByRole('button')
      .click(),
  );
  assert.equal(draft.words[1].id, replacement.id);
  draft = await act('/api/drafts/' + draft.id, () =>
    page
      .locator('.selected-words > li')
      .nth(1)
      .getByRole('button', {
        name: '上移 ' + (replacement.display_word || replacement.word),
        exact: true,
      })
      .click(),
  );
  assert.equal(draft.words[0].id, replacement.id);
  const expected = draft.words.map((w) => w.id);
  assert.equal((await get('state?class_id=' + classroom.id)).lessons.length, 0);
  await page.reload();
  await page.locator('button.class-card').filter({ hasText: name }).click();
  await page.locator('.selected-words > li').first().waitFor();
  await page.locator('.search-results article').first().waitFor();
  assert.deepEqual(
    await page
      .locator('.selected-words > li')
      .evaluateAll((nodes) => nodes.map((node) => Number(node.dataset.wordId))),
    expected,
  );
  assert.ok(
    (await page.locator('.selection-confirm').boundingBox()).height < 180,
  );
  assert.ok(
    (await page.locator('.selection-confirm .btn').boundingBox()).width < 600,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: new URL('selection.png', output).pathname });
  let lesson = await act('/confirm', () =>
    page
      .getByRole('button', { name: '确认并创建第 1 课', exact: true })
      .click(),
  );
  assert.deepEqual(
    lesson.words.map((w) => w.id),
    expected,
  );
  assert.equal(lesson.level, 'KET + PET');
  report.checks.push(
    'preview creates no lesson; delete, replace, reorder, cross-library add; restore draft; exact confirmed snapshot',
  );
  await page.getByRole('button', { name: '开始讲课', exact: true }).click();
  await page.locator('.slide-canvas').waitFor();
  const notesButton = page.getByRole('button', {
    name: '临时笔记',
    exact: true,
  });
  await notesButton.click();
  const input = page.getByLabel('临时笔记内容', { exact: true });
  await input.waitFor();
  assert.ok(
    await input.evaluate(
      (node) => parseFloat(getComputedStyle(node).fontSize) >= 32,
    ),
  );
  assert.equal(
    await input.evaluate((node) => node === document.activeElement),
    true,
  );
  const beforeSlide = await page
    .locator('.slide-canvas')
    .getAttribute('aria-label');
  await input.fill(
    '今天的句子：\nWe have a beautiful notebook.\n你也来说一句。',
  );
  await page.keyboard.press('End');
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  assert.equal(
    await page.locator('.slide-canvas').getAttribute('aria-label'),
    beforeSlide,
  );
  const text = await input.inputValue();
  const panel = page.locator('.temporary-notes');
  const from = await panel.boundingBox();
  const handle = page.getByRole('button', {
    name: '拖动临时笔记，或用方向键移动',
    exact: true,
  });
  const point = await handle.boundingBox();
  await page.mouse.move(point.x + 150, point.y + 20);
  await page.mouse.down();
  await page.mouse.move(point.x + 590, point.y - 140, { steps: 10 });
  await page.mouse.up();
  const moved = await panel.boundingBox();
  assert.ok(Math.abs(moved.x - from.x) > 300);
  assert.ok(Math.abs(moved.y - from.y) > 100);
  await page.keyboard.press('ArrowRight');
  assert.ok((await panel.boundingBox()).x > moved.x);
  assert.equal(
    await page.locator('.slide-canvas').getAttribute('aria-label'),
    beforeSlide,
  );
  await page.getByRole('button', { name: '关闭临时笔记', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  assert.notEqual(
    await page.locator('.slide-canvas').getAttribute('aria-label'),
    beforeSlide,
  );
  await notesButton.click();
  assert.equal(await input.inputValue(), text);
  await page.locator('.player-next').click();
  await page.locator('.player-next').click();
  assert.equal(await input.inputValue(), text);
  assert.notEqual(
    await page.locator('.slide-canvas').getAttribute('aria-label'),
    beforeSlide,
  );
  await page.screenshot({ path: new URL('notes.png', output).pathname });
  await page.setViewportSize({ width: 800, height: 600 });
  const bounded = await panel.boundingBox();
  assert.ok(
    bounded.x >= 0 &&
      bounded.y >= 0 &&
      bounded.x + bounded.width <= 801 &&
      bounded.y + bounded.height <= 601,
  );
  await input.focus();
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.lesson-player').count(), 1);
  await page.setViewportSize({ width: 1920, height: 1080 });
  report.checks.push(
    'notes autofocus, Chinese and multiline typing, shortcut isolation, drag, keyboard movement, reopen, page changes, resize, Escape closes notes',
  );
  const slides = buildSlides(lesson);
  const recap = slides.filter((s) => s.kind === 'finish');
  report.recapPages = recap.length;
  const seen = new Set();
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
  ]) {
    await page.setViewportSize(size);
    await page.locator('.player-chapters button').last().click();
    for (let i = 0; i < recap.length; i++) {
      await page.locator('.slide-recap').waitFor();
      const rows = await page.locator('.recap-entry').evaluateAll((items) =>
        items.map((item) => ({
          id: Number(item.dataset.wordId),
          text: item.textContent,
        })),
      );
      assert.deepEqual(
        rows.map((w) => w.id),
        recap[i].recap.map((e) => e.word.id),
      );
      for (const word of rows) seen.add(word.id);
      const overflow = await page.locator('.slide-body').evaluate((body) => {
        const box = body.getBoundingClientRect();
        return [...body.querySelectorAll('h1,h2,p,article,button')]
          .filter((node) => {
            const b = node.getBoundingClientRect();
            return (
              b.bottom > box.bottom + 2 ||
              b.right > box.right + 2 ||
              b.top < box.top - 2 ||
              b.left < box.left - 2 ||
              node.scrollWidth > node.clientWidth + 2
            );
          })
          .map((node) => node.textContent.slice(0, 80));
      });
      if (overflow.length) report.overflow.push({ size, page: i, overflow });
      if (i === 0)
        await page.screenshot({
          path: new URL('recap-' + size.width + '.png', output).pathname,
        });
      if (i < recap.length - 1)
        await page.getByRole('button', { name: '下一页', exact: true }).click();
      else
        assert.equal(
          await page
            .getByRole('button', { name: '结束放映', exact: true })
            .count(),
          1,
        );
    }
  }
  assert.equal(seen.size, lesson.words.length);
  assert.deepEqual(report.overflow, []);
  await page.getByRole('button', { name: '结束放映', exact: true }).click();
  await page.locator('.lesson-player').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '开始讲课', exact: true }).click();
  await page.getByRole('button', { name: '临时笔记', exact: true }).click();
  assert.equal(await input.inputValue(), '');
  await page.getByRole('button', { name: '退出讲课', exact: true }).click();
  report.checks.push(
    'complete large-font recap, all bilingual examples and words, 1920 and 1366 bounds, only final page ends lecture; temporary notes reset after lecture',
  );
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  draft = await act('/api/preview', () =>
    page.getByRole('button', { name: '生成候选词表', exact: true }).click(),
  );
  assert.equal(
    (await get('lessons/' + lesson.id)).version_id,
    lesson.version_id,
  );
  const old = lesson;
  lesson = await act('/confirm', () =>
    page.getByRole('button', { name: '确认并保存新版本', exact: true }).click(),
  );
  assert.equal(lesson.version_number, 2);
  assert.deepEqual(
    (await get('lessons/' + old.id + '?version=' + old.version_id)).words,
    old.words,
  );
  assert.deepEqual(
    lesson.words.map((w) => w.id),
    draft.words.map((w) => w.id),
  );
  report.checks.push(
    'regeneration also requires confirmation and retains old version',
  );
  assert.deepEqual(report.errors, []);
  report.classId = classroom.id;
  report.lessonId = lesson.id;
  console.log(JSON.stringify(report));
} finally {
  await fs.writeFile(
    new URL('report.json', output),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
