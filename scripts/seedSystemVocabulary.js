const pool = require('../db');

const TOPICS = [
  { name: 'Business', description: 'Kinh doanh, thương mại và hợp đồng' },
  { name: 'Office', description: 'Văn phòng, hành chính và cuộc họp' },
  { name: 'Finance', description: 'Tài chính, kế toán và ngân sách' },
  { name: 'Marketing', description: 'Tiếp thị, bán hàng và khách hàng' },
  { name: 'Travel', description: 'Du lịch, công tác và vận chuyển' },
  { name: 'Technology', description: 'Công nghệ, thiết bị và phần mềm' },
  { name: 'Human Resources', description: 'Nhân sự, tuyển dụng và phúc lợi' },
];

const WORDS = [
  // Business
  {
    topic: 'Business',
    word: 'contract',
    pronunciation: '/ˈkɑːntrækt/',
    part_of_speech: 'noun',
    meaning_vi: 'hợp đồng',
    example_sentence: 'Both parties signed the contract yesterday.',
    example_translation: 'Cả hai bên đã ký hợp đồng vào hôm qua.',
  },
  {
    topic: 'Business',
    word: 'negotiate',
    pronunciation: '/nɪˈɡoʊʃieɪt/',
    part_of_speech: 'verb',
    meaning_vi: 'đàm phán, thương lượng',
    example_sentence: 'We need to negotiate better terms with the supplier.',
    example_translation: 'Chúng ta cần đàm phán các điều khoản tốt hơn với nhà cung cấp.',
  },
  {
    topic: 'Business',
    word: 'supplier',
    pronunciation: '/səˈplaɪər/',
    part_of_speech: 'noun',
    meaning_vi: 'nhà cung cấp',
    example_sentence: 'Our main supplier guaranteed on-time delivery.',
    example_translation: 'Nhà cung cấp chính của chúng tôi đảm bảo giao hàng đúng hạn.',
  },
  {
    topic: 'Business',
    word: 'agreement',
    pronunciation: '/əˈɡriːmənt/',
    part_of_speech: 'noun',
    meaning_vi: 'thỏa thuận, hợp đồng',
    example_sentence: 'They reached a mutual agreement after the meeting.',
    example_translation: 'Họ đã đạt được thỏa thuận chung sau cuộc họp.',
  },
  {
    topic: 'Business',
    word: 'partnership',
    pronunciation: '/ˈpɑːrtnərʃɪp/',
    part_of_speech: 'noun',
    meaning_vi: 'quan hệ đối tác',
    example_sentence: 'The new partnership will expand our market share.',
    example_translation: 'Quan hệ đối tác mới sẽ mở rộng thị phần của chúng tôi.',
  },
  {
    topic: 'Business',
    word: 'proposal',
    pronunciation: '/prəˈpoʊzl/',
    part_of_speech: 'noun',
    meaning_vi: 'bản đề xuất, kế hoạch đề nghị',
    example_sentence: 'Please submit your project proposal by Friday.',
    example_translation: 'Vui lòng nộp bản đề xuất dự án của bạn trước thứ Sáu.',
  },
  // Office
  {
    topic: 'Office',
    word: 'deadline',
    pronunciation: '/ˈdedlaɪn/',
    part_of_speech: 'noun',
    meaning_vi: 'hạn chót',
    example_sentence: 'The deadline for the quarterly report is tomorrow.',
    example_translation: 'Hạn chót cho báo cáo quý là ngày mai.',
  },
  {
    topic: 'Office',
    word: 'schedule',
    pronunciation: '/ˈskedʒuːl/',
    part_of_speech: 'noun / verb',
    meaning_vi: 'lịch trình; sắp xếp lịch',
    example_sentence: 'Let me check my schedule before confirming the meeting.',
    example_translation: 'Hãy để tôi kiểm tra lịch trình trước khi xác nhận cuộc họp.',
  },
  {
    topic: 'Office',
    word: 'conference',
    pronunciation: '/ˈkɑːnfərəns/',
    part_of_speech: 'noun',
    meaning_vi: 'hội nghị',
    example_sentence: 'The annual sales conference will be held in Da Nang.',
    example_translation: 'Hội nghị bán hàng thường niên sẽ được tổ chức tại Đà Nẵng.',
  },
  {
    topic: 'Office',
    word: 'agenda',
    pronunciation: '/əˈdʒendə/',
    part_of_speech: 'noun',
    meaning_vi: 'chương trình nghị sự, nội dung cuộc họp',
    example_sentence: 'A copy of the agenda was sent to all participants.',
    example_translation: 'Một bản chương trình cuộc họp đã được gửi cho tất cả người tham gia.',
  },
  {
    topic: 'Office',
    word: 'colleague',
    pronunciation: '/ˈkɑːliːɡ/',
    part_of_speech: 'noun',
    meaning_vi: 'đồng nghiệp',
    example_sentence: 'She discussed the new policy with her colleagues.',
    example_translation: 'Cô ấy đã thảo luận chính sách mới với các đồng nghiệp.',
  },
  {
    topic: 'Office',
    word: 'headquarters',
    pronunciation: '/ˈhedkwɔːrtərz/',
    part_of_speech: 'noun',
    meaning_vi: 'trụ sở chính',
    example_sentence: 'The company headquarters is located in Ho Chi Minh City.',
    example_translation: 'Trụ sở chính của công ty đặt tại TP. Hồ Chí Minh.',
  },
  // Finance
  {
    topic: 'Finance',
    word: 'revenue',
    pronunciation: '/ˈrevənuː/',
    part_of_speech: 'noun',
    meaning_vi: 'doanh thu',
    example_sentence: 'Total revenue increased by 15% this quarter.',
    example_translation: 'Tổng doanh thu đã tăng 15% trong quý này.',
  },
  {
    topic: 'Finance',
    word: 'invoice',
    pronunciation: '/ˈɪnvɔɪs/',
    part_of_speech: 'noun',
    meaning_vi: 'hóa đơn thanh toán',
    example_sentence: 'Please pay the invoice within 30 days of receipt.',
    example_translation: 'Vui lòng thanh toán hóa đơn trong vòng 30 ngày kể từ khi nhận.',
  },
  {
    topic: 'Finance',
    word: 'budget',
    pronunciation: '/ˈbʌdʒɪt/',
    part_of_speech: 'noun',
    meaning_vi: 'ngân sách',
    example_sentence: 'The marketing department exceeded its annual budget.',
    example_translation: 'Phòng tiếp thị đã vượt quá ngân sách hàng năm.',
  },
  {
    topic: 'Finance',
    word: 'expense',
    pronunciation: '/ɪkˈspens/',
    part_of_speech: 'noun',
    meaning_vi: 'chi phí, khoản chi',
    example_sentence: 'Keep all receipts for your travel expenses.',
    example_translation: 'Hãy giữ lại tất cả biên lai cho chi phí công tác của bạn.',
  },
  {
    topic: 'Finance',
    word: 'reimburse',
    pronunciation: '/ˌriːɪmˈbɜːrs/',
    part_of_speech: 'verb',
    meaning_vi: 'hoàn trả lại tiền, bồi hoàn',
    example_sentence: 'The company will reimburse you for hotel costs.',
    example_translation: 'Công ty sẽ hoàn trả chi phí khách sạn cho bạn.',
  },
  {
    topic: 'Finance',
    word: 'investment',
    pronunciation: '/ɪnˈvestmənt/',
    part_of_speech: 'noun',
    meaning_vi: 'khoản đầu tư, sự đầu tư',
    example_sentence: 'Foreign investment has grown steadily over the past year.',
    example_translation: 'Đầu tư nước ngoài đã tăng trưởng ổn định trong năm qua.',
  },
  // Marketing
  {
    topic: 'Marketing',
    word: 'promote',
    pronunciation: '/prəˈmoʊt/',
    part_of_speech: 'verb',
    meaning_vi: 'quảng bá; thăng chức',
    example_sentence: 'Social media is used to promote our new product line.',
    example_translation: 'Mạng xã hội được sử dụng để quảng bá dòng sản phẩm mới của chúng tôi.',
  },
  {
    topic: 'Marketing',
    word: 'customer',
    pronunciation: '/ˈkʌstəmər/',
    part_of_speech: 'noun',
    meaning_vi: 'khách hàng',
    example_sentence: 'Customer satisfaction is our top priority.',
    example_translation: 'Sự hài lòng của khách hàng là ưu tiên hàng đầu của chúng tôi.',
  },
  {
    topic: 'Marketing',
    word: 'campaign',
    pronunciation: '/kæmˈpeɪn/',
    part_of_speech: 'noun',
    meaning_vi: 'chiến dịch quảng cáo',
    example_sentence: 'The summer advertising campaign was a huge success.',
    example_translation: 'Chiến dịch quảng cáo mùa hè đã thành công vang dội.',
  },
  {
    topic: 'Marketing',
    word: 'survey',
    pronunciation: '/ˈsɜːrveɪ/',
    part_of_speech: 'noun',
    meaning_vi: 'cuộc khảo sát',
    example_sentence: 'We conducted an online survey to gather user feedback.',
    example_translation: 'Chúng tôi đã thực hiện một khảo sát trực tuyến để thu thập phản hồi người dùng.',
  },
  {
    topic: 'Marketing',
    word: 'launch',
    pronunciation: '/lɔːntʃ/',
    part_of_speech: 'verb / noun',
    meaning_vi: 'ra mắt, tung ra sản phẩm mới',
    example_sentence: 'The firm plans to launch its mobile app next month.',
    example_translation: 'Công ty dự kiến ra mắt ứng dụng di động vào tháng tới.',
  },
  // Travel
  {
    topic: 'Travel',
    word: 'itinerary',
    pronunciation: '/aɪˈtɪnəreri/',
    part_of_speech: 'noun',
    meaning_vi: 'lịch trình chuyến đi',
    example_sentence: 'Your flight details are included in the travel itinerary.',
    example_translation: 'Chi tiết chuyến bay của bạn đã có trong lịch trình chuyến đi.',
  },
  {
    topic: 'Travel',
    word: 'reservation',
    pronunciation: '/ˌrezərˈveɪʃn/',
    part_of_speech: 'noun',
    meaning_vi: 'sự đặt chỗ trước',
    example_sentence: 'I would like to make a hotel reservation for two nights.',
    example_translation: 'Tôi muốn đặt phòng khách sạn trong hai đêm.',
  },
  {
    topic: 'Travel',
    word: 'departure',
    pronunciation: '/dɪˈpɑːrtʃər/',
    part_of_speech: 'noun',
    meaning_vi: 'sự khởi hành',
    example_sentence: 'Passengers should arrive two hours before departure.',
    example_translation: 'Hành khách nên có mặt trước giờ khởi hành hai tiếng.',
  },
  {
    topic: 'Travel',
    word: 'accommodation',
    pronunciation: '/əˌkɑːməˈdeɪʃn/',
    part_of_speech: 'noun',
    meaning_vi: 'chỗ ở, nơi lưu trú',
    example_sentence: 'The conference fee includes meals and accommodation.',
    example_translation: 'Phí hội nghị đã bao gồm bữa ăn và chỗ ở.',
  },
  {
    topic: 'Travel',
    word: 'luggage',
    pronunciation: '/ˈlʌɡɪdʒ/',
    part_of_speech: 'noun',
    meaning_vi: 'hành lý',
    example_sentence: 'Each passenger is allowed one piece of carry-on luggage.',
    example_translation: 'Mỗi hành khách được phép mang một kiện hành lý xách tay.',
  },
  // Technology
  {
    topic: 'Technology',
    word: 'maintenance',
    pronunciation: '/ˈmeɪntənəns/',
    part_of_speech: 'noun',
    meaning_vi: 'sự bảo trì, bảo dưỡng',
    example_sentence: 'The server will be offline for scheduled maintenance.',
    example_translation: 'Máy chủ sẽ tạm ngừng hoạt động để bảo trì định kỳ.',
  },
  {
    topic: 'Technology',
    word: 'upgrade',
    pronunciation: '/ˈʌpɡreɪd/',
    part_of_speech: 'verb / noun',
    meaning_vi: 'nâng cấp',
    example_sentence: 'We need to upgrade our operating system for better security.',
    example_translation: 'Chúng ta cần nâng cấp hệ điều hành để bảo mật tốt hơn.',
  },
  {
    topic: 'Technology',
    word: 'equipment',
    pronunciation: '/ɪˈkwɪpmənt/',
    part_of_speech: 'noun',
    meaning_vi: 'trang thiết bị',
    example_sentence: 'All safety equipment must be inspected monthly.',
    example_translation: 'Tất cả thiết bị an toàn phải được kiểm tra hàng tháng.',
  },
  {
    topic: 'Technology',
    word: 'compatible',
    pronunciation: '/kəmˈpætəbl/',
    part_of_speech: 'adjective',
    meaning_vi: 'tương thích',
    example_sentence: 'This software is compatible with both Windows and macOS.',
    example_translation: 'Phần mềm này tương thích với cả Windows và macOS.',
  },
  // Human Resources
  {
    topic: 'Human Resources',
    word: 'candidate',
    pronunciation: '/ˈkændɪdət/',
    part_of_speech: 'noun',
    meaning_vi: 'ứng viên',
    example_sentence: 'We interviewed five qualified candidates for the position.',
    example_translation: 'Chúng tôi đã phỏng vấn năm ứng viên đủ tiêu chuẩn cho vị trí này.',
  },
  {
    topic: 'Human Resources',
    word: 'recruit',
    pronunciation: '/rɪˈkruːt/',
    part_of_speech: 'verb',
    meaning_vi: 'tuyển dụng',
    example_sentence: 'The company plans to recruit twenty new engineers.',
    example_translation: 'Công ty có kế hoạch tuyển dụng hai mươi kỹ sư mới.',
  },
  {
    topic: 'Human Resources',
    word: 'qualification',
    pronunciation: '/ˌkwɑːlɪfɪˈkeɪʃn/',
    part_of_speech: 'noun',
    meaning_vi: 'bằng cấp, trình độ chuyên môn',
    example_sentence: 'Applicants must have relevant professional qualifications.',
    example_translation: 'Ứng viên phải có trình độ chuyên môn phù hợp.',
  },
  {
    topic: 'Human Resources',
    word: 'Training',
    pronunciation: '/ˈtreɪnɪŋ/',
    part_of_speech: 'noun',
    meaning_vi: 'đào tạo, huấn luyện',
    example_sentence: 'All new staff must attend the orientation training.',
    example_translation: 'Tất cả nhân viên mới phải tham dự khóa đào tạo định hướng.',
  },
];

