import { Store } from './store';
import { AppError, integer, string } from './model';
import { authenticated, login, logout } from './auth';
import { configuration, prepare, inventory } from './audio';
import { renderWorksheet } from './worksheets';
import { parseCSV } from './csv';
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'same-origin',
};
const json = (v: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { ...headers, ...extra },
  });
async function body(request: Request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    throw new AppError('写入请求必须使用 JSON', 415);
  if (Number(request.headers.get('Content-Length')) > 15_000_000)
    throw new AppError('请求过大', 413);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 15_000_000) throw new AppError('请求过大', 413);
  let value;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AppError('JSON 格式不正确');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AppError('请求必须是对象');
  return value as Record<string, unknown>;
}
export async function media(request: Request, bucket: R2Bucket) {
  const path = decodeURIComponent(
    new URL(request.url).pathname.slice('/assets/'.length),
  );
  if (
    !/^(words|lessons|audio)\/[a-zA-Z0-9/_-]+\/[a-f0-9]{64}\.(png|jpe?g|webp|mp3)$/.test(
      path,
    ) ||
    path.includes('..')
  )
    throw new AppError('素材不存在', 404);
  const metadata = await bucket.head(path);
  if (!metadata) throw new AppError('素材尚未同步', 404);
  const h = new Headers({
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    ETag: metadata.httpEtag,
  });
  metadata.writeHttpMetadata(h);
  if (request.headers.get('If-None-Match') === metadata.httpEtag)
    return new Response(null, { status: 304, headers: h });
  let range: { offset: number; length: number } | undefined;
  const value = request.headers.get('Range');
  if (value) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(value);
    if (!m || (!m[1] && !m[2]))
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': 'bytes */' + metadata.size },
      });
    const start = m[1]
        ? Number(m[1])
        : Math.max(0, metadata.size - Number(m[2])),
      end =
        m[1] && m[2]
          ? Math.min(metadata.size - 1, Number(m[2]))
          : metadata.size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= metadata.size
    )
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': 'bytes */' + metadata.size },
      });
    range = { offset: start, length: end - start + 1 };
    h.set('Content-Range', `bytes ${start}-${end}/${metadata.size}`);
  }
  h.set('Content-Length', String(range?.length || metadata.size));
  if (request.method === 'HEAD')
    return new Response(null, { status: range ? 206 : 200, headers: h });
  const obj = await bucket.get(path, range ? { range } : {});
  if (!obj) throw new AppError('素材不存在', 404);
  return new Response(obj.body, { status: range ? 206 : 200, headers: h });
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url),
        path = url.pathname,
        p = path.split('/').filter(Boolean),
        q = url.searchParams,
        method = request.method;
      if (path.startsWith('/assets/')) {
        if (!['GET', 'HEAD'].includes(method))
          throw new AppError('方法不支持', 405);
        return await media(request, env.MEDIA);
      }
      if (!path.startsWith('/api/')) return env.STATIC.fetch(request);
      if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(method))
        throw new AppError('方法不支持', 405);
      const write = !['GET', 'HEAD'].includes(method);
      const origin = request.headers.get('Origin'),
        local = ['127.0.0.1', 'localhost'].includes(url.hostname);
      if (
        write &&
        origin &&
        origin !== url.origin &&
        !(
          local &&
          ['http://localhost:3000', 'http://127.0.0.1:3000'].includes(origin)
        )
      )
        throw new AppError('不允许跨站写入', 403);
      if (path === '/api/health')
        return json({ app: 'kite-words', version: 3, storage: 'D1 + R2' });
      if (path === '/api/auth/session' && !write)
        return json({
          authenticated: await authenticated(request, env.SESSION_SECRET),
          username: 'admin',
          role: 'teacher',
          storage: 'cloud',
        });
      if (path === '/api/auth/login' && method === 'POST')
        return json({ authenticated: true, username: 'admin' }, 200, {
          'Set-Cookie': await login(request, await body(request), env),
        });
      if (!(await authenticated(request, env.SESSION_SECRET)))
        throw new AppError('请先登录', 401);
      if (path === '/api/auth/logout' && method === 'POST')
        return json({ authenticated: false }, 200, {
          'Set-Cookie': logout(request),
        });
      const store = new Store(env.DB),
        data = write && method !== 'DELETE' ? await body(request) : {};
      if (path === '/api/state' && !write)
        return json(await store.state(q.get('class_id') || undefined));
      if (path === '/api/classes' && method === 'POST')
        return json(await store.createClass(data), 201);
      if (p[1] === 'classes' && p.length === 3 && method === 'DELETE')
        return json(await store.deleteClass(p[2]));
      if (p[1] === 'lessons' && p.length === 3) {
        if (method === 'DELETE') return json(await store.deleteLesson(p[2]));
        if (!write)
          return json(await store.lesson(p[2], q.get('version') || undefined));
      }
      if (path === '/api/pool' && method === 'POST')
        return json(await store.pool(data));
      if (path === '/api/preview' && method === 'POST')
        return json(await store.preview(data), 201);
      if (path === '/api/drafts' && !write)
        return json(
          await store.latestDraft(
            string(q.get('class_id'), 64, '班级编号'),
            q.get('lesson_id') || undefined,
          ),
        );
      if (p[1] === 'drafts' && p.length >= 3) {
        if (p.length === 4 && p[3] === 'confirm' && method === 'POST')
          return json(await store.confirm(p[2], data), 201);
        if (p.length === 3 && ['PATCH', 'POST'].includes(method))
          return json(await store.patchDraft(p[2], data));
      }
      if (path === '/api/vocabulary' && !write)
        return json(
          await store.vocabulary(
            q.get('level') || 'KET',
            (q.get('q') || '').slice(0, 80),
            integer(Number(q.get('offset') || 0), 0, 100000, '页码'),
            q.get('class_id') || undefined,
          ),
        );
      if (p[1] === 'versions' && p.length >= 3) {
        if (p.length === 3 && ['PATCH', 'POST'].includes(method))
          return json(await store.patch(p[2], data));
        if (p[3] === 'complete' && method === 'POST')
          return json(await store.complete(p[2]));
        if (p[3] === 'attempts' && method === 'POST')
          return json(await store.attempt(p[2], data), 201);
        if (p[3] === 'audio' && !write)
          return json(
            await inventory(
              env.MEDIA,
              await store.byVersion(p[2]),
              env.AUDIO_ONLINE,
              env.DB,
            ),
          );
        if (p[3] === 'worksheet' && !write)
          return new Response(
            renderWorksheet(
              await store.byVersion(p[2]),
              q.get('kind') || 'classroom',
              q.get('view') === 'embedded',
            ),
            {
              headers: {
                ...headers,
                'Content-Type': 'text/html; charset=utf-8',
              },
            },
          );
      }
      if (p[1] === 'courses' && p[3] === 'brief' && !write)
        return json(await store.brief(p[2]), 200, {
          'Content-Disposition':
            'attachment; filename="kite-words-material-brief.json"',
        });
      if (p[1] === 'courses' && p[3] === 'materials' && method === 'POST')
        return json(
          await store.applyPack(p[2], string(data.bundle_id, 80, '素材包编号')),
          201,
        );
      if (path === '/api/audio/configuration' && !write)
        return json(configuration(env.AUDIO_ONLINE));
      if (path === '/api/audio' && method === 'POST')
        return json(
          await prepare(env.MEDIA, data.text, env.AUDIO_ONLINE, env.DB),
        );
      if (path === '/api/backup' && !write)
        return json(await store.backup(), 200, {
          'Content-Disposition':
            'attachment; filename="kite-words-classrooms.json"',
        });
      if (path === '/api/seed.csv' && !write) {
        const level = q.get('level') || 'KET';
        if (!['KET', 'PET', 'CET-4', 'CET-6'].includes(level))
          throw new AppError('词表范围不正确');
        const obj = await env.MEDIA.get('data/' + level.toLowerCase() + '.csv');
        if (!obj) throw new AppError('该词表尚未导入', 404);
        return new Response(obj.body, {
          headers: {
            ...headers,
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${level.toLowerCase()}.csv"`,
          },
        });
      }
      if (path === '/api/import' && method === 'POST') {
        const words = parseCSV(data.csv, data.level);
        const statements = words.map((w) => {
          const { id, result, ...snapshot } = w;
          void id;
          void result;
          return store.stmt(
            'INSERT INTO vocabulary(level,word,difficulty,is_basic,data) VALUES(?,?,?,?,?) ON CONFLICT(level,word) DO UPDATE SET difficulty=excluded.difficulty,is_basic=excluded.is_basic,data=excluded.data',
            w.level,
            w.word,
            w.difficulty,
            Number(w.is_basic),
            JSON.stringify(snapshot),
          );
        });
        if (statements.length > 1000)
          throw new AppError(
            '网页每次最多导入 1000 词；更大词表请使用 cf:prepare 和 cf:deploy。',
          );
        await env.DB.batch(statements);
        return json({ imported: words.length });
      }
      throw new AppError('接口不存在', 404);
    } catch (error) {
      if (error instanceof AppError)
        return json({ error: error.message }, error.status);
      console.error('request_failed', {
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : 'unknown',
      });
      return json({ error: '服务暂时无法完成请求，请重试。' }, 503);
    }
  },
} satisfies ExportedHandler<Env>;
