// Practice estimate: piecewise interpolation of reference points published by WIE.
// https://wie.ac.nz/toeicconversion.htm
// This is not an ETS conversion table or a calibrated official score.
const reference = [
  [0,5,5], [17,5,5], [20,20,5], [30,80,55], [40,150,115],
  [50,225,175], [60,295,250], [70,355,300], [80,420,360],
  [90,480,435], [93,495,455], [100,495,495],
];
const expectedCounts = {1:6, 2:25, 3:39, 4:30, 5:30, 6:16, 7:54};

function estimateSection(correct, section) {
  if (!Number.isInteger(correct) || correct < 0 || correct > 100) throw new Error('Expected 0–100 correct answers');
  if (!['listening','reading'].includes(section)) throw new Error('Invalid section');
  const column = section === 'listening' ? 1 : 2;
  for (let i = 1; i < reference.length; i++) {
    if (correct <= reference[i][0]) {
      const a = reference[i-1], b = reference[i];
      return Math.max(5, Math.min(495, 5 * Math.round((a[column] + (correct-a[0]) * (b[column]-a[column]) / (b[0]-a[0])) / 5)));
    }
  }
  return 495;
}

function toeicEstimate(parts) {
  const scores = {};
  for (const [section, numbers] of [['listening',[1,2,3,4]], ['reading',[5,6,7]]]) {
    if (numbers.every(number => parts.find(p=>p.part_number===number)?.total === expectedCounts[number])) {
      scores[section] = estimateSection(parts.filter(p=>numbers.includes(p.part_number)).reduce((sum,p)=>sum+p.correct,0),section);
    } else scores[section] = null;
  }
  return {
    ...scores, total: scores.listening !== null && scores.reading !== null ? scores.listening + scores.reading : null,
    max_total: 990, max_section: 495, is_estimate: true,
    version: 'practice-reference-interpolation-v1',
    reference_url: 'https://wie.ac.nz/toeicconversion.htm',
    notice: 'Điểm TOEIC ước tính để luyện tập, không phải điểm chính thức ETS.',
    eligibility_notice: 'Chỉ ước tính điểm khi đủ 100 câu và đúng cấu trúc Listening hoặc Reading; tổng /990 cần đủ cả hai phần.',
  };
}

module.exports = { estimateSection, toeicEstimate };
