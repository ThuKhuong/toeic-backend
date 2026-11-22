ALTER TABLE questions ADD COLUMN IF NOT EXISTS source_set text;
CREATE UNIQUE INDEX IF NOT EXISTS questions_source_number_unique ON questions (lower(source_set), part_number, order_in_test) WHERE source_set IS NOT NULL AND order_in_test IS NOT NULL;
