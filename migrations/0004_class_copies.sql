-- A retry of the same copy request must not create another classroom.
CREATE TABLE class_copies(
  request_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES classrooms(id),
  class_id TEXT NOT NULL UNIQUE REFERENCES classrooms(id),
  created_at TEXT NOT NULL
);
