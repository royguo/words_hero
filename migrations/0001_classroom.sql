-- Independent classroom records; assets are kept in R2 and never cascade-delete.
CREATE TABLE classrooms(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,deleted_at TEXT);
CREATE TABLE lessons(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classrooms(id),number INTEGER NOT NULL,title TEXT NOT NULL,created_at TEXT NOT NULL,active_version TEXT,deleted_at TEXT,UNIQUE(class_id,number));
CREATE TABLE versions(id TEXT PRIMARY KEY,lesson_id TEXT NOT NULL REFERENCES lessons(id),number INTEGER NOT NULL,code TEXT NOT NULL UNIQUE,data TEXT NOT NULL,UNIQUE(lesson_id,number));
CREATE TABLE drafts(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classrooms(id),lesson_id TEXT REFERENCES lessons(id),data TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE attempts(id TEXT PRIMARY KEY,version_id TEXT NOT NULL REFERENCES versions(id),created_at TEXT NOT NULL,data TEXT NOT NULL);
CREATE TABLE vocabulary(id INTEGER PRIMARY KEY,level TEXT NOT NULL,word TEXT NOT NULL,difficulty INTEGER NOT NULL,is_basic INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(level,word));
CREATE TABLE content_packs(id TEXT PRIMARY KEY,digest TEXT NOT NULL,data TEXT NOT NULL);
CREATE TABLE mutation_guard(ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE INDEX idx_vocab_scope ON vocabulary(level,difficulty,is_basic);
CREATE INDEX idx_vocab_word ON vocabulary(word);
CREATE INDEX idx_lesson_class ON lessons(class_id,deleted_at);
CREATE INDEX idx_version_lesson ON versions(lesson_id);
CREATE INDEX idx_draft_class ON drafts(class_id,lesson_id,updated_at);
CREATE INDEX idx_attempt_version ON attempts(version_id,created_at);
INSERT INTO meta VALUES('schema_version','1');
