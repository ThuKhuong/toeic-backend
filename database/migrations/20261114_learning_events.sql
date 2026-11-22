-- Additive migration. Run only with the guarded migration runner after a backup.
BEGIN;
CREATE TABLE IF NOT EXISTS learning_events (
  event_id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES "User"(user_id),
  attempt_id INTEGER REFERENCES user_test_attempts(attempt_id),
  question_id INTEGER REFERENCES questions(question_id),
  lesson_id TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN ('QUESTION_VIEWED','ANSWER_SUBMITTED','ANSWER_CHANGED','AUDIO_PLAYED','EXPLANATION_VIEWED','ATTEMPT_COMPLETED','LESSON_STARTED','LESSON_COMPLETED')),
  event_timestamp TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  event_payload JSONB NOT NULL CHECK(jsonb_typeof(event_payload)='object'),
  question_version TEXT,
  taxonomy_version TEXT,
  mapping_version UUID,
  mapping_provenance JSONB,
  client_session_id UUID,
  client_sequence BIGINT CHECK(client_sequence>0),
  client_event_sha256 TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('client','server')),
  FOREIGN KEY(attempt_id,question_id) REFERENCES attempt_questions(attempt_id,question_id),
  CHECK((client_session_id IS NULL)=(client_sequence IS NULL)),
  CHECK((lesson_id IS NOT NULL AND attempt_id IS NULL AND question_id IS NULL AND event_type IN ('LESSON_STARTED','LESSON_COMPLETED')) OR
    (lesson_id IS NULL AND attempt_id IS NOT NULL AND
     ((event_type='ATTEMPT_COMPLETED' AND question_id IS NULL) OR
      (event_type IN ('QUESTION_VIEWED','ANSWER_SUBMITTED','ANSWER_CHANGED','AUDIO_PLAYED','EXPLANATION_VIEWED') AND question_id IS NOT NULL)))),
  UNIQUE(user_id,client_session_id,client_sequence)
);
CREATE INDEX IF NOT EXISTS learning_events_owner_attempt ON learning_events(user_id,attempt_id,received_at);
CREATE INDEX IF NOT EXISTS learning_events_question_order ON learning_events(attempt_id,question_id,event_timestamp,client_sequence);

-- Reviewed registry only. Migration intentionally inserts ZERO mappings.
CREATE TABLE IF NOT EXISTS learning_kc_mapping_versions (
  mapping_version UUID PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES questions(question_id),
  question_version TEXT NOT NULL,
  taxonomy_version TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK(review_status IN ('pending_review','approved','rejected')),
  primary_kc TEXT NOT NULL,
  secondary_kcs JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(secondary_kcs)='array'),
  content_verified BOOLEAN NOT NULL DEFAULT false,
  audio_verified BOOLEAN NOT NULL DEFAULT false,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  provenance JSONB NOT NULL CHECK(jsonb_typeof(provenance)='object'),
  CHECK(review_status<>'approved' OR (COALESCE(length(trim(reviewed_by)),0)>0 AND reviewed_at IS NOT NULL AND provenance<>'{}'::jsonb))
);
CREATE UNIQUE INDEX IF NOT EXISTS learning_one_approved_mapping ON learning_kc_mapping_versions(question_id,question_version) WHERE review_status='approved';
CREATE OR REPLACE FUNCTION learning_protect_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Mapping provenance must be retained'; END IF;
 IF OLD.review_status='rejected' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
  RAISE EXCEPTION 'Revoked mapping is immutable; create a new version';
 END IF;
 IF OLD.review_status='approved' AND ((to_jsonb(NEW)-'review_status') IS DISTINCT FROM (to_jsonb(OLD)-'review_status') OR NEW.review_status NOT IN ('approved','rejected')) THEN
  RAISE EXCEPTION 'Approved mapping content is immutable; create a new version';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS learning_mapping_provenance_guard ON learning_kc_mapping_versions;
CREATE TRIGGER learning_mapping_provenance_guard BEFORE UPDATE OR DELETE ON learning_kc_mapping_versions FOR EACH ROW EXECUTE FUNCTION learning_protect_mapping();
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='learning_events'::regclass AND conname='learning_events_mapping_fk') THEN
  ALTER TABLE learning_events ADD CONSTRAINT learning_events_mapping_fk FOREIGN KEY(mapping_version) REFERENCES learning_kc_mapping_versions(mapping_version);
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS learning_answer_revisions (
  revision_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES "User"(user_id),
  attempt_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  previous_answer CHAR(1),
  new_answer CHAR(1),
  correctness BOOLEAN,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  question_version TEXT,
  baseline_known BOOLEAN NOT NULL,
  FOREIGN KEY(attempt_id,question_id) REFERENCES attempt_questions(attempt_id,question_id)
);
CREATE INDEX IF NOT EXISTS learning_answer_revisions_lookup ON learning_answer_revisions(attempt_id,question_id,revision_id);
CREATE TABLE IF NOT EXISTS learning_attempt_sync (
  attempt_id INTEGER PRIMARY KEY REFERENCES user_test_attempts(attempt_id),
  revision BIGINT NOT NULL CHECK(revision>0),
  payload_sha256 TEXT NOT NULL
);

