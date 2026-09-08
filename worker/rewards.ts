import { Store } from './store';
import { AppError, integer, now, string, uid } from './model';
import type { PointsEntry, PointsSummary } from '../lib/student-game';

export class Rewards extends Store {
  async settings(cid: string) {
    return (
      (await this.one<{ points_per_word: number; revision: number }>(
        'SELECT points_per_word,revision FROM reward_settings WHERE class_id=?',
        cid,
      )) || { points_per_word: 10, revision: 0 }
    );
  }
  async configure(cid: string, data: Record<string, unknown>) {
    const c = await this.classroom(cid),
      previous = await this.settings(cid);
    if (integer(data.revision, 0, 1e9, '积分规则版本') !== previous.revision)
      throw new AppError('积分规则已改变，请刷新后重试', 409);
    const value = integer(data.points_per_word, 0, 1000, '每词积分');
    await this.transaction(c, [
      this.stmt(
        'INSERT INTO reward_settings(class_id,points_per_word,updated_at) VALUES(?,?,?) ON CONFLICT(class_id) DO UPDATE SET points_per_word=excluded.points_per_word,revision=revision+1,updated_at=excluded.updated_at',
        cid,
        value,
        now(),
      ),
    ]);
    return { points_per_word: value, revision: previous.revision + 1 };
  }
  async summary(id: string, cid: string): Promise<PointsSummary> {
    const [wallet, settings, earned] = await Promise.all([
      this.one<{ balance: number; revision: number }>(
        'SELECT balance,revision FROM student_wallets WHERE student_id=?',
        id,
      ),
      this.settings(cid),
      this.one<{ n: number }>(
        "SELECT COUNT(*) AS n FROM student_points WHERE student_id=? AND kind='mastery' AND amount>0",
        id,
      ),
    ]);
    return {
      balance: wallet?.balance || 0,
      revision: wallet?.revision || 0,
      earned_words: earned?.n || 0,
      points_per_word: settings.points_per_word,
    };
  }
  async sessionReward(id: string, sid: string) {
    return (await this.one<{ points: number; words: number }>(
      "SELECT coalesce(SUM(amount),0) AS points,COUNT(*) AS words FROM student_points WHERE student_id=? AND session_id=? AND kind='mastery' AND amount>0",
      id,
      sid,
    ))!;
  }
  async history(id: string, cid: string, before = '') {
    const entries = await this.all<PointsEntry>(
      `SELECT id,kind,amount,reason,word_key,created_at FROM student_points WHERE student_id=? ${before ? 'AND rowid < (SELECT rowid FROM student_points WHERE student_id=? AND id=?)' : ''} ORDER BY rowid DESC LIMIT 51`,
      id,
      ...(before ? [id, before] : []),
    );
    return {
      points: await this.summary(id, cid),
      entries: entries.slice(0, 50),
      next: entries.length > 50 ? entries[49].id : null,
    };
  }
  award(id: string, sid: string, word: string, points: number, stamp: string) {
    return this.stmt(
      "INSERT INTO student_points(id,student_id,kind,amount,reason,word_key,session_id,request_id,request_data,created_at) SELECT ?,?,'mastery',?,'首次记熟单词',?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM student_points WHERE student_id=? AND kind='mastery' AND word_key=?)",
      uid(),
      id,
      points,
      word,
      sid,
      'mastery:' + sid + ':' + word,
      '{}',
      stamp,
      id,
      word,
    );
  }
  async adjust(
    student: { id: string; class_id: string; revision: number },
    data: Record<string, unknown>,
  ) {
    const { id, class_id: cid } = student,
      c = await this.classroom(cid);
    const requestId = string(data.request_id, 80, '请求编号');
    if (!/^[a-zA-Z0-9_-]{12,80}$/.test(requestId))
      throw new AppError('请求编号不正确');
    const kind = data.kind;
    if (!['bonus', 'redeem', 'adjustment'].includes(String(kind)))
      throw new AppError('请选择奖励、兑换或设置余额');
    const value = integer(
        data.amount,
        kind === 'adjustment' ? 0 : 1,
        1000000,
        '积分',
      ),
      reason = string(data.reason, 160, '原因');
    const revision = integer(data.revision, 0, 1e9, '积分版本');
    const payload = JSON.stringify({ kind, value, reason, revision });
    const previous = await this.one<{ request_data: string }>(
      'SELECT request_data FROM student_points WHERE student_id=? AND request_id=?',
      id,
      requestId,
    );
    if (previous) {
      if (previous.request_data !== payload)
        throw new AppError('请求编号已使用，请重新操作', 409);
      return this.history(id, cid);
    }
    const wallet = await this.summary(id, cid);
    if (wallet.revision !== revision)
      throw new AppError('积分已变化，请刷新余额后重新确认', 409);
    const amount =
      kind === 'adjustment'
        ? value - wallet.balance
        : kind === 'redeem'
          ? -value
          : value;
    if (wallet.balance + amount < 0) throw new AppError('积分不足，无法兑换');
    if (amount === 0) throw new AppError('余额没有变化');
    try {
      await this.db.batch([
        this.stmt(
          'INSERT INTO mutation_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM classrooms WHERE id=? AND revision=? AND deleted_at IS NULL) THEN 1 ELSE 0 END',
          cid,
          c.revision,
        ),
        this.stmt(
          'INSERT INTO mutation_guard SELECT CASE WHEN coalesce((SELECT revision FROM student_wallets WHERE student_id=?),0)=? AND EXISTS(SELECT 1 FROM students WHERE id=? AND revision=? AND deleted_at IS NULL) THEN 1 ELSE 0 END',
          id,
          revision,
          id,
          student.revision,
        ),
        this.stmt(
          'INSERT INTO student_points(id,student_id,kind,amount,reason,request_id,request_data,created_at) VALUES(?,?,?,?,?,?,?,?)',
          uid(),
          id,
          kind,
          amount,
          reason,
          requestId,
          payload,
          now(),
        ),
        this.stmt('DELETE FROM mutation_guard'),
      ]);
    } catch (e) {
      // A lost response/concurrent identical request is successful exactly once.
      const saved = await this.one<{ request_data: string }>(
        'SELECT request_data FROM student_points WHERE student_id=? AND request_id=?',
        id,
        requestId,
      );
      if (saved?.request_data === payload) return this.history(id, cid);
      if (
        (e instanceof AppError && e.status === 409) ||
        String(e).includes('constraint')
      )
        throw new AppError('积分已变化，请刷新余额后重新确认', 409);
      throw e;
    }
    return this.history(id, cid);
  }
}
