import { digest } from './audio';
import { AppError } from './model';
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