-- Exactly one final response observation per attempt/question, never one per KC edge.
CREATE TABLE IF NOT EXISTS learning_answer_observations (
  observation_id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES "User"(user_id),
  attempt_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  answer CHAR(1) NOT NULL,
  correctness BOOLEAN NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  question_version TEXT NOT NULL,
  question_fingerprint TEXT NOT NULL,
  part_number INTEGER NOT NULL,
  group_id INTEGER,
  prior_response_count INTEGER NOT NULL,
  is_first_response BOOLEAN NOT NULL,
  mapping_version UUID REFERENCES learning_kc_mapping_versions(mapping_version),
  taxonomy_version TEXT,
  primary_kc TEXT,
  secondary_kcs JSONB NOT NULL DEFAULT '[]',
  mapping_provenance JSONB,
  bkt_eligible_at_capture BOOLEAN NOT NULL DEFAULT false,
  exclusion_reason TEXT,
  UNIQUE(attempt_id,question_id),
  FOREIGN KEY(attempt_id,question_id) REFERENCES attempt_questions(attempt_id,question_id)
);
CREATE INDEX IF NOT EXISTS learning_observations_sequence ON learning_answer_observations(user_id,primary_kc,observed_at,attempt_id);
CREATE OR REPLACE VIEW bkt_ready_observations AS
 SELECT o.* FROM learning_answer_observations o
 JOIN learning_kc_mapping_versions m ON m.mapping_version=o.mapping_version
 WHERE o.bkt_eligible_at_capture AND m.review_status='approved' AND m.content_verified
 AND (o.part_number>4 OR m.audio_verified) AND o.question_version=m.question_version;

CREATE OR REPLACE FUNCTION learning_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Learning evidence is append-only'; END $$;
DROP TRIGGER IF EXISTS learning_events_immutable ON learning_events;
CREATE TRIGGER learning_events_immutable BEFORE UPDATE OR DELETE ON learning_events FOR EACH ROW EXECUTE FUNCTION learning_append_only();
DROP TRIGGER IF EXISTS learning_revisions_immutable ON learning_answer_revisions;
CREATE TRIGGER learning_revisions_immutable BEFORE UPDATE OR DELETE ON learning_answer_revisions FOR EACH ROW EXECUTE FUNCTION learning_append_only();
DROP TRIGGER IF EXISTS learning_observations_immutable ON learning_answer_observations;
CREATE TRIGGER learning_observations_immutable BEFORE UPDATE OR DELETE ON learning_answer_observations FOR EACH ROW EXECUTE FUNCTION learning_append_only();

CREATE OR REPLACE FUNCTION learning_capture_answer_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snap JSONB; owner_id INTEGER;
BEGIN
 IF TG_OP='INSERT' AND NEW.user_answer IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.user_answer IS NOT DISTINCT FROM NEW.user_answer THEN RETURN NEW; END IF;
 SELECT aq.question_snapshot,a.user_id INTO snap,owner_id FROM attempt_questions aq
 JOIN user_test_attempts a USING(attempt_id) WHERE aq.attempt_id=NEW.attempt_id AND aq.question_id=NEW.question_id;
 INSERT INTO learning_answer_revisions(user_id,attempt_id,question_id,previous_answer,new_answer,correctness,question_version,baseline_known)
 VALUES(owner_id,NEW.attempt_id,NEW.question_id,CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.user_answer END,
 NEW.user_answer,CASE WHEN NEW.user_answer IS NULL THEN NULL ELSE NEW.user_answer=snap->>'correct_answer' END,
 snap->'learning_version'->>'question_version',TG_OP='INSERT' OR
 (OLD.user_answer IS NULL AND snap ? 'learning_version' AND NOT EXISTS(SELECT 1 FROM learning_answer_revisions
  WHERE attempt_id=NEW.attempt_id AND question_id=NEW.question_id)));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS learning_answer_revision_capture ON user_answers;
CREATE TRIGGER learning_answer_revision_capture AFTER INSERT OR UPDATE OF user_answer ON user_answers
 FOR EACH ROW EXECUTE FUNCTION learning_capture_answer_revision();
COMMIT;
