-- XÂY DỰNG HỆ THỐNG LUYỆN THI TOEIC ỨNG DỤNG AI ĐÁNH GIÁ NĂNG LỰC NGƯỜI HỌC
-- PostgreSQL: schema tinh gọn kế thừa schema.sql, tái sử dụng phần AI của schema_ai.sql.
-- CHỈ chạy trên database TRỐNG. Không phải migration; không chạy chung schema cũ.
-- Ví dụ từ thư mục gốc dự án (tạo database toeic_assessment trống trước):
-- psql -h localhost -U postgres -d toeic_assessment -v ON_ERROR_STOP=1 -f toeic_be/database/toeic_learning_system.sql
-- File có sẵn danh mục kỹ năng/chủ đề; chưa có tài khoản hoặc đề thi mẫu.
--
-- PHẠM VI (22 bảng): tài khoản, thống kê học tập, từ vựng, ngữ liệu, đề/câu hỏi,
-- lượt làm bài, snapshot câu hỏi, kỹ năng, đánh giá AI và gợi ý luyện tập.
-- Bỏ SRS, thành tích, XP, cấp độ gamification, streak, mục tiêu và lịch học.
-- Giữ vocabulary vì backend lấy câu hỏi hiện JOIN vocabulary/vocabulary_topics.
-- Giữ tên bảng/cột, role, question_type, test_type theo backend cũ.
--
-- Backend hiện tại dùng schema này; xem BACKEND_ASSESSMENT.md để biết hợp đồng API.
-- Worker đánh giá AI chưa được triển khai; schema không tự gọi AI.
--
-- QUY ƯỚC NGHIỆP VỤ:
-- time_limit, user_test_attempts.time_spent, user_stats.total_study_time: PHÚT.
-- user_answers.time_spent, listening_materials.duration: GIÂY.
-- score giữ cho backend cũ; không mặc định coi công thức hiện tại là điểm TOEIC chuẩn.
-- Điểm dự đoán được lưu riêng và cần phương pháp được kiểm chứng; có thể không tạo.
-- Snapshot phải chứa text, choices, correct_answer, explanation, ngữ liệu và nhãn kỹ năng.
-- Không trả đáp án/snapshot đầy đủ/transcript cho client khi đang thi.
-- Backend kiểm tra choices có đáp án, đồng bộ correct_answer và is_correct khi xuất bản.
-- Part 2 có 3 lựa chọn; Part 1,3-7 có 4. Kiểm tra khi xuất bản, cho phép lưu bản nháp.
-- Tổng câu/đúng/sai/bỏ trống/thời gian do backend tính; AI chỉ phân tích dữ liệu đã tổng hợp.
-- Chỉ dùng lượt đã hoàn tất của đúng người học làm bằng chứng, không đưa PII vào input AI.
-- Lưu model/prompt/feature version để tái kiểm tra; đánh giá hoàn tất không sửa nội dung.
-- Confidence để NULL nếu chưa hiệu chuẩn; thiếu dữ liệu dùng insufficient_data.
-- user_stats là thống kê tổng hợp: backend cập nhật cùng transaction, không cộng hai lần.
-- questions.test_id giữ quan hệ một câu-một đề để phù hợp code; chưa hỗ trợ tái dùng
-- một câu đồng thời trong nhiều đề. Không xóa đề/câu đã có lượt thi; ẩn đề bằng is_active.
-- Timestamp cũ giữ nguyên để giảm thay đổi backend; trường AI dùng TIMESTAMPTZ.

