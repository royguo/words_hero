-- Keep large immutable lesson packs below D1's per-statement SQL limit.
-- Public word snapshots remain independent of classroom and student records.
CREATE TABLE content_pack_words(
  pack_id TEXT NOT NULL REFERENCES content_packs(id),
  position INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY(pack_id,position)
);
CREATE INDEX idx_content_pack_words_pack ON content_pack_words(pack_id,position);
