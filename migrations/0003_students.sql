-- Student identity and personal memory are independent of reusable media assets.
CREATE TABLE students (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classrooms(id),
  name TEXT NOT NULL,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  auth_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_students_class ON students(class_id,deleted_at);
CREATE TABLE student_memory (
  student_id TEXT NOT NULL REFERENCES students(id),
  word_key TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY(student_id,word_key)
);
CREATE TABLE student_sessions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  status TEXT NOT NULL CHECK(status IN ('active','completed','invalidated')),
  revision INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE UNIQUE INDEX idx_one_active_session ON student_sessions(student_id) WHERE status='active';
CREATE INDEX idx_student_session_history ON student_sessions(student_id,completed_at);
CREATE TABLE student_events (
  session_id TEXT NOT NULL REFERENCES student_sessions(id),
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY(session_id,request_id)
);
INSERT INTO meta(key,value) VALUES('student_schema_version','1');
