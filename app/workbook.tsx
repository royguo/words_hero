'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight,
  BookMarked,
  CheckCircle2,
  Loader2,
  Pencil,
  Printer,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Lesson } from '@/lib/classroom';

const subscribeToHydration = () => () => {};

export function Workbook({ lesson }: { lesson: Lesson }) {
  const [kind, setKind] = useState('classroom');
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const mounted = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const preview = useRef<HTMLDivElement>(null);
  const printed = useRef<HTMLDivElement>(null);
  const src = '/api/versions/' + lesson.version_id + '/worksheet?kind=' + kind;
  useEffect(() => {
    const controller = new AbortController();
    void fetch(src + '&view=embedded', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('练习材料没有加载成功，请重试。');
        const body = await response.text();
        if (!body.includes('data-worksheet="' + kind + '"'))
          throw new Error('练习材料格式不正确，请重试。');
        if (!controller.signal.aborted) setHtml(body);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : '材料读取失败，请重试。',
          );
      });
    return () => controller.abort();
  }, [src, kind, retry]);
  function preparePrint() {
    if (!preview.current || !printed.current || !html) return;
    const copy = preview.current.cloneNode(true) as HTMLElement;
    const values = preview.current.querySelectorAll('input');
    copy
      .querySelectorAll('input')
      .forEach((input, i) => input.setAttribute('value', values[i].value));
    printed.current.innerHTML = copy.innerHTML;
  }
  useEffect(() => {
    window.addEventListener('beforeprint', preparePrint);
    return () => window.removeEventListener('beforeprint', preparePrint);
  });
  async function print() {
    await document.fonts.ready;
    preparePrint();
    window.print();
  }
  return (
    <div className="stage-body workbook">
      <div className="section-toolbar">
        <div>
          <h2>纸上的练习，也准备好了</h2>
          <p>
            课前印好随堂跟写纸；课后用单词联系和句子填空巩固。本课版本{' '}
            {lesson.version_number}。
          </p>
        </div>
      </div>
      <Tabs
        value={kind}
        onValueChange={(value) => {
          setHtml('');
          setError('');
          setKind(String(value));
        }}
      >
        <TabsList className="print-kind-tabs">
          <TabsTrigger value="classroom">
            <Pencil size={16} />
            随堂跟写
          </TabsTrigger>
          <TabsTrigger value="homework">
            <BookMarked size={16} />
            课后填空
          </TabsTrigger>
          <TabsTrigger value="answers">
            <CheckCircle2 size={16} />
            教师答案
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="print-toolbar">
        <div>
          <span className="a4-badge">A4</span>
          <span>
            {kind === 'classroom'
              ? '逐词跟写 · 构词联系 · 下课收取'
              : kind === 'homework'
                ? '单词联系 · 句子填空 · 至少 2 页'
                : '固定题序与参考答案，独立打印'}
          </span>
        </div>
        <div>
          <a
            className="btn secondary"
            href={src}
            target="_blank"
            rel="noreferrer"
          >
            单独打开
            <ArrowUpRight size={15} />
          </a>
          <button
            className="btn primary"
            disabled={!html}
            onClick={() => void print()}
          >
            <Printer size={17} />
            打印这份材料
          </button>
        </div>
      </div>
      {error ? (
        <div className="worksheet-status" role="alert">
          <p>{error}</p>
          <button
            className="btn secondary"
            onClick={() => {
              setError('');
              setHtml('');
              setRetry(retry + 1);
            }}
          >
            重新加载
          </button>
        </div>
      ) : !html ? (
        <output className="worksheet-status">
          <Loader2 className="spin" />
          正在准备 A4 页面…
        </output>
      ) : null}
      <div
        className="worksheet-preview"
        aria-label="A4 材料预览"
        ref={preview}
        onInput={(event) => {
          const target = event.target as HTMLInputElement;
          const field = target.dataset.field;
          if (field)
            preview.current
              ?.querySelectorAll<HTMLInputElement>(
                'input[data-field="' + field + '"]',
              )
              .forEach((input) => {
                input.value = target.value;
              });
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <p className="caption">
        姓名、年龄、时间可在页面填写，会同步到每一页。打印采用独立页面，保留填写内容；选择
        A4 纵向并关闭浏览器页眉页脚。
      </p>
      {mounted &&
        createPortal(
          <div
            id="worksheet-print-root"
            data-ready={Boolean(html)}
            ref={printed}
            dangerouslySetInnerHTML={{ __html: html }}
          />,
          document.body,
        )}
    </div>
  );
}
