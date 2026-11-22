# AI đánh giá khả năng trả lời đúng

## Sử dụng

1. Khởi động lại backend (`npm run dev` trong `toeic_be`) và web admin.
2. Web admin → **Đánh giá AI**: xem số dữ liệu đủ điều kiện, bấm **Huấn luyện và so sánh mô hình** khi đủ dữ liệu.
3. App → **Hồ sơ → Đánh giá năng lực → Cập nhật đánh giá** sau khi nộp bài. Cần hot restart/build app để nhận màn hình mới.
4. Mỗi lần cập nhật thành công lưu một bản ghi mới trong `ai_assessments` và liên kết bằng chứng trong `assessment_attempts`.

Không cần API key, Python hay dịch vụ AI trả phí. Không sửa cấu trúc database: tận dụng các bảng AI đã có trong schema hiện hành. Đây là mô hình học máy dự đoán đúng/sai, không phải chức năng dịch thuật hoặc chatbot.

Ngày triển khai kiểm tra database thật có 10 câu trả lời đủ điều kiện / 3 lượt làm / 2 tài khoản. Chưa đủ huấn luyện. Không có kết quả mô hình thật để báo cáo độ chính xác.

## Dữ liệu và đặc trưng

- Chỉ lấy lượt đã nộp, có thời điểm kết thúc, đáp án đã chọn và nhãn `is_correct`, có snapshot Part hợp lệ.
- Câu bỏ trống và lượt đang làm không đưa vào tập huấn luyện. Vì vậy xác suất là khả năng đúng **khi người học trả lời**, không dự đoán việc bỏ câu/hết giờ.
- Đặc trưng `history-v1`: bias; tỷ lệ đúng làm trơn Laplace `(correct+1)/(count+2)` và `log(1+count)/10` cho người học, người học–Part, câu hỏi, người học–câu hỏi; 7 biến one-hot Part.
- Không đưa tên, email, nội dung đáp án đúng, lời giải, điểm kết thúc bài hay thời gian trả lời câu đang dự đoán vào đặc trưng.
- Với mỗi mẫu huấn luyện, chỉ dùng kết quả các lượt **kết thúc trước khi lượt đó bắt đầu**. Những câu trong cùng lượt không nhìn thấy nhãn của nhau.
- Người học/câu hỏi mới dùng prior 0.5 và count 0. Không dùng cột độ khó do quản trị viên gán.

## Huấn luyện và đánh giá

Triển khai JavaScript thuần, mã thuật toán tại `src/modules/ai/engine.js`:

1. Baseline: xác suất đúng chung của tập train, làm trơn Laplace.
2. Logistic regression: batch gradient descent 400 vòng, learning rate 0.3, L2=0.01, không regularize bias.
3. Gaussian Naive Bayes: trung bình/phương sai theo lớp, variance floor 0.01. Là mô hình so sánh đơn giản; giả định độc lập và Gaussian chỉ xấp xỉ với các đặc trưng hiện tại.

Chia theo các mốc thời gian bắt đầu thành khoảng 60% train / 20% validation / 20% test. Không cắt một lượt giữa các tập. Loại lượt giao qua mốc kết thúc train/validation. Tỷ lệ mẫu thực tế có thể khác 60/20/20.

Ngưỡng chạy tối thiểu: 200 câu trả lời, 20 lượt, 5 người học; mỗi tập ít nhất 20 mẫu và có cả hai nhãn đúng/sai. Đây là ngưỡng kỹ thuật phục vụ triển khai, **không chứng minh đủ cỡ mẫu nghiên cứu**.

Chọn mô hình bằng **log-loss validation thấp nhất**; sau đó báo cáo test log-loss, Brier, ROC-AUC (xử lý ties), accuracy ngưỡng 0.5, F1 lớp đúng, confusion matrix. Không dùng test để chọn mô hình. Giữ nguyên trọng số đã được kiểm thử khi triển khai, không âm thầm refit rồi gán số đo cũ cho mô hình mới. Baseline có thể thắng và được chọn; không ép chọn mô hình phức tạp.

