/* oxlint-disable next/no-img-element -- Static PNG brand assets require no remote image service. */
'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Loader2, ArrowRight } from 'lucide-react';
export function AuthGate({
  children,
  requiredRole = 'teacher',
}: {
  children: ReactNode;
  requiredRole?: 'teacher' | 'student';
}) {
  const [phase, setPhase] = useState<'loading' | 'login' | 'ready' | 'error'>(
      'loading',
    ),
    [error, setError] = useState(''),
    [password, setPassword] = useState(''),
    [username, setUsername] = useState(
      requiredRole === 'teacher' ? 'admin' : '',
    ),
    [busy, setBusy] = useState(false);
  const [role, setRole] = useState<'teacher' | 'student'>(requiredRole);
  const usernameInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const enter = useCallback(
    (userRole: 'teacher' | 'student') => {
      if (userRole !== requiredRole)
        location.replace(userRole === 'student' ? '/learn' : '/');
      else setPhase('ready');
    },
    [requiredRole],
  );
  useEffect(() => {
    let active = true;
    fetch('/api/auth/session')
      .then(async (r) => {
        if (r.status === 404 && requiredRole === 'teacher')
          return { authenticated: true, role: 'teacher' as const };
        if (!r.ok) throw new Error('无法连接课堂服务，请刷新重试。');
        return r.json() as Promise<{
          authenticated: boolean;
          role: 'teacher' | 'student';
        }>;
      })
      .then((v) => {
        if (active) {
          if (v.authenticated) enter(v.role);
          else setPhase('login');
        }
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
  }, [enter, requiredRole]);
  useEffect(() => {
    if (phase !== 'login' || busy) return;
    const frame = requestAnimationFrame(() => {
      (role === 'teacher' ? passwordInput : usernameInput).current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [busy, phase, role]);
  if (phase === 'ready') return children;
  return (
    <main className="login-screen">
      <div className="login-panel">
        <img
          className="login-icon"
          src="/favicon.png?v=2"
          alt="风筝与翻开的书"
        />
        <p className="eyebrow">KiteDance</p>
        <h1>风筝单词</h1>
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
                  body: JSON.stringify({ username, password, role }),
                });
                const v = (await r.json()) as { error?: string };
                if (!r.ok) throw new Error(v.error || '登录失败');
                setPassword('');
                enter(role);
              } catch (e) {
                setError(e instanceof Error ? e.message : '登录没有完成');
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="login-tabs" role="tablist" aria-label="登录身份">
              {(['student', 'teacher'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={role === value}
                  onClick={() => {
                    setRole(value);
                    setUsername(value === 'teacher' ? 'admin' : '');
                    setPassword('');
                    setError('');
                  }}
                  disabled={busy}
                >
                  {value === 'student' ? '学生登录' : '老师登录'}
                </button>
              ))}
            </div>
            <label htmlFor="login-user">账号</label>
            <input
              ref={usernameInput}
              id="login-user"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <label htmlFor="login-password">密码</label>
            <input
              ref={passwordInput}
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
              {role === 'student' ? '开始背词' : '进入课堂'}
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
