# Sổ từ do người dùng tự nhập

Từ vựng và chủ đề do người dùng tự tạo, thuộc riêng tài khoản của họ. Admin không còn trang quản lý, import hoặc API CRUD từ vựng. Mọi API dưới `/api/student/vocabulary` yêu cầu Bearer token và lấy user_id từ token.

## Database

Database hiện có: chạy `npm run migrate:personal-vocabulary` từ `toeic_be`, rồi khởi động lại backend. Lệnh áp dụng cả migration học từ và migration quyền sở hữu, có thể chạy lại. Database mới dùng `toeic_learning_system.sql`.

Các từ/chủ đề admin cũ có owner_user_id NULL được giữ để bảo toàn dữ liệu và quan hệ câu hỏi cũ, không hiển thị trong sổ từ hoặc đáp án quiz cá nhân. Không tự gán nội dung cũ cho bất kỳ người dùng nào. Tiến độ và snapshot cũ vẫn lưu trong database; phiên học mới chỉ sử dụng từ thuộc tài khoản hiện tại.

## Luồng sử dụng

**Từ vựng → Thêm từ → Nhập từ tiếng Anh, nghĩa tiếng Việt → Chọn chủ đề hoặc Chưa phân loại → Lưu từ → Học flashcard / Làm quiz.** Phiên âm, loại từ, ví dụ và dịch ví dụ là tùy chọn. Sửa/xóa từ qua menu trên từng thẻ. Chức năng đánh dấu giúp ưu tiên một nhóm từ trong sổ cá nhân.

Tạo chủ đề ngay trong form nhập từ hoặc mở **Chủ đề của tôi** để thêm, sửa, xóa. Hai tài khoản có thể dùng cùng tên chủ đề. Xóa chủ đề chuyển các từ sang Chưa phân loại và giữ tiến độ. Sửa từ hoặc nghĩa chuyển từ đã học sang Cần ôn; sửa ví dụ hoặc đổi chủ đề không xóa trạng thái ghi nhớ.

Flashcard mặc định 10 từ/lượt. Lật thẻ, chọn Đã nhớ/Cần ôn; server lưu đánh giá và vị trí cùng transaction. Mở lại đúng phạm vi tiếp tục lượt chưa hoàn thành. Từ chưa học được ưu tiên trước, rồi đến từ cần ôn và từ đã nhớ.

Quiz chỉ lấy câu hỏi và các lựa chọn từ chính sổ từ của tài khoản. Cần ít nhất hai nghĩa khác nhau trong sổ để tạo quiz. Server chấm bằng snapshot; nộp lại cùng lượt không cộng lỗi hai lần. Từ sai/bỏ trống vào Cần ôn; kết quả có nút học flashcard và quiz lại nhóm này. Kết quả từ vựng độc lập với lịch sử luyện đề TOEIC.

Đã học là số từ từng được đánh giá flashcard/chấm quiz. Đã nhớ là trạng thái hiện tại known, Cần ôn dùng needs_review. Thống kê tính theo chủ đề đang chọn, độc lập với bộ lọc đánh dấu.

## API

| Method | Đường dẫn dưới `/api/student/vocabulary` | Dữ liệu |
|---|---|---|
| GET | `/` | Chỉ các từ thuộc tài khoản |
| POST | `/` | word, meaning_vi bắt buộc; topic_id và các trường mô tả tùy chọn |
| PUT | `/:id` | Nội dung từ, cùng các trường như POST |
| DELETE | `/:id` | Xóa từ và tiến độ tương ứng |
| GET | `/categories/list` | Chủ đề của tài khoản và số từ |
| POST | `/topics` | `{name}` |
| PUT | `/topics/:id` | `{name}` |
| DELETE | `/topics/:id` | Giữ từ, chuyển sang chưa phân loại |
| GET | `/learning` | Trạng thái học từ |
| PUT | `/:id/saved` | `{saved: boolean}` |
| POST | `/study/sessions` | Bộ lọc; tiếp tục hoặc tạo lượt flashcard |
| PUT | `/study/sessions/:id/card` | `{vocab_id, known: boolean}` |
| POST | `/quiz/sessions` | Bộ lọc; câu hỏi không kèm đáp án |
| POST | `/quiz/sessions/:id/finish` | `{answers: [{vocab_id, selected_label}]}` |

Bộ lọc: scope = all/saved/review; topic_id tùy chọn; unassigned:true cho chưa phân loại; vocab_ids từ 1–50 ID; count mặc định 10, tối đa 20. Không dùng topic_id cùng unassigned:true. Các ID của người khác không được đọc, sửa, xóa hoặc dùng làm thẻ học/đáp án.

## Kiểm tra

`npm test`, `npm run test:vocabulary`, `npm run test:vocabulary:integration`. Integration dùng TEST_DATABASE_URL nếu có, nếu không dùng cấu hình PostgreSQL trong .env; tạo schema ngẫu nhiên riêng và xóa khi kết thúc, không sửa dữ liệu ứng dụng. Flutter: `flutter test test/vocabulary_learning_test.dart`.
