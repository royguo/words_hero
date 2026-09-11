// Optional real-browser acceptance. Called with an isolated local student by test:cloudflare.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
const input = JSON.parse(readFileSync(0, 'utf8'));
assert.equal(new URL(input.base).hostname, '127.0.0.1');
if (!process.env.KITE_PLAYWRIGHT)
  throw new Error('Set KITE_PLAYWRIGHT to a local playwright-core module');
const { chromium } = await import(process.env.KITE_PLAYWRIGHT);
const code = ts.transpileModule(
  readFileSync(new URL('../lib/student-game.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { replayActions, currentRecall } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);
const directory = 'tmp/student-adaptive-browser';
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.KITE_CHROME ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
});
const equal = input.cookie.indexOf('=');
await context.addCookies([
  {
    name: input.cookie.slice(0, equal),
    value: input.cookie.slice(equal + 1),
    url: input.base,
  },
]);
const page = await context.newPage(),
  errors = [],
  bases = new Map(),
  requests = [],
  latencies = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  localStorage.setItem('kite.student.voice', 'off');
  localStorage.setItem('kite.student.effects', 'off');
});
let releaseFirst,
  firstHeld = false,
  down = false,
  heldAt = 0;
const held = new Promise((resolve) => {
  releaseFirst = resolve;
});
await page.route('**/api/student/sessions/*/actions', async (route) => {
  const payload = route.request().postDataJSON();
  requests.push(payload.request_id);
  if (down) {
    await route.abort('failed');
    return;
  }
  const response = await route.fetch(),
    data = await response.json();
  if (response.ok()) bases.set(data.revision, data);
  if (!firstHeld) {
    firstHeld = true;
    heldAt = Date.now();
    await held;
    try {
      await route.abort('failed');
    } catch {
      /* Navigation may have already cancelled the request. */
    }
  } else await route.fulfill({ response });
});
async function state() {
  return (await context.request.get(input.base + '/api/student/state')).json();
}
async function game() {
  const draft = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) || 'null'),
    'kite.student.progress.v1:' + input.studentId,
  );
  if (!draft) return bases.get(Math.max(...bases.keys())).game;
  const base = bases.get(draft.revision);
  assert(base, 'known authoritative revision');
  return replayActions(base.game, draft.actions);
}
async function ready(n) {
  await page.waitForFunction(
    (count) =>
      document.querySelector('.learning-game')?.dataset.answers ===
        String(count) &&
      !document.querySelector(
        '.match-tile:not(.removed):disabled, .recall-card input:disabled, .listen-options button:disabled, .correction-panel button:disabled',
      ),
    n,
  );
}
async function practiceFitsViewport(label) {
  const layout = await page.evaluate(() => {
    const practice = document.querySelector('.learner-page.in-session'),
      rect = practice?.getBoundingClientRect(),
      correctionImage = document.querySelector(
        '.correction-grid article > img',
      );
    return {
      rootOverflow: getComputedStyle(document.documentElement).overflow,
      bodyOverflow: getComputedStyle(document.body).overflow,
      documentHeight: document.documentElement.scrollHeight,
      bodyHeight: document.body.scrollHeight,
      viewportHeight: window.innerHeight,
      practiceTop: rect?.top,
      practiceBottom: rect?.bottom,
      correctionObjectFit: correctionImage
        ? getComputedStyle(correctionImage).objectFit
        : null,
      correctionNaturalWidth: correctionImage?.naturalWidth || 0,
      correctionNaturalHeight: correctionImage?.naturalHeight || 0,
    };
  });
  assert.equal(
    layout.rootOverflow,
    'hidden',
    label + ': root is scroll-locked',
  );
  assert.equal(
    layout.bodyOverflow,
    'hidden',
    label + ': body is scroll-locked',
  );
  assert(
    layout.documentHeight <= layout.viewportHeight + 1,
    `${label}: document ${layout.documentHeight}px exceeds ${layout.viewportHeight}px viewport`,
  );
  assert(
    layout.bodyHeight <= layout.viewportHeight + 1,
    `${label}: body ${layout.bodyHeight}px exceeds ${layout.viewportHeight}px viewport`,
  );
  assert(
    (layout.practiceTop || 0) >= -1,
    label + ': practice begins in viewport',
  );
  assert(
    (layout.practiceBottom || 0) <= layout.viewportHeight + 1,
    label + ': practice ends in viewport',
  );
  return layout;
}
async function answer() {
  const g = await game(),
    began = Date.now();
  if (g.adaptive.correction) {
    await page.getByRole('button', { name: '看清了，继续' }).click();
    await page.locator('.correction-panel').waitFor({ state: 'hidden' });
    return;
  }
  if (g.stage === 1) {
    const key = g.en_order.find((k) => !g.removed.includes(k)),
      w = g.words.find((word) => word.key === key);
    await page
      .getByRole('button', { name: '英文 ' + w.word, exact: true })
      .click();
    await page
      .getByRole('button', { name: '中文 ' + w.meaning, exact: true })
      .click();
  } else {
    const task = currentRecall(g),
      w = g.words.find((word) => word.key === task.word);
    if (task.skill === 'spelling') {
      await page.getByRole('textbox', { name: '填写英文单词' }).fill(w.word);
      await page.getByRole('button', { name: '确认', exact: true }).click();
    } else
      await page
        .locator('.listen-options')
        .getByRole('button', { name: w.meaning, exact: true })
        .click();
  }
  await ready(g.answers + 1);
  latencies.push(Date.now() - began);
}
try {
  await page.goto(input.base + '/learn');
  await page.getByRole('button', { name: '开始一组', exact: true }).click();
  await page.locator('.matching-board').waitFor();
  const initial = (await state()).session;
  bases.set(initial.revision, initial);
  assert.equal(initial.game.schema_version, 3);
  assert.equal(await page.locator('.match-tile').count(), 10);
  await practiceFitsViewport('desktop warmup');
  await page.screenshot({ path: directory + '/warmup.png', fullPage: true });
  const visibleKeys = initial.game.en_order.filter(
      (key) => !initial.game.removed.includes(key),
    ),
    picturedKey =
      visibleKeys.find(
        (key) => initial.game.words.find((word) => word.key === key)?.image,
      ) || visibleKeys[0],
    otherKey = visibleKeys.find((key) => key !== picturedKey),
    picturedWord = initial.game.words.find((word) => word.key === picturedKey),
    otherWord = initial.game.words.find((word) => word.key === otherKey);
  assert(picturedWord && otherWord, 'warmup has two distinct words');
  assert(picturedWord.image, 'isolated browser fixture includes a word image');
  await page
    .getByRole('button', { name: '英文 ' + picturedWord.word, exact: true })
    .click();
  await page
    .getByRole('button', { name: '中文 ' + otherWord.meaning, exact: true })
    .click();
  await page.locator('.correction-panel').waitFor();
  await page.locator('.correction-grid article > img').first().waitFor();
  const correctionLayout = await practiceFitsViewport('desktop correction');
  assert.equal(correctionLayout.correctionObjectFit, 'contain');
  assert(
    correctionLayout.correctionNaturalWidth > 0,
    'correction image loaded',
  );
  assert(
    correctionLayout.correctionNaturalHeight > 0,
    'correction image loaded',
  );
  await page.screenshot({
    path: directory + '/correction-desktop.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '看清了，继续' }).click();
  await page.locator('.correction-panel').waitFor({ state: 'hidden' });
  while ((await game()).stage === 1) await answer();
  while (!firstHeld) await page.waitForTimeout(20);
  const countAtCheckpoint = (await game()).answers;
  for (let i = 0; i < 3; i++) await answer();
  assert.equal((await game()).answers, countAtCheckpoint + 3);
  assert.equal(
    requests.length,
    1,
    'no per-answer requests during a slow checkpoint',
  );
  await page.waitForTimeout(Math.max(0, 5000 - (Date.now() - heldAt)));
  down = true;
  await page
    .getByText('进度已暂存在本机，可以继续答题；联网后会重试同步。', {
      exact: false,
    })
    .waitFor();
  assert(
    Date.now() - heldAt >= 14000,
    'the blocked checkpoint times out without blocking answers',
  );
  releaseFirst();
  const attemptsBefore = requests.length;
  await answer();
  await answer();
  assert.equal(
    requests.length,
    attemptsBefore,
    'failed checkpoint does not retry on every answer',
  );
  const beforeReload = await game();
  await page.reload();
  await page.getByRole('button', { name: '继续练习', exact: true }).click();
  await page.locator('.recall-card').waitFor();
  assert.deepEqual(
    await game(),
    beforeReload,
    'reload preserves answers after the lost response',
  );
  while (currentRecall(await game()).skill !== 'spelling') await answer();
  await page.getByRole('button', { name: '首字母提示', exact: true }).click();
  await page.getByRole('button', { name: '字母提示', exact: true }).click();
  await page.locator('.letter-bank').waitFor();
  await page.screenshot({
    path: directory + '/recall-desktop.png',
    fullPage: true,
  });
  await practiceFitsViewport('desktop recall');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: directory + '/recall-mobile.png',
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await practiceFitsViewport('mobile recall');
  await page.setViewportSize({ width: 1440, height: 1050 });
  let guard = 0;
  while ((await game()).stage !== 'done') {
    assert(guard++ < 60);
    await answer();
  }
  await page.getByText('已完成，进度待同步', { exact: false }).waitFor();
  assert(
    await page
      .getByRole('button', { name: '下一组', exact: true })
      .isDisabled(),
  );
  assert.equal((await state()).completed_groups, 0);
  down = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByText('进度已保存', { exact: false }).waitFor();
  const final = await state();
  assert.equal(final.completed_groups, 1);
  assert.equal(final.points.balance, 0);
  assert.equal(new Set(requests).size, 2, 'only two unique checkpoint writes');
  assert.deepEqual(errors, []);
  await practiceFitsViewport('desktop completion');
  await page.screenshot({ path: directory + '/completed.png', fullPage: true });
  const result = {
    uniqueCheckpoints: new Set(requests).size,
    attemptedRequests: requests.length,
    simulatedDelayMs: 5000,
    timeoutRecovered: true,
    answersDuringSlowSave: 3,
    answersAfterFailedSave: 2,
    maxInteractionMs: Math.max(...latencies),
    refreshedTailPreserved: true,
    completedGroups: final.completed_groups,
    desktopAndMobile: true,
    singleScreenPractice: true,
    correctionImageContained: true,
    pageErrors: errors,
  };
  writeFileSync(directory + '/result.json', JSON.stringify(result, null, 2));
  console.log('PASS browser: ' + JSON.stringify(result));
} catch (e) {
  await page.screenshot({ path: directory + '/failure.png', fullPage: true });
  writeFileSync(
    directory + '/failure.txt',
    await page.locator('body').innerText(),
  );
  throw e;
} finally {
  releaseFirst();
  await browser.close();
}
