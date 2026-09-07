import { Store } from './store';
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
  advanceGame,
  newGame,
  scheduleReview,
  shuffled,
  type GameAction,
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
    const rows = await this.all<StudentRow>(
      'SELECT id,class_id,name,username,phone,revision FROM students WHERE class_id=? AND deleted_at IS NULL ORDER BY created_at,id',
      cid,
    );
    return {
      class_id: c.id,
      class_name: c.name,
      students: rows.map(publicStudent),
    };
  }
  async create(cid: string, data: Record<string, unknown>) {
    const c = await this.classroom(cid);
    const digits = [...crypto.getRandomValues(new Uint32Array(2))]
      .map((n) => String(n % 100000).padStart(5, '0'))
      .join('');
    const username = account(data.username || 'kd' + digits);
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
    } catch (e) {
      if (String(e).includes('students.username'))
        throw new AppError('账号已使用，请换一个账号', 409);
      throw e;
    }
    return { ...row, generated_password: rawPassword };
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
    };
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
    eligible.sort((a, b) => {
      const ma = memory.get(a.key),
        mb = memory.get(b.key);
      const priority = (m: WordMemory | undefined) =>
        !m ? 1 : m.due_at <= stamp ? 0 : 2;
      return (
        priority(ma) - priority(mb) ||
        (ma && mb ? ma.due_at.localeCompare(mb.due_at) : 0)
      );
    });
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
    const sid = uid(),
      game = newGame(selected);
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
    const previous = await this.one<{ data: string }>(
      'SELECT data FROM student_events WHERE session_id=? AND request_id=?',
      sid,
      requestId,
    );
    if (previous)
      return {
        ...sessionView(row),
        feedback: JSON.parse(previous.data).feedback,
      };
    const active = await this.active(id, await this.eligible(s.class_id));
    if (!active || active.id !== sid)
      throw new AppError('班级词表已更新或本组已结束，请返回重新开始', 409);
    if (integer(data.revision, 1, 1000000000, '练习版本') !== row.revision)
      throw new AppError('练习进度已更新，请继续最新进度', 409);
    if (
      !data.action ||
      typeof data.action !== 'object' ||
      Array.isArray(data.action)
    )
      throw new AppError('练习操作不正确');
    let game: StudyGame;
    try {
      game = advanceGame(JSON.parse(row.data), data.action as GameAction);
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
          action: data.action,
          feedback: game.feedback,
          revision: row.revision + 1,
        }),
      ),
    );
    if (finished) {
      const memory = await this.memories(id);
      for (const word of game.words)
        statements.push(
          this.stmt(
            'INSERT INTO student_memory(student_id,word_key,data) VALUES(?,?,?) ON CONFLICT(student_id,word_key) DO UPDATE SET data=excluded.data',
            id,
            word.key,
            JSON.stringify(
              scheduleReview(
                memory.get(word.key),
                game.errors[word.key] || 0,
                stamp,
              ),
            ),
          ),
        );
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
    };
  }
}
