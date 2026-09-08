'use client';
import { useEffect, useRef, useState } from 'react';
import { Coins } from 'lucide-react';
import { api, ApiError } from '@/lib/classroom';
import type { PointsSummary } from '@/lib/student-game';
import { PointsLedger, type PointsData } from './student-records';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export function StudentRewards({
  student,
  onClose,
  onUpdate,
}: {
  student: { id: string; name: string };
  onClose: () => void;
  onUpdate: (points: PointsSummary) => void;
}) {
  const [data, setData] = useState<PointsData | null>(null),
    [kind, setKind] = useState('redeem'),
    [amount, setAmount] = useState(''),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [awaiting, setAwaiting] = useState(false);
  const pending = useRef<Record<string, unknown> | null>(null),
    lock = useRef(false);
  useEffect(() => {
    let live = true;
    void api<PointsData>('/students/' + student.id + '/points')
      .then((p) => {
        if (live) setData(p);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [student.id]);
  const target = data
    ? kind === 'adjustment'
      ? Number(amount)
      : data.points.balance + (kind === 'redeem' ? -1 : 1) * Number(amount)
    : 0;
  async function save() {
    if (!data || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setAwaiting(true);
    pending.current ||= {
      kind,
      amount: Number(amount),
      reason,
      revision: data.points.revision,
      request_id: crypto.randomUUID(),
    };
    try {
      const updated = await api<PointsData>(
        '/students/' + student.id + '/points',
        pending.current,
      );
      setData(updated);
      onUpdate(updated.points);
      pending.current = null;
      setAwaiting(false);
      setAmount('');
      setReason('');
      setNotice('积分已更新');
    } catch (e) {
      if (e instanceof ApiError && [400, 409].includes(e.status)) {
        pending.current = null;
        setAwaiting(false);
        try {
          const latest = await api<PointsData>(
            '/students/' + student.id + '/points',
          );
          setData(latest);
          onUpdate(latest.points);
        } catch {
          /* Retain the displayed balance until refresh succeeds. */
        }
      }
      setError(e instanceof Error ? e.message : '保存失败，请重试');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy && !pending.current) onClose();
      }}
    >
      <DialogContent
        className="student-record-dialog"
        showCloseButton={!busy && !awaiting}
      >
        <DialogTitle>{student.name} · 积分管理</DialogTitle>
        <DialogDescription>
          奖励和兑换均保留记录，积分不足时不能抵扣。
        </DialogDescription>
        {error && <p role="alert">{error}</p>}
        {notice && <output>{notice}</output>}
        {data ? (
          <>
            <div className="points-total">
              <Coins />
              <strong>{data.points.balance}</strong>
              <span>可用积分 · 已奖励 {data.points.earned_words} 词</span>
            </div>
            <form
              className="reward-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <fieldset disabled={busy || awaiting}>
                <label>
                  操作
                  <select
                    value={kind}
                    onChange={(e) => {
                      setKind(e.target.value);
                      setAmount('');
                    }}
                  >
                    <option value="redeem">兑换抵扣</option>
                    <option value="bonus">奖励加分</option>
                    <option value="adjustment">设置余额</option>
                  </select>
                </label>
                <label>
                  {kind === 'adjustment' ? '新的余额' : '积分数量'}
                  <input
                    type="number"
                    inputMode="numeric"
                    min={kind === 'adjustment' ? 0 : 1}
                    max={1000000}
                    step="1"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label className="reward-reason">
                  {kind === 'redeem' ? '兑换的奖励' : '调整原因'}
                  <input
                    required
                    maxLength={160}
                    value={reason}
                    placeholder={
                      kind === 'redeem'
                        ? '例如：兑换一本绘本'
                        : '填写原因，方便核对'
                    }
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              </fieldset>
              {awaiting ? (
                <p className="record-note">
                  上次提交的结果尚未确认，请重试同一笔记录。
                </p>
              ) : (
                amount !== '' && (
                  <p>
                    当前 {data.points.balance} 分 →{' '}
                    {kind === 'adjustment'
                      ? '设为'
                      : kind === 'redeem'
                        ? '抵扣'
                        : '增加'}{' '}
                    {amount} 分 → 剩余 <b>{target}</b> 分
                  </p>
                )
              )}
              <button
                className="btn primary"
                disabled={
                  busy ||
                  (!awaiting &&
                    (!amount ||
                      !reason.trim() ||
                      target < 0 ||
                      !Number.isSafeInteger(Number(amount))))
                }
              >
                {busy
                  ? '保存中…'
                  : awaiting
                    ? '重试同一笔记录'
                    : kind === 'redeem'
                      ? '确认兑换并抵扣'
                      : '确认调整'}
              </button>
            </form>
            <div className="record-scroll">
              <h3>积分明细</h3>
              <PointsLedger entries={data.entries} />
              {data.next && (
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const next = await api<PointsData>(
                        '/students/' +
                          student.id +
                          '/points?before=' +
                          data.next,
                      );
                      setData({
                        ...next,
                        entries: [...data.entries, ...next.entries],
                      });
                    } catch (e) {
                      setError(e instanceof Error ? e.message : '读取失败');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  更早的明细
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="record-empty">
            {error ? (
              <button className="btn secondary" onClick={onClose}>
                关闭后重试
              </button>
            ) : (
              '读取积分…'
            )}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
