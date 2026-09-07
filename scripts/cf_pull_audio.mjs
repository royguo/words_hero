/** Pull independently cached production audio into the tracked library; never touches classroom data. */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const config = JSON.parse(await readFile('cloudflare/wrangler.jsonc', 'utf8'));
const token =
  process.env.CLOUDFLARE_API_TOKEN ||
  JSON.parse(
    execFileSync('npx', ['wrangler', 'auth', 'token', '--json'], {
      encoding: 'utf8',
    }),
  ).token;
const result = JSON.parse(
  execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'kite-words-db',
      '--config',
      'cloudflare/wrangler.jsonc',
      '--remote',
      '--command',
      'SELECT key,file FROM audio_index',
      '--json',
    ],
    { encoding: 'utf8' },
  ),
);
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
async function get(key) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/r2/buckets/${config.r2_buckets[0].bucket_name}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
  const r = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error('R2 download failed ' + r.status + ': ' + key);
  return Buffer.from(await r.arrayBuffer());
}
await mkdir('assets/audio/v1', { recursive: true });
let count = 0;
for (const row of result[0].results) {
  if (
    !/^[a-f0-9]{64}$/.test(row.key) ||
    !/^audio\/v1\/[a-f0-9]{64}\.mp3$/.test(row.file)
  )
    throw new Error('Invalid remote audio key');
  const path = 'assets/audio/v1/' + row.key + '.json';
  try {
    await access(path);
    continue;
  } catch {}
  const raw = await get('audio/v1/' + row.key + '.json'),
    m = JSON.parse(raw.toString('utf8'));
  const canonical = JSON.stringify(
    Object.fromEntries(
      Object.keys(m.request)
        .sort()
        .map((k) => [k, m.request[k]]),
    ),
  );
  if (
    sha(canonical) !== row.key ||
    m.key !== row.key ||
    m.file !== row.file ||
    row.file !== 'audio/v1/' + m.sha256 + '.mp3' ||
    m.synthetic !== true
  )
    throw new Error('Invalid audio manifest ' + row.key);
  const audio = await get(row.file);
  if (
    sha(audio) !== m.sha256 ||
    audio.length !== m.bytes ||
    audio.length > 5_000_000
  )
    throw new Error('Invalid audio bytes ' + row.key);
  await writeFile('assets/' + row.file, audio, { flag: 'wx' }).catch(
    async (e) => {
      if (
        e.code !== 'EEXIST' ||
        sha(await readFile('assets/' + row.file)) !== m.sha256
      )
        throw e;
    },
  );
  await writeFile(path, raw, { flag: 'wx' });
  count++;
}
execFileSync('python3', ['scripts/lesson_audio.py', 'validate'], {
  stdio: 'inherit',
});
console.log(
  `${count} new recordings pulled. Review and commit assets/audio/v1 to Git.`,
);
