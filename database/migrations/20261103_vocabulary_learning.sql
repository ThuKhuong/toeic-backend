BEGIN;

CREATE TABLE IF NOT EXISTS user_vocabulary_learning (
    user_id INTEGER NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    vocab_id INTEGER NOT NULL REFERENCES vocabulary(vocab_id) ON DELETE CASCADE,
    saved BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(16) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'learning', 'known')),
    needs_review BOOLEAN NOT NULL DEFAULT FALSE,
    learned_at TIMESTAMPTZ,
    last_studied_at TIMESTAMPTZ,
    wrong_count INTEGER NOT NULL DEFAULT 0 CHECK (wrong_count >= 0),
    PRIMARY KEY (user_id, vocab_id)
);

CREATE TABLE IF NOT EXISTS vocabulary_study_sessions (
    session_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    scope_key TEXT NOT NULL,
    word_ids INTEGER[] NOT NULL,
    reviewed_ids INTEGER[] NOT NULL DEFAULT '{}',
    known_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS vocabulary_study_active
    ON vocabulary_study_sessions(user_id, scope_key) WHERE completed_at IS NULL;

CREATE TABLE IF NOT EXISTS vocabulary_quiz_sessions (
    session_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    questions JSONB NOT NULL,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS vocabulary_quiz_owner ON vocabulary_quiz_sessions(user_id, created_at DESC);

COMMIT;
