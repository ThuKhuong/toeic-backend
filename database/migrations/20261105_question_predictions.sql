-- Predictions are committed with a new attempt, before answers can be accepted.
ALTER TABLE user_test_attempts ADD COLUMN IF NOT EXISTS question_predictions jsonb;
COMMENT ON COLUMN user_test_attempts.question_predictions IS
  'Experimental tag-free v3 predictions frozen before the attempt is exposed; app observation only, not used for grading or recommendations.';
