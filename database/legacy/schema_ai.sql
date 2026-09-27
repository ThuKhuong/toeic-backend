-- Fresh database only. See DATABASE_DESIGN.md. Not a migration.
BEGIN;
CREATE TABLE vocabulary_topics (topic_id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE, description TEXT);
CREATE TABLE "User" (
    user_id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    avatar_url TEXT,
    role VARCHAR(20) DEFAULT 'STUDENT' CHECK (role IN ('STUDENT', 'TEACHER', 'ADMIN')),
    current_level INTEGER DEFAULT 1,
    total_xp INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    target_score INTEGER DEFAULT 600,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. User Stats table for gamification
CREATE TABLE user_stats (
    stat_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    total_study_time INTEGER DEFAULT 0,
    vocabulary_learned INTEGER DEFAULT 0,
    tests_completed INTEGER DEFAULT 0,
    correct_answers INTEGER DEFAULT 0,
    total_answers INTEGER DEFAULT 0,
    last_study_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Achievements table
CREATE TABLE achievements (
    achievement_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(255),
    condition_type VARCHAR(50),
    condition_value INTEGER,
    xp_reward INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. User Achievements table
CREATE TABLE user_achievements (
    user_achievement_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    achievement_id INTEGER REFERENCES achievements(achievement_id),
    earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, achievement_id)
);

-- 5. Vocabulary table
CREATE TABLE vocabulary (
    vocab_id SERIAL PRIMARY KEY,
    word VARCHAR(255) NOT NULL,
    pronunciation VARCHAR(255),
    meaning_vi TEXT NOT NULL,
    meaning_en TEXT,
    part_of_speech VARCHAR(50),
    example_sentence TEXT,
    example_translation TEXT,
    audio_url TEXT,
    image_url TEXT,
    difficulty_level INTEGER DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),
    frequency_score INTEGER DEFAULT 1,
    topic_id INTEGER REFERENCES vocabulary_topics(topic_id),
    tags TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Reading Passages table
CREATE TABLE reading_passages (
    passage_id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    content TEXT NOT NULL,
    image_url TEXT,
    source VARCHAR(255),
    difficulty_level INTEGER DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),
    topic VARCHAR(100),
    word_count INTEGER,
    estimated_time INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Listening Materials table
CREATE TABLE listening_materials (
    material_id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    audio_url TEXT NOT NULL,
    transcript TEXT,
    duration INTEGER,
    difficulty_level INTEGER DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),
    topic VARCHAR(100),
    speaker_count INTEGER DEFAULT 1,
    accent VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Tests table
CREATE TABLE tests (
    test_id SERIAL PRIMARY KEY,
    test_name VARCHAR(500) NOT NULL,
    test_type VARCHAR(50) DEFAULT 'practice' CHECK (test_type IN ('full_test', 'part_test', 'practice', 'mini_test')),
    description TEXT,
    total_questions INTEGER DEFAULT 0,
    time_limit INTEGER,
    difficulty_level INTEGER DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),
    parts INTEGER[],
    is_active BOOLEAN DEFAULT true,
    created_by INTEGER REFERENCES "User"(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. Questions table
CREATE TABLE questions (
    question_id SERIAL PRIMARY KEY,
    test_id INTEGER REFERENCES tests(test_id) ON DELETE SET NULL,
    question_text TEXT,
    question_type VARCHAR(50) NOT NULL CHECK (question_type IN ('listening', 'reading', 'vocabulary', 'grammar')),
    part_number INTEGER CHECK (part_number BETWEEN 1 AND 7),
    passage_id INTEGER REFERENCES reading_passages(passage_id),
    material_id INTEGER REFERENCES listening_materials(material_id),
    vocab_id INTEGER REFERENCES vocabulary(vocab_id),
    audio_url TEXT,
    image_url TEXT,
    correct_answer CHAR(1) NOT NULL CHECK (correct_answer IN ('A', 'B', 'C', 'D')),
    explanation TEXT,
    difficulty_level INTEGER DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),
    order_in_test INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 10. Answer Choices table
CREATE TABLE answer_choices (
    choice_id SERIAL PRIMARY KEY,
    question_id INTEGER REFERENCES questions(question_id) ON DELETE CASCADE,
    choice_text TEXT NOT NULL,
    choice_label CHAR(1) NOT NULL CHECK (choice_label IN ('A', 'B', 'C', 'D')),
    is_correct BOOLEAN DEFAULT false,
    UNIQUE(question_id, choice_label)
);

-- 11. SRS Cards table (Spaced Repetition System)
CREATE TABLE srscard (
    card_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    content_type VARCHAR(50) NOT NULL CHECK (content_type IN ('vocabulary', 'grammar', 'question')),
    content_id INTEGER NOT NULL,
    easiness_factor DECIMAL(3,2) DEFAULT 2.5,
    interval_days INTEGER DEFAULT 1,
    repetition_count INTEGER DEFAULT 0,
    due TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_reviewed TIMESTAMP,
    total_reviews INTEGER DEFAULT 0,
    correct_reviews INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, content_type, content_id)
);

-- 12. SRS Reviews table (track review history)
CREATE TABLE srs_reviews (
    review_id SERIAL PRIMARY KEY,
    card_id INTEGER REFERENCES srscard(card_id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    grade INTEGER NOT NULL CHECK (grade BETWEEN 0 AND 5),
    response_time INTEGER,
    previous_interval INTEGER,
    new_interval INTEGER,
    review_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 13. User Test Attempts table
CREATE TABLE user_test_attempts (
    attempt_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    test_id INTEGER REFERENCES tests(test_id),
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    total_correct INTEGER DEFAULT 0,
    total_questions INTEGER DEFAULT 0,
    score INTEGER,
    time_spent INTEGER,
    is_completed BOOLEAN DEFAULT false,
    xp_earned INTEGER DEFAULT 0
);

-- 14. User Answers table
CREATE TABLE user_answers (
    answer_id SERIAL PRIMARY KEY,
    attempt_id INTEGER REFERENCES user_test_attempts(attempt_id) ON DELETE CASCADE,
    question_id INTEGER REFERENCES questions(question_id),
    user_answer CHAR(1) CHECK (user_answer IN ('A', 'B', 'C', 'D')),
    is_correct BOOLEAN,
    time_spent INTEGER,
    marked_for_review BOOLEAN DEFAULT false,
    answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 15. Study Sessions table
CREATE TABLE study_sessions (
    session_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    session_type VARCHAR(50) NOT NULL CHECK (session_type IN ('vocabulary', 'grammar', 'reading', 'listening', 'test', 'review')),
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    items_studied INTEGER DEFAULT 0,
    correct_answers INTEGER DEFAULT 0,
    xp_earned INTEGER DEFAULT 0,
    streak_maintained BOOLEAN DEFAULT false
);

-- Core integrity; retain legacy names and time units for the existing backend.
ALTER TABLE user_stats ADD CONSTRAINT uq_user_stats_user UNIQUE (user_id);
ALTER TABLE user_answers
    ALTER COLUMN attempt_id SET NOT NULL,
    ALTER COLUMN question_id SET NOT NULL,
    ADD CONSTRAINT uq_attempt_question UNIQUE (attempt_id, question_id),
    ADD CHECK (time_spent >= 0);
ALTER TABLE answer_choices ALTER COLUMN question_id SET NOT NULL;
ALTER TABLE questions
    ADD CHECK (order_in_test > 0),
    ADD CONSTRAINT uq_test_question_order UNIQUE (test_id, order_in_test);
ALTER TABLE user_test_attempts
    ALTER COLUMN test_id SET NOT NULL,
    ADD CONSTRAINT uq_attempt_owner UNIQUE (attempt_id, user_id),
    ADD CHECK (total_questions >= 0 AND total_correct BETWEEN 0 AND total_questions),
    ADD CHECK (end_time >= start_time),
    ADD CHECK (NOT is_completed OR end_time IS NOT NULL),
    ADD CHECK (time_spent >= 0);
ALTER TABLE srscard ADD CONSTRAINT uq_card_owner UNIQUE (card_id, user_id);
ALTER TABLE srs_reviews
    ALTER COLUMN card_id SET NOT NULL,
    ADD FOREIGN KEY (card_id, user_id) REFERENCES srscard(card_id, user_id) ON DELETE CASCADE;

-- A group can contain multiple passages, for example a multi-document reading set.
CREATE TABLE question_groups (
    group_id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    part_number INTEGER NOT NULL CHECK (part_number BETWEEN 1 AND 7),
    material_id INTEGER REFERENCES listening_materials(material_id),
    image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE question_group_passages (
    group_id INTEGER NOT NULL REFERENCES question_groups(group_id) ON DELETE CASCADE,
    passage_id INTEGER NOT NULL REFERENCES reading_passages(passage_id),
    position INTEGER NOT NULL CHECK (position > 0),
    PRIMARY KEY (group_id, passage_id),
    UNIQUE (group_id, position)
);
ALTER TABLE questions ADD COLUMN group_id INTEGER REFERENCES question_groups(group_id);

-- Snapshot every presented question, including unanswered ones, at attempt creation.
-- JSON contains text, choices, answer key, explanation, media and skill tags.
CREATE TABLE attempt_questions (
    attempt_id INTEGER NOT NULL REFERENCES user_test_attempts(attempt_id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES questions(question_id),
    position INTEGER NOT NULL CHECK (position > 0),
    question_snapshot JSONB NOT NULL CHECK (jsonb_typeof(question_snapshot) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (attempt_id, question_id),
    UNIQUE (attempt_id, position)
);

CREATE TABLE skills (
    skill_id SERIAL PRIMARY KEY,
    code VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    section VARCHAR(20) NOT NULL CHECK (section IN ('listening', 'reading')),
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE question_skills (
    question_id INTEGER NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
    skill_id INTEGER NOT NULL REFERENCES skills(skill_id),
    weight NUMERIC(5,4) NOT NULL DEFAULT 1 CHECK (weight > 0 AND weight <= 1),
    PRIMARY KEY (question_id, skill_id)
);

CREATE TABLE learning_goals (
    goal_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    target_score INTEGER NOT NULL CHECK (target_score BETWEEN 10 AND 990),
    target_date DATE,
    daily_minutes INTEGER NOT NULL DEFAULT 30 CHECK (daily_minutes > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (goal_id, user_id)
);
CREATE UNIQUE INDEX uq_active_learning_goal ON learning_goals(user_id) WHERE status = 'active';

-- Each run is immutable after completion; a retry/reassessment creates a new row.
CREATE TABLE ai_assessments (
    assessment_id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    trigger_attempt_id INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    model_provider VARCHAR(100) NOT NULL,
    model_name VARCHAR(150) NOT NULL,
    model_version VARCHAR(150) NOT NULL,
    prompt_version VARCHAR(100) NOT NULL,
    feature_version VARCHAR(100) NOT NULL,
    input_snapshot JSONB NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
    output_payload JSONB,
    summary TEXT,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (assessment_id, user_id),
    FOREIGN KEY (trigger_attempt_id, user_id)
        REFERENCES user_test_attempts(attempt_id, user_id),
    CHECK (completed_at >= started_at),
    CHECK (status <> 'completed' OR (completed_at IS NOT NULL AND output_payload IS NOT NULL)),
    CHECK (status <> 'failed' OR error_message IS NOT NULL)
);

-- All attempts used as evidence, not just the attempt that triggered the run.
CREATE TABLE assessment_attempts (
    assessment_id BIGINT NOT NULL,
    attempt_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (assessment_id, attempt_id),
    FOREIGN KEY (assessment_id, user_id)
        REFERENCES ai_assessments(assessment_id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (attempt_id, user_id)
        REFERENCES user_test_attempts(attempt_id, user_id)
);
CREATE TABLE assessment_skill_results (
    assessment_id BIGINT NOT NULL REFERENCES ai_assessments(assessment_id) ON DELETE CASCADE,
    skill_id INTEGER NOT NULL REFERENCES skills(skill_id),
    mastery_score NUMERIC(5,2) CHECK (mastery_score BETWEEN 0 AND 100),
    confidence NUMERIC(5,4) CHECK (confidence BETWEEN 0 AND 1),
    evidence_count INTEGER NOT NULL CHECK (evidence_count >= 0),
    correct_count INTEGER NOT NULL CHECK (correct_count BETWEEN 0 AND evidence_count),
    average_response_seconds NUMERIC(10,2) CHECK (average_response_seconds >= 0),
    assessment_label VARCHAR(30) NOT NULL
        CHECK (assessment_label IN ('insufficient_data', 'needs_practice', 'developing', 'proficient')),
    feedback TEXT,
    PRIMARY KEY (assessment_id, skill_id),
    CHECK ((assessment_label = 'insufficient_data' AND mastery_score IS NULL)
        OR (assessment_label <> 'insufficient_data' AND mastery_score IS NOT NULL AND evidence_count > 0))
);

-- Predictions are separate from raw correct counts and legacy practice scores.
CREATE TABLE assessment_score_predictions (
    assessment_id BIGINT PRIMARY KEY REFERENCES ai_assessments(assessment_id) ON DELETE CASCADE,
    listening_score INTEGER CHECK (listening_score BETWEEN 5 AND 495),
    reading_score INTEGER CHECK (reading_score BETWEEN 5 AND 495),
    total_score INTEGER GENERATED ALWAYS AS (listening_score + reading_score) STORED,
    confidence NUMERIC(5,4) CHECK (confidence BETWEEN 0 AND 1),
    method_version VARCHAR(150) NOT NULL,
    explanation TEXT,
    CHECK (listening_score IS NOT NULL OR reading_score IS NOT NULL)
);

CREATE TABLE learning_plans (
    plan_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    assessment_id BIGINT NOT NULL,
    goal_id INTEGER,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    start_date DATE NOT NULL,
    end_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assessment_id, user_id) REFERENCES ai_assessments(assessment_id, user_id),
    FOREIGN KEY (goal_id, user_id) REFERENCES learning_goals(goal_id, user_id),
    CHECK (end_date >= start_date)
);
CREATE TABLE learning_plan_items (
    item_id SERIAL PRIMARY KEY,
    plan_id INTEGER NOT NULL REFERENCES learning_plans(plan_id) ON DELETE CASCADE,
    skill_id INTEGER REFERENCES skills(skill_id),
    test_id INTEGER REFERENCES tests(test_id),
    vocab_id INTEGER REFERENCES vocabulary(vocab_id),
    activity_type VARCHAR(30) NOT NULL CHECK (activity_type IN ('test', 'vocabulary', 'skill_practice')),
    instructions TEXT NOT NULL,
    reason TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position > 0),
    scheduled_date DATE,
    estimated_minutes INTEGER CHECK (estimated_minutes > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
    completed_at TIMESTAMPTZ,
    UNIQUE (plan_id, position),
    CHECK ((activity_type = 'test' AND test_id IS NOT NULL AND vocab_id IS NULL)
        OR (activity_type = 'vocabulary' AND vocab_id IS NOT NULL AND test_id IS NULL)
        OR (activity_type = 'skill_practice' AND skill_id IS NOT NULL AND test_id IS NULL AND vocab_id IS NULL)),
    CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

CREATE INDEX idx_questions_test ON questions(test_id);
CREATE INDEX idx_questions_type_part ON questions(question_type, part_number);
CREATE INDEX idx_questions_group ON questions(group_id);
CREATE INDEX idx_question_skills_skill ON question_skills(skill_id, question_id);
CREATE INDEX idx_user_attempts_user ON user_test_attempts(user_id, start_time DESC);
CREATE INDEX idx_user_answers_question ON user_answers(question_id);
CREATE INDEX idx_srscard_user_due ON srscard(user_id, due);
CREATE INDEX idx_srs_reviews_card_date ON srs_reviews(card_id, review_date DESC);
CREATE INDEX idx_vocabulary_topic ON vocabulary(topic_id);
CREATE INDEX idx_study_sessions_user ON study_sessions(user_id, start_time DESC);
CREATE INDEX idx_assessments_user_date ON ai_assessments(user_id, created_at DESC);
CREATE INDEX idx_assessment_queue ON ai_assessments(created_at) WHERE status = 'pending';
CREATE INDEX idx_assessment_attempts_attempt ON assessment_attempts(attempt_id);
CREATE INDEX idx_learning_plans_user ON learning_plans(user_id, status);

CREATE VIEW latest_user_skill_assessments AS
SELECT DISTINCT ON (a.user_id, r.skill_id)
    a.user_id, r.*, a.completed_at
FROM ai_assessments a
JOIN assessment_skill_results r ON r.assessment_id = a.assessment_id
WHERE a.status = 'completed'
ORDER BY a.user_id, r.skill_id, a.completed_at DESC, a.assessment_id DESC;

CREATE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER update_user_updated_at BEFORE UPDATE ON "User"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_stats_updated_at BEFORE UPDATE ON user_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_vocabulary_updated_at BEFORE UPDATE ON vocabulary
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tests_updated_at BEFORE UPDATE ON tests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_srscard_updated_at BEFORE UPDATE ON srscard
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;

