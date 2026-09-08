import type { Course } from './model';

/** Copy teaching content; public asset IDs/URLs remain shared and unchanged. */
export function resetCourseForCopy(
  source: Course,
  target: {
    classId: string;
    className: string;
    lessonId: string;
    versionId: string;
    code: string;
    createdAt: string;
  },
): Course {
  const copy = structuredClone(source);
  delete copy.versions;
  delete copy.attempts;
  delete copy.config.presentation_slide;
  copy.config.new_count = copy.words.length;
  copy.config.review_count = 0;
  return {
    ...copy,
    id: target.lessonId,
    class_id: target.classId,
    class_name: target.className,
    version_id: target.versionId,
    version_number: 1,
    course_code: target.code,
    created_at: target.createdAt,
    completed_at: null,
    status: 'active',
    is_current: true,
    read_only: false,
    stage: 'preview',
    cursor: 0,
    notes: '',
    draft: {},
    words: copy.words.map((word) => {
      delete word.seen;
      delete word.reserved;
      return { ...word, result: null };
    }),
  };
}
