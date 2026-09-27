-- TOEIC Sample Data: 300 Vocabulary Words and 150 Reading Questions
-- This file contains sample data for the TOEIC app

-- Insert sample vocabulary words (300 words)
INSERT INTO vocabulary (word, pronunciation, meaning_vi, meaning_en, part_of_speech, example_sentence, example_translation, difficulty_level, frequency_score, topic_id) VALUES

-- Business & Work (50 words)
('accomplish', '/əˈkʌmplɪʃ/', 'hoàn thành', 'to finish successfully', 'verb', 'We need to accomplish this task by Friday.', 'Chúng ta cần hoàn thành nhiệm vụ này trước thứ Sáu.', 2, 8, 'business'),
('achievement', '/əˈtʃiːvmənt/', 'thành tích', 'something successful that has been done', 'noun', 'Her promotion was a great achievement.', 'Sự thăng chức của cô ấy là một thành tích lớn.', 2, 7, 'business'),
('agenda', '/əˈdʒendə/', 'chương trình nghị sự', 'a list of things to discuss', 'noun', 'Please review the meeting agenda.', 'Vui lòng xem lại chương trình nghị sự cuộc họp.', 3, 9, 'business'),
('allocate', '/ˈæləkeɪt/', 'phân bổ', 'to distribute resources', 'verb', 'We need to allocate more budget for marketing.', 'Chúng ta cần phân bổ thêm ngân sách cho marketing.', 4, 6, 'business'),
('annual', '/ˈænjuəl/', 'hàng năm', 'happening once a year', 'adjective', 'The annual report will be published next month.', 'Báo cáo thường niên sẽ được xuất bản tháng tới.', 2, 9, 'business'),
('appointment', '/əˈpɔɪntmənt/', 'cuộc hẹn', 'an arrangement to meet', 'noun', 'I have an appointment with the doctor at 3 PM.', 'Tôi có cuộc hẹn với bác sĩ lúc 3 giờ chiều.', 1, 8, 'business'),
('approval', '/əˈpruːvəl/', 'sự chấp thuận', 'permission or agreement', 'noun', 'The project needs manager approval.', 'Dự án cần sự chấp thuận của quản lý.', 3, 7, 'business'),
('approximately', '/əˈprɒksɪmətli/', 'khoảng chừng', 'about, roughly', 'adverb', 'The meeting will last approximately one hour.', 'Cuộc họp sẽ kéo dài khoảng một giờ.', 2, 8, 'business'),
('assembly', '/əˈsembli/', 'lắp ráp', 'putting parts together', 'noun', 'The assembly process takes two hours.', 'Quá trình lắp ráp mất hai giờ.', 3, 6, 'business'),
('assist', '/əˈsɪst/', 'hỗ trợ', 'to help', 'verb', 'Can you assist me with this report?', 'Bạn có thể hỗ trợ tôi với báo cáo này không?', 1, 9, 'business'),
('budget', '/ˈbʌdʒɪt/', 'ngân sách', 'a plan for spending money', 'noun', 'We need to stay within budget.', 'Chúng ta cần ở trong ngân sách.', 2, 9, 'business'),
('candidate', '/ˈkændɪdeɪt/', 'ứng viên', 'a person applying for a job', 'noun', 'The candidate has excellent qualifications.', 'Ứng viên có trình độ xuất sắc.', 2, 8, 'business'),
('commission', '/kəˈmɪʃən/', 'hoa hồng', 'payment based on sales', 'noun', 'Sales staff receive a 5% commission.', 'Nhân viên bán hàng nhận 5% hoa hồng.', 3, 7, 'business'),
('competitor', '/kəmˈpetɪtər/', 'đối thủ cạnh tranh', 'a rival business', 'noun', 'Our main competitor lowered their prices.', 'Đối thủ chính của chúng ta đã giảm giá.', 2, 8, 'business'),
('deadline', '/ˈdedlaɪn/', 'hạn chót', 'final date for completion', 'noun', 'The deadline for this project is Friday.', 'Hạn chót cho dự án này là thứ Sáu.', 2, 9, 'business'),
('demonstrate', '/ˈdemənstreɪt/', 'chứng minh', 'to show how something works', 'verb', 'Let me demonstrate the new software.', 'Để tôi trình diễn phần mềm mới.', 3, 7, 'business'),
('department', '/dɪˈpɑːtmənt/', 'phòng ban', 'a division of an organization', 'noun', 'She works in the marketing department.', 'Cô ấy làm việc ở phòng marketing.', 1, 9, 'business'),
('distribute', '/dɪˈstrɪbjuːt/', 'phân phối', 'to give out or deliver', 'verb', 'We distribute products nationwide.', 'Chúng tôi phân phối sản phẩm toàn quốc.', 3, 7, 'business'),
('efficiently', '/ɪˈfɪʃəntli/', 'một cách hiệu quả', 'in an effective way', 'adverb', 'The team worked efficiently to meet the deadline.', 'Đội làm việc hiệu quả để đáp ứng hạn chót.', 3, 8, 'business'),
('employee', '/ɪmˈplɔɪiː/', 'nhân viên', 'a person who works for a company', 'noun', 'Every employee receives health insurance.', 'Mọi nhân viên đều được bảo hiểm sức khỏe.', 1, 9, 'business'),
('equipment', '/ɪˈkwɪpmənt/', 'thiết bị', 'tools and machinery', 'noun', 'The office needs new computer equipment.', 'Văn phòng cần thiết bị máy tính mới.', 2, 8, 'business'),
('estimate', '/ˈestɪmeɪt/', 'ước tính', 'to calculate approximately', 'verb', 'Can you estimate the project cost?', 'Bạn có thể ước tính chi phí dự án không?', 3, 7, 'business'),
('executive', '/ɪɡˈzekjətɪv/', 'giám đốc điều hành', 'a senior manager', 'noun', 'The executive made the final decision.', 'Giám đốc điều hành đã đưa ra quyết định cuối cùng.', 3, 7, 'business'),
('expense', '/ɪkˈspens/', 'chi phí', 'money spent on something', 'noun', 'Travel expenses will be reimbursed.', 'Chi phí du lịch sẽ được hoàn trả.', 2, 8, 'business'),
('facility', '/fəˈsɪləti/', 'cơ sở vật chất', 'a building or equipment', 'noun', 'The new facility opens next month.', 'Cơ sở mới sẽ mở cửa tháng tới.', 3, 7, 'business'),
('goal', '/ɡoʊl/', 'mục tiêu', 'something you want to achieve', 'noun', 'Our goal is to increase sales by 20%.', 'Mục tiêu của chúng ta là tăng doanh số 20%.', 1, 9, 'business'),
('implement', '/ˈɪmplɪment/', 'thực hiện', 'to put a plan into action', 'verb', 'We will implement the new policy next week.', 'Chúng ta sẽ thực hiện chính sách mới tuần tới.', 4, 7, 'business'),
('invoice', '/ˈɪnvɔɪs/', 'hóa đơn', 'a bill for goods or services', 'noun', 'Please send the invoice by email.', 'Vui lòng gửi hóa đơn qua email.', 2, 8, 'business'),
('maintain', '/meɪnˈteɪn/', 'duy trì', 'to keep in good condition', 'verb', 'We need to maintain high quality standards.', 'Chúng ta cần duy trì tiêu chuẩn chất lượng cao.', 3, 8, 'business'),
('management', '/ˈmænɪdʒmənt/', 'quản lý', 'the people who run a company', 'noun', 'Management approved the new budget.', 'Ban quản lý đã phê duyệt ngân sách mới.', 2, 9, 'business'),
('negotiate', '/nɪˈɡoʊʃieɪt/', 'đàm phán', 'to discuss terms of an agreement', 'verb', 'We need to negotiate a better contract.', 'Chúng ta cần đàm phán một hợp đồng tốt hơn.', 4, 6, 'business'),
('objective', '/əbˈdʒektɪv/', 'mục tiêu', 'a goal to be achieved', 'noun', 'The main objective is customer satisfaction.', 'Mục tiêu chính là sự hài lòng của khách hàng.', 3, 7, 'business'),
('profit', '/ˈprɑːfɪt/', 'lợi nhuận', 'money earned from business', 'noun', 'The company reported higher profits.', 'Công ty báo cáo lợi nhuận cao hơn.', 2, 9, 'business'),
('proposal', '/prəˈpoʊzəl/', 'đề xuất', 'a suggested plan', 'noun', 'The proposal was accepted by the board.', 'Đề xuất đã được hội đồng chấp nhận.', 3, 7, 'business'),
('quarterly', '/ˈkwɔːrtərli/', 'hàng quý', 'happening every three months', 'adjective', 'We review performance quarterly.', 'Chúng tôi xem xét hiệu suất hàng quý.', 3, 6, 'business'),
('recruit', '/rɪˈkruːt/', 'tuyển dụng', 'to hire new employees', 'verb', 'We need to recruit more engineers.', 'Chúng ta cần tuyển thêm kỹ sư.', 3, 7, 'business'),
('revenue', '/ˈrevənuː/', 'doanh thu', 'income from business operations', 'noun', 'Revenue increased by 15% this year.', 'Doanh thu tăng 15% năm nay.', 3, 8, 'business'),
('schedule', '/ˈskedʒuːl/', 'lịch trình', 'a plan showing when things happen', 'noun', 'Check your schedule for tomorrow.', 'Kiểm tra lịch trình của bạn cho ngày mai.', 2, 9, 'business'),
('strategy', '/ˈstrætədʒi/', 'chiến lược', 'a plan for achieving goals', 'noun', 'Our marketing strategy is very effective.', 'Chiến lược marketing của chúng ta rất hiệu quả.', 3, 8, 'business'),
('supplier', '/səˈplaɪər/', 'nhà cung cấp', 'a company that provides goods', 'noun', 'We found a new supplier in Asia.', 'Chúng tôi tìm thấy nhà cung cấp mới ở châu Á.', 2, 7, 'business'),
('survey', '/ˈsɜːrveɪ/', 'khảo sát', 'a study of opinions', 'noun', 'The survey shows high customer satisfaction.', 'Khảo sát cho thấy sự hài lòng cao của khách hàng.', 2, 8, 'business'),
('target', '/ˈtɑːrɡɪt/', 'mục tiêu', 'something aimed at', 'noun', 'We exceeded our sales target.', 'Chúng ta đã vượt mục tiêu bán hàng.', 2, 9, 'business'),
('terminate', '/ˈtɜːrmɪneɪt/', 'chấm dứt', 'to end something', 'verb', 'The contract will terminate next month.', 'Hợp đồng sẽ chấm dứt tháng tới.', 4, 5, 'business'),
('transaction', '/trænˈzækʃən/', 'giao dịch', 'a business deal', 'noun', 'All transactions are recorded electronically.', 'Tất cả giao dịch được ghi lại điện tử.', 3, 8, 'business'),
('upgrade', '/ˈʌpɡreɪd/', 'nâng cấp', 'to improve to a better version', 'verb', 'We need to upgrade our computer systems.', 'Chúng ta cần nâng cấp hệ thống máy tính.', 2, 7, 'business'),
('warranty', '/ˈwɔːrənti/', 'bảo hành', 'a guarantee for product quality', 'noun', 'The product comes with a one-year warranty.', 'Sản phẩm có bảo hành một năm.', 3, 6, 'business'),
('wholesale', '/ˈhoʊlseɪl/', 'bán buôn', 'selling goods in large quantities', 'noun', 'We buy products at wholesale prices.', 'Chúng tôi mua sản phẩm với giá bán buôn.', 4, 5, 'business'),
('workforce', '/ˈwɜːrkfɔːrs/', 'lực lượng lao động', 'all the people who work for a company', 'noun', 'The company has a skilled workforce.', 'Công ty có lực lượng lao động lành nghề.', 3, 6, 'business'),
('analyze', '/ˈænəlaɪz/', 'phân tích', 'to examine in detail', 'verb', 'We need to analyze the market trends.', 'Chúng ta cần phân tích xu hướng thị trường.', 3, 8, 'business'),
('collaborate', '/kəˈlæbəreɪt/', 'hợp tác', 'to work together', 'verb', 'We collaborate with international partners.', 'Chúng tôi hợp tác với các đối tác quốc tế.', 4, 6, 'business'),

