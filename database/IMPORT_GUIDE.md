# Nhập câu hỏi TOEIC

## Tải và sử dụng bộ mẫu mới

Trong admin, chọn Part rồi bấm **Tải ZIP mẫu** (Part 5: tải Excel mẫu).
Giải nén, đọc `HUONG_DAN.txt`, sửa `questions.xlsx`, thay media trong `audio/` và `images/`,
lưu và đóng Excel rồi nén lại các file/thư mục thành ZIP để import. Giữ nguyên tên cột và sheet.
Backend bỏ qua `HUONG_DAN.txt`, nên không cần xóa hướng dẫn trước khi nén.

Audio WAV mẫu chỉ là tiếng bíp kiểm tra đường dẫn, không chứa bài nghe. Ảnh và các dòng
có nhãn MẪU là khung để thay dữ liệu, không phải đề thi hoàn chỉnh. Hãy thay hoặc xóa hết
dòng mẫu trước khi nhập câu hỏi thật; hệ thống vẫn lưu chúng nếu import nguyên bản.

Bộ mẫu gồm Part 1: 2 câu; Part 2: 2 câu; Part 3 và 4: mỗi Part 2 nhóm × 3 câu;
Part 5: 1 câu; Part 6: 4 câu; Part 7: nhóm đơn 2 câu, nhóm đôi 5 câu, nhóm ba 5 câu.
Part 7 dùng cột `passage_keys` với giá trị như `p7_2_1|p7_2_2`.

Để tạo lại bộ mẫu và kiểm tra cấu trúc bằng parser backend, chạy `npm run generate:import-templates`
trong toeic_be. Lệnh ghi đè các file mẫu trong toeic_admin_vite/public/templates, không ghi database.

## Lưu trữ

- PostgreSQL lưu câu hỏi, lựa chọn, đáp án đúng, lời giải, nhóm câu và liên kết ngữ liệu Part 1–7.
- Ảnh/audio lưu tại `toeic_be/uploads/imports/`; database lưu URL `/uploads/imports/...`. Backup cả database và uploads. Không lưu ngân hàng câu hỏi chỉ trên điện thoại.
- Excel/ZIP là đầu vào, được xử lý trong `.import-tmp/` và dọn sau mỗi yêu cầu. Chỉ media được tham chiếu mới chuyển sang uploads.
- Khi triển khai, dùng ổ đĩa bền vững cho uploads hoặc chuyển media sang object storage nếu chạy nhiều backend. Không phụ thuộc ổ đĩa tạm của container.

## Database đang có dữ liệu

Chạy `npm run migrate:imports` trong toeic_be, rồi khởi động lại backend. Migration chỉ thêm bảng import_batches; không chạy lại toàn bộ schema để nâng cấp database có dữ liệu.

## Quy tắc chung

Một dòng sai sẽ hủy toàn bộ lần nhập, trả HTTP 422 cùng tên file, sheet, dòng và cột lỗi. Không âm thầm bỏ dòng. Lỗi ghi SQL cũng rollback cả đợt.

Nhập lại cùng ZIP đã thành công sẽ trả created=0 và duplicate=true. JSON được nhận diện theo dữ liệu đã chuẩn hóa. Registry không tự dọn dữ liệu trùng đã tồn tại từ trước; ZIP đóng gói lại có thể có fingerprint khác. Sau khi xóa câu hỏi, nhập lại đúng file cũ vẫn được coi là đợt đã nhập.

Tối đa 2000 câu/đợt; ZIP tải lên 50 MB, tối đa 500 mục và 200 MB giải nén; tối đa 20 workbook. XLSX có giới hạn nội dung giải nén riêng 40 MB. Từ chối đường dẫn vượt thư mục, ZIP mã hóa, symlink và loại file ngoài danh sách hỗ trợ.

