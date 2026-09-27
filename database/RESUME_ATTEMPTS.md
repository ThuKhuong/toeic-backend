# Tiếp tục bài làm

- GET /api/tests/attempts/:id/resume: yêu cầu token và quyền sở hữu, lấy đúng snapshot của lượt làm; không tạo lượt mới.
- PUT /api/tests/attempts/:id/progress: lưu nguyên tử current_index (bắt đầu từ 0), elapsed_seconds và answers (question_id, user_answer, time_spent tính giây).
- Luyện tập (practice, part_test, mini_test): đồng hồ tạm dừng khi rời bài hoặc đưa app xuống nền.
- Thi thử full_test: deadline_at cố định trên server. Hết giờ không nhận thêm đáp án. Resume sau hết giờ tự chấm phần đã lưu rồi mở kết quả. Không có tác vụ nền tự chấm khi không ai truy cập; việc kết thúc xảy ra khi app nộp hoặc gọi resume.
- Bản dịch/lời giải/đáp án đúng và cờ is_correct không được gửi trong resume. API kết quả vẫn yêu cầu đã nộp.
- App lưu khi chọn đáp án, chuyển câu, rời bài và mỗi 10 giây. Nếu lỗi mạng, giữ tiến độ tạm trên thiết bị và thử đồng bộ trước khi resume. Muốn mở lại bài cần có kết nối. Với full_test, đáp án chưa đến server trước hạn sẽ không được nhận sau hạn.
- Không hỗ trợ hợp nhất hai thiết bị cùng sửa một lượt làm; nên tiếp tục trên một thiết bị tại một thời điểm.
- Thời gian bài đã nộp giữ đơn vị phút, thời gian tiến độ dùng giây. Tắt cưỡng bức app có thể mất tối đa phần thời gian từ lần lưu gần nhất.

Database đã có dữ liệu: chạy `npm run migrate:resume` trong toeic_be một lần (có thể chạy lại).
Schema gốc đã chứa cột mới. Migration không xóa dữ liệu; bài cũ ước tính thời gian đã luyện từ user_answers.time_spent. Lượt cũ không có attempt_questions không thể phục hồi chính xác và API sẽ báo lỗi rõ ràng.