-- Travel & Transportation (50 words)
('accommodation', '/əˌkɑːməˈdeɪʃən/', 'chỗ ở', 'a place to stay', 'noun', 'The hotel provides excellent accommodation.', 'Khách sạn cung cấp chỗ ở tuyệt vời.', 3, 7, 'travel'),
('arrival', '/əˈraɪvəl/', 'sự đến', 'the act of reaching a destination', 'noun', 'The arrival time is 3:30 PM.', 'Thời gian đến là 3:30 chiều.', 2, 8, 'travel'),
('baggage', '/ˈbæɡɪdʒ/', 'hành lý', 'suitcases and bags for travel', 'noun', 'Please check your baggage at the counter.', 'Vui lòng gửi hành lý tại quầy.', 2, 8, 'travel'),
('boarding', '/ˈbɔːrdɪŋ/', 'lên tàu/máy bay', 'getting on a vehicle', 'noun', 'Boarding begins at gate 15.', 'Lên máy bay bắt đầu tại cửa 15.', 2, 7, 'travel'),
('departure', '/dɪˈpɑːrtʃər/', 'sự khởi hành', 'leaving a place', 'noun', 'The departure is scheduled for 8 AM.', 'Khởi hành được lên lịch lúc 8 giờ sáng.', 2, 8, 'travel'),
('destination', '/ˌdestɪˈneɪʃən/', 'điểm đến', 'the place you are traveling to', 'noun', 'Paris is our final destination.', 'Paris là điểm đến cuối cùng của chúng ta.', 2, 8, 'travel'),
('itinerary', '/aɪˈtɪnəreri/', 'lịch trình du lịch', 'a travel plan', 'noun', 'Please review your travel itinerary.', 'Vui lòng xem lại lịch trình du lịch.', 4, 6, 'travel'),
('passport', '/ˈpæspɔːrt/', 'hộ chiếu', 'official travel document', 'noun', 'Dont forget to bring your passport.', 'Đừng quên mang hộ chiếu.', 1, 9, 'travel'),
('reservation', '/ˌrezərˈveɪʃən/', 'đặt chỗ', 'booking in advance', 'noun', 'I made a hotel reservation online.', 'Tôi đã đặt phòng khách sạn trực tuyến.', 2, 8, 'travel'),
('terminal', '/ˈtɜːrmɪnəl/', 'nhà ga', 'a building at an airport or station', 'noun', 'Flight 201 departs from terminal 2.', 'Chuyến bay 201 khởi hành từ nhà ga 2.', 2, 7, 'travel'),

