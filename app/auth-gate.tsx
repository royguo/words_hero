/* oxlint-disable next/no-img-element -- Static PNG brand assets require no remote image service. */
'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, ArrowRight } from 'lucide-react';
export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<'loading' | 'login' | 'ready' | 'error'>(
      'loading',
    ),
    [error, setError] = useState(''),
    [password, setPassword] = useState(''),
    [username, setUsername] = useState('admin'),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    fetch('/api/auth/session')
      .then(async (r) => {
        if (r.status === 404) return { authenticated: true };
        if (!r.ok) throw new Error('无法连接课堂服务，请刷新重试。');
        return r.json() as Promise<{ authenticated: boolean }>;
      })
      .then((v) => {
        if (active) setPhase(v.authenticated ? 'ready' : 'login');
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setPhase('error');
        }
      });
    const expired = () => {
      setPhase('login');
      setPassword('');
    };
    const logout = () => {
      void fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
        .then((r) => {
          if (!r.ok) throw new Error('退出没有完成，请重试');
          expired();
        })
        .catch((e) => {
          setError(e.message);
        });
    };
    window.addEventListener('kite-auth-required', expired);
    window.addEventListener('kite-logout', logout);
    return () => {
      active = false;
      window.removeEventListener('kite-auth-required', expired);
      window.removeEventListener('kite-logout', logout);
    };
  }, []);
  if (phase === 'ready') return children;
  return (
    <main className="login-screen">
      <div className="login-panel">
        <img className="login-icon" src="/favicon.png" alt="风筝与翻开的书" />
        <p className="eyebrow">KiteDance</p>
        <h1>风筝单词</h1>
        <p className="login-tagline">让每一个单词，带想象力起飞。</p>
        {phase === 'loading' ? (
          <p className="login-loading">
            <Loader2 className="spin" /> 正在打开课堂…
          </p>
        ) : phase === 'error' ? (
          <>
            <p role="alert" className="login-error">
              {error}
            </p>
            <button className="btn primary" onClick={() => location.reload()}>
              重新连接
            </button>
          </>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setError('');
              try {
                const r = await fetch('/api/auth/login', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ username, password }),
                });
                const v = (await r.json()) as { error?: string };
                if (!r.ok) throw new Error(v.error || '登录失败');
                setPassword('');
                setPhase('ready');
              } catch (e) {
                setError(e instanceof Error ? e.message : '登录没有完成');
              } finally {
                setBusy(false);
              }
            }}
          >
            <label htmlFor="login-user">账号</label>
            <input
              id="login-user"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <label htmlFor="login-password">密码</label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error && (
              <p role="alert" className="login-error">
                {error}
              </p>
            )}
            <button className="btn primary" disabled={busy}>
              {busy ? (
                <Loader2 className="spin" size={18} />
              ) : (
                <ArrowRight size={18} />
              )}
              进入课堂
            </button>
            <p className="login-remember">
              登录后自动记住此设备，下次直接进入。
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
