BEGIN;
ALTER TABLE user_test_attempts ADD COLUMN IF NOT EXISTS elapsed_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_test_attempts ADD COLUMN IF NOT EXISTS current_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_test_attempts ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;
ALTER TABLE user_test_attempts ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;
UPDATE user_test_attempts a SET duration_seconds=COALESCE(t.time_limit,60)*60,
 elapsed_seconds=COALESCE((SELECT SUM(time_spent) FROM user_answers WHERE attempt_id=a.attempt_id),0),
 deadline_at=CASE WHEN t.test_type='full_test' THEN a.start_time + make_interval(mins=>COALESCE(t.time_limit,60)) ELSE NULL END
FROM tests t WHERE t.test_id=a.test_id AND a.duration_seconds IS NULL;
COMMIT;
