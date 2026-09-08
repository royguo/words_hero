import { Store } from './store';
import { Rewards } from './rewards';
import { phoneticFor } from '../lib/word-presentation';
import {
  AppError,
  integer,
  normalize,
  now,
  string,
  uid,
  type Classroom,
} from './model';
import { passwordHash } from './auth';
import {
  studentAccountDay,
  numberedStudentAccount,
} from '../lib/student-account';
import {
  replayActions,
  newGame,
  scheduleReview,
  shuffled,
  memoryLevel,
  compareMemory,
  MASTERY_STEP,
  type WordReview,
  type StudentDashboard,
  type StudentIdentity,
  type StudentSession,
  type StudyGame,
  type StudyWord,
  type WordMemory,
} from '../lib/student-game';

type StudentRow = StudentIdentity & {
  revision: number;
  auth_version: number;
  phone: string;
  password_hash: string;
};
type SessionRow = {
  id: string;
  student_id: string;
  revision: number;
  data: string;
  status: string;
  completed_at: string | null;
};
const sessionView = (s: SessionRow): StudentSession => ({
  id: s.id,
  revision: s.revision,
  game: JSON.parse(s.data),
  completed_at: s.completed_at,
});
const publicStudent = (s: StudentRow) => ({
  id: s.id,
  class_id: s.class_id,
  name: s.name,
  username: s.username,
  phone: s.phone,
  revision: s.revision,
});
function account(value: unknown) {
  const result = string(value, 32, '账号').toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{5,31}$/.test(result) || result === 'admin')
    throw new AppError('账号需为 6–32 位字母、数字、点、横线或下划线');
  return result;
}
function password(value: unknown) {
  const result = string(value, 100, '密码');
  if (result.length < 6) throw new AppError('密码至少 6 位');
  return result;
}
export class Students extends Store {
  get rewards() {
    return new Rewards(this.db);
  }
  async student(id: string) {
    const s = await this.one<StudentRow>(
      'SELECT s.*,c.name AS class_name FROM students s JOIN classrooms c ON c.id=s.class_id WHERE s.id=? AND s.deleted_at IS NULL AND c.deleted_at IS NULL',
      id,
    );
    if (!s) throw new AppError('学生不存在或已移除', 404);
    return s;
  }
  async list(cid: string) {
    const c = await this.classroom(cid);
    const settings = await this.rewards.settings(cid);
    const rows = await this.all<
      StudentRow & {
        balance: number;
        wallet_revision: number;
        earned_words: number;
      }
    >(
      "SELECT s.id,s.class_id,s.name,s.username,s.phone,s.revision,coalesce(w.balance,0) AS balance,coalesce(w.revision,0) AS wallet_revision,(SELECT COUNT(*) FROM student_points WHERE student_id=s.id AND kind='mastery' AND amount>0) AS earned_words FROM students s LEFT JOIN student_wallets w ON w.student_id=s.id WHERE s.class_id=? AND s.deleted_at IS NULL ORDER BY s.created_at,s.id",
      cid,
    );
    return {
      class_id: c.id,
      class_name: c.name,
      students: rows.map((s) => ({
        ...publicStudent(s),
        points: {
          balance: s.balance,
          revision: s.wallet_revision,
          earned_words: s.earned_words,
          points_per_word: settings.points_per_word,
        },
      })),
      reward_settings: settings,
      next_username: await this.nextUsername(),
    };
  }
  async nextUsername() {
    const day = studentAccountDay();
    const row = await this.one<{ last: number }>(
      "SELECT coalesce(MAX(CAST(substr(username,9) AS INTEGER)),0) AS last FROM students WHERE username GLOB ? AND substr(username,9) NOT GLOB '*[^0-9]*'",
      day + '[0-9][0-9][0-9]*',
    );
    return numberedStudentAccount(day, (row?.last || 0) + 1);
  }
  async create(cid: string, data: Record<string, unknown>) {
    const automatic = data.auto_username === true || !data.username;
    for (let attempt = 0; attempt < 8; attempt++) {
      const c = await this.classroom(cid);
      const username = account(
        automatic ? await this.nextUsername() : data.username,
      );
      const rawPassword = password(data.password || username.slice(-6));
      const row = {
        id: uid(),
        class_id: c.id,
        name: string(data.name, 60, '姓名'),
        username,
        phone: string(data.phone || '', 32, '手机号', true),
        revision: 1,
      };
      const stamp = now();
      try {
        await this.transaction(c, [
          this.stmt(
            'INSERT INTO students(id,class_id,name,username,password_hash,phone,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
            row.id,
            c.id,
            row.name,
            username,
            await passwordHash(rawPassword),
            row.phone,
            stamp,
            stamp,
          ),
        ]);
        return { ...row, generated_password: rawPassword };
      } catch (e) {
        // Unique account + class revision guards serialize concurrent teachers.
        if (
          automatic &&
          (String(e).includes('students.username') ||
            (e instanceof AppError && e.status === 409))
        )
          continue;
        if (String(e).includes('students.username'))
          throw new AppError('账号已使用，请换一个账号', 409);
        throw e;
      }
    }
    throw new AppError('同时创建的学生较多，请重试保存', 409);
  }
  async edit(id: string, data: Record<string, unknown>) {
    const s = await this.student(id),
      c = await this.classroom(s.class_id);
    if (integer(data.revision, 1, 1000000000, '学生版本') !== s.revision)
      throw new AppError('学生资料已更新，请刷新后再编辑', 409);
    const username = account(data.username),
      name = string(data.name, 60, '姓名'),
      phone = string(data.phone || '', 32, '手机号', true);
    const changedPassword = data.password !== undefined && data.password !== '';
    const hash = changedPassword
      ? await passwordHash(password(data.password))
      : s.password_hash;
    try {
      await this.transaction(c, [
        this.stmt(
          'UPDATE students SET name=?,username=?,phone=?,password_hash=?,revision=revision+1,auth_version=auth_version+?,updated_at=? WHERE id=? AND revision=?',
          name,
          username,
          phone,
          hash,
          Number(changedPassword || username !== s.username),
          now(),
          id,
          s.revision,
        ),
      ]);
    } catch (e) {
      if (String(e).includes('students.username'))
        throw new AppError('账号已使用，请换一个账号', 409);
      throw e;
    }
    return publicStudent(await this.student(id));
  }
  async remove(id: string) {
    const s = await this.student(id),
      c = await this.classroom(s.class_id);
    await this.transaction(c, [
      this.stmt(
        'UPDATE students SET deleted_at=?,auth_version=auth_version+1,revision=revision+1 WHERE id=?',
        now(),
        id,
      ),
    ]);
    return { deleted: true };
  }
  /** Only the active, explicitly completed version of each nondeleted lesson contributes. */
  async eligible(cid: string): Promise<StudyWord[]> {
    const courses = (await this.classCourses(cid))
      .filter((l) => l.status === 'completed')
      .sort(
        (a, b) =>
          (b.completed_at || '').localeCompare(a.completed_at || '') ||
          b.version_id.localeCompare(a.version_id),
      );
    const words = new Map<string, StudyWord>();
    for (const course of courses)
      for (const word of course.words) {
        const key = normalize(word.word);
        if (!words.has(key))
          words.set(key, {
            key,
            word: word.display_word || word.word,
            meaning: word.meaning_zh,
            example: word.example,
            example_zh: word.example_zh,
            source_version: course.version_id,
            ...(word.images?.[0]?.src ? { image: word.images[0].src } : {}),
            phonetic: phoneticFor(word),
          });
      }
    return [...words.values()];
  }
  async memories(id: string) {
    return new Map(
      (
        await this.all<{ word_key: string; data: string }>(
          'SELECT word_key,data FROM student_memory WHERE student_id=?',
          id,
        )
      ).map((row) => [row.word_key, JSON.parse(row.data) as WordMemory]),
    );
  }
  async active(id: string, words: StudyWord[]) {
    const s = await this.one<SessionRow>(
      "SELECT * FROM student_sessions WHERE student_id=? AND status='active'",
      id,
    );
    if (!s) return null;
    const game: StudyGame = JSON.parse(s.data),
      current = new Map(words.map((w) => [w.key, w]));
    if (
      game.words.some(
        (w) => current.get(w.key)?.source_version !== w.source_version,
      )
    ) {
      await this.stmt(
        "UPDATE student_sessions SET status='invalidated',updated_at=?,revision=revision+1 WHERE id=? AND status='active' AND revision=?",
        now(),
        s.id,
        s.revision,
      ).run();
      return null;
    }
    return s;
  }
  async dashboard(id: string): Promise<StudentDashboard> {
    const s = await this.student(id),
      words = await this.eligible(s.class_id),
      memory = await this.memories(id);
    const stamp = now(),
      practiced = words.filter((w) => memory.has(w.key)),
      due = practiced.filter((w) => memory.get(w.key)!.due_at <= stamp);
    const active = await this.active(id, words);
    const recent = await this.all<{
      completed_at: string;
      words: number;
      errors: number;
    }>(
      "SELECT completed_at,json_array_length(data,'$.words') AS words,coalesce((SELECT SUM(CAST(value AS INTEGER)) FROM json_each(student_sessions.data,'$.errors')),0) AS errors FROM student_sessions WHERE student_id=? AND status='completed' ORDER BY completed_at DESC LIMIT 8",
      id,
    );
    const count = await this.one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM student_sessions WHERE student_id=? AND status='completed'",
      id,
    );
    const next =
      practiced
        .map((w) => memory.get(w.key)!.due_at)
        .filter((d) => d > stamp)
        .sort()[0] || null;
    return {
      student: {
        id: s.id,
        name: s.name,
        username: s.username,
        class_id: s.class_id,
        class_name: s.class_name,
      },
      total: words.length,
      practiced: practiced.length,
      due: due.length,
      fresh: words.length - practiced.length,
      next_due: next,
      completed_groups: count?.n || 0,
      session: active ? sessionView(active) : null,
      recent,
      mastered: practiced.filter(
        (w) => memoryLevel(memory.get(w.key)) === 'mastered',
      ).length,
      consolidating: practiced.filter(
        (w) => memoryLevel(memory.get(w.key)) === 'consolidating',
      ).length,
      points: await this.rewards.summary(id, s.class_id),
    };
  }
  async history(id: string, before = '') {
    const s = await this.student(id),
      memory = await this.memories(id);
    // Include past words even when a course no longer contributes them to practice.
    const current = new Map(
      (await this.eligible(s.class_id)).map((w) => [w.key, w]),
    );
    const rows = await this.all<{
      id: string;
      completed_at: string;
      words: number;
      errors: number;
    }>(
      `SELECT id,completed_at,json_array_length(data,'$.words') AS words,coalesce((SELECT SUM(CAST(value AS INTEGER)) FROM json_each(student_sessions.data,'$.errors')),0) AS errors FROM student_sessions WHERE student_id=? AND status='completed' ${before ? 'AND rowid < (SELECT rowid FROM student_sessions WHERE id=? AND student_id=?)' : ''} ORDER BY rowid DESC LIMIT 31`,
      id,
      ...(before ? [before, id] : []),
    );
    const archived = [...memory.entries()]
      .filter(([key]) => !current.has(key))
      .map(([key, m]) => ({
        key,
        word: key,
        meaning: '',
        example: '',
        example_zh: '',
        source_version: '',
        available: false,
        memory: m,
      }));
    return {
      words: [...current.values()]
        .map((w) => ({
          ...w,
          available: true,
          memory: memory.get(w.key) || null,
        }))
        .concat(archived),
      archived_count: archived.length,
      recent: rows.slice(0, 30),
      next: rows.length > 30 ? rows[29].id : null,
    };
  }
  async wordHistory(id: string, key: string, before = '') {
    await this.student(id);
    const rows = await this.all<WordReview & { review_id: number }>(
      `SELECT rowid AS review_id,session_id,created_at,errors,step_before,step_after,due_at FROM student_review_history WHERE student_id=? AND word_key=? ${before ? 'AND rowid < ?' : ''} ORDER BY rowid DESC LIMIT 51`,
      id,
      normalize(key),
      ...(before
        ? [integer(Number(before), 1, Number.MAX_SAFE_INTEGER, '历史位置')]
        : []),
    );
    return {
      reviews: rows.slice(0, 50),
      next: rows.length > 50 ? String(rows[49].review_id) : null,
    };
  }
  async points(id: string, before = '') {
    const s = await this.student(id);
    return this.rewards.history(id, s.class_id, before);
  }
  async adjustPoints(id: string, data: Record<string, unknown>) {
    return this.rewards.adjust(await this.student(id), data);
  }
  async start(id: string, data: Record<string, unknown>) {
    const s = await this.student(id),
      c = await this.classroom(s.class_id),
      words = await this.eligible(s.class_id);
    const active = await this.active(id, words);
    if (active) return sessionView(active);
    const count = integer(data.count ?? 10, 1, 20, '每组数量'),
      memory = await this.memories(id),
      stamp = now();
    const eligible = shuffled(words).filter(
      (w) =>
        data.extra === true ||
        !memory.has(w.key) ||
        memory.get(w.key)!.due_at <= stamp,
    );
    eligible.sort((a, b) =>
      compareMemory(memory.get(a.key), memory.get(b.key), stamp),
    );
    const meanings = new Set<string>(),
      selected: StudyWord[] = [];
    for (const w of eligible) {
      const meaning = w.meaning.replace(/\s+/g, '');
      if (meanings.has(meaning)) continue; // Avoid indistinguishable Chinese tiles.
      meanings.add(meaning);
      selected.push(w);
      if (selected.length === count) break;
    }
    if (!selected.length) return null;
    if (
      data.mode !== undefined &&
      (typeof data.mode !== 'string' ||
        !['practice', 'challenge'].includes(data.mode))
    )
      throw new AppError('练习模式不正确');
    const sid = uid(),
      game = newGame(
        selected,
        Math.random,
        data.mode === 'practice' ? 'practice' : 'challenge',
      );
    try {
      await this.db.batch([
        this.guard(c, s),
        this.stmt(
          "INSERT INTO student_sessions(id,student_id,status,data,created_at,updated_at) VALUES(?,?,'active',?,?,?)",
          sid,
          id,
          JSON.stringify(game),
          stamp,
          stamp,
        ),
        this.stmt('DELETE FROM mutation_guard'),
      ]);
    } catch (error) {
      const found = await this.active(id, await this.eligible(s.class_id));
      if (found) return sessionView(found);
      if (String(error).includes('CHECK constraint'))
        throw new AppError('班级资料已更新，请重试', 409);
      throw error;
    }
    return {
      id: sid,
      revision: 1,
      game,
      completed_at: null,
    } satisfies StudentSession;
  }
  guard(c: Classroom, s: StudentRow, session?: SessionRow) {
    return this.stmt(
      `INSERT INTO mutation_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM classrooms c JOIN students s ON s.class_id=c.id WHERE c.id=? AND c.revision=? AND c.deleted_at IS NULL AND s.id=? AND s.revision=? AND s.deleted_at IS NULL) ${session ? "AND EXISTS(SELECT 1 FROM student_sessions WHERE id=? AND revision=? AND status='active')" : ''} THEN 1 ELSE 0 END`,
      c.id,
      c.revision,
      s.id,
      s.revision,
      ...(session ? [session.id, session.revision] : []),
    );
  }
  async act(id: string, sid: string, data: Record<string, unknown>) {
    const s = await this.student(id),
      c = await this.classroom(s.class_id);
    const row = await this.one<SessionRow>(
      'SELECT * FROM student_sessions WHERE id=? AND student_id=?',
      sid,
      id,
    );
    if (!row) throw new AppError('练习不存在', 404);
    const requestId = string(data.request_id, 80, '请求编号');
    if (!/^[a-zA-Z0-9_-]{12,80}$/.test(requestId))
      throw new AppError('请求编号不正确');
    if (data.actions !== undefined && data.action !== undefined)
      throw new AppError('请只提交一组练习操作');
    // Keep the single-action shape for already-open pages during deployment.
    const actions = data.actions ?? [data.action];
    const previous = await this.one<{ data: string }>(
      'SELECT data FROM student_events WHERE session_id=? AND request_id=?',
      sid,
      requestId,
    );
    if (previous) {
      const saved = JSON.parse(previous.data);
      if (
        JSON.stringify(saved.actions ?? [saved.action]) !==
        JSON.stringify(actions)
      )
        throw new AppError('请求编号已使用，请继续最新进度', 409);
      return {
        ...sessionView(row),
        feedback: saved.feedback,
        ...(row.completed_at
          ? { earned: await this.rewards.sessionReward(id, sid) }
          : {}),
      };
    }
    const active = await this.active(id, await this.eligible(s.class_id));
    if (!active || active.id !== sid)
      throw new AppError('班级词表已更新或本组已结束，请返回重新开始', 409);
    if (integer(data.revision, 1, 1000000000, '练习版本') !== row.revision)
      throw new AppError('练习进度已更新，请继续最新进度', 409);
    let game: StudyGame;
    try {
      game = replayActions(JSON.parse(row.data), actions);
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : '练习操作不正确',
      );
    }
    const stamp = now(),
      finished = game.stage === 'done',
      statements: D1PreparedStatement[] = [this.guard(c, s, row)];
    statements.push(
      this.stmt(
        'UPDATE student_sessions SET data=?,revision=revision+1,status=?,updated_at=?,completed_at=? WHERE id=?',
        JSON.stringify(game),
        finished ? 'completed' : 'active',
        stamp,
        finished ? stamp : null,
        sid,
      ),
    );
    statements.push(
      this.stmt(
        'INSERT INTO student_events(session_id,request_id,created_at,data) VALUES(?,?,?,?)',
        sid,
        requestId,
        stamp,
        JSON.stringify({
          actions,
          feedback: game.feedback,
          revision: row.revision + 1,
        }),
      ),
    );
    if (finished) {
      const memory = await this.memories(id),
        settings = await this.rewards.settings(s.class_id);
      for (const word of game.words) {
        const before = memory.get(word.key),
          errors = game.errors[word.key] || 0,
          after = scheduleReview(before, errors, stamp);
        statements.push(
          this.stmt(
            'INSERT INTO student_memory(student_id,word_key,data) VALUES(?,?,?) ON CONFLICT(student_id,word_key) DO UPDATE SET data=excluded.data',
            id,
            word.key,
            JSON.stringify(after),
          ),
          this.stmt(
            'INSERT INTO student_review_history(student_id,session_id,word_key,created_at,errors,step_before,step_after,due_at) VALUES(?,?,?,?,?,?,?,?)',
            id,
            sid,
            word.key,
            stamp,
            errors,
            before?.step ?? null,
            after.step,
            after.due_at,
          ),
        );
        if (!errors && after.step >= MASTERY_STEP)
          statements.push(
            this.rewards.award(
              id,
              sid,
              word.key,
              settings.points_per_word,
              stamp,
            ),
          );
      }
    }
    statements.push(this.stmt('DELETE FROM mutation_guard'));
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (
        String(error).includes('CHECK constraint') ||
        String(error).includes('UNIQUE constraint')
      )
        throw new AppError('进度已更新，请继续最新进度', 409);
      throw error;
    }
    return {
      id: sid,
      revision: row.revision + 1,
      game,
      completed_at: finished ? stamp : null,
      feedback: game.feedback,
      ...(finished
        ? { earned: await this.rewards.sessionReward(id, sid) }
        : {}),
    };
  }
}
