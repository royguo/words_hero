import { AppError, levels, normalize, type Word } from './model';
import type { WordStudy } from '../lib/word-study';
import { basicWords } from './worksheet-style';
export function parseCSV(text: unknown, expected: unknown): Word[] {
  if (typeof text !== 'string' || text.length > 10_000_000)
    throw new AppError('CSV 文件过大或格式不正确');
  const rows: string[][] = [],
    row: string[] = [];
  let field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (!quoted && field === '') quoted = true;
      else if (quoted) quoted = false;
      else throw new AppError('CSV 引号格式不正确');
    } else if (ch === ',' && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      field = '';
      if (row.some(Boolean)) rows.push([...row]);
      row.length = 0;
    } else field += ch;
  }
  if (quoted) throw new AppError('CSV 引号没有闭合');
  if (field || row.length) {
    row.push(field.trim());
    rows.push([...row]);
  }
  const header = rows.shift()?.map((x) => x.replace(/^\ufeff/, '')) || [],
    required = [
      'word',
      'level',
      'meaning_zh',
      'pos',
      'topic',
      'difficulty',
      'example',
      'example_zh',
      'cloze',
      'cloze_answer',
      'cloze_zh',
    ];
  if (
    new Set(header).size !== header.length ||
    !required.every((k) => header.includes(k))
  )
    throw new AppError('CSV 缺少必需列或列名重复');
  if (!rows.length || rows.length > 10000)
    throw new AppError('每次导入 1–10000 个词');
  const used = new Set<string>();
  return rows.map((values, i) => {
    const fail = (message: string): never => {
      throw new AppError('CSV 第 ' + (i + 2) + ' 行：' + message);
    };
    if (values.length !== header.length) fail('列数不正确');
    const r = Object.fromEntries(header.map((k, n) => [k, values[n]])),
      word = r.word.toLowerCase(),
      level = r.level.toUpperCase();
    if (
      !levels.includes(level) ||
      (expected && expected !== level) ||
      !/^[a-z][a-z '-]{0,79}$/.test(word)
    )
      fail('词条或级别不正确');
    if (
      required.some((k) => !r[k] || r[k].length > 1000) ||
      !/^[123]$/.test(r.difficulty)
    )
      fail('必填内容缺失或难度不正确');
    const k = level + ':' + word;
    if (used.has(k)) fail('重复词条');
    used.add(k);
    const json = (key: string, fallback: unknown): unknown => {
      try {
        return r[key] ? JSON.parse(r[key]) : fallback;
      } catch {
        fail(key + ' 不是合法 JSON');
      }
    };
    const parts = json('parts_json', []) as Word['parts'];
    if (
      !Array.isArray(parts) ||
      parts.length > 8 ||
      parts.some(
        (p) =>
          !p ||
          typeof p !== 'object' ||
          !['root', 'prefix', 'suffix', 'compound'].includes(p.kind) ||
          !p.text ||
          !p.meaning ||
          Object.values(p).some(
            (v) => typeof v !== 'string' || !v || v.length > 1000,
          ) ||
          Object.keys(p).some(
            (k) => !['text', 'kind', 'meaning', 'story', 'source'].includes(k),
          ),
      )
    )
      fail('构词成分不正确');
    const extra = json('examples_json', []) as NonNullable<
      Word['extra_examples']
    >;
    if (
      !Array.isArray(extra) ||
      extra.length > 4 ||
      extra.some(
        (x) =>
          !x ||
          Object.keys(x).sort().join(',') !== 'en,zh' ||
          Object.values(x).some(
            (v) => typeof v !== 'string' || !v || v.length > 240,
          ),
      )
    )
      fail('补充例句不正确');
    const accepted = [
        word,
        ...(r.accepted || '').split('|').filter(Boolean).map(normalize),
      ],
      cloze_type = r.cloze_type || 'context';
    if (
      !['headword', 'context'].includes(cloze_type) ||
      !accepted.map(normalize).includes(normalize(r.cloze_answer)) ||
      (cloze_type === 'context' &&
        (r.cloze.split('__________').length !== 2 ||
          r.cloze.replace('__________', r.cloze_answer) !== r.example))
    )
      fail('填空题与例句或答案不对应');
    if (
      !['0', '1', ''].includes(r.is_basic || '') ||
      (r.student_prompt || '').length > 240
    )
      fail('基础词或互动提示不正确');
    const study = json('study_json', undefined) as WordStudy | undefined;
    if (study) validateStudy(study);
    return {
      ...r,
      word,
      level,
      display_word: r.display_word || word,
      difficulty: Number(r.difficulty),
      parts,
      extra_examples: extra,
      cloze_type,
      accepted,
      is_basic: r.is_basic === '1' || basicWords.includes(word),
      word_study: study,
      id: 0,
      result: null,
    } as Word;
  });
}
export function validateStudy(s: WordStudy) {
  const fail = () => {
    throw new AppError('word_study 结构不正确，请按 docs/word-study.md 填写');
  };
  const str = (v: unknown, n: number) =>
    typeof v === 'string' && v.trim().length > 0 && v.length <= n;
  if (
    !s ||
    ![1, 2].includes(s.schema_version) ||
    !['simple', 'compound', 'derived', 'inflected', 'phrase'].includes(
      s.formation,
    ) ||
    !str(s.construction, 64) ||
    !str(s.explanation_zh, 100) ||
    (s.origin_zh !== undefined &&
      (typeof s.origin_zh !== 'string' ||
        s.origin_zh.length > (s.schema_version === 2 ? 60 : 100))) ||
    !Array.isArray(s.components) ||
    s.components.length > 4 ||
    (s.formation === 'simple'
      ? s.components.length !== 0
      : s.components.length < 2)
  )
    fail();
  if (
    s.components.some(
      (p) =>
        !p ||
        !str(p.text, 24) ||
        !str(p.meaning_zh, 18) ||
        !['base', 'root', 'prefix', 'suffix', 'word'].includes(p.kind),
    )
  )
    fail();
  if (
    !Array.isArray(s.family) ||
    s.family.length < (s.schema_version === 2 ? 0 : 1) ||
    s.family.length > 2 ||
    s.family.some(
      (f) =>
        !f ||
        !str(f.word, 28) ||
        !str(f.meaning_zh, 20) ||
        !str(f.connection_zh, 55) ||
        ![
          'compound',
          'derivation',
          'shared_root',
          'word_family',
          'phrase',
          'inflection',
          'shared_affix',
        ].includes(f.relation) ||
        !f.example ||
        !str(f.example.en, 90) ||
        !str(f.example.zh, 40),
    )
  )
    fail();
  if (
    !s.challenge ||
    !str(s.challenge.prompt_zh, 100) ||
    !str(s.challenge.answer_zh, 70) ||
    !Array.isArray(s.sources) ||
    s.sources.length <
      (s.schema_version === 1 ||
      s.origin_zh ||
      s.components.length ||
      s.family.length
        ? 1
        : 0) ||
    s.sources.length > 6 ||
    s.sources.some((x) => {
      try {
        const u = new URL(x.url);
        return (
          !str(x.title, 80) ||
          !str(x.url, 300) ||
          u.protocol !== 'https:' ||
          !!u.username ||
          !!u.password
        );
      } catch {
        return true;
      }
    })
  )
    fail();
}
