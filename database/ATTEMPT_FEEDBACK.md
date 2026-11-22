# Nhận xét sau khi nộp bài

Phiên bản `attempt_feedback_v1`, ngày 05/11/2026.

- Backend tạo nhận xét từ thống kê chấm bằng snapshot của chính lượt làm, rồi lưu trong `user_test_attempts.grading_result.feedback`. Không cần migration.
- API hoàn tất và xem kết quả trả `grading.feedback`. Mở lịch sử của lượt cũ chưa có nhận xét sẽ tạo và lưu một lần, sau khi kiểm tra quyền sở hữu và trạng thái đã nộp.
- Nộp lại hoặc xem lại giữ nguyên nhận xét và không cộng lại thống kê. Khóa lượt làm trong transaction bảo vệ yêu cầu đồng thời.
- Không gọi Python/LightGBM trong luồng này. Nhận xét là quy tắc mô tả, không phải kết quả dự đoán mô hình. Hàm tạo nhận xét có fallback; lỗi tạo nhận xét không làm hỏng việc chấm bài.

## Nội dung

`scope=current_attempt`, `method=descriptive_rules`. Lưu phiên bản, thời điểm tạo, số câu làm căn cứ, đúng/sai/bỏ trống từng Part, nhận xét và danh sách luyện tiếp.

Tỷ lệ đúng là số đúng / tổng số câu của Part, bao gồm câu bỏ trống trong mẫu số. Không gán nhãn yếu/giỏi hoặc áp ngưỡng năng lực. Khi có nhiều Part đã trả lời, chỉ nói một Part thấp nhất nếu không đồng hạng. Part chưa trả lời không được diễn giải là thiếu năng lực. Toàn bài bỏ trống trả `insufficient_data`; đúng toàn bộ không gợi ý Part cần cải thiện.

Gợi ý tối đa ba Part đã có câu trả lời nhưng chưa đúng toàn bộ, theo tỷ lệ đúng tăng dần; đồng hạng sắp theo số sai rồi số Part để ổn định giao diện. Đây là thứ tự xem lại trong bài, không phải bằng chứng mức năng lực hay thứ tự khó của Part. Mỗi nhận xét nêu giới hạn số câu/độ khó và phạm vi bài vừa nộp.

## Flutter

Trang kết quả và lịch sử hiển thị “Nhận xét & hướng luyện tập”, số liệu theo Part và nút “Luyện thêm Part…”. Nút chuyển đến danh sách bài luyện đã lọc Part. Nếu đang có bài chưa hoàn tất, ứng dụng yêu cầu hoàn tất bài đó trước.

## Kiểm tra

```text
node --test scripts/testAttemptFeedback.js
node scripts/testPart7ReviewIntegration.js
```

Kiểm tra tích hợp dùng schema PostgreSQL riêng, gồm lưu nhận xét, nộp lại, thống kê không lặp, quyền sở hữu và tạo nhận xét cho lịch sử cũ. Flutter có `test/attempt_feedback_test.dart`, cùng hồi quy `grading_result_test.dart` và `part7_review_test.dart`.
