import { digest } from './audio';
import { AppError } from './model';
import type { StudentIdentity } from '../lib/student-game';
export type Identity =
  | { role: 'teacher'; username: 'admin' }
  | (StudentIdentity & { role: 'student'; auth_version: number });
const cookie = 'kite_session',
  duration = 30 * 86400;
async function key(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
export async function authenticated(req: Request, secret: string) {
  if (!secret) return false;
  const value = req.headers
    .get('Cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(cookie + '='))
    ?.slice(cookie.length + 1);
  if (!value) return false;
  const [expires, sig] = value.split('.');
  if (
    !/^\d+$/.test(expires) ||
    Number(expires) < Date.now() / 1000 ||
    Number(expires) > Date.now() / 1000 + duration + 60 ||
    !/^[a-f0-9]{64}$/.test(sig || '')
  )
    return false;
  return crypto.subtle.verify(
    'HMAC',
    await key(secret),
    Uint8Array.from(sig.match(/../g)!, (x) => parseInt(x, 16)),
    new TextEncoder().encode('admin.' + expires),
  );
}
export async function login(
  req: Request,
  data: Record<string, unknown>,
  env: { ADMIN_PASSWORD: string; SESSION_SECRET: string },
) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET)
    throw new AppError('登录服务尚未配置', 503);
  if (
    typeof data.password !== 'string' ||
    data.password.length > 200 ||
    data.username !== 'admin' ||
    (await digest(data.password)) !== (await digest(env.ADMIN_PASSWORD))
  )
    throw new AppError('账号或密码不正确', 401);
  const expires = Math.floor(Date.now() / 1000) + duration,
    payload = 'admin.' + expires,
    sig = hex(
      await crypto.subtle.sign(
        'HMAC',
        await key(env.SESSION_SECRET),
        new TextEncoder().encode(payload),
      ),
    );
  return `${cookie}=${expires}.${sig}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${duration}${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export const logout = (req: Request) =>
  `${cookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`;

const encoder = new TextEncoder();
const fromHex = (value: string) =>
  Uint8Array.from(value.match(/../g) || [], (x) => parseInt(x, 16));
export async function passwordHash(
  password: string,
  salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer),
) {
  const base = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bytes = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: fromHex(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    base,
    256,
  );
  return `pbkdf2$100000$${salt}$${hex(bytes)}`;
}
async function passwordMatches(password: string, stored: string) {
  const parts = stored.split('$');
  if (
    parts.length !== 4 ||
    parts[0] !== 'pbkdf2' ||
    parts[1] !== '100000' ||
    !/^[a-f0-9]{32}$/.test(parts[2]) ||
    !/^[a-f0-9]{64}$/.test(parts[3])
  )
    return false;
  const candidate = (await passwordHash(password, parts[2])).split('$')[3];
  const signature = await crypto.subtle.sign(
    'HMAC',
    await key(candidate),
    encoder.encode('kite-password-check'),
  );
  return crypto.subtle.verify(
    'HMAC',
    await key(parts[3]),
    signature,
    encoder.encode('kite-password-check'),
  );
}
export async function identity(
  req: Request,
  env: { SESSION_SECRET: string; DB: D1Database },
): Promise<Identity | null> {
  if (await authenticated(req, env.SESSION_SECRET))
    return { role: 'teacher', username: 'admin' };
  const value = req.headers
    .get('Cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(cookie + '='))
    ?.slice(cookie.length + 1);
  const match = /^s\.([a-f0-9]{32})\.(\d+)\.(\d+)\.([a-f0-9]{64})$/.exec(
    value || '',
  );
  if (!match || !env.SESSION_SECRET) return null;
  const [, id, version, expires, sig] = match;
  if (
    Number(expires) < Date.now() / 1000 ||
    Number(expires) > Date.now() / 1000 + duration + 60
  )
    return null;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await key(env.SESSION_SECRET),
    fromHex(sig),
    encoder.encode(`student.${id}.${version}.${expires}`),
  );
  if (!valid) return null;
  const student = await env.DB.prepare(
    'SELECT s.id,s.name,s.username,s.class_id,s.auth_version,c.name AS class_name FROM students s JOIN classrooms c ON c.id=s.class_id WHERE s.id=? AND s.auth_version=? AND s.deleted_at IS NULL AND c.deleted_at IS NULL',
  )
    .bind(id, Number(version))
    .first<StudentIdentity & { auth_version: number }>();
  return student ? { ...student, role: 'student' } : null;
}
export async function studentLogin(
  req: Request,
  data: Record<string, unknown>,
  env: { DB: D1Database; SESSION_SECRET: string },
) {
  if (!env.SESSION_SECRET) throw new AppError('登录服务尚未配置', 503);
  if (
    typeof data.username !== 'string' ||
    data.username.length > 32 ||
    typeof data.password !== 'string' ||
    data.password.length > 100
  )
    throw new AppError('账号或密码不正确', 401);
  const student = await env.DB.prepare(
    'SELECT s.id,s.auth_version,s.password_hash FROM students s JOIN classrooms c ON c.id=s.class_id WHERE s.username=? COLLATE NOCASE AND s.deleted_at IS NULL AND c.deleted_at IS NULL',
  )
    .bind(data.username.trim())
    .first<{ id: string; auth_version: number; password_hash: string }>();
  if (
    !student ||
    !(await passwordMatches(data.password, student.password_hash))
  )
    throw new AppError('账号或密码不正确', 401);
  const expires = Math.floor(Date.now() / 1000) + duration;
  const sig = hex(
    await crypto.subtle.sign(
      'HMAC',
      await key(env.SESSION_SECRET),
      encoder.encode(
        `student.${student.id}.${student.auth_version}.${expires}`,
      ),
    ),
  );
  return `${cookie}=s.${student.id}.${student.auth_version}.${expires}.${sig}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${duration}${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`;
}
