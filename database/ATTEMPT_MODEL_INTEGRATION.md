# LightGBM sau khi nộp bài — 05/11/2026

## Chạy hệ thống

Từ `toeic_be`, thay lệnh khởi động backend riêng bằng:

```powershell
npm run start:ai
```

Lệnh nạp artifact `toeic-ai/models/v2/lightgbm_v2.joblib` bằng Python venv, chờ `/health` đúng tên và SHA-256 mô hình, rồi mở Express. Không train lại. Nếu Python phù hợp đã chạy thì dùng lại. Dừng backend cũ đang chiếm cổng 3000 trước khi chạy lệnh này. Không tự dừng dịch vụ đã có.

Python mặc định `../toeic-ai/.venv/Scripts/python.exe` trên Windows; có thể đặt `AI_PYTHON`. `AI_SERVICE_URL` mặc định `http://127.0.0.1:8000`. Chạy riêng: từ `toeic-ai`, `.\.venv\Scripts\python.exe -m uvicorn api:app --app-dir src --host 127.0.0.1 --port 8000`. Các dependency trực tiếp đã xác minh nằm trong `toeic-ai/requirements.txt`.

Database hiện tại đã chạy migration. Database khác chạy `npm run migrate:attempt-ai` một lần. Dữ liệu được lưu ở cột JSONB `user_test_attempts.ai_prediction`, không thay thế `grading_result`.

## Luồng nghiệp vụ

1. Hoàn tất transaction chấm và lưu bài trước.
2. Backend gọi LightGBM qua Python cho các Part xuất hiện trong lượt làm. Dữ liệu đầu vào là tổng số câu đã trả lời/đúng và số câu đã trả lời/đúng theo Part trong các bài đã nộp, có thời điểm hoàn tất không sau lượt đang đánh giá. Nhãn so sánh từ snapshot.
3. Lưu đầu vào, mốc lịch sử, xác suất, model, SHA-256 artifact, feature version, thời gian thiếu và trạng thái từng Part. Dự đoán là xác suất trả lời đúng trong lượt tiếp theo theo Part, chưa phân biệt câu hỏi cụ thể.
4. Flutter hiển thị mục “Dự đoán từ mô hình AI”, tách khỏi điểm chấm và nhận xét quy tắc. Lịch sử đọc lại dự đoán đã lưu.

Không coi xác suất là điểm TOEIC hoặc tỷ lệ năng lực. Mô hình học trên Riiid, chưa được kiểm định chất lượng trên người dùng app. Backend đánh dấu thiếu thời gian vì chưa ánh xạ phép đo thời gian của app với đặc trưng Riiid.

## Lỗi và thử lại

- Mỗi Part timeout 4 giây, các Part gọi song song ngoài transaction chấm bài. AI lỗi không rollback bài nộp.
- Trạng thái `processing`, `ready`, `partial`, `failed`, `insufficient_data`. Kết quả lỗi được giữ để giao diện hiện nút thử lại.
- `POST /api/tests/attempts/:attempt_id/ai-prediction` yêu cầu JWT chủ lượt làm và bài đã nộp. Thử lại dùng đầu vào đã lưu, không cộng lịch sử mới; giữ lại các Part đã dự đoán thành công.
- Claim nguyên tử trên hàng lượt làm, token và lease 60 giây bảo vệ yêu cầu đồng thời và cho phục hồi nếu process dừng. Không chạy hai job cùng lúc trên cùng lượt. Khi đang xử lý, nút cập nhật lấy trạng thái hiện tại; hết lease có thể chạy lại.
- API complete/results tự chạy lần đầu khi chưa có dự đoán, gồm cả lượt cũ. GET results có thể tạo dự đoán một lần; kết quả lịch sử sau đó ổn định.

## Kiểm thử

Khởi chạy Python thật rồi chạy từ `toeic_be`:

```powershell
npm run test:attempt-ai
npm test
```

Test tạo/xóa schema fixture riêng, không ghi dữ liệu học viên thật. Đã kiểm tra suy luận LightGBM thật qua HTTP backend, lưu DB, lịch sử cố định, offline/retry, cache, tranh chấp và quyền sở hữu. Flutter: `model_prediction_test.dart`, `attempt_feedback_test.dart`, `grading_result_test.dart`, `part7_review_test.dart`; Dart analyze sạch. Chưa kiểm tra trực tiếp trên điện thoại.
