BEGIN;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS source_question_number integer;
UPDATE questions SET source_question_number=order_in_test WHERE source_set IS NOT NULL AND source_question_number IS NULL;
DROP INDEX IF EXISTS questions_source_number_unique;
CREATE UNIQUE INDEX questions_source_number_unique ON questions(lower(source_set),part_number,source_question_number) WHERE source_set IS NOT NULL AND source_question_number IS NOT NULL;
COMMIT;
