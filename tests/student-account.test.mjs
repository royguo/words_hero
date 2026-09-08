import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(
  readFileSync(new URL('../lib/student-account.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { studentAccountDay, numberedStudentAccount, suggestStudentAccount } =
  await import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  );
void test('daily account sequence uses Shanghai midnight, with three digits and overflow', () => {
  assert.equal(studentAccountDay(new Date('2026-08-05T15:59:59Z')), '20260805');
  assert.equal(studentAccountDay(new Date('2026-08-05T16:00:00Z')), '20260806');
  assert.equal(numberedStudentAccount('20260806', 1), '20260806001');
  assert.equal(numberedStudentAccount('20260806', 1000), '202608061000');
});
void test('new rows use the global next number and locally added rows, resetting on a new day', () => {
  assert.equal(
    suggestStudentAccount('20260806003', ['kd1234567890'], '20260806'),
    '20260806003',
  );
  assert.equal(
    suggestStudentAccount(
      '20260806003',
      ['20260806003', '20260806004'],
      '20260806',
    ),
    '20260806005',
  );
  assert.equal(
    suggestStudentAccount('20260806099', ['20260806099'], '20260807'),
    '20260807001',
  );
});
