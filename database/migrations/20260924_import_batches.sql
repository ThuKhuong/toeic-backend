-- Additive migration. Existing question, user and attempt data is unchanged.
BEGIN;
CREATE TABLE IF NOT EXISTS import_batches (
    batch_id BIGSERIAL PRIMARY KEY,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('reading','listening','vocabulary')),
    fingerprint CHAR(64) NOT NULL,
    row_count INTEGER NOT NULL CHECK (row_count > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(kind, fingerprint)
);
COMMIT;
