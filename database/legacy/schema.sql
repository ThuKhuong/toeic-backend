-- 1. Users table
CREATE TABLE "User" (
    user_id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    avatar_url TEXT,
    role VARCHAR(20) DEFAULT 'STUDENT' CHECK (role IN ('STUDENT', 'ADMIN')),
    current_level INTEGER DEFAULT 1,
    total_xp INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. User Stats table for gamification
CREATE TABLE user_stats (
    stat_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES "User"(user_id) ON DELETE CASCADE,
    total_study_time INTEGER DEFAULT 0, 
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
    condition_type VARCHAR(50), -- 'streak', 'xp', 'vocabulary', 'tests', etc.
    condition_value INTEGER,
    xp_reward INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. User Achievements table
CREATE TABLE user_achievements (
    user_achievement_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES "User"(user_id) ON DELETE CASCADE,
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
    part_of_speech VARCHAR(50), -- noun, verb, adjective, etc.
    example_sentence TEXT,
    example_translation TEXT,
    difficulty_level INTEGER DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),
    topic_id INTEGER REFERENCES vocabulary_topics(topic_id), -- business, technology, daily life, etc.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Reading Passages table
CREATE TABLE reading_passages (
    passage_id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    content TEXT NOT NULL,
    difficulty_level INTEGER DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Listening Materials table
CREATE TABLE listening_materials (
    material_id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    audio_url TEXT NOT NULL,
    transcript TEXT,
    difficulty_level INTEGER DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Tests table
CREATE TABLE tests (
    test_id SERIAL PRIMARY KEY,
    test_name VARCHAR(500) NOT NULL,
    test_type VARCHAR(50) DEFAULT 'practice' CHECK (test_type IN ('full_test', 'part_test', 'practice', 'mini_test')),
    description TEXT,
    total_questions INTEGER DEFAULT 0,
    time_limit INTEGER, -- in minutes
    difficulty_level INTEGER DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),
    parts INTEGER[], -- which TOEIC parts [5,6,7] for reading, [1,2,3,4] for listening
    is_active BOOLEAN DEFAULT true,
    created_by INTEGER REFERENCES "User"(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. Questions table
CREATE TABLE questions (
    question_id SERIAL PRIMARY KEY,
    test_id INTEGER REFERENCES tests(test_id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    part_number INTEGER CHECK (part_number BETWEEN 1 AND 7),
    passage_id INTEGER REFERENCES reading_passages(passage_id),
   material_id INTEGER REFERENCES listening_materials(material_id) ON DELETE CASCADE,
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
    user_id INTEGER REFERENCES "User"(user_id) ON DELETE CASCADE,
    content_type VARCHAR(50) NOT NULL CHECK (content_type IN ('vocabulary', 'grammar', 'question')),
    content_id INTEGER NOT NULL, -- references vocab_id, question_id, etc.
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
    user_id INTEGER REFERENCES "User"(user_id) ON DELETE CASCADE,
    grade INTEGER NOT NULL CHECK (grade BETWEEN 0 AND 5), -- 0=again, 1=hard, 3=good, 5=easy
    response_time INTEGER, -- in seconds
    previous_interval INTEGER,
    new_interval INTEGER,
    review_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 13. User Test Attempts table
CREATE TABLE user_test_attempts (
    attempt_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES "User"(user_id) ON DELETE CASCADE,
    test_id INTEGER REFERENCES tests(test_id),
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    total_correct INTEGER DEFAULT 0,
    total_questions INTEGER DEFAULT 0,
    time_spent INTEGER, -- in minutes
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
    time_spent INTEGER, -- in seconds
    marked_for_review BOOLEAN DEFAULT false,
    answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 15. Study Sessions table
CREATE TABLE study_sessions (
    session_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES "User"(user_id) ON DELETE CASCADE,
    session_type VARCHAR(50) NOT NULL CHECK (session_type IN ('vocabulary', 'grammar', 'reading', 'listening', 'test', 'review')),
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    items_studied INTEGER DEFAULT 0,
    correct_answers INTEGER DEFAULT 0,
    xp_earned INTEGER DEFAULT 0,
    streak_maintained BOOLEAN DEFAULT false
);
CREATE TABLE vocabulary_topics (
    topic_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT
);

ALTER TABLE questions
DROP CONSTRAINT questions_test_id_fkey;

ALTER TABLE questions
ADD CONSTRAINT questions_test_id_fkey
FOREIGN KEY (test_id)
REFERENCES tests(test_id)
ON DELETE SET NULL;


-- Create indexes for better performance
CREATE INDEX idx_user_email ON "User"(email);
CREATE INDEX idx_srscard_user_due ON srscard(user_id, due);
CREATE INDEX idx_srscard_content ON srscard(content_type, content_id);
CREATE INDEX idx_questions_test ON questions(test_id);
CREATE INDEX idx_questions_type_part ON questions(question_type, part_number);
CREATE INDEX idx_user_attempts_user ON user_test_attempts(user_id);
CREATE INDEX idx_user_answers_attempt ON user_answers(attempt_id);
CREATE INDEX idx_vocabulary_difficulty ON vocabulary(difficulty_level);
CREATE INDEX idx_vocabulary_- 1. Users table
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
    user_id INTEGER REFERENCES "User"(user_id) ON DELETE CASCADE,
    total_study_time INTEGER DEFAULT 0, -- in minutes
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
    condition_type VARCHAR(50), -- 'streak', 'xp', 'vocabulary', 'tests', etc.
    condition_value INTEGER,
    xp_reward INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. User Achievements table
CREATE TABLE user_achievements (
    user_achievement_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES "User"(user_id) ON DELETE CASCADE,
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
    part_of_speech VARCHAR(50), -- noun, verb, adjective, etc.
    example_sentence TEXT,
    example_translation TEXT,
    audio_url TEXT, --bỏ
    image_url TEXT, --bỏ
    difficulty_level INTEGER DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),
    frequency_score INTEGER DEFAULT 1, --bỏ
    topic_id VARCHAR(100), -- business, technology, daily life, etc.
    tags TEXT[], --bỏ
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Reading Passages table
CREATE TABLE reading_passages (
    passage_id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    content TEXT NOT NULL,
    source VARCHAR(255), --bỏ
    difficulty_level INTEGER DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),
    topic VARCHAR(100), --bỏ
    word_count INTEGER, --bỏ
    estimated_time INTEGER, -- bỏbỏ
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Listening Materials table
CREATE TABLE listening_materials (
    material_id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    audio_url TEXT NOT NULL,
    transcript TEXT,
    duration INTEGER, -- in seconds
    difficulty_level INTEGER DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),
    topic VARCHAR(100), --bỏ
    speaker_count INTEGER DEFAULT 1, --bỏ
    accent VARCHAR(50), -- American, British, Australian, etc.  --bỏbỏ
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Tests table
CREATE TABLE tests (
    test_id SERIAL PRIMARY KEY,
    test_name VARCHAR(500) NOT NULL,
    test_type VARCHAR(50) DEFAULT 'practice' CHECK (test_type IN ('full_test', 'part_test', 'practice', 'mini_test')),
    description TEXT,
    total_questions INTEGER DEFAULT 0,
    time_limit INTEGER, -- in minutes
    difficulty_level INTEGER DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),
    parts INTEGER[], -- which TOEIC parts [5,6,7] for reading, [1,2,3,4] for listening
    is_active BOOLEAN DEFAULT true,
    created_by INTEGER REFERENCES "User"(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. Questions table
CREATE TABLE questions (
    question_id SERIAL PRIMARY KEY,
    test_id INTEGER REFERENCES tests(test_id) ON DELETE CASCADE,
    question_text TEXT,
    question_type VARCHAR(50) NOT NULL CHECK (question_type IN ('listening', 'reading', 'vocabulary', 'grammar')), --bỏbỏ
    part_number INTEGER CHECK (part_number BETWEEN 1 AND 7),
    passage_id INTEGER REFERENCES reading_passages(passage_id),
    material_id INTEGER REFERENCES listening_materials(material_id),
    vocab_id INTEGER REFERENCES vocabulary(vocab_id), --bỏ
    audio_url TEXT, --bỏbỏ
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
    user_id INTEGER REFERENCES "User"(user_id) ON DELETE CASCADE,
    content_type VARCHAR(50) NOT NULL CHECK (content_type IN ('vocabulary', 'grammar', 'question')),
    content_id INTEGER NOT NULL, -- references vocab_id, question_id, etc.
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
    user_id INTEGER REFERENCES "User"(user_id) ON DELETE CASCADE,
    grade INTEGER NOT NULL CHECK (grade BETWEEN 0 AND 5), -- 0=again, 1=hard, 3=good, 5=easy
    response_time INTEGER, -- in seconds
    previous_interval INTEGER,
    new_interval INTEGER,
    review_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 13. User Test Attempts table
CREATE TABLE user_test_attempts (
    attempt_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES "User"(user_id) ON DELETE CASCADE,
    test_id INTEGER REFERENCES tests(test_id),
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    total_correct INTEGER DEFAULT 0,
    total_questions INTEGER DEFAULT 0,
    score INTEGER, -- calculated score (0-990 for TOEIC)
    time_spent INTEGER, -- in minutes
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
    time_spent INTEGER, -- in seconds
    marked_for_review BOOLEAN DEFAULT false,
    answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 15. Study Sessions table
CREATE TABLE study_sessions (
    session_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES "User"(user_id) ON DELETE CASCADE,
    session_type VARCHAR(50) NOT NULL CHECK (session_type IN ('vocabulary', 'grammar', 'reading', 'listening', 'test', 'review')),
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    items_studied INTEGER DEFAULT 0,
    correct_answers INTEGER DEFAULT 0,
    xp_earned INTEGER DEFAULT 0,
    streak_maintained BOOLEAN DEFAULT false
);
CREATE TABLE vocabulary_topics (
    topic_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT
); ON vocabulary(topic_id);

-- Topics for vocabulary
CREATE TABLE IF NOT EXISTS vocabulary_topics (
    topic_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
);

-- Add topic_id to vocabulary if missing
ALTER TABLE vocabulary ADD COLUMN IF NOT EXISTS topic_id INTEGER REFERENCES vocabulary_topics(topic_id);
CREATE INDEX IF NOT EXISTS idx_vocabulary_topic_id ON vocabulary(topic_id);

-- Seed default topics
INSERT INTO vocabulary_topics (name) VALUES
    ('Business') ON CONFLICT DO NOTHING,
    ('Education') ON CONFLICT DO NOTHING,
    ('Technology') ON CONFLICT DO NOTHING,
    ('Health') ON CONFLICT DO NOTHING,
    ('Travel') ON CONFLICT DO NOTHING;

-- Insert default achievements
INSERT INTO achievements (name, description, icon, condition_type, condition_value, xp_reward) VALUES
('First Steps', 'Complete your first vocabulary review', '🎯', 'vocabulary', 1, 10),
('Dedicated Learner', 'Study for 3 days in a row', '🔥', 'streak', 3, 50),
('Week Warrior', 'Study for 7 days in a row', '⚡', 'streak', 7, 100),
('Vocabulary Master', 'Learn 100 vocabulary words', '📚', 'vocabulary', 100, 200),
('Test Taker', 'Complete your first practice test', '✅', 'tests', 1, 25),
('Rising Star', 'Earn 1000 XP', '⭐', 'xp', 1000, 100),
('Champion', 'Earn 5000 XP', '👑', 'xp', 5000, 250);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_user_updated_at BEFORE UPDATE ON "User" 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_vocabulary_updated_at BEFORE UPDATE ON vocabulary 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tests_updated_at BEFORE UPDATE ON tests 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_srscard_updated_at BEFORE UPDATE ON srscard 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_stats_updated_at BEFORE UPDATE ON user_stats 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert some sample data for testing
INSERT INTO "User" (email, password_hash, full_name, role) VALUES
('admin@toeic.com', '$2b$10$rQs3QG8gFUqO9WO7OQhQQ.K1KX7Kx4K7FXe8Oe5qKx6Kv2Kw1Ky9O.', 'Admin User', 'ADMIN'),
('teacher@toeic.com', '$2b$10$rQs3QG8gFUqO9WO7OQhQQ.K1KX7Kx4K7FXe8Oe5qKx6Kv2Kw1Ky9O.', 'Teacher User', 'TEACHER'),
('student@toeic.com', '$2b$10$rQs3QG8gFUqO9WO7OQhQQ.K1KX7Kx4K7FXe8Oe5qKx6Kv2Kw1Ky9O.', 'Student User', 'STUDENT');

-- Initialize user stats for sample users
INSERT INTO user_stats (user_id) 
SELECT user_id FROM "User";

COMMENT ON TABLE "User" IS 'User accounts with authentication and profile info';
COMMENT ON TABLE vocabulary IS 'TOEIC vocabulary words with meanings and examples';
COMMENT ON TABLE srscard IS 'Spaced repetition cards for vocabulary learning';
COMMENT ON TABLE tests IS 'TOEIC practice tests and exams';
COMMENT ON TABLE questions IS 'Individual questions within tests';
COMMENT ON TABLE user_test_attempts IS 'User test taking sessions and results';
COMMENT ON TABLE achievements IS 'Gamification achievements and rewards';
COMMENT ON TABLE user_stats IS 'User progress statistics and metrics';