async function seedSystemVocabulary() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Remove test system topic 'Hu' if unused
    await client.query(`DELETE FROM vocabulary_topics WHERE owner_user_id IS NULL AND name = 'Hu' AND NOT EXISTS (SELECT 1 FROM vocabulary WHERE topic_id = vocabulary_topics.topic_id)`);

    const topicMap = new Map();
    for (const t of TOPICS) {
      const existing = await client.query(
        'SELECT topic_id FROM vocabulary_topics WHERE owner_user_id IS NULL AND lower(name) = lower($1)',
        [t.name],
      );
      let topicId;
      if (existing.rows.length) {
        topicId = existing.rows[0].topic_id;
        await client.query(
          'UPDATE vocabulary_topics SET description = $1 WHERE topic_id = $2',
          [t.description, topicId],
        );
      } else {
        const inserted = await client.query(
          'INSERT INTO vocabulary_topics (name, description, owner_user_id) VALUES ($1, $2, NULL) RETURNING topic_id',
          [t.name, t.description],
        );
        topicId = inserted.rows[0].topic_id;
      }
      topicMap.set(t.name, topicId);
    }

    let insertedCount = 0;
    let updatedCount = 0;
    for (const item of WORDS) {
      const wordText = item.word.toLowerCase();
      const topicId = topicMap.get(item.topic) ?? null;
      const existing = await client.query(
        'SELECT vocab_id FROM vocabulary WHERE owner_user_id IS NULL AND lower(word) = lower($1)',
        [wordText],
      );
      if (existing.rows.length) {
        await client.query(
          `UPDATE vocabulary
           SET meaning_vi = $2, pronunciation = $3, part_of_speech = $4,
               example_sentence = $5, example_translation = $6, topic_id = $7, updated_at = NOW()
           WHERE vocab_id = $1`,
          [
            existing.rows[0].vocab_id,
            item.meaning_vi,
            item.pronunciation,
            item.part_of_speech,
            item.example_sentence,
            item.example_translation,
            topicId,
          ],
        );
        updatedCount++;
      } else {
        await client.query(
          `INSERT INTO vocabulary (owner_user_id, word, meaning_vi, pronunciation, part_of_speech, example_sentence, example_translation, topic_id)
           VALUES (NULL, $1, $2, $3, $4, $5, $6, $7)`,
          [
            wordText,
            item.meaning_vi,
            item.pronunciation,
            item.part_of_speech,
            item.example_sentence,
            item.example_translation,
            topicId,
          ],
        );
        insertedCount++;
      }
    }
    await client.query('COMMIT');
    console.log(`System vocabulary seeded: ${insertedCount} inserted, ${updatedCount} updated.`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  seedSystemVocabulary().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seedSystemVocabulary };
