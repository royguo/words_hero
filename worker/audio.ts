/** Edge neural speech protocol adapted from edge-tts 7.2.8 (LGPL-3.0).
 * Protocol reference: https://github.com/rany2/edge-tts . No paid/GPT API channel.
 */
import { AppError, type Course, uid, now } from './model';
const MAX_AUDIO = 5_000_000;
export const profile = {
  schema_version: 1,
  provider: 'edge',
  model: 'neural',
  voice: 'en-GB-SoniaNeural',
  rate: '-10%',
  format: 'audio-24khz-48kbitrate-mono-mp3',
};
export const canonical = (v: Record<string, unknown>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, v[k]]),
    ),
  );
export async function digest(data: string | ArrayBuffer | Uint8Array) {
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        bytes instanceof Uint8Array ? new Uint8Array(bytes).buffer : bytes,
      ),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export function normalizeText(v: unknown) {
  if (typeof v !== 'string' || v.length > 2000)
    throw new AppError('朗读文字须为 1–2000 个字符');
  const s = v.trim().replace(/\s+/gu, ' ').normalize('NFC');
  if (!/[a-z]/i.test(s) || /\p{C}/u.test(s))
    throw new AppError('请提供有效的英文朗读内容');
  return s;
}
export async function identity(text: unknown) {
  const request = { ...profile, text: normalizeText(text) };
  return { key: await digest(canonical(request)), request };
}
export function isMP3(b: Uint8Array) {
  if (b.length < 128 || b.length > MAX_AUDIO) return false;
  let n = 0;
  if (b[0] === 73 && b[1] === 68 && b[2] === 51) {
    if (b.slice(6, 10).some((x) => x >= 128)) return false;
    n = 10 + (b[6] << 21) + (b[7] << 14) + (b[8] << 7) + b[9];
  }
  return (
    n + 4 <= b.length &&
    b[n] === 255 &&
    (b[n + 1] & 224) === 224 &&
    (b[n + 1] & 24) !== 8 &&
    (b[n + 1] & 6) !== 0 &&
    ![0, 15].includes(b[n + 2] >> 4) &&
    (b[n + 2] & 12) !== 12
  );
}
export function texts(l: Course) {
  const out = new Map<string, { text: string; kind: string }>();
  const add = (v: string | undefined, kind: string) => {
    if (v) {
      const text = normalizeText(v);
      if (!out.has(text)) out.set(text, { text, kind });
    }
  };
  for (const w of l.words) {
    add(w.word, 'word');
    add(w.example, 'example');
    for (const x of w.extra_examples || []) add(x.en, 'example');
    for (const x of w.word_study?.family || []) {
      add(x.word, 'word');
      add(x.example.en, 'example');
    }
  }
  for (const s of l.materials.story?.scenes || []) {
    add(s.en, 'story');
    add(s.question.en, 'question');
    add(s.question.answer_en, 'answer');
  }
  return [...out.values()];
}
export const configuration = (online: string) => ({
  provider: 'edge',
  voice: profile.voice,
  label: '英式英语 · Sonia · 清晰慢速',
  configured: online === 'true',
  message: online === 'true' ? '' : '当前只播放已缓存语音。',
  synthetic: true,
});
type Clip = { key: string; url: string; bytes: number; cached: boolean };
type Manifest = {
  schema_version: number;
  key: string;
  request: Record<string, unknown>;
  file: string;
  sha256: string;
  bytes: number;
};
export async function cached(
  bucket: R2Bucket,
  key: string,
  request: Record<string, unknown>,
): Promise<Clip | null> {
  const object = await bucket.get('audio/v1/' + key + '.json');
  if (!object) return null;
  const m = await object.json<Manifest>();
  if (
    m.key !== key ||
    canonical(m.request) !== canonical(request) ||
    !/^[a-f0-9]{64}$/.test(m.sha256) ||
    m.file !== 'audio/v1/' + m.sha256 + '.mp3'
  )
    throw new AppError('语音缓存校验失败', 409);
  const audio = await bucket.head(m.file);
  if (!audio || audio.size !== m.bytes || audio.size > MAX_AUDIO)
    throw new AppError('语音缓存不完整', 409);
  return { key, url: '/assets/' + m.file, bytes: m.bytes, cached: true };
}
export async function inventory(
  _bucket: R2Bucket,
  l: Course,
  online: string,
  db: D1Database,
) {
  const entries = await Promise.all(
    texts(l).map(async (item) => ({ ...item, ...(await identity(item.text)) })),
  );
  const indexed = new Map<
    string,
    { key: string; file: string; bytes: number; request: string }
  >();
  for (let i = 0; i < entries.length; i += 90) {
    const chunk = entries.slice(i, i + 90);
    const rows = await db
      .prepare(
        'SELECT * FROM audio_index WHERE key IN (' +
          chunk.map(() => '?').join(',') +
          ')',
      )
      .bind(...chunk.map((x) => x.key))
      .all<{ key: string; file: string; bytes: number; request: string }>();
    for (const r of rows.results) indexed.set(r.key, r);
  }
  const items = entries.map(({ text, kind, key, request }) => {
    const m = indexed.get(key),
      hit = !!m && canonical(JSON.parse(m.request)) === canonical(request);
    return {
      text,
      kind,
      key,
      cached: hit,
      url: hit ? '/assets/' + m!.file : null,
    };
  });
  return {
    configuration: configuration(online),
    items,
    total: items.length,
    cached: items.filter((i) => i.cached).length,
  };
}
async function indexClip(
  db: D1Database,
  clip: Clip,
  request: Record<string, unknown>,
) {
  await db
    .prepare(
      'INSERT INTO audio_index VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET file=excluded.file,bytes=excluded.bytes,request=excluded.request',
    )
    .bind(
      clip.key,
      clip.url.slice('/assets/'.length),
      clip.bytes,
      canonical(request),
    )
    .run();
}
export async function prepare(
  bucket: R2Bucket,
  text: unknown,
  online: string,
  db: D1Database,
) {
  const { key, request } = await identity(text),
    hit = await cached(bucket, key, request);
  if (hit) {
    await indexClip(db, hit, request);
    return hit;
  }
  if (online !== 'true')
    throw new AppError('当前为离线测试，未缓存语音请先同步素材。', 503);
  const body = await synthesize(request.text);
  if (!isMP3(body)) throw new AppError('语音服务未返回有效录音，请重试。', 502);
  const sha = await digest(body),
    file = 'audio/v1/' + sha + '.mp3';
  await bucket.put(file, body, {
    httpMetadata: {
      contentType: 'audio/mpeg',
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: { sha256: sha },
  });
  const manifest = {
    schema_version: 1,
    key,
    request,
    file,
    sha256: sha,
    bytes: body.length,
    created_at: now(),
    generator: 'KiteDance Workers Edge protocol v1 (edge-tts 7.2.8)',
    source: 'https://github.com/rany2/edge-tts',
    synthetic: true,
  };
  // Audio first, manifest last; failed synthesis cannot publish a partial cache entry.
  await bucket.put(
    'audio/v1/' + key + '.json',
    JSON.stringify(manifest, null, 2) + '\n',
    { httpMetadata: { contentType: 'application/json' } },
  );
  const clip = {
    key,
    url: '/assets/' + file,
    bytes: body.length,
    cached: false,
  };
  await indexClip(db, clip, request);
  return clip;
}
const clientToken = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'; // public Edge protocol constant, not an account credential
export async function synthesize(text: string, skew = 0): Promise<Uint8Array> {
  const seconds = Math.floor(Date.now() / 1000) + skew + 11644473600,
    ticks = BigInt(seconds - (seconds % 300)) * BigInt(10000000);
  const gec = (await digest(String(ticks) + clientToken)).toUpperCase();
  const url =
    'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=' +
    clientToken +
    '&ConnectionId=' +
    uid() +
    '&Sec-MS-GEC=' +
    gec +
    '&Sec-MS-GEC-Version=1-143.0.3650.75';
  const response = await fetch(url, {
    headers: {
      Upgrade: 'websocket',
      Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Cookie: 'muid=' + uid().toUpperCase() + ';',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.webSocket) {
    if (response.status === 403 && !skew && response.headers.get('Date')) {
      const correction = Math.round(
        (Date.parse(response.headers.get('Date')!) - Date.now()) / 1000,
      );
      if (Math.abs(correction) > 1 && Math.abs(correction) < 86400)
        return synthesize(text, correction);
    }
    await response.body?.cancel();
    throw new AppError('在线语音暂时不可用；已有录音仍可播放。', 502);
  }
  const ws = response.webSocket;
  // Current Workers default binary frames to Blob. Parse ordered frames synchronously.
  ws.binaryType = 'arraybuffer';
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0,
      done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      if (error) {
        reject(error);
        return;
      }
      const out = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
      }
      resolve(out);
    };
    const timer = setTimeout(
      () => finish(new AppError('语音连接超时，请稍后重试。', 503)),
      30000,
    );
    ws.addEventListener('error', () =>
      finish(new AppError('语音连接中断', 502)),
    );
    ws.addEventListener('close', () =>
      finish(new AppError('语音未完整生成', 502)),
    );
    ws.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        if (/Path:turn.end\r\n/.test(event.data)) finish();
        return;
      }
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      if (bytes.length < 2) return finish(new AppError('语音格式错误', 502));
      const n = bytes[0] * 256 + bytes[1];
      if (n + 2 > bytes.length)
        return finish(new AppError('语音格式错误', 502));
      const headers = new TextDecoder().decode(bytes.slice(2, n + 2));
      if (!/Path:audio\r\n/.test(headers + '\r\n')) return;
      const chunk = bytes.slice(n + 2);
      size += chunk.length;
      if (size > MAX_AUDIO) return finish(new AppError('语音过长', 502));
      chunks.push(chunk);
    });
    ws.accept();
    const stamp = new Date().toString(),
      xml = text.replace(
        /[&<>"']/g,
        (c) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&apos;',
          })[c]!,
      );
    ws.send(
      `X-Timestamp:${stamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: {
                  sentenceBoundaryEnabled: 'false',
                  wordBoundaryEnabled: 'false',
                },
                outputFormat: profile.format,
              },
            },
          },
        }) +
        '\r\n',
    );
    ws.send(
      `X-RequestId:${uid()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${stamp}Z\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='Microsoft Server Speech Text to Speech Voice (en-GB, SoniaNeural)'><prosody pitch='+0Hz' rate='-10%' volume='+0%'>${xml}</prosody></voice></speak>`,
    );
  });
}
