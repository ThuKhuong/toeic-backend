-- Safe rollback ONLY before evidence collection. Archive/restore is required once data exists.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM learning_events) OR EXISTS(SELECT 1 FROM learning_answer_revisions)
 OR EXISTS(SELECT 1 FROM learning_answer_observations) OR EXISTS(SELECT 1 FROM learning_kc_mapping_versions)
 OR EXISTS(SELECT 1 FROM learning_attempt_sync) THEN
  RAISE EXCEPTION 'Refusing rollback: learning data exists. Back up and retain evidence; use a reviewed recovery plan.';
 END IF;
END $$;
DROP TRIGGER learning_answer_revision_capture ON user_answers;
DROP FUNCTION learning_capture_answer_revision();
DROP VIEW bkt_ready_observations;
DROP TABLE learning_answer_observations;
DROP TABLE learning_events;
DROP TABLE learning_answer_revisions;
DROP TABLE learning_attempt_sync;
DROP TABLE learning_kc_mapping_versions;
DROP FUNCTION learning_protect_mapping();
DROP FUNCTION learning_append_only();
COMMIT;