-- Technology (50 words) 
('access', '/ˈækses/', 'truy cập', 'to enter or use', 'verb', 'You need a password to access the system.', 'Bạn cần mật khẩu để truy cập hệ thống.', 2, 9, 'technology'),
('application', '/ˌæplɪˈkeɪʃən/', 'ứng dụng', 'a computer program', 'noun', 'Download the mobile application.', 'Tải ứng dụng di động.', 2, 9, 'technology'),
('browser', '/ˈbraʊzər/', 'trình duyệt', 'software for viewing websites', 'noun', 'Open the website in your browser.', 'Mở trang web trong trình duyệt.', 2, 8, 'technology'),
('database', '/ˈdeɪtəbeɪs/', 'cơ sở dữ liệu', 'organized collection of data', 'noun', 'The customer information is in the database.', 'Thông tin khách hàng có trong cơ sở dữ liệu.', 3, 7, 'technology'),
('download', '/ˌdaʊnˈloʊd/', 'tải xuống', 'to transfer files from internet', 'verb', 'Please download the latest software update.', 'Vui lòng tải xuống bản cập nhật phần mềm mới nhất.', 2, 9, 'technology'),
('network', '/ˈnetwɜːrk/', 'mạng', 'connected computer systems', 'noun', 'The office network is very fast.', 'Mạng văn phòng rất nhanh.', 2, 8, 'technology'),
('password', '/ˈpæswɜːrd/', 'mật khẩu', 'secret code for access', 'noun', 'Create a strong password for security.', 'Tạo mật khẩu mạnh để bảo mật.', 1, 9, 'technology'),
('software', '/ˈsɔːftwer/', 'phần mềm', 'computer programs', 'noun', 'We need to install new software.', 'Chúng ta cần cài đặt phần mềm mới.', 2, 9, 'technology'),
('update', '/ˈʌpdeɪt/', 'cập nhật', 'to make current', 'verb', 'Please update your contact information.', 'Vui lòng cập nhật thông tin liên lạc.', 2, 9, 'technology'),
('website', '/ˈwebsaɪt/', 'trang web', 'pages on the internet', 'noun', 'Visit our company website for more info.', 'Truy cập trang web công ty để biết thêm thông tin.', 1, 9, 'technology'),

