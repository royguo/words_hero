-- Metadata indexes independent reusable R2 objects; no class/lesson foreign keys.
CREATE TABLE audio_index(key TEXT PRIMARY KEY,file TEXT NOT NULL,bytes INTEGER NOT NULL,request TEXT NOT NULL);