Media local phải tồn tại; đường dẫn tương đối được tìm từ thư mục workbook rồi gốc ZIP. Nếu chỉ dùng tên file, tên phải duy nhất. URL http(s) được chấp nhận nhưng backend không kiểm tra khả năng truy cập hay nội dung audio từ xa. Kiểm tra phát audio/hiển thị ảnh sau nhập; kiểm tra phần mở rộng không thay thế kiểm tra nội dung media.

## Listening: Part 1–4

ZIP chứa workbook và media. Các cột: part_number, question_text, choiceA, choiceB, choiceC, choiceD, correct_answer, explanation, audio_path, image_path, material_title, transcript, group_key.

- Part 1: ảnh và audio bắt buộc; 4 lựa chọn A–D.
- Part 2: audio bắt buộc; đúng 3 lựa chọn A–C, để trống cột D.
- Part 3–4: mỗi group_key có đúng 3 câu và dùng chung thông tin audio/ngữ liệu. Nên ghi đầy đủ thông tin chung giống nhau ở cả 3 dòng. Hai nhóm dùng cùng audio nên có group_key khác nhau.
- correct_answer là A/B/C/D phù hợp Part. Lời giải được lưu từ explanation.

## Bản dịch và lời giải Part 2 sau khi nộp bài

Điền `question_text` và `choiceA`, `choiceB`, `choiceC` bằng tiếng Anh.
Trong ô `explanation`, nhập bản dịch và lời giải tiếng Việt theo mẫu sau
(Alt+Enter để xuống dòng trong Excel):

```text
DỊCH CÂU HỎI
Cuộc họp bắt đầu lúc mấy giờ?

DỊCH CÁC LỰA CHỌN
A. Lúc 9 giờ.
B. Trong phòng họp.
C. Ông Smith sẽ chủ trì cuộc họp.

GIẢI THÍCH
Đáp án A đúng vì “When” hỏi về thời gian. B nói về địa điểm; C nói về người chủ trì.
```

App ẩn câu hỏi và nội dung lựa chọn trong lúc làm Part 2. Sau khi nộp, màn hình
kết quả hiện tiếng Anh, đáp án đã chọn/đáp án đúng và toàn bộ ô explanation.
Bản dịch do quản trị viên nhập, hệ thống không tự dịch. ZIP mẫu Part 2 có hai ví dụ.
Bài làm đã bắt đầu lưu bản chụp dữ liệu lúc bắt đầu, nên thay lời giải trong ngân hàng
chỉ áp dụng cho lượt làm mới, không tự thay nội dung lịch sử cũ.

## Định dạng Reading

Part 5 nhập Excel qua trang admin, gồm question_text, A, B, C, D, correct_answer, explanation; dùng file mẫu trên giao diện.

Part 6–7 nhập ZIP. Mỗi workbook có hai sheet tên chính xác `passages` và `questions`:

- passages: key, title, content, image_url. Mỗi key duy nhất trong workbook; ngữ liệu phải có text hoặc ảnh.
- questions: passage_key (một ngữ liệu) hoặc passage_keys (ví dụ p1|p2), group_key, question_text, A, B, C, D, correct_answer, explanation.
- Part 6: một ngữ liệu, đúng 4 câu mỗi nhóm.
- Part 7: 1–3 ngữ liệu; nhóm một ngữ liệu có 2–5 câu, nhóm nhiều ngữ liệu có 5 câu. Các câu cùng nhóm phải dùng cùng danh sách ngữ liệu theo cùng thứ tự.
- Key ở hai workbook khác nhau không bị gộp chung.

## Kiểm thử

`npm test` kiểm tra schema và mã backend. Đặt TEST_DATABASE_URL tới PostgreSQL kiểm thử rồi chạy `npm run test:imports` và `npm run test:integration`; các bộ kiểm thử dùng schema tạm riêng và dọn sau khi chạy. Không đặt TEST_DATABASE_URL tới hệ thống production.

File mẫu không có cột độ khó. Import bỏ qua cột difficulty_level trong file cũ, dùng giá trị nội bộ mặc định 1 để tương thích database.
