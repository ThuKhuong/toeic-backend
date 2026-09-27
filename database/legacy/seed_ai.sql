-- Reference data only. No accounts, passwords, or fabricated learner results.
BEGIN;
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
COMMIT;
