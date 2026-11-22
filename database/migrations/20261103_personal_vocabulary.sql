BEGIN;
ALTER TABLE vocabulary_topics ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES "User"(user_id) ON DELETE CASCADE;
ALTER TABLE vocabulary ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES "User"(user_id) ON DELETE CASCADE;
ALTER TABLE vocabulary_topics DROP CONSTRAINT IF EXISTS vocabulary_topics_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS vocabulary_topics_personal_name
    ON vocabulary_topics(owner_user_id, lower(name)) WHERE owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vocabulary_topics_legacy_name
    ON vocabulary_topics(name) WHERE owner_user_id IS NULL;
CREATE INDEX IF NOT EXISTS vocabulary_personal_owner ON vocabulary(owner_user_id, topic_id);

-- Existing quizzes retain their history but cannot enter the personal learning flow.
ALTER TABLE vocabulary_quiz_sessions ADD COLUMN IF NOT EXISTS is_personal BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vocabulary_quiz_sessions ALTER COLUMN is_personal SET DEFAULT TRUE;
COMMIT;