Đánh giá theo kịch bản tuần tự: trọng số cố định, nhưng lịch sử của các lượt validation/test đã kết thúc trước đó được cập nhật vào đặc trưng cho lượt tiếp theo. Đây không phải benchmark cold-start cho người học mới. Cần bổ sung đánh giá tách người học, nhiều mốc thời gian, khoảng tin cậy và calibration khi có dữ liệu nghiên cứu đủ lớn. Việc luyện lặp lại một câu được phản ánh bằng lịch sử người học–câu hỏi; kết quả không đo riêng khả năng tổng quát hóa sang câu chưa gặp.

## Lưu trữ và API

- Mô hình, báo cáo JSON: `toeic_be/private/ai/`, không public qua `/uploads`, được gitignore. Giữ file theo phiên bản và cập nhật `active.json` bằng rename sau khi ghi xong.
- `AI_MODEL_DIR` tùy chọn để chỉ định thư mục riêng (kiểm thử dùng thư mục tạm). Không trỏ vào `uploads`.
- Worker thread huấn luyện để không chặn vòng lặp xử lý API; một job tại một thời điểm trong một process. Nếu huấn luyện thất bại, mô hình đang dùng vẫn được giữ.
- `GET /api/ai/admin/status`: JWT ADMIN, số liệu sẵn sàng, trạng thái huấn luyện, lỗi lần gần nhất và báo cáo mô hình đang dùng.
- `POST /api/ai/admin/train`: JWT ADMIN, trả 202 khi bắt đầu; 422 nếu chưa đủ dữ liệu, 409 nếu đang chạy. Admin tự polling trạng thái.
- `GET /api/ai/me`: đánh giá đã lưu gần nhất của chủ JWT, không tạo bản ghi mới.
- `POST /api/ai/me`: tạo đánh giá mới cho chủ JWT; không nhận user_id từ client. Trả trạng thái `not_trained` / `insufficient_data` nếu chưa sẵn sàng.

Đánh giá lấy xác suất trung bình trên các câu thuộc đề đang xuất bản của từng Part. Chỉ hiển thị xác suất Part khi có ít nhất 5 câu đã trả lời ở Part đó và ngân hàng có câu tương ứng; tổng người học cần tối thiểu 10 câu. Lưu vector đặc trưng tại thời điểm dự đoán trong `input_snapshot` để có thể tái hiện cùng artifact, cùng kết quả.

Nhận xét luyện tập dùng quy tắc minh bạch: xác suất dưới 0.6 → ưu tiên luyện thêm. Đây là ngưỡng gợi ý ban đầu, chưa hiệu chuẩn thành chuẩn năng lực. Không ghi vào `assessment_score_predictions`, không quy đổi xác suất thành điểm TOEIC 10–990. Chưa chấm theo kỹ năng ngữ pháp chi tiết trong `assessment_skill_results`; hiện đánh giá theo Part 1–7 trong output JSON.

## Kiểm thử và giới hạn

```powershell
npm run test:ai
npm test
$env:TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:15439/postgres'
npm run test:ai:integration
```

Integration dùng PostgreSQL test được chỉ định, schema ngẫu nhiên và thư mục mô hình tạm. Dữ liệu tổng hợp chỉ kiểm tra thuật toán/API/lưu trữ, không phải kết quả thực nghiệm đồ án. Schema và artifact kiểm thử được dọn sau khi chạy.

Thiết kế hiện tại dành cho một backend và dữ liệu đồ án vừa phải: đọc lịch sử vào RAM để trích đặc trưng, model JSON lưu local. Nhiều backend đồng thời cần khóa/job queue dùng chung và kho artifact chung; dữ liệu lớn cần pipeline trích đặc trưng theo batch. Hệ thống chưa có tự huấn luyện định kỳ, theo dõi drift hay cập nhật đánh giá tự động khi nộp; người học chủ động bấm cập nhật, admin chủ động huấn luyện lại.
