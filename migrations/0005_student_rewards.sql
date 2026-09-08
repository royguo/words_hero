-- Personal learning history and points never belong to reusable teaching assets.
CREATE TABLE student_review_history (
  student_id TEXT NOT NULL REFERENCES students(id),
  session_id TEXT NOT NULL REFERENCES student_sessions(id),
  word_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  errors INTEGER NOT NULL,
  step_before INTEGER,
  step_after INTEGER NOT NULL,
  due_at TEXT NOT NULL,
  PRIMARY KEY(session_id,word_key)
);
CREATE INDEX idx_review_student_word ON student_review_history(student_id,word_key,created_at);
CREATE TABLE reward_settings (
  class_id TEXT PRIMARY KEY REFERENCES classrooms(id),
  points_per_word INTEGER NOT NULL CHECK(points_per_word BETWEEN 0 AND 1000),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE student_wallets (
  student_id TEXT PRIMARY KEY REFERENCES students(id),
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE student_points (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  kind TEXT NOT NULL CHECK(kind IN ('mastery','bonus','redeem','adjustment')),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  word_key TEXT,
  session_id TEXT REFERENCES student_sessions(id),
  request_id TEXT NOT NULL,
  request_data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(student_id,request_id)
);
CREATE UNIQUE INDEX idx_points_first_mastery ON student_points(student_id,word_key) WHERE kind='mastery';
CREATE INDEX idx_points_student_history ON student_points(student_id,created_at);
-- The ledger insert and balance change succeed or roll back together, including
-- two simultaneous redemptions. Replayed inserts cannot credit the balance twice.
CREATE TRIGGER student_points_balance AFTER INSERT ON student_points BEGIN
  INSERT INTO student_wallets(student_id,balance,revision) VALUES(NEW.student_id,0,0)
  ON CONFLICT(student_id) DO NOTHING;
  UPDATE student_wallets SET balance=balance+NEW.amount,revision=revision+1 WHERE student_id=NEW.student_id;
END;