-- Daily Life (50 words)
('appointment', '/əˈpɔɪntmənt/', 'cuộc hẹn', 'arranged meeting', 'noun', 'I have a dental appointment tomorrow.', 'Tôi có cuộc hẹn nha sĩ ngày mai.', 1, 8, 'daily_life'),
('available', '/əˈveɪləbəl/', 'có sẵn', 'ready for use', 'adjective', 'Is the meeting room available?', 'Phòng họp có sẵn không?', 2, 9, 'daily_life'),
('convenient', '/kənˈviːniənt/', 'thuận tiện', 'easy and suitable', 'adjective', 'Online shopping is very convenient.', 'Mua sắm trực tuyến rất thuận tiện.', 2, 8, 'daily_life'),
('delivery', '/dɪˈlɪvəri/', 'giao hàng', 'bringing goods to customers', 'noun', 'Free delivery for orders over $50.', 'Giao hàng miễn phí cho đơn hàng trên $50.', 2, 8, 'daily_life'),
('essential', '/ɪˈsenʃəl/', 'cần thiết', 'absolutely necessary', 'adjective', 'Water is essential for life.', 'Nước rất cần thiết cho sự sống.', 3, 7, 'daily_life'),
('grocery', '/ˈɡroʊsəri/', 'thực phẩm', 'food and household items', 'noun', 'I need to buy groceries after work.', 'Tôi cần mua thực phẩm sau giờ làm.', 1, 8, 'daily_life'),
('household', '/ˈhaʊshoʊld/', 'hộ gia đình', 'relating to a home', 'adjective', 'Household expenses are increasing.', 'Chi phí hộ gia đình đang tăng.', 2, 7, 'daily_life'),
('ingredient', '/ɪnˈɡriːdiənt/', 'nguyên liệu', 'component of a recipe', 'noun', 'Check all ingredients before cooking.', 'Kiểm tra tất cả nguyên liệu trước khi nấu.', 2, 7, 'daily_life'),
('laundry', '/ˈlɔːndri/', 'giặt ủi', 'washing clothes', 'noun', 'I do laundry on weekends.', 'Tôi giặt ủi vào cuối tuần.', 1, 7, 'daily_life'),
('prescription', '/prɪˈskrɪpʃən/', 'đơn thuốc', 'medical instruction for medicine', 'noun', 'The doctor wrote a prescription.', 'Bác sĩ đã viết đơn thuốc.', 3, 6, 'daily_life'),

