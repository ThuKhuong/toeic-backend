# Chỉ lưu trữ phiên bản cũ

Các file trong thư mục này không thuộc quy trình khởi tạo database hiện tại. Chúng được chuyển vào đây để tránh nhầm với `../toeic_learning_system.sql`.

- `schema.sql`: schema cũ có SRS, XP, streak và thành tích.
- `schema_ai.sql`, `seed_ai.sql`, `verify_ai.sql`: phiên bản AI trước khi tinh gọn; schema hiện tại đã chứa danh mục cần thiết.
- `sample_data.sql`: seed cũ dùng topic dạng chữ, không khớp khóa ngoại topic_id hiện tại.
- `sample_questions.sql`: phụ thuộc ID đề/ngữ liệu cố định của seed cũ.
- `sample_test_attempts.sql`: lượt thi giả với ID cố định, thiếu snapshot và sai đơn vị thời gian so với backend hiện tại.
- `DATABASE_DESIGN.md`: tài liệu lịch sử, đường dẫn và hướng dẫn bên trong không còn áp dụng.

Không chạy các file này vào database đang dùng. Muốn dùng lại nội dung mẫu cần chuyển đổi theo schema mới.
