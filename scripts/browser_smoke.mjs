// Run against an isolated QA server. Optional tooling is deliberately not a runtime dependency.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildSlides, wordLabel } from '../lib/slides.ts';
const base = process.env.WG_QA_URL;
if (!base || !base.startsWith('http://127.0.0.1:') || base.includes(':8765'))
  throw new Error('Use an isolated QA server, never the classroom database.');
const { chromium } = await import(
  process.env.WG_PLAYWRIGHT_MODULE || 'playwright-core'
);
const output = new URL(
  '../tmp/ui/' + (process.env.WG_QA_CLASS_ID ? 'pet/' : ''),
  import.meta.url,
);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  let lesson;
  if (process.env.WG_QA_CLASS_ID) {
    const state = await (
      await fetch(base + 'api/state?class_id=' + process.env.WG_QA_CLASS_ID)
    ).json();
    lesson = await (
      await fetch(base + 'api/lessons/' + state.lessons[0].id)
    ).json();
    await page
      .locator('button.class-card')
      .filter({ hasText: lesson.class_name })
      .click();
  } else {
    await page
      .getByLabel('班级名称', { exact: true })
      .fill('大屏检查 ' + Date.now());
    await page.getByRole('button', { name: '创建班级', exact: true }).click();
    await page.getByRole('button', { name: '50', exact: true }).click();
    await page
      .getByRole('button', { name: '生成候选词表', exact: true })
      .click();
    const generated = page.waitForResponse(
      (r) => r.url().endsWith('/confirm') && r.request().method() === 'POST',
    );
    await page
      .getByRole('button', { name: '确认并创建第 1 课', exact: true })
      .click();
    lesson = await (await generated).json();
  }
  assert.equal(lesson.words.length, 50);
  const start = page.getByRole('button', { name: '开始讲课', exact: true });
  await start.waitFor();
  await page.screenshot({ path: new URL('workspace.png', output).pathname });
  await start.click();
  await page.locator('.slide-canvas').waitFor();
  await page.screenshot({ path: new URL('welcome.png', output).pathname });
  const fullscreen = await page.evaluate(() =>
    Boolean(document.fullscreenElement),
  );
  await page.keyboard.press('Space');
  await page.locator('.slide-word-layout').waitFor();
  assert.equal(
    await page.locator('.slide-meaning').innerText(),
    '读一读，猜猜它的意思',
  );
  await page.keyboard.press('ArrowRight');
  await page.locator('.slide-meaning.revealed').waitFor();
  await page.screenshot({ path: new URL('word.png', output).pathname });
  await page.keyboard.press('ArrowRight');
  await page.locator('.slide-story-layout').waitFor();
  await page.screenshot({ path: new URL('story.png', output).pathname });
  await page.locator('.player-chapters button').nth(2).click();
  await page.locator('.slide-root-layout,.slide-whole').waitFor();
  await page.keyboard.press('ArrowRight');
  await page.screenshot({ path: new URL('root.png', output).pathname });
  await page.keyboard.press('ArrowRight');
  if (await page.locator('.slide-family').count())
    await page.screenshot({ path: new URL('family.png', output).pathname });
  await page.locator('.player-chapters button').nth(3).click();
  await page.getByRole('button', { name: '课程目录', exact: true }).click();
  const firstPractice = buildSlides(lesson).findIndex(
    (slide) =>
      slide.kind === 'practice' && slide.word.id === lesson.words[0].id,
  );
  await page
    .getByRole('button', {
      name:
        '跳到第 ' + (firstPractice + 1) + ' 页 ' + wordLabel(lesson.words[0]),
      exact: true,
    })
    .click();
  await page.locator('.slide-practice').waitFor();
  assert.equal(await page.locator('.practice-reveal.revealed').count(), 0);
  await page.getByRole('button', { name: '一起揭晓', exact: true }).click();
  await page.locator('.practice-reveal.revealed').waitFor();
  await page.screenshot({ path: new URL('practice.png', output).pathname });
  await page.getByRole('button', { name: '记住了', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.player-feedback')?.textContent?.includes('已记住'),
  );
  await page.getByRole('button', { name: '看英文说中文', exact: true }).click();
  assert.equal(await page.locator('.practice-reveal.revealed').count(), 0);
  await page.getByRole('button', { name: '课程目录', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('.player-outline').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.lesson-player').count(), 1);
  await page.keyboard.press('Escape');
  await page.locator('.lesson-player').waitFor({ state: 'hidden' });
  const saved = await (await fetch(base + 'api/lessons/' + lesson.id)).json();
  assert.equal(
    saved.config.presentation_slide,
    'practice:' + lesson.words[0].id,
  );
  assert.equal(saved.words[0].result, 'remembered');
  await page.reload();
  await page
    .getByRole('button')
    .filter({ hasText: lesson.class_name })
    .first()
    .click();
  await page.getByRole('button', { name: /继续第 \d+ 页/ }).click();
  await page.locator('.slide-practice').waitFor();

  // Visit every saved slide, checking the content bounds at the design canvas size.
  await page.getByRole('button', { name: '课程目录', exact: true }).click();
  const labels = await page
    .locator('.outline-grid button')
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute('aria-label')),
    );
  await page.getByRole('button', { name: '关闭课程目录', exact: true }).click();
  const overflow = [];
  for (const label of labels) {
    await page.getByRole('button', { name: '课程目录', exact: true }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    if (
      await page.getByRole('button', { name: '一起揭晓', exact: true }).count()
    ) {
      await page.getByRole('button', { name: '一起揭晓', exact: true }).click();
    }
    const issue = await page.locator('.slide-body').evaluate((element) => {
      const body = element.getBoundingClientRect();
      const bad = [
        ...element.querySelectorAll('h1,h2,p,article,button'),
      ].filter((node) => {
        const r = node.getBoundingClientRect();
        return (
          r.width &&
          r.height &&
          (r.bottom > body.bottom + 2 ||
            r.top < body.top - 2 ||
            r.right > body.right + 2 ||
            r.left < body.left - 2 ||
            node.scrollWidth > node.clientWidth + 2)
        );
      });
      return bad.slice(0, 3).map((node) => ({
        text: node.textContent.slice(0, 65),
        tag: node.tagName,
      }));
    });
    if (issue.length) overflow.push({ label, issue });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.locator('.player-chapters button').nth(1).click();
  await page.screenshot({ path: new URL('laptop.png', output).pathname });
  const canvasFits = await page.locator('.slide-canvas').evaluate((element) => {
    const r = element.getBoundingClientRect();
    const p = element.parentElement.getBoundingClientRect();
    return (
      r.width <= p.width + 1 && r.height <= p.height + 1 && r.top >= p.top - 1
    );
  });
  assert.ok(canvasFits);
  assert.deepEqual(errors, []);
  await page.getByRole('button', { name: '退出讲课', exact: true }).click();
  await page.getByRole('tab', { name: /练习册打印/ }).click();
  await page
    .frameLocator('iframe')
    .getByRole('heading', { name: '随堂跟写练习', exact: true })
    .waitFor();
  assert.ok(
    await page
      .frameLocator('iframe')
      .getByLabel('姓名', { exact: true })
      .count(),
  );
  const result = {
    fullscreen,
    slides: labels.length,
    overflow,
    runtimeErrors: errors,
    resume: true,
    rating: true,
    printView: true,
    canvasFits,
  };
  await fs.writeFile(
    new URL('report.json', output),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(overflow, []);
} finally {
  await browser.close();
}