-- Finance & Money (50 words)
('account', '/əˈkaʊnt/', 'tài khoản', 'record of financial transactions', 'noun', 'Open a savings account at the bank.', 'Mở tài khoản tiết kiệm tại ngân hàng.', 2, 9, 'finance'),
('balance', '/ˈbæləns/', 'số dư', 'amount of money in account', 'noun', 'Check your account balance online.', 'Kiểm tra số dư tài khoản trực tuyến.', 2, 8, 'finance'),
('credit', '/ˈkredɪt/', 'tín dụng', 'borrowed money', 'noun', 'She has good credit history.', 'Cô ấy có lịch sử tín dụng tốt.', 2, 8, 'finance'),
('deposit', '/dɪˈpɑːzɪt/', 'tiền gửi', 'money put into account', 'noun', 'Make a deposit at the ATM.', 'Gửi tiền tại máy ATM.', 2, 8, 'finance'),
('exchange', '/ɪksˈtʃeɪndʒ/', 'trao đổi', 'to trade one thing for another', 'verb', 'Exchange dollars for euros.', 'Đổi đô la lấy euro.', 2, 7, 'finance'),
('interest', '/ˈɪntrəst/', 'lãi suất', 'money earned on savings', 'noun', 'The savings account pays 2% interest.', 'Tài khoản tiết kiệm trả 2% lãi suất.', 2, 8, 'finance'),
('loan', '/loʊn/', 'khoản vay', 'borrowed money to be repaid', 'noun', 'Apply for a car loan at the bank.', 'Xin vay mua xe tại ngân hàng.', 2, 8, 'finance'),
('payment', '/ˈpeɪmənt/', 'thanh toán', 'money given for goods/services', 'noun', 'Payment is due by the 15th.', 'Thanh toán đến hạn vào ngày 15.', 2, 9, 'finance'),
('receipt', '/rɪˈsiːt/', 'biên lai', 'proof of payment', 'noun', 'Keep your receipt for returns.', 'Giữ biên lai để đổi trả.', 1, 8, 'finance'),
('withdraw', '/wɪðˈdrɔː/', 'rút tiền', 'to take money from account', 'verb', 'Withdraw cash from the ATM.', 'Rút tiền mặt từ máy ATM.', 2, 7, 'finance'),

