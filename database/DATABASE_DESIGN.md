# Database hiện tại

File khởi tạo duy nhất: **toeic_learning_system.sql**. File này đã chứa danh mục kỹ năng và chủ đề mặc định, chỉ chạy một lần trên database trống.

Backend giữ các nhóm chức năng:

| Nhóm | Bảng |
|---|---|
| Tài khoản, thống kê | User, user_stats |
| Từ vựng | vocabulary_topics, vocabulary |
| Ngữ liệu | reading_passages, listening_materials |
| Đề và câu hỏi | tests, questions, answer_choices, question_groups, question_group_passages |
| Làm bài | user_test_attempts, attempt_questions, user_answers |
| Đánh giá năng lực | skills, question_skills, ai_assessments, assessment_attempts, assessment_skill_results, assessment_score_predictions, assessment_recommendations |

Không còn module SRS, XP, cấp độ người dùng, chuỗi ngày học, mục tiêu hoặc thành tích. `difficulty_level` là độ khó của học liệu và vẫn được giữ. `user_stats` vẫn phục vụ thống kê lượt thi. Các bảng AI phục vụ đề tài nhưng worker đánh giá AI chưa được triển khai.

## Database đã được tạo

Không chạy lại schema và không nạp các file trong `legacy/`. Giữ cấu hình kết nối hiện tại trong `.env`, chạy backend bằng `npm run dev` từ thư mục `toeic_be`.

## Kiểm tra

- `npm test`: kiểm tra mã nguồn, cú pháp, import và tham chiếu tính năng đã bỏ, không truy cập database.
- `npm run test:integration`: yêu cầu `TEST_DATABASE_URL` trỏ đến PostgreSQL thử nghiệm riêng; tự tạo và xóa schema thử nghiệm.
- `verify_toeic_assessment.sql`: kiểm tra ràng buộc schema, chỉ dùng trên database thử nghiệm vì sequence có thể tăng dù transaction rollback.

Chi tiết API: [BACKEND_ASSESSMENT.md](BACKEND_ASSESSMENT.md).
