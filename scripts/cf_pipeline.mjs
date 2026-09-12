/** Production migrations are explicit and repeatable; local records never seed production. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const mode = process.argv[2];
if (!['local', 'deploy'].includes(mode)) throw new Error('Use local or deploy');
const remote = mode === 'deploy',
  config = 'cloudflare/wrangler.jsonc',
  persist = process.env.KITE_CF_STATE || '.wrangler/state';
function run(command, args) {
  const r = spawnSync(command, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}
run('python3', ['scripts/cf_prepare.py']);
run('npm', ['run', 'typecheck']);
run('npm', ['run', 'build']);
const location = remote ? ['--remote'] : ['--local', '--persist-to', persist];
run('npx', [
  'wrangler',
  'd1',
  'migrations',
  'apply',
  'kite-words-db',
  '--config',
  config,
  ...location,
]);
run('node', ['scripts/cf_objects.mjs', ...(remote ? ['--remote'] : [])]);
const seedFiles = JSON.parse(
  readFileSync('.wrangler/content/seed-files.json', 'utf8'),
);
for (const seed of seedFiles)
  run('npx', [
    'wrangler',
    'd1',
    'execute',
    'kite-words-db',
    '--config',
    config,
    ...location,
    '--file',
    seed,
  ]);
if (remote) run('npx', ['wrangler', 'deploy', '--config', config]);
console.log(
  remote
    ? 'Deployment complete; verify https://kitedance.com'
    : 'Local D1 and R2 ready. Run npm run cf:dev',
);
