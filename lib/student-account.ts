/** School dates use Asia/Shanghai even when the Worker runs in a different region. */
export function studentAccountDay(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  return ['year', 'month', 'day']
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join('');
}
export function numberedStudentAccount(day: string, sequence: number) {
  if (
    !/^\d{8}$/.test(day) ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    sequence > 999999999
  )
    throw new Error('学生编号不正确');
  return day + String(sequence).padStart(3, '0');
}
/** UI suggestions are confirmed by the server on save, including concurrent edits. */
export function suggestStudentAccount(
  next: string,
  usernames: string[],
  day = studentAccountDay(),
) {
  const sequence = (name: string) =>
    new RegExp('^' + day + '\\d{3,9}$').test(name) ? Number(name.slice(8)) : 0;
  return numberedStudentAccount(
    day,
    Math.max(1, sequence(next), ...usernames.map((name) => sequence(name) + 1)),
  );
}
