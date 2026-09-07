import {
  AppError,
  uid,
  now,
  normalize,
  integer,
  string,
  shuffle,
  levels,
  rootGroups,
  type Course,
  type Word,
  type Classroom,
  type LessonRow,
  type Draft,
} from './model';
import { worksheetPlan } from './worksheets';
import { defaults, type Config } from '../lib/classroom';
type Vocab = {
  id: number;
  level: string;
  word: string;
  difficulty: number;
  is_basic: number;
  data?: string;
};
type Seen = {
  word_id: number;
  seen_at: string;
  due_at: string;
  interval_days: number;
  reviews: number;
  result: string;
};
type Pack = {
  word_order: string[];
  words: Word[];
  materials: Course['materials'];
  title: string;
  level: string;
};
export class Store {
  constructor(public db: D1Database) {}
  stmt(sql: string, ...args: unknown[]) {
    return this.db.prepare(sql).bind(...args);
  }
  async all<T>(sql: string, ...args: unknown[]): Promise<T[]> {
    return (await this.stmt(sql, ...args).all<T>()).results;
  }
  async one<T>(sql: string, ...args: unknown[]): Promise<T | null> {
    return this.stmt(sql, ...args).first<T>();
  }
  async classroom(cid: unknown): Promise<Classroom> {
    const c = await this.one<Classroom>(
      'SELECT * FROM classrooms WHERE id=? AND deleted_at IS NULL',
      string(cid, 64, '班级编号'),
    );
    if (!c) throw new AppError('班级不存在或已删除', 404);
    return c;
  }
  async transaction(c: Classroom, queries: D1PreparedStatement[]) {
    try {
      await this.db.batch([
        this.stmt(
          'INSERT INTO mutation_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM classrooms WHERE id=? AND revision=? AND deleted_at IS NULL) THEN 1 ELSE 0 END',
          c.id,
          c.revision,
        ),
        this.stmt('DELETE FROM mutation_guard'),
        ...queries,
        this.stmt('UPDATE classrooms SET revision=revision+1 WHERE id=?', c.id),
      ]);
    } catch (error) {
      if (String(error).includes('CHECK constraint'))
        throw new AppError('课堂已在其他页面更新，请重试。', 409);
      throw error;
    }
  }
  async createClass(data: Record<string, unknown>) {
    const c = {
      id: uid(),
      name: string(data.name, 50, '班级名称'),
      created_at: now(),
    };
    await this.stmt(
      'INSERT INTO classrooms(id,name,created_at) VALUES(?,?,?)',
      c.id,
      c.name,
      c.created_at,
    ).run();
    return c;
  }
  async lesson(lid: string, vid?: string): Promise<Course> {
    const row = await this.one<LessonRow & { class_name: string }>(
      `SELECT l.*,c.name AS class_name FROM lessons l JOIN classrooms c ON c.id=l.class_id WHERE l.id=? AND l.deleted_at IS NULL AND c.deleted_at IS NULL`,
      lid,
    );
    if (!row) throw new AppError('课程不存在或已删除', 404);
    const v = await this.one<{ data: string }>(
      'SELECT data FROM versions WHERE id=? AND lesson_id=?',
      vid || row.active_version,
      lid,
    );
    if (!v) throw new AppError('课程版本不存在', 404);
    const course = JSON.parse(v.data) as Course;
    const current = course.version_id === row.active_version;
    const vs = await this.all<{ id: string; number: number; data: string }>(
      'SELECT id,number,data FROM versions WHERE lesson_id=? ORDER BY number DESC',
      lid,
    );
    const attempts = await this.all<{ data: string }>(
      'SELECT data FROM attempts WHERE version_id=? ORDER BY created_at DESC,rowid DESC',
      course.version_id,
    );
    return {
      ...course,
      id: lid,
      class_name: row.class_name,
      is_current: current,
      read_only: !current || course.status === 'completed',
      versions: vs.map((v) => {
        const d = JSON.parse(v.data) as Course;
        return {
          id: v.id,
          number: v.number,
          created_at: d.created_at,
          status: d.status,
        };
      }),
      attempts: attempts.map((a) => JSON.parse(a.data)),
    };
  }
  async byVersion(vid: string) {
    const r = await this.one<{ lesson_id: string }>(
      'SELECT lesson_id FROM versions WHERE id=?',
      vid,
    );
    if (!r) throw new AppError('课程版本不存在', 404);
    return this.lesson(r.lesson_id, vid);
  }
  async byCode(code: string) {
    const r = await this.one<{ id: string }>(
      'SELECT id FROM versions WHERE code=?',
      code.trim().toUpperCase(),
    );
    if (!r) throw new AppError('课程编号不存在', 404);
    return this.byVersion(r.id);
  }
  async classCourses(cid: string) {
    return (
      await this.all<{ data: string }>(
        `SELECT v.data FROM lessons l JOIN versions v ON v.id=l.active_version WHERE l.class_id=? AND l.deleted_at IS NULL ORDER BY l.number`,
        cid,
      )
    ).map((r) => JSON.parse(r.data) as Course);
  }
  progress(courses: Course[]) {
    const progress = new Map<string, Seen>();
    for (const l of courses
      .filter((l) => l.status === 'completed')
      .sort((a, b) =>
        (a.completed_at || '').localeCompare(b.completed_at || ''),
      ))
      for (const w of l.words) {
        const key = normalize(w.word),
          old = progress.get(key),
          result = w.result || 'again';
        const interval =
          result === 'remembered'
            ? Math.min(30, Math.max(3, (old?.interval_days || 0) * 2))
            : 1;
        const stamp = l.completed_at!;
        progress.set(key, {
          word_id: old?.word_id || w.id,
          seen_at: stamp,
          due_at: new Date(
            Date.parse(stamp) + interval * 86400000,
          ).toISOString(),
          interval_days: interval,
          reviews: (old?.reviews || 0) + 1,
          result,
        });
      }
    return progress;
  }
  async state(cid?: string) {
    const classes = await this.all<Classroom>(
      'SELECT * FROM classrooms WHERE deleted_at IS NULL ORDER BY created_at,rowid',
    );
    const counters = await this.all<{ level: string; total: number }>(
      'SELECT level,COUNT(*) AS total FROM vocabulary GROUP BY level',
    );
    const result = [];
    let courses: Course[] = [],
      progress = new Map<string, Seen>();
    for (const c of classes) {
      const ls = await this.classCourses(c.id),
        p = this.progress(ls);
      result.push({
        id: c.id,
        name: c.name,
        lesson_count: ls.length,
        learned: p.size,
      });
      if (c.id === cid) {
        courses = ls;
        progress = p;
      }
    }
    if (cid && !classes.some((c) => c.id === cid))
      throw new AppError('班级不存在或已删除', 404);
    return {
      classes: result,
      levels: levels.map((id) => ({
        id,
        total: counters.find((c) => c.level === id)?.total || 0,
      })),
      lessons: courses.reverse().map((l) => ({
        id: l.id,
        title: l.title,
        number: l.number,
        status: l.status,
        level: l.level,
        word_count: l.words.length,
        remembered: l.words.filter((w) => w.result === 'remembered').length,
        active_version: l.version_id,
        version_count: l.version_number,
      })),
      learned: progress.size,
      due: [...progress.values()].filter((p) => p.due_at <= now()).length,
      database: 'Cloudflare D1',
    };
  }
  config(data: Record<string, unknown>): Config {
    const c = {
      ...defaults,
      ...Object.fromEntries(
        Object.keys(defaults)
          .filter((k) => k in data)
          .map((k) => [k, data[k]]),
      ),
    };
    if (
      !levels.includes(c.level) ||
      !['new', 'mixed', 'review'].includes(c.mode)
    )
      throw new AppError('词表或模式不正确');
    integer(c.count, 5, 100, '词数');
    integer(c.difficulty_min, 1, 3, '最低难度');
    integer(c.difficulty_max, 1, 3, '最高难度');
    if (
      c.difficulty_min > c.difficulty_max ||
      typeof c.exclude_basic !== 'boolean' ||
      typeof c.exclude_seen !== 'boolean'
    )
      throw new AppError('筛选条件不正确');
    return c;
  }
  async target(cid: string, lid?: string | null) {
    await this.classroom(cid);
    if (!lid) return null;
    const l = await this.lesson(lid);
    if (l.class_id !== cid) throw new AppError('课程不属于当前班级', 403);
    // Regeneration creates a new active version; completed snapshots remain immutable.
    return l;
  }
  async candidates(cid: string, config: Config, lid?: string | null) {
    const courses = await this.classCourses(cid),
      progress = this.progress(courses);
    const reserved = new Set(
      courses
        .filter((l) => l.status === 'active' && l.id !== lid)
        .flatMap((l) => l.words.map((w) => normalize(w.word))),
    );
    const rows = await this.all<Vocab>(
      'SELECT id,level,word,difficulty,is_basic FROM vocabulary WHERE level=? AND difficulty BETWEEN ? AND ? AND (?=0 OR is_basic=0)',
      config.level,
      config.difficulty_min,
      config.difficulty_max,
      Number(config.exclude_basic),
    );
    return rows
      .filter((r) => !reserved.has(normalize(r.word)))
      .map((r) => ({
        ...r,
        due_at: progress.get(normalize(r.word))?.due_at || null,
      }));
  }
  async pool(data: Record<string, unknown>) {
    const cid = string(data.class_id, 64, '班级编号'),
      lid = data.lesson_id as string | undefined;
    await this.target(cid, lid);
    const c = this.config(data),
      rows = await this.candidates(cid, c, lid),
      fresh = rows.filter((r) => !r.due_at),
      due = rows.filter((r) => r.due_at && r.due_at <= now());
    return {
      available:
        c.mode === 'review'
          ? due.length
          : c.mode === 'mixed'
            ? fresh.length + due.length
            : c.exclude_seen
              ? fresh.length
              : rows.length,
      new: fresh.length,
      due: due.length,
    };
  }
  async words(ids: number[]) {
    if (!ids.length) return [];
    const rs = await this.all<{ id: number; data: string }>(
      `SELECT id,data FROM vocabulary WHERE id IN (${ids.map(() => '?').join(',')})`,
      ...ids,
    );
    const map = new Map(
      rs.map((r) => [
        r.id,
        { ...JSON.parse(r.data), id: r.id, result: null } as Word,
      ]),
    );
    return ids.map((id) => {
      const w = map.get(id);
      if (!w) throw new AppError('单词不存在，请重新搜索');
      return w;
    });
  }
  async preview(data: Record<string, unknown>) {
    const cid = string(data.class_id, 64, '班级编号'),
      c = await this.classroom(cid),
      lid = (data.lesson_id || null) as string | null;
    const previous = await this.target(cid, lid),
      config = this.config(data),
      title = string(data.title ?? '', 80, '课程名称', true);
    const rows = shuffle(await this.candidates(cid, config, lid));
    const old = new Set(previous?.words.map((w) => w.id) || []);
    rows.sort((a, b) => Number(old.has(a.id)) - Number(old.has(b.id)));
    const fresh = rows.filter((r) => !r.due_at),
      due = rows.filter((r) => r.due_at && r.due_at <= now());
    let chosen;
    if (config.mode === 'review') chosen = due.slice(0, config.count);
    else if (config.mode === 'mixed') {
      const n = Math.min(due.length, Math.max(1, Math.floor(config.count / 5)));
      chosen = [...due.slice(0, n), ...fresh.slice(0, config.count - n)];
      chosen.push(...due.slice(n, n + config.count - chosen.length));
    } else chosen = (config.exclude_seen ? fresh : rows).slice(0, config.count);
    const stamp = now(),
      draft: Draft = {
        id: uid(),
        class_id: cid,
        lesson_id: lid,
        base_version_id: previous?.version_id || null,
        config,
        title,
        words: await this.words(shuffle(chosen).map((w) => w.id)),
        revision: 1,
        created_at: stamp,
        updated_at: stamp,
        committed_version: null,
      };
    await this.transaction(c, [
      this.stmt(
        'INSERT INTO drafts VALUES(?,?,?,?,?)',
        draft.id,
        cid,
        lid,
        JSON.stringify(draft),
        stamp,
      ),
    ]);
    return draft;
  }
  async readDraft(did: string) {
    const r = await this.one<{ data: string }>(
      'SELECT data FROM drafts WHERE id=?',
      did,
    );
    if (!r) throw new AppError('选词草稿不存在', 404);
    const d = JSON.parse(r.data) as Draft;
    await this.classroom(d.class_id);
    return d;
  }
  async latestDraft(cid: string, lid?: string) {
    const previous = await this.target(cid, lid);
    const r = await this.one<{ data: string }>(
      'SELECT data FROM drafts WHERE class_id=? AND lesson_id IS ? ORDER BY updated_at DESC,rowid DESC LIMIT 1',
      cid,
      lid || null,
    );
    if (!r) return { draft: null };
    const d = JSON.parse(r.data) as Draft;
    return {
      draft:
        d.committed_version ||
        (previous && d.base_version_id !== previous.version_id)
          ? null
          : d,
    };
  }
  async editable(d: Draft, data: Record<string, unknown>) {
    if (d.committed_version) throw new AppError('词单已创建课程', 409);
    if (integer(data.revision, 1, 1e10, '草稿版本') !== d.revision)
      throw new AppError('词单已在其他页面修改，请刷新', 409);
    const l = await this.target(d.class_id, d.lesson_id);
    if (l && l.version_id !== d.base_version_id)
      throw new AppError('课程已有新版本，请重新选词', 409);
  }
  async patchDraft(did: string, data: Record<string, unknown>) {
    const initial = await this.readDraft(did),
      c = await this.classroom(initial.class_id),
      d = await this.readDraft(did);
    await this.editable(d, data);
    const ids = data.word_ids;
    if (!Array.isArray(ids) || ids.length > 100)
      throw new AppError('最多选择 100 个单词');
    ids.forEach((id) => integer(id, 1, 1e10, '单词编号'));
    if (new Set(ids).size !== ids.length) throw new AppError('单词不能重复');
    const old = new Map(d.words.map((w) => [w.id, w]));
    const words = (await this.words(ids)).map((w) => old.get(w.id) || w);
    if (new Set(words.map((w) => normalize(w.word))).size !== words.length)
      throw new AppError('跨词库的同一英文单词只需选择一次');
    Object.assign(d, { words, revision: d.revision + 1, updated_at: now() });
    await this.transaction(c, [
      this.stmt(
        'UPDATE drafts SET data=?,updated_at=? WHERE id=?',
        JSON.stringify(d),
        d.updated_at,
        did,
      ),
    ]);
    return d;
  }
  async makeVersion(
    c: Classroom,
    d: Draft,
    materials?: Course['materials'],
    preserve?: Course,
  ) {
    if (!d.words.length) throw new AppError('请至少选择一个单词');
    const previous = d.lesson_id ? await this.lesson(d.lesson_id) : null;
    const lid = d.lesson_id || uid(),
      vid = uid(),
      stamp = now();
    const n =
      previous?.number ||
      (await this.one<{ n: number }>(
        'SELECT COALESCE(MAX(number),0)+1 AS n FROM lessons WHERE class_id=?',
        c.id,
      ))!.n;
    const vn = previous
      ? (await this.one<{ n: number }>(
          'SELECT MAX(number)+1 AS n FROM versions WHERE lesson_id=?',
          lid,
        ))!.n
      : 1;
    const title = d.title || '第 ' + String(n).padStart(2, '0') + ' 课',
      groups = rootGroups(d.words),
      progress = this.progress(await this.classCourses(c.id));
    const order = preserve?.config.worksheet_order || {
      english_to_chinese: shuffle(d.words.map((w) => w.id)),
      chinese_to_english: shuffle(d.words.map((w) => w.id)),
    };
    const sourceLevels = levels.filter((level) =>
      d.words.some((w) => w.level === level),
    );
    const course: Course = {
      id: lid,
      class_id: c.id,
      class_name: c.name,
      number: n,
      title,
      level: sourceLevels.join(' + '),
      version_id: vid,
      version_number: vn,
      course_code: 'WG-' + uid().slice(0, 10).toUpperCase(),
      materials: materials || {},
      status: 'active',
      is_current: true,
      read_only: false,
      created_at: stamp,
      completed_at: null,
      stage: 'preview',
      cursor: 0,
      notes: preserve?.notes || '',
      draft: {},
      words: d.words.map((w) => ({ ...w, result: preserve ? w.result : null })),
      groups,
      config: {
        ...d.config,
        count: d.words.length,
        requested_count: d.config.count,
        new_count: d.words.filter((w) => !progress.has(normalize(w.word)))
          .length,
        review_count: d.words.filter((w) => progress.has(normalize(w.word)))
          .length,
        worksheet_order: order,
        worksheets: worksheetPlan(d.words, order),
        root_groups: groups,
        materials: materials || {},
        materials_version: '2026-09-v3',
        source_levels: sourceLevels,
        selection_confirmed: true,
      },
    };
    const queries: D1PreparedStatement[] = [];
    if (!previous)
      queries.push(
        this.stmt(
          'INSERT INTO lessons(id,class_id,number,title,created_at,active_version) VALUES(?,?,?,?,?,?)',
          lid,
          c.id,
          n,
          title,
          stamp,
          vid,
        ),
      );
    queries.push(
      this.stmt(
        'INSERT INTO versions VALUES(?,?,?,?,?)',
        vid,
        lid,
        vn,
        course.course_code,
        JSON.stringify(course),
      ),
    );
    queries.push(
      this.stmt('UPDATE lessons SET active_version=? WHERE id=?', vid, lid),
    );
    return { course, queries };
  }
  async confirm(did: string, data: Record<string, unknown>) {
    const initial = await this.readDraft(did);
    if (initial.committed_version)
      return this.byVersion(initial.committed_version);
    const c = await this.classroom(initial.class_id),
      d = await this.readDraft(did);
    if (d.committed_version) return this.byVersion(d.committed_version);
    await this.editable(d, data);
    const reserved = new Set(
      (await this.classCourses(c.id))
        .filter((l) => l.status === 'active' && l.id !== d.lesson_id)
        .flatMap((l) => l.words.map((w) => normalize(w.word))),
    );
    if (d.words.some((w) => reserved.has(normalize(w.word))))
      throw new AppError(
        '词单中的单词已被另一节进行中的课使用，请删去冲突词后确认。',
        409,
      );
    const { course, queries } = await this.makeVersion(c, d);
    d.committed_version = course.version_id;
    d.updated_at = now();
    queries.push(
      this.stmt(
        'UPDATE drafts SET data=?,updated_at=? WHERE id=?',
        JSON.stringify(d),
        d.updated_at,
        did,
      ),
    );
    try {
      await this.transaction(c, queries);
    } catch (e) {
      const latest = await this.readDraft(did);
      if (latest.committed_version)
        return this.byVersion(latest.committed_version);
      throw e;
    }
    return this.lesson(course.id);
  }
  async vocabulary(level: string, q: string, offset: number, cid?: string) {
    if (![...levels, 'ALL'].includes(level))
      throw new AppError('词表范围不正确');
    if (cid) await this.classroom(cid);
    const courses = cid ? await this.classCourses(cid) : [],
      seen = this.progress(courses),
      reserved = new Set(
        courses
          .filter((l) => l.status === 'active')
          .flatMap((l) => l.words.map((w) => normalize(w.word))),
      );
    const search = '%' + q.replace(/[\\%_]/g, (x) => '\\' + x) + '%';
    const rows = await this.all<{ id: number; data: string }>(
      `SELECT id,data FROM vocabulary WHERE (?='ALL' OR level=?) AND (word LIKE ? ESCAPE '\\' OR json_extract(data,'$.meaning_zh') LIKE ? ESCAPE '\\') ORDER BY CASE WHEN word=? COLLATE NOCASE THEN 0 ELSE 1 END,word,level LIMIT 40 OFFSET ?`,
      level,
      level,
      search,
      search,
      q,
      offset,
    );
    return rows.map((r) => {
      const w = JSON.parse(r.data) as Word;
      return {
        ...w,
        id: r.id,
        seen: seen.has(normalize(w.word)),
        reserved: reserved.has(normalize(w.word)),
      };
    });
  }
  validateAnswers(
    l: Course,
    value: unknown,
    partial = false,
  ): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new AppError('答案格式不正确');
    const answers = value as Record<string, string>,
      keys = new Set(l.words.map((w) => String(w.id)));
    if (
      Object.entries(answers).some(
        ([k, v]) => !keys.has(k) || typeof v !== 'string' || v.length > 200,
      ) ||
      (!partial && Object.keys(answers).length !== keys.size)
    )
      throw new AppError('请提交本课完整的练习答案');
    return answers;
  }
  saveQuery(l: Course) {
    const { versions, attempts, ...snapshot } = l;
    void versions;
    void attempts;
    return this.stmt(
      'UPDATE versions SET data=? WHERE id=?',
      JSON.stringify(snapshot),
      l.version_id,
    );
  }
  async patch(vid: string, data: Record<string, unknown>) {
    // Retry only an optimistic conflict. Re-read before merging so another tab's notes are retained.
    for (let tries = 0; ; tries++) {
      const initial = await this.byVersion(vid),
        c = await this.classroom(initial.class_id),
        l = await this.byVersion(vid);
      if (l.read_only) throw new AppError('此版本已归档');
      if ('stage' in data) {
        if (
          !['preview', 'roots', 'scenes', 'practice', 'workbook'].includes(
            data.stage as string,
          )
        )
          throw new AppError('课堂步骤不正确');
        l.stage = data.stage as string;
      }
      if ('presentation_slide' in data) {
        if (
          typeof data.presentation_slide !== 'string' ||
          !/^[a-z0-9:_-]{1,100}$/.test(data.presentation_slide)
        )
          throw new AppError('讲课页码格式不正确');
        l.config.presentation_slide = data.presentation_slide;
      }
      if ('cursor' in data)
        l.cursor = integer(data.cursor, 0, l.words.length - 1, '卡片序号');
      if ('notes' in data) l.notes = string(data.notes, 5000, '课堂笔记', true);
      if ('draft' in data) l.draft = this.validateAnswers(l, data.draft, true);
      if ('word_id' in data) {
        const w = l.words.find((w) => w.id === data.word_id);
        if (
          !w ||
          !['remembered', 'again', null].includes(data.result as string | null)
        )
          throw new AppError('单词或掌握情况不正确');
        w.result = data.result as Word['result'];
      }
      try {
        await this.transaction(c, [this.saveQuery(l)]);
        return this.byVersion(vid);
      } catch (e) {
        if (!(e instanceof AppError) || e.status !== 409 || tries >= 2) throw e;
      }
    }
  }
  async complete(vid: string) {
    const initial = await this.byVersion(vid),
      c = await this.classroom(initial.class_id),
      l = await this.byVersion(vid);
    if (!l.is_current) throw new AppError('旧版本不能结课');
    if (l.status === 'completed') return l;
    l.status = 'completed';
    l.completed_at = now();
    l.words = l.words.map((w) => ({ ...w, result: w.result || 'again' }));
    await this.transaction(c, [this.saveQuery(l)]);
    return this.byVersion(vid);
  }
  async attempt(vid: string, data: Record<string, unknown>) {
    const initial = await this.byVersion(vid),
      c = await this.classroom(initial.class_id),
      l = await this.byVersion(vid),
      answers = this.validateAnswers(l, data.answers);
    const checks = l.words.map((w) => ({
      id: w.id,
      word: w.word,
      answer: answers[w.id],
      correct: (w.accepted || [w.word])
        .map(normalize)
        .includes(normalize(answers[w.id])),
    }));
    const attempt = {
      id: uid(),
      created_at: now(),
      correct: checks.filter((x) => x.correct).length,
      total: checks.length,
      data: checks,
    };
    const queries = [
      this.stmt(
        'INSERT INTO attempts VALUES(?,?,?,?)',
        attempt.id,
        vid,
        attempt.created_at,
        JSON.stringify(attempt),
      ),
    ];
    if (!l.read_only) {
      l.words = l.words.map((w) => ({
        ...w,
        result: checks.find((x) => x.id === w.id)!.correct
          ? 'remembered'
          : 'again',
      }));
      l.draft = answers;
      queries.push(this.saveQuery(l));
    }
    await this.transaction(c, queries);
    return this.byVersion(vid);
  }
  async deleteLesson(lid: string) {
    const initial = await this.lesson(lid),
      c = await this.classroom(initial.class_id);
    await this.transaction(c, [
      this.stmt('UPDATE lessons SET deleted_at=? WHERE id=?', now(), lid),
    ]);
    return { deleted: true, assets_preserved: true };
  }
  async deleteClass(cid: string) {
    const c = await this.classroom(cid);
    await this.transaction(c, [
      this.stmt('UPDATE classrooms SET deleted_at=? WHERE id=?', now(), cid),
    ]);
    return { deleted: true, assets_preserved: true };
  }
  async brief(code: string) {
    const l = await this.byCode(code);
    return {
      schema_version: 2,
      course_code: l.course_code,
      level: l.level,
      word_order: l.words.map((w) => w.word),
      instructions:
        '阅读 AGENTS.md 与 docs/word-study.md。保持词单、词义与顺序。用 word_study schema_version=2；只教容易理解且有助记忆的构词联系。origin_zh 可省略或留空，只有有趣、可靠且帮助记忆的背景才用一两句说明（最多60字），不要罗列古语拼写或生僻词源。可靠出处留在 sources 中。新增素材版本，经 validate 后应用本课编号。',
      words: l.words.map(
        ({
          word,
          level,
          meaning_zh,
          pos,
          difficulty,
          example,
          example_zh,
          extra_examples,
          parts,
          word_study,
          asset_id,
        }) => ({
          word,
          level,
          meaning_zh,
          pos,
          difficulty,
          example,
          example_zh,
          extra_examples,
          parts,
          word_study,
          asset_id,
        }),
      ),
      materials: l.materials,
    };
  }
  async applyPack(code: string, packId: string) {
    const initial = await this.byCode(code),
      c = await this.classroom(initial.class_id),
      l = await this.byCode(code);
    if (l.read_only) throw new AppError('请使用未结课的当前版本课程编号', 409);
    const row = await this.one<{ data: string }>(
      'SELECT data FROM content_packs WHERE id=?',
      packId,
    );
    if (!row) throw new AppError('素材包尚未发布', 404);
    const p = JSON.parse(row.data) as Pack;
    if (l.materials.bundle_digest === p.materials.bundle_digest) return l;
    if (
      JSON.stringify(p.word_order) !==
      JSON.stringify(l.words.map((w) => w.word))
    )
      throw new AppError('素材包词单或顺序不同');
    const words = l.words.map((w, i) => {
      if (p.words[i].level !== w.level) throw new AppError('素材包级别不同');
      return { ...w, ...p.words[i], id: w.id, result: w.result };
    });
    const d: Draft = {
      id: uid(),
      class_id: c.id,
      lesson_id: l.id,
      base_version_id: l.version_id,
      title: l.title,
      config: l.config,
      words,
      revision: 1,
      created_at: now(),
      updated_at: now(),
      committed_version: null,
    };
    const { course, queries } = await this.makeVersion(c, d, p.materials, l);
    await this.transaction(c, queries);
    return this.lesson(course.id);
  }
  async backup() {
    const tables = [
      'classrooms',
      'lessons',
      'versions',
      'drafts',
      'attempts',
      'students',
      'student_memory',
      'student_sessions',
      'student_events',
      'meta',
    ];
    const result: Record<string, unknown> = {
      format: 'kite-words-backup-v1',
      created_at: now(),
      note: '课堂 JSON 备份；词库和素材独立保存在 Git / R2。',
    };
    for (const t of tables) result[t] = await this.all('SELECT * FROM ' + t);
    return result;
  }
}