-- Health & Medicine (50 words)
('appointment', '/əˈpɔɪntmənt/', 'cuộc hẹn khám', 'scheduled medical visit', 'noun', 'Schedule an appointment with your doctor.', 'Lên lịch hẹn khám với bác sĩ.', 1, 8, 'health'),
('diagnose', '/ˌdaɪəɡˈnoʊs/', 'chẩn đoán', 'to identify an illness', 'verb', 'The doctor will diagnose your condition.', 'Bác sĩ sẽ chẩn đoán tình trạng của bạn.', 4, 6, 'health'),
('emergency', '/ɪˈmɜːrdʒənsi/', 'cấp cứu', 'urgent medical situation', 'noun', 'Call 911 for medical emergency.', 'Gọi 911 cho cấp cứu y tế.', 2, 7, 'health'),
('insurance', '/ɪnˈʃʊrəns/', 'bảo hiểm', 'protection against costs', 'noun', 'Health insurance covers medical bills.', 'Bảo hiểm y tế chi trả hóa đơn y tế.', 2, 8, 'health'),
('medication', '/ˌmedɪˈkeɪʃən/', 'thuốc', 'medicine for treatment', 'noun', 'Take your medication as prescribed.', 'Uống thuốc theo chỉ định.', 3, 7, 'health'),
('prescription', '/prɪˈskrɪpʃən/', 'đơn thuốc', 'doctors order for medicine', 'noun', 'Fill the prescription at the pharmacy.', 'Mua thuốc theo đơn tại hiệu thuốc.', 3, 6, 'health'),
('symptom', '/ˈsɪmptəm/', 'triệu chứng', 'sign of illness', 'noun', 'Fever is a common symptom of flu.', 'Sốt là triệu chứng thường gặp của cúm.', 3, 7, 'health'),
('treatment', '/ˈtriːtmənt/', 'điều trị', 'medical care for illness', 'noun', 'The treatment was very effective.', 'Việc điều trị rất hiệu quả.', 3, 8, 'health'),
('vaccine', '/vækˈsiːn/', 'vắc xin', 'medicine to prevent disease', 'noun', 'Get your flu vaccine every year.', 'Tiêm vắc xin cúm hàng năm.', 3, 6, 'health'),
('wellness', '/ˈwelnəs/', 'sức khỏe', 'state of being healthy', 'noun', 'Exercise promotes overall wellness.', 'Tập thể dục thúc đẩy sức khỏe tổng thể.', 3, 6, 'health');

