# Backend với schema đánh giá năng lực

Backend đã cập nhật theo `toeic_learning_system.sql`:

- Đăng nhập, hồ sơ và danh sách người dùng không còn XP, level, streak, target_score.
- Các route `/api/srs`, `/api/admin/srs`, `/api/gamification`, `/api/admin/gamification` đã gỡ khỏi server. Đã xóa mã nguồn hai module SRS/gamification khỏi backend.
- Dashboard thống kê hoạt động từ lượt thi; bỏ `srsCards`, `wordsStudiedToday`, `words_studied` vì không còn dữ liệu theo dõi ôn từ vựng.
- Tạo tài khoản và thống kê người dùng trong cùng một câu lệnh SQL.

## Hợp đồng API làm bài

1. `POST /api/tests/:id/attempt`: lấy người học từ JWT, không dùng `user_id` trong body. Trả thông tin lượt thi và `questions` lấy từ bản chụp vừa lưu. Client nên dùng mảng này để hiển thị bài thi. Đề trống hoặc thiếu lựa chọn hợp lệ trả 409.
2. `PUT /api/tests/attempts/:attempt_id/answer`: body gồm `question_id`, `user_answer` (A–D hoặc null để bỏ chọn), `time_spent` (số nguyên giây không âm, tổng thời gian cho câu). UPSERT, chấm theo bản chụp, không trả đúng/sai khi đang thi.
3. `PUT /api/tests/attempts/:attempt_id/complete`: chấm lại theo bản chụp, lưu kết quả và cập nhật thống kê trong transaction. Nộp lại trả kết quả cũ, không cộng thống kê lần nữa. Điểm `score` là phần trăm đúng trên toàn bộ câu đã phát, kể cả câu bỏ trống; không phải thang điểm TOEIC 990. Thời gian lượt thi là thời gian từ bắt đầu đến nộp, lưu theo phút.
4. `GET /api/tests/attempts/:attempt_id/results`: chỉ chủ lượt thi đã hoàn tất được xem; nội dung/đáp án/giải thích lấy từ bản chụp, kể cả câu chưa trả lời.

API xem đề công khai không còn hỗ trợ tiết lộ đáp án bằng `include_answers=true`. API quản trị vẫn có đáp án để biên tập.

Flutter/admin đã gỡ màn hình SRS, thành tích, XP và streak. Flutter sử dụng `questions` trong phản hồi bắt đầu thi, gửi `null` cho câu bỏ trống và chỉ hiển thị kết quả lấy từ backend. Hồ sơ tổng hợp thống kê từ các lượt thi hoàn tất; dashboard admin không gọi SRS. Quiz từ vựng chỉ hiển thị kết quả tại chỗ, không ghi lịch sử học qua API gamification cũ.

Chưa triển khai worker đánh giá AI. Không tự chuyển dữ liệu lượt thi cũ thiếu snapshot; những lượt này không có đủ nội dung lịch sử để chấm bằng luồng mới.

## Kiểm tra tích hợp

Chạy trong thư mục `toeic_be`, chỉ định PostgreSQL thử nghiệm riêng:

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/postgres'
node scripts/testAssessmentBackend.js
```

Script tạo schema ngẫu nhiên, nạp SQL, chạy HTTP API và xóa đúng schema thử khi kết thúc. Không đọc `.env` để chọn database kiểm thử. Kiểm tra đăng ký/đăng nhập, hồ sơ, lưu/chấm snapshot, câu bỏ trống, quyền chủ lượt thi, lưu/nộp đồng thời, lịch sử sau khi sửa ngân hàng, dashboard và các route đã gỡ.

## Dọn mã và SQL cũ

- Schema đang sử dụng: toeic_learning_system.sql (22 bảng, gồm import_batches).
- SQL, seed và tài liệu của các phiên bản cũ được lưu riêng trong legacy/, không nạp vào database hiện tại.
- Thống kê theo Part lấy từ attempt_questions của lượt đã hoàn tất; tính cả câu bỏ trống và không phụ thuộc câu hỏi đã sửa trong ngân hàng.
- Chạy npm test để kiểm tra cú pháp, import nội bộ và phát hiện tham chiếu cũ; npm run test:integration để kiểm tra với PostgreSQL thử nghiệm.


API quản trị xem kết quả dùng adminGetAttemptResults sau middleware ADMIN, tra chủ lượt thi rồi đọc snapshot. Lượt chưa nộp trả 409; người học không có quyền gọi API này. Kiểm thử tích hợp bao gồm thống kê Part sau khi sửa ngân hàng, loại lượt chưa nộp và kiểm tra API danh sách người dùng/đề/từ vựng/Reading/Listening.

