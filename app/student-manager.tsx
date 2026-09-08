'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ArrowLeft,
  Plus,
  Save,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { api } from '@/lib/classroom';
import { suggestStudentAccount } from '@/lib/student-account';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
type Student = {
  id: string;
  name: string;
  username: string;
  phone: string;
  revision: number;
};
type Row = Partial<Student> & {
  localId: string;
  name: string;
  username: string;
  password: string;
  phone: string;
  dirty: boolean;
  autoUsername?: boolean;
  autoPassword?: boolean;
  error?: string;
};
const asRow = (s: Student): Row => ({
  ...s,
  localId: s.id,
  password: '',
  dirty: false,
});
function fresh(username: string): Row {
  return {
    localId: crypto.randomUUID(),
    name: '',
    username,
    password: username.slice(-6),
    phone: '',
    dirty: true,
    autoUsername: true,
    autoPassword: true,
  };
}
const readClassId = () =>
  new URLSearchParams(location.search).get('class') || '';
const subscribeURL = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
};
export function StudentManager() {
  const cid = useSyncExternalStore(subscribeURL, readClassId, () => '');
  const [className, setClassName] = useState(''),
    [rows, setRows] = useState<Row[]>([]),
    [nextUsername, setNextUsername] = useState('');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [showPasswords, setShowPasswords] = useState(false),
    [removing, setRemoving] = useState<Row | null>(null);
  const lastInput = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    let live = true;
    const id = cid;
    if (!id) return;
    api<{ class_name: string; students: Student[]; next_username: string }>(
      '/classes/' + encodeURIComponent(id) + '/students',
    )
      .then((data) => {
        if (live) {
          setClassName(data.class_name);
          setRows(data.students.map(asRow));
          setNextUsername(data.next_username);
        }
      })
      .catch((e) => {
        if (live) setMessage(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [cid]);
  const dirty = rows.filter((r) => r.dirty).length;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function update(
    localId: string,
    key: 'name' | 'username' | 'password' | 'phone',
    value: string,
  ) {
    if (key === 'username') value = value.toLowerCase();
    setRows((old) =>
      old.map((r) => {
        if (r.localId !== localId) return r;
        const password =
          key === 'username' && !r.id && r.autoPassword
            ? value.slice(-6)
            : r.password;
        return {
          ...r,
          password,
          [key]: value,
          dirty: true,
          error: undefined,
          autoUsername: key === 'username' ? false : r.autoUsername,
          autoPassword:
            key === 'password'
              ? value === r.username.slice(-6) || value === ''
              : r.autoPassword,
        };
      }),
    );
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    let saved = 0,
      failed = 0;
    for (const row of rows.filter((r) => r.dirty)) {
      try {
        if (!row.name.trim()) throw new Error('请填写姓名');
        const data = {
          name: row.name,
          username: row.username,
          phone: row.phone,
          password:
            !row.id && row.autoUsername && row.autoPassword
              ? undefined
              : row.password,
          auto_username: !row.id && row.autoUsername,
          revision: row.revision,
        };
        const result = await api<Student>(
          row.id ? '/students/' + row.id : '/classes/' + cid + '/students',
          data,
          row.id ? 'PATCH' : 'POST',
        );
        setRows((old) =>
          old.map((r) =>
            r.localId === row.localId
              ? { ...asRow(result), localId: row.localId }
              : r,
          ),
        );
        saved++;
      } catch (e) {
        failed++;
        setRows((old) =>
          old.map((r) =>
            r.localId === row.localId
              ? {
                  ...r,
                  error: e instanceof Error ? e.message : '保存失败，请重试',
                }
              : r,
          ),
        );
      }
    }
    setMessage(
      `已保存 ${saved} 位学生${failed ? `，${failed} 行需要检查` : ''}`,
    );
    setBusy(false);
  }
  return (
    <main className="student-manager-page">
      <header className="manager-header">
        <a href={'/?class=' + encodeURIComponent(cid)} className="btn ghost">
          <ArrowLeft size={18} />
          返回班级
        </a>
        <span>{className}</span>
      </header>
      <div className="manager-title">
        <div>
          <h1>学生管理</h1>
          <p>
            {rows.filter((r) => r.id).length} 位学生
            {dirty ? ` · ${dirty} 行待保存` : ''}
          </p>
        </div>
        <div className="manager-actions">
          <button
            className="btn secondary"
            disabled={busy || !cid || loading}
            onClick={() => {
              setRows((old) => [
                ...old,
                fresh(
                  suggestStudentAccount(
                    nextUsername,
                    old.map((r) => r.username),
                  ),
                ),
              ]);
              setTimeout(() => lastInput.current?.focus(), 0);
            }}
          >
            <Plus size={17} />
            添加学生
          </button>
          <button
            className="btn primary"
            disabled={busy || !dirty}
            onClick={() => void save()}
          >
            {busy ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
            保存修改
          </button>
        </div>
      </div>
      <div className="manager-hint">
        <span>
          账号为当天日期＋递增序号，保存时确认；初始密码为账号后六位。已保存的密码留空则不修改。
        </span>
        <label>
          <input
            type="checkbox"
            checked={showPasswords}
            onChange={(e) => setShowPasswords(e.target.checked)}
          />
          显示正在输入的密码
        </label>
      </div>
      {message && <output className="manager-message">{message}</output>}
      {!cid ? (
        <p className="empty-state">请从班级页面打开学生管理。</p>
      ) : loading ? (
        <p className="empty-state">
          <Loader2 className="spin" />
          正在读取学生…
        </p>
      ) : (
        <div className="student-table-scroll">
          <table className="student-table">
            <thead>
              <tr>
                <th>#</th>
                <th>姓名</th>
                <th>账号</th>
                <th>密码</th>
                <th>手机号（选填）</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.localId}
                  className={
                    row.error ? 'row-error' : row.dirty ? 'row-dirty' : ''
                  }
                >
                  <td>{i + 1}</td>
                  <td>
                    <input
                      ref={i === rows.length - 1 ? lastInput : undefined}
                      aria-label={`第 ${i + 1} 行姓名`}
                      value={row.name}
                      maxLength={60}
                      disabled={busy}
                      autoComplete="off"
                      onChange={(e) =>
                        update(row.localId, 'name', e.target.value)
                      }
                    />
                    {row.error && <small role="alert">{row.error}</small>}
                  </td>
                  <td>
                    <input
                      aria-label={`第 ${i + 1} 行账号`}
                      value={row.username}
                      maxLength={32}
                      disabled={busy}
                      autoCapitalize="none"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) =>
                        update(row.localId, 'username', e.target.value)
                      }
                    />
                  </td>
                  <td>
                    <div className="password-cell">
                      <input
                        aria-label={`第 ${i + 1} 行密码`}
                        value={row.password}
                        type={showPasswords ? 'text' : 'password'}
                        maxLength={100}
                        disabled={busy}
                        autoComplete="new-password"
                        placeholder={
                          row.id ? '已设置 · 留空保留' : '账号后六位'
                        }
                        onChange={(e) =>
                          update(row.localId, 'password', e.target.value)
                        }
                      />
                      <button
                        className="icon-btn"
                        aria-label={`重置 ${row.name || '此学生'} 的密码为账号后六位`}
                        title="重置为账号后六位（保存后生效）"
                        disabled={busy}
                        onClick={() =>
                          update(
                            row.localId,
                            'password',
                            row.username.slice(-6),
                          )
                        }
                      >
                        <RefreshCw size={15} />
                      </button>
                    </div>
                  </td>
                  <td>
                    <input
                      aria-label={`第 ${i + 1} 行手机号`}
                      value={row.phone}
                      type="tel"
                      maxLength={32}
                      disabled={busy}
                      autoComplete="off"
                      onChange={(e) =>
                        update(row.localId, 'phone', e.target.value)
                      }
                    />
                  </td>
                  <td>
                    <button
                      className="icon-btn"
                      aria-label={'移除学生 ' + (row.name || i + 1)}
                      disabled={busy}
                      onClick={() =>
                        row.id
                          ? setRemoving(row)
                          : setRows((old) =>
                              old.filter((r) => r.localId !== row.localId),
                            )
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="student-table-empty">
                    暂无学生，点击“添加学生”开始填写。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={!!removing}
        onOpenChange={(v) => {
          if (!v && !busy) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogTitle>移除 {removing?.name}？</DialogTitle>
          <DialogDescription>
            该账号将无法登录，已有记忆记录会保留。
          </DialogDescription>
          <div className="manager-actions">
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => setRemoving(null)}
            >
              取消
            </button>
            <button
              className="btn danger"
              disabled={busy}
              onClick={async () => {
                if (!removing?.id) return;
                setBusy(true);
                try {
                  await api('/students/' + removing.id, {}, 'DELETE');
                  setRows((old) =>
                    old.filter((r) => r.localId !== removing.localId),
                  );
                  setRemoving(null);
                } catch (e) {
                  setMessage(e instanceof Error ? e.message : '移除失败');
                } finally {
                  setBusy(false);
                }
              }}
            >
              确认移除
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