BEGIN;
CREATE TABLE import_batches (
    batch_id BIGSERIAL PRIMARY KEY,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('reading','listening','vocabulary')),
    fingerprint CHAR(64) NOT NULL,
    row_count INTEGER NOT NULL CHECK (row_count > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(kind, fingerprint)
);
CREATE TABLE vocabulary_topics (topic_id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE, description TEXT);
CREATE TABLE "User" (
    user_id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    avatar_url TEXT,
    role VARCHAR(20) DEFAULT 'STUDENT' CHECK (role IN ('STUDENT', 'TEACHER', 'ADMIN')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE answer_choices (
    choice_id SERIAL PRIMARY KEY,
    question_id INTEGER REFERENCES questions(question_id) ON DELETE CASCADE,
    choice_text TEXT NOT NULL,
    choice_label CHAR(1) NOT NULL CHECK (choice_label IN ('A', 'B', 'C', 'D')),
    is_correct BOOLEAN DEFAULT false,
    UNIQUE(question_id, choice_label)
);

CREATE TABLE user_test_attempts (
    elapsed_seconds INTEGER NOT NULL DEFAULT 0,
    current_index INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER,
    deadline_at TIMESTAMPTZ,
    attempt_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    test_id INTEGER REFERENCES tests(test_id),
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    total_correct INTEGER DEFAULT 0,
    total_questions INTEGER DEFAULT 0,
    score INTEGER,
    time_spent INTEGER,
    is_completed BOOLEAN NOT NULL DEFAULT false
);

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

-- Đáp án chỉ được ghi cho câu thực sự đã phát trong lượt thi này.
ALTER TABLE user_answers ADD CONSTRAINT fk_answer_presented_question
    FOREIGN KEY (attempt_id, question_id)
    REFERENCES attempt_questions(attempt_id, question_id) ON DELETE CASCADE;

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

CREATE INDEX idx_questions_test ON questions(test_id);
CREATE INDEX idx_questions_type_part ON questions(question_type, part_number);
CREATE INDEX idx_questions_group ON questions(group_id);
CREATE INDEX idx_question_skills_skill ON question_skills(skill_id, question_id);
CREATE INDEX idx_user_attempts_user ON user_test_attempts(user_id, start_time DESC);
CREATE INDEX idx_user_answers_question ON user_answers(question_id);
CREATE INDEX idx_vocabulary_topic ON vocabulary(topic_id);
CREATE INDEX idx_assessments_user_date ON ai_assessments(user_id, created_at DESC);
CREATE INDEX idx_assessment_queue ON ai_assessments(created_at) WHERE status = 'pending';
CREATE INDEX idx_assessment_attempts_attempt ON assessment_attempts(attempt_id);

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

-- Gợi ý luyện tập theo kết quả đánh giá; không phải mục tiêu/lịch học/gamification.
CREATE TABLE assessment_recommendations (
    recommendation_id BIGSERIAL PRIMARY KEY,
    assessment_id BIGINT NOT NULL REFERENCES ai_assessments(assessment_id) ON DELETE CASCADE,
    skill_id INTEGER NOT NULL REFERENCES skills(skill_id),
    test_id INTEGER REFERENCES tests(test_id) ON DELETE SET NULL,
    priority INTEGER NOT NULL DEFAULT 1 CHECK (priority BETWEEN 1 AND 5),
    reason TEXT NOT NULL,
    instructions TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (assessment_id, skill_id)
);
CREATE INDEX idx_recommendations_test ON assessment_recommendations(test_id);

ALTER TABLE tests
    ADD CHECK (total_questions >= 0),
    ADD CHECK (time_limit > 0),
    ADD CHECK (parts <@ ARRAY[1,2,3,4,5,6,7]);
ALTER TABLE user_stats
    ADD CHECK (total_study_time >= 0 AND tests_completed >= 0),
    ADD CHECK (correct_answers >= 0 AND total_answers >= correct_answers);
COMMENT ON TABLE ai_assessments IS 'Lịch sử đánh giá năng lực từ bằng chứng làm bài; mỗi lần đánh giá là một bản ghi mới.';
COMMENT ON TABLE assessment_skill_results IS 'Điểm từng kỹ năng kèm số bằng chứng, nhận xét và mức độ đủ dữ liệu.';
COMMENT ON COLUMN user_test_attempts.score IS 'Điểm luyện tập kế thừa; không tự động tương đương điểm TOEIC chính thức.';
COMMENT ON COLUMN assessment_skill_results.feedback IS 'Nhận xét điểm mạnh/yếu và lỗi cần cải thiện dựa trên bằng chứng.';

-- Reference data only. No accounts, passwords, or fabricated learner results.
INSERT INTO vocabulary_topics (name, description) VALUES
('Business', 'Business and work'),
('Education', 'Education and training'),
('Technology', 'Technology and equipment'),
('Health', 'Health and wellbeing'),
('Travel', 'Travel and transportation')
ON CONFLICT (name) DO NOTHING;

INSERT INTO skills (code, name, section, description) VALUES
('listening_visual_detail', 'Nhận diện chi tiết trong tranh', 'listening', 'Liên hệ mô tả với người, vật và hành động trong tranh'),
('listening_response', 'Chọn phản hồi phù hợp', 'listening', 'Hiểu ý định câu hỏi và chọn lời đáp'),
('listening_main_idea', 'Nghe hiểu ý chính', 'listening', 'Xác định chủ đề, mục đích hội thoại hoặc bài nói'),
('listening_detail', 'Nghe thông tin chi tiết', 'listening', 'Nhận biết thời gian, địa điểm và thông tin cụ thể'),
('listening_inference', 'Suy luận khi nghe', 'listening', 'Suy ra ý định hoặc thông tin ngầm'),
('reading_word_form', 'Từ loại và dạng từ', 'reading', 'Chọn danh từ, động từ, tính từ hoặc trạng từ theo ngữ cảnh'),
('reading_verb_tense', 'Thì và dạng động từ', 'reading', 'Nhận biết thì và cấu trúc động từ'),
('reading_vocabulary', 'Từ vựng trong ngữ cảnh', 'reading', 'Hiểu nghĩa và cách kết hợp từ'),
('reading_cohesion', 'Liên kết văn bản', 'reading', 'Chọn từ nối hoặc câu phù hợp với mạch văn'),
('reading_main_idea', 'Đọc hiểu ý chính', 'reading', 'Xác định chủ đề và mục đích văn bản'),
('reading_detail', 'Đọc thông tin chi tiết', 'reading', 'Tìm thông tin cụ thể trong văn bản'),
('reading_inference', 'Suy luận khi đọc', 'reading', 'Suy ra thông tin từ bằng chứng trong văn bản'),
('reading_cross_passage', 'Đối chiếu nhiều văn bản', 'reading', 'Kết hợp thông tin từ nhiều ngữ liệu')
ON CONFLICT (code) DO NOTHING;


ALTER TABLE tests ADD COLUMN IF NOT EXISTS publication_status VARCHAR(20);
UPDATE tests SET publication_status=CASE WHEN is_active THEN 'published' ELSE 'draft' END WHERE publication_status IS NULL;
ALTER TABLE tests ALTER COLUMN publication_status SET NOT NULL;
CREATE OR REPLACE FUNCTION sync_test_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.publication_status := COALESCE(NEW.publication_status,CASE WHEN NEW.is_active THEN 'published' ELSE 'draft' END);
  ELSIF NEW.publication_status IS NOT DISTINCT FROM OLD.publication_status AND NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    NEW.publication_status := CASE WHEN NEW.is_active THEN 'published' ELSE 'draft' END;
  END IF;
  IF NEW.publication_status IS NULL OR NEW.publication_status NOT IN ('draft','published','unpublished') THEN
    RAISE EXCEPTION 'Invalid publication status' USING ERRCODE='23514';
  END IF;
  NEW.is_active := NEW.publication_status='published';
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tests_publication_sync ON tests;
CREATE TRIGGER tests_publication_sync BEFORE INSERT OR UPDATE ON tests FOR EACH ROW EXECUTE FUNCTION sync_test_publication();


COMMIT;



