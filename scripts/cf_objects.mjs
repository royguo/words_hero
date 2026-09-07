/** Sync Git assets to local/remote R2. Never deletes an object. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const remote = process.argv.includes('--remote'),
  persist = process.env.KITE_CF_STATE || '.wrangler/state';
const files = JSON.parse(
  await readFile('.wrangler/content/objects.json', 'utf8'),
);
const config = JSON.parse(await readFile('cloudflare/wrangler.jsonc', 'utf8')),
  bucketName = config.r2_buckets[0].bucket_name;
const types = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  json: 'application/json',
  md: 'text/markdown',
  csv: 'text/csv; charset=utf-8',
};
let mf, bucket, token;
if (remote) {
  token =
    process.env.CLOUDFLARE_API_TOKEN ||
    JSON.parse(
      execFileSync('npx', ['wrangler', 'auth', 'token', '--json'], {
        encoding: 'utf8',
      }),
    ).token;
  if (!token) throw new Error('Cloudflare credentials unavailable');
} else {
  const { Miniflare, convertV4MiniflareOptions } = await import('miniflare');
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("local R2 setup")}}',
      compatibilityDate: '2026-09-07',
      r2Buckets: { MEDIA: bucketName },
      resourcePersistencePath: resolve(persist, 'v3'),
    }),
  );
  bucket = await mf.getR2Bucket('MEDIA');
}
// A receipt is an optimization, never the source of truth. Every changed object is uploaded.
const receiptPath = remote
  ? '.wrangler/content/uploaded-remote.json'
  : resolve(persist, 'uploaded-r2.json');
let receipt = {};
try {
  receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
} catch {}
let copied = 0,
  skipped = 0;
async function put(item) {
  if (receipt[item.key] === item.sha256) {
    skipped++;
    return;
  }
  const data = await readFile(item.file),
    hash = createHash('sha256').update(data).digest('hex');
  if (hash !== item.sha256)
    throw new Error('Asset changed since prepare: ' + item.key);
  const contentType =
      types[item.key.split('.').at(-1)] || 'application/octet-stream',
    immutable = /\/[a-f0-9]{64}\.(png|jpg|jpeg|webp|mp3)$/.test(item.key);
  if (remote) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/r2/buckets/${bucketName}/objects/${item.key.split('/').map(encodeURIComponent).join('/')}`;
    let success = false;
    for (let n = 0; n < 3; n++) {
      const r = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': contentType,
          'Cache-Control': immutable
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
          'cf-r2-data-catalog-check': 'true',
        },
        body: data,
        signal: AbortSignal.timeout(60000),
      });
      if (r.ok) {
        await r.arrayBuffer();
        success = true;
        break;
      }
      await r.body?.cancel();
      if (n === 2)
        throw new Error('R2 upload failed ' + r.status + ': ' + item.key);
    }
    if (!success) throw new Error('Upload failed');
  } else
    await bucket.put(item.key, data, {
      httpMetadata: {
        contentType,
        cacheControl: immutable
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      },
      customMetadata: { sha256: hash },
    });
  receipt[item.key] = hash;
  copied++;
  if (copied % 20 === 0)
    console.log(`R2 ${remote ? 'remote' : 'local'}: ${copied} uploaded`);
}
try {
  for (let i = 0; i < files.length; i += 4)
    await Promise.all(files.slice(i, i + 4).map(put));
  await mkdir(resolve(receiptPath, '..'), { recursive: true });
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(
    JSON.stringify({
      target: remote ? 'remote' : 'local',
      uploaded: copied,
      unchanged: skipped,
    }),
  );
} finally {
  await mf?.dispose();
}
