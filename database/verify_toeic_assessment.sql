-- Run only in a disposable verification database after toeic_learning_system.sql.
-- Rows are rolled back; PostgreSQL sequences can still advance.
BEGIN;
DO $$
DECLARE
    learner INTEGER;
    other_learner INTEGER;
    test_key INTEGER;
    question_key INTEGER;
    attempt_key INTEGER;
    other_attempt INTEGER;
    skill_key INTEGER;
    assessment_key BIGINT;
    newer_assessment BIGINT;
BEGIN
    INSERT INTO "User" (email, password_hash) VALUES ('verify-one@example.invalid', 'test-only') RETURNING user_id INTO learner;
    INSERT INTO "User" (email, password_hash) VALUES ('verify-two@example.invalid', 'test-only') RETURNING user_id INTO other_learner;
    INSERT INTO tests (test_name) VALUES ('Schema verification') RETURNING test_id INTO test_key;
    INSERT INTO questions (test_id, question_text, question_type, part_number, correct_answer, order_in_test)
        VALUES (test_key, 'Example question', 'reading', 5, 'A', 1) RETURNING question_id INTO question_key;
    INSERT INTO answer_choices (question_id, choice_text, choice_label, is_correct)
        VALUES (question_key, 'Example choice', 'A', true);
    INSERT INTO user_test_attempts (user_id, test_id, total_questions, total_correct, end_time, is_completed)
        VALUES (learner, test_key, 1, 1, CURRENT_TIMESTAMP, true) RETURNING attempt_id INTO attempt_key;
    INSERT INTO user_test_attempts (user_id, test_id, total_questions)
        VALUES (other_learner, test_key, 1) RETURNING attempt_id INTO other_attempt;
    INSERT INTO attempt_questions (attempt_id, question_id, position, question_snapshot)
        VALUES (attempt_key, question_key, 1, '{"correct_answer":"A","skill_codes":["reading_word_form"]}');
    INSERT INTO user_answers (attempt_id, question_id, user_answer, is_correct, time_spent)
        VALUES (attempt_key, question_key, 'A', true, 12);
    BEGIN
        INSERT INTO user_answers (attempt_id, question_id, user_answer) VALUES (attempt_key, question_key, 'B');
        RAISE EXCEPTION 'Duplicate answer was accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO user_test_attempts (user_id, test_id, total_questions, total_correct)
            VALUES (learner, test_key, 1, 2);
        RAISE EXCEPTION 'Invalid correct count was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    SELECT skill_id INTO STRICT skill_key FROM skills WHERE code = 'reading_word_form';
    INSERT INTO question_skills VALUES (question_key, skill_key, 1);
    INSERT INTO ai_assessments (user_id, trigger_attempt_id, model_provider, model_name,
        model_version, prompt_version, feature_version, input_snapshot)
        VALUES (learner, attempt_key, 'test', 'test', 'v1', 'v1', 'v1', '{}')
        RETURNING assessment_id INTO assessment_key;
    INSERT INTO assessment_attempts VALUES (assessment_key, attempt_key, learner);
    BEGIN
        INSERT INTO assessment_attempts VALUES (assessment_key, other_attempt, learner);
        RAISE EXCEPTION 'Another learner evidence was accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO assessment_skill_results (assessment_id, skill_id, mastery_score, evidence_count, correct_count, assessment_label)
            VALUES (assessment_key, skill_key, 80, 0, 0, 'proficient');
        RAISE EXCEPTION 'Mastery without evidence was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    INSERT INTO assessment_skill_results (assessment_id, skill_id, mastery_score, confidence, evidence_count, correct_count, assessment_label)
        VALUES (assessment_key, skill_key, 60, 0.5, 1, 1, 'developing');
    INSERT INTO assessment_score_predictions (assessment_id, listening_score, reading_score, method_version)
        VALUES (assessment_key, 250, 300, 'test-only');
    IF (SELECT total_score FROM assessment_score_predictions WHERE assessment_id = assessment_key) <> 550 THEN
        RAISE EXCEPTION 'Incorrect total prediction';
    END IF;
    UPDATE ai_assessments SET status = 'completed', output_payload = '{}',
        started_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP WHERE assessment_id = assessment_key;
    INSERT INTO ai_assessments (user_id, model_provider, model_name, model_version, prompt_version, feature_version, input_snapshot)
        VALUES (learner, 'test', 'test', 'v2', 'v2', 'v1', '{}') RETURNING assessment_id INTO newer_assessment;
    INSERT INTO assessment_skill_results (assessment_id, skill_id, evidence_count, correct_count, assessment_label)
        VALUES (newer_assessment, skill_key, 0, 0, 'insufficient_data');
    IF (SELECT assessment_id FROM latest_user_skill_assessments WHERE user_id = learner AND skill_id = skill_key) <> assessment_key THEN
        RAISE EXCEPTION 'Pending assessment leaked into latest result';
    END IF;
    UPDATE ai_assessments SET status = 'completed', output_payload = '{}',
        started_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP WHERE assessment_id = newer_assessment;
    IF (SELECT assessment_id FROM latest_user_skill_assessments WHERE user_id = learner AND skill_id = skill_key) <> newer_assessment THEN
        RAISE EXCEPTION 'Latest result selection failed';
    END IF;
    INSERT INTO assessment_recommendations (assessment_id, skill_id, test_id, reason, instructions)
        VALUES (assessment_key, skill_key, test_key, 'Practice needed', 'Review word forms');
    BEGIN
        INSERT INTO user_answers (attempt_id, question_id, user_answer)
            VALUES (other_attempt, question_key, 'A');
        RAISE EXCEPTION 'Answer for a question not presented was accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public'
        AND table_name IN ('srscard','srs_reviews','achievements','user_achievements','learning_goals','learning_plans','study_sessions')) THEN
        RAISE EXCEPTION 'Removed feature tables still exist';
    END IF;
    RAISE NOTICE 'TOEIC assessment schema verification passed';
END;
$$;
ROLLBACK;