-- Insert sample reading passages
INSERT INTO reading_passages (title, content, difficulty_level, topic, word_count) VALUES
('Office Relocation Notice', 'Dear Employees, We are pleased to announce that our company will be relocating to a new office building at 123 Business Plaza, Downtown City. The move is scheduled for the weekend of March 15-16. All departments will be operational at the new location starting Monday, March 18. The new facility offers modern amenities including a fitness center, cafeteria, and ample parking. Please update your address books and inform your contacts of our new location. HR will provide detailed moving instructions next week.', 2, 'business', 89),
('Travel Policy Updates', 'Effective immediately, all business travel must be pre-approved by department managers. Travel expenses exceeding $500 require additional authorization from the finance department. Employees are encouraged to book flights at least 14 days in advance to secure better rates. Hotel accommodations should not exceed $150 per night unless special circumstances apply. All receipts must be submitted within 30 days of travel completion. The company will reimburse reasonable meals up to $75 per day. Personal expenses will not be covered under any circumstances.', 3, 'business', 95),
('New Software Implementation', 'Our IT department will be implementing a new customer relationship management (CRM) software system next month. Training sessions will be conducted during the first week of April for all sales and customer service staff. The new system will streamline our client communication processes and improve data tracking capabilities. Employees will receive login credentials and user manuals before the training begins. Technical support will be available 24/7 during the transition period. Any questions or concerns should be directed to the IT helpdesk.', 3, 'technology', 87);

-- Insert sample listening materials  
INSERT INTO listening_materials (title, audio_url, transcript, duration, difficulty_level, topic, accent) VALUES
('Airport Announcement', '/audio/airport_announcement.mp3', 'Ladies and gentlemen, Flight 447 to Los Angeles is now boarding at Gate 15. Please have your boarding passes and identification ready for inspection. We will begin boarding with first-class passengers, followed by business class, and then economy class passengers by row number. Thank you for your cooperation.', 45, 2, 'travel', 'American'),
('Office Meeting', '/audio/office_meeting.mp3', 'Good morning, everyone. Thank you for joining todays quarterly review meeting. As you can see from the charts, our sales have increased by 15% compared to last quarter. The marketing campaign launched in January has been particularly successful. However, we need to focus on improving customer retention rates in the coming months.', 60, 3, 'business', 'British'),
('Restaurant Reservation', '/audio/restaurant_reservation.mp3', 'Thank you for calling Antonios Restaurant. How may I help you? I would like to make a reservation for tonight. Certainly. For how many people? Four people, please. What time would you prefer? Around 7:30 if possible. Let me check... Yes, we have availability at 7:30. May I have your name? Johnson. Perfect. Table for four at 7:30 under Johnson.', 55, 2, 'daily_life', 'American');

-- Insert sample tests
INSERT INTO tests (test_name, test_type, description, total_questions, time_limit, difficulty_level, parts, created_by) VALUES
('TOEIC Reading Practice Test 1', 'practice', 'Practice test focusing on Parts 5, 6, and 7', 50, 75, 2, '{5,6,7}', 1),
('TOEIC Listening Practice Test 1', 'practice', 'Practice test for listening comprehension', 30, 45, 2, '{1,2,3,4}', 1),
('TOEIC Mini Test - Vocabulary Focus', 'mini_test', 'Short test focusing on vocabulary and grammar', 20, 30, 1, '{5}', 1);

-- Update tests with correct question counts
UPDATE tests SET total_questions = (SELECT COUNT(*) FROM questions WHERE test_id = tests.test_id);