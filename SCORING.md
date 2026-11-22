# Chấm bài và điểm TOEIC ước tính

Backend đối chiếu đáp án với snapshot tại thời điểm bắt đầu bài. Câu sai và bỏ trống không cộng điểm, không trừ điểm. `score` cũ vẫn là tỷ lệ đúng 0–100 để không thay đổi các thống kê hiện có.

`grading_result` lưu thống kê đúng/sai/bỏ trống theo Part, điểm ước tính, phiên bản công thức và nguồn tham khảo tại lần hoàn tất đầu tiên. Nộp lại không cộng thống kê hai lần. Lịch sử mới giữ nguyên công thức đã dùng. Lượt cũ chưa có grading_result được tính từ snapshot khi xem lại, không sửa dữ liệu lịch sử.

Điểm Listening/Reading chỉ được ước tính khi có đủ cấu trúc 100 câu: Part 1–4 là 6/25/39/30; Part 5–7 là 30/16/54. Tổng 10–990 chỉ xuất hiện nếu đủ cả hai phần. Không ngoại suy từ bài chỉ luyện một Part.

Phiên bản `practice-reference-interpolation-v1` nội suy tuyến tính giữa các mốc số câu đúng của bảng luyện tập WIE, làm tròn về bội số 5, giới hạn mỗi phần 5–495. Đây là phép ước tính của ứng dụng, không phải toàn bộ bảng WIE và không phải bảng quy đổi ETS. Mốc 0 câu đúng được đặt bằng điểm sàn 5. Không nhân tỷ lệ đúng với 990.

Nguồn tham khảo: https://wie.ac.nz/toeicconversion.htm

Thông tin về thang điểm và hiệu chỉnh điểm ETS: https://www.ets.org/content/ets-org/ca/en/toeic/test-takers/faq/product-specific-faq/toeic-listening-reading.html

Cập nhật database hiện có: `node scripts/migrateAttemptGrading.js` từ thư mục toeic_be. Kiểm tra luồng chấm trên PostgreSQL bằng `node scripts/testGrading.js`; dữ liệu thử nghiệm được rollback.
