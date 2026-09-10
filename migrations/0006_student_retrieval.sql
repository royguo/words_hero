-- Append evidence for future reviews; old classroom, memory and points records remain intact.
ALTER TABLE student_review_history ADD COLUMN evidence TEXT NOT NULL DEFAULT '{}';
