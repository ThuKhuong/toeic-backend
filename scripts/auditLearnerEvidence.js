// Offline reporting only: no API calls, inference, migrations or database writes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const {connect} = require('./learningDevEnvironment');
const {gradeAttempt} = require('../src/modules/tests/grading');
const {versionOf} = require('../src/modules/learning/version');
const {fingerprint} = require('../src/modules/ai/appQuestionFeatures');
const aiRoot = path.resolve(__dirname, '../../toeic-ai');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function csv(name) {
  const workbook = XLSX.readFile(path.join(aiRoot, name), {raw:true});
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {defval:''});
}
function tally(rows, key) {
  return rows.reduce((out, row) => {const k = String(row[key]); out[k] = (out[k] || 0) + 1; return out;}, {});
}
function analyze(data) {
  const issues = [];
  const parts = new Map();
  const completed = data.attempts.filter(a => a.is_completed);
  const observationKeys = new Set();
  for (const o of data.observations) {
    const key = `${o.attempt_id}:${o.question_id}`;
    if (observationKeys.has(key)) issues.push({type:'duplicate_observation', key});
    observationKeys.add(key);
  }
  const attemptReports = completed.map(a => {
    const rows = data.answers.filter(r => r.attempt_id === a.attempt_id);
    const grading = gradeAttempt(rows);
    const mismatch = rows.filter(r => r.is_correct !== (r.user_answer != null && r.user_answer === r.question_snapshot.correct_answer));
    if (mismatch.length) issues.push({type:'grading_mismatch',attempt_id:a.attempt_id,question_ids:mismatch.map(r=>r.question_id)});
    if (grading.total !== a.total_questions || grading.correct !== a.total_correct ||
        ['total','answered','correct','incorrect','unanswered','score'].some(k => a.grading_result?.[k] !== grading[k]))
      issues.push({type:'attempt_summary_mismatch',attempt_id:a.attempt_id});
    if (!a.valid_time_window) issues.push({type:'invalid_attempt_time',attempt_id:a.attempt_id});
    const events = data.events.filter(e => e.attempt_id === a.attempt_id);
    if(events.some(e=>e.user_id!==a.user_id)) issues.push({type:'event_owner_mismatch',attempt_id:a.attempt_id});
    if (events.filter(e=>e.event_type==='ATTEMPT_COMPLETED').length !== 1)
      issues.push({type:'completion_event_count',attempt_id:a.attempt_id});
    const versionMismatch = events.filter(e=>e.question_id && e.question_version !== versionOf(rows.find(r=>r.question_id===e.question_id)?.question_snapshot||{}));
    if (versionMismatch.length) issues.push({type:'event_version_mismatch',attempt_id:a.attempt_id,count:versionMismatch.length});
    for (const row of rows) {
      const part = Number(row.question_snapshot.part_number);
      if (!parts.has(part)) parts.set(part, {part_number:part,total:0,answered:0,correct:0,incorrect:0,unanswered:0,first_responses:0,repeated_responses:0,question_ids:[]});
      const p = parts.get(part); p.total++; p.question_ids.push(row.question_id);
      const answered = ['A','B','C','D'].includes(row.user_answer);
      const correctChoices=(row.question_snapshot.choices||[]).filter(c=>c.is_correct===true);
      if (correctChoices.length!==1 || correctChoices[0].choice_label!==row.question_snapshot.correct_answer)
        issues.push({type:'snapshot_key_choice_mismatch',attempt_id:a.attempt_id,question_id:row.question_id});
      if (answered) {p.answered++; if (row.user_answer===row.question_snapshot.correct_answer) p.correct++; else p.incorrect++;} else p.unanswered++;
      const o = data.observations.find(o=>o.attempt_id===a.attempt_id&&o.question_id===row.question_id);
      if (answered && (!o || o.answer!==row.user_answer || o.correctness !== (row.user_answer===row.question_snapshot.correct_answer) || o.question_version!==versionOf(row.question_snapshot)))
        issues.push({type:'observation_missing_or_mismatch',attempt_id:a.attempt_id,question_id:row.question_id});
      if (!answered && o) issues.push({type:'blank_has_observation',attempt_id:a.attempt_id,question_id:row.question_id});
      if (o) {
        const prior=data.answers.filter(r=>r.attempt_id!==a.attempt_id&&r.question_id===row.question_id&&r.user_answer&&
          fingerprint(r.question_snapshot)===fingerprint(row.question_snapshot)&&
          completed.findIndex(t=>t.attempt_id===r.attempt_id)<completed.findIndex(t=>t.attempt_id===a.attempt_id)).length;
        if(o.prior_response_count!==prior||o.is_first_response!==(prior===0)) issues.push({type:'first_repeat_mismatch',attempt_id:a.attempt_id,question_id:row.question_id});
      }
      const revisions=data.revisions.filter(r=>r.attempt_id===a.attempt_id&&r.question_id===row.question_id);
      if(answered && (!revisions.length || revisions.at(-1).new_answer!==row.user_answer))
        issues.push({type:'revision_final_mismatch',attempt_id:a.attempt_id,question_id:row.question_id});
      for(const revision of revisions) if(revision.correctness!==(revision.new_answer==null?null:revision.new_answer===row.question_snapshot.correct_answer))
        issues.push({type:'revision_correctness_mismatch',attempt_id:a.attempt_id,question_id:row.question_id});
      if (o) {if (o.is_first_response) p.first_responses++; else p.repeated_responses++;}
      if (row.time_spent != null && row.time_spent < 0) issues.push({type:'negative_answer_time',attempt_id:a.attempt_id,question_id:row.question_id});
      const answerEvents = events.filter(e=>e.question_id===row.question_id&&['ANSWER_SUBMITTED','ANSWER_CHANGED'].includes(e.event_type));
      if (answered && !answerEvents.length) issues.push({type:'answer_without_client_event',attempt_id:a.attempt_id,question_id:row.question_id});
      // A trustworthy total order exists only within one client session.
      const sessions = [...new Set(answerEvents.map(e=>e.client_session_id))];
      for (const session of sessions) {
        const sequence = answerEvents.filter(e=>e.client_session_id===session).sort((x,y)=>Number(x.client_sequence)-Number(y.client_sequence));
        for (let i=1;i<sequence.length;i++) if (sequence[i].event_payload.previous_answer !== sequence[i-1].event_payload.new_answer)
          issues.push({type:'answer_chain_discontinuity',attempt_id:a.attempt_id,question_id:row.question_id});
      }
      if (answerEvents.length && sessions.length===1) {
        const last = [...answerEvents].sort((x,y)=>Number(x.client_sequence)-Number(y.client_sequence)).at(-1);
        if (last.event_payload.new_answer !== row.user_answer) issues.push({type:'client_final_differs_from_persisted',attempt_id:a.attempt_id,question_id:row.question_id});
      }
    }
    return {attempt_id:a.attempt_id,test_name:a.test_name,start_local:a.start_local,end_local:a.end_local,
      elapsed_wall_seconds:Number(a.elapsed_wall_seconds),total:grading.total,answered:grading.answered,correct:grading.correct,
      incorrect:grading.incorrect,unanswered:grading.unanswered,events:tally(events,'event_type'),
      time_spent_sum_seconds:rows.reduce((n,r)=>n+Number(r.time_spent||0),0),
      zero_time_question_ids:rows.filter(r=>!r.time_spent).map(r=>r.question_id),
      unversioned_question_ids:rows.filter(r=>!r.question_snapshot.learning_version).map(r=>r.question_id),
      media_unavailable_question_ids:rows.filter(r=>!r.question_snapshot.learning_version?.media_verified).map(r=>r.question_id),
      blank_question_ids:rows.filter(r=>!r.user_answer).map(r=>r.question_id)};
  });
  const duplicateEventIds = data.events.length-new Set(data.events.map(e=>e.event_id)).size;
  const clientEvents = data.events.filter(e=>e.source==='client');
  const sequences = clientEvents.map(e=>`${e.user_id}:${e.client_session_id}:${e.client_sequence}`);
  const duplicateSequences = sequences.length-new Set(sequences).size;
  if (duplicateEventIds||duplicateSequences) issues.push({type:'duplicate_events',duplicateEventIds,duplicateSequences});
  const sessionGaps=[];
  for(const session of new Set(clientEvents.map(e=>e.client_session_id))) {
    const values=clientEvents.filter(e=>e.client_session_id===session).map(e=>Number(e.client_sequence)).sort((a,b)=>a-b);
    for(let i=1;i<values.length;i++) if(values[i]>values[i-1]+1) sessionGaps.push({after:values[i-1],before:values[i]});
  }
  return {attempts:attemptReports,parts:[...parts.values()].sort((a,b)=>a.part_number-b.part_number),issues,
    events:{total:data.events.length,by_type:tally(data.events,'event_type'),duplicate_ids:duplicateEventIds,duplicate_sequences:duplicateSequences,
      session_count:new Set(clientEvents.map(e=>e.client_session_id)).size,session_internal_gaps:sessionGaps,
      late_received:clientEvents.filter(e=>e.event_payload.server_context?.received_after_completion).length,
      future_clock_flagged:clientEvents.filter(e=>e.event_payload.server_context?.client_clock_future).length},
    observations:{total:data.observations.length,first:data.observations.filter(o=>o.is_first_response).length,
      repeated:data.observations.filter(o=>!o.is_first_response).length,eligible:data.bktReady,
      exclusion_reasons:tally(data.observations,'exclusion_reason')},revisions:{total:data.revisions.length,
    baseline_unknown:data.revisions.filter((r,i,rows)=>!r.baseline_known&&!rows.slice(0,i).some(p=>p.attempt_id===r.attempt_id&&p.question_id===r.question_id)).length},
    assessment_status:'descriptive_only_no_mastery',kc_assessment_status:data.bktReady?'requires_separate_validation':'insufficient_approved_evidence'};
}
async function run(userId) {
  if (!Number.isSafeInteger(userId)||userId<1) throw Error('Pass a positive user_id');
  const c=await connect('toeic_learning_events_dev');
  let data, proof;
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await c.query("SET LOCAL statement_timeout='15s'");
    const context=(await c.query("SELECT current_database() AS database,current_setting('transaction_read_only') AS read_only,current_setting('TimeZone') AS timezone,now()::text AS captured_at")).rows[0];
    const marker=(await c.query("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0].marker;
    if(marker!=='TOEIC_LEARNING_EVENTS_ISOLATED_DEVELOPMENT')throw Error('Wrong database marker');
    const user=(await c.query('SELECT user_id,full_name,role FROM "User" WHERE user_id=$1',[userId])).rows[0];
    if(!user||user.role!=='STUDENT')throw Error('Expected a real student account');
    const attempts=(await c.query(`SELECT a.*,t.test_name,a.start_time::text AS start_local,a.end_time::text AS end_local,
      extract(epoch FROM a.end_time-a.start_time) AS elapsed_wall_seconds,
      (a.end_time>=a.start_time AND a.end_time<=CURRENT_TIMESTAMP::timestamp) AS valid_time_window
      FROM user_test_attempts a JOIN tests t USING(test_id) WHERE user_id=$1 ORDER BY a.end_time,a.attempt_id`,[userId])).rows;
    const answers=(await c.query(`SELECT aq.*,ua.user_answer,ua.is_correct,ua.time_spent,ua.answered_at::text AS answered_local
      FROM attempt_questions aq JOIN user_test_attempts a USING(attempt_id) LEFT JOIN user_answers ua USING(attempt_id,question_id)
      WHERE a.user_id=$1 AND a.is_completed ORDER BY aq.attempt_id,aq.position`,[userId])).rows;
    const events=(await c.query('SELECT * FROM learning_events WHERE user_id=$1 ORDER BY received_at,event_id',[userId])).rows;
    const observations=(await c.query('SELECT * FROM learning_answer_observations WHERE user_id=$1 ORDER BY observed_at,attempt_id,question_id',[userId])).rows;
    const revisions=(await c.query('SELECT * FROM learning_answer_revisions WHERE user_id=$1 ORDER BY revision_id',[userId])).rows;
    const registry=(await c.query('SELECT mapping_version,question_id,question_version,taxonomy_version,review_status,content_verified,audio_verified FROM learning_kc_mapping_versions')).rows;
    const bktReady=Number((await c.query('SELECT count(*) FROM bkt_ready_observations WHERE user_id=$1',[userId])).rows[0].count);
    data={user,attempts,answers,events,observations,revisions,registry,bktReady};
    proof={...context,evidence_sha256:digest(data),transaction_end:'ROLLBACK',scope:'one repeatable-read snapshot; no claim that concurrent learners were idle'};
    await c.query('ROLLBACK');
  } finally {await c.end();}
  const report=analyze(data);
  const components=csv('knowledge_components.csv');
  const reviews=csv('MAPPING_REVIEW_TEMPLATE.csv');
  const quality=csv('CONTENT_QUALITY_REVIEW.csv');
  const audio=csv('AUDIO_VERIFICATION_MANIFEST.csv');
  const answeredIds=new Set(data.answers.filter(r=>r.user_answer).map(r=>r.question_id));
  const presentedIds=new Set(data.answers.map(r=>r.question_id));
  const qualityIds=new Set(quality.filter(q=>q.review_status!=='approved').map(q=>Number(q.question_id)));
  const priority=reviews.filter(m=>presentedIds.has(Number(m.question_id))).map(m=>({
    question_id:m.question_id,part_number:m.part_number,mapping_id:m.mapping_id,knowledge_component:m.knowledge_component,kc_role:m.kc_role,
    answered:answeredIds.has(Number(m.question_id)),review_status:m.review_status,content_quality_blocked:qualityIds.has(Number(m.question_id)),
    review_priority:qualityIds.has(Number(m.question_id))?'1_resolve_content':answeredIds.has(Number(m.question_id))?'2_review_answered':'3_review_blank',
    reason:m.reason,evidence_excerpt:m.evidence_excerpt,required_human_review:m.required_human_review,
    proposal_question_content_sha256:m.question_content_sha256,
    observed_question_version:data.answers.find(r=>r.question_id===Number(m.question_id))?.question_snapshot.learning_version?.question_version||'',
    version_note:'Proposal SHA and snapshot HMAC use different contracts; require content/media comparison, never equate hashes',
  })).sort((a,b)=>a.review_priority.localeCompare(b.review_priority)||Number(a.question_id)-Number(b.question_id));
  report.mapping_readiness={components:components.length,review_rows:reviews.length,review_statuses:tally(reviews,'review_status'),
    registry_rows:data.registry.length,registry_statuses:tally(data.registry,'review_status'),
    presented_questions:presentedIds.size,proposed_edges_for_presented:priority.length,
    pending_quality_question_ids:[...presentedIds].filter(id=>qualityIds.has(id)).sort((a,b)=>a-b),
    audio_review_statuses:tally(audio,'listening_review_status'),
    retrospective_mapping_policy:'No automatic backfill: future approval does not make old observations BKT-eligible; requires explicit versioned derivation with provenance'};
  const dir=path.join(aiRoot,'reports','learner_readiness',`user_${userId}_${new Date().toISOString().replace(/[:.]/g,'-')}`);
  fs.mkdirSync(dir,{recursive:true});
  const output={format_version:1,user:data.user,proof,...report};
  fs.writeFileSync(path.join(dir,'audit.json'),JSON.stringify(output,null,2)+'\n');
  const sheet=XLSX.utils.json_to_sheet(priority);
  fs.writeFileSync(path.join(dir,'mapping_review_priority.csv'),'\uFEFF'+XLSX.utils.sheet_to_csv(sheet));
  const usedAudio=audio.filter(a=>String(a.question_ids).split(';').some(id=>presentedIds.has(Number(id))));
  fs.writeFileSync(path.join(dir,'audio_review_priority.csv'),'\uFEFF'+XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(usedAudio)));
  const usedQuality=quality.filter(q=>presentedIds.has(Number(q.question_id)));
  fs.writeFileSync(path.join(dir,'content_quality_priority.csv'),'\uFEFF'+XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(usedQuality)));
  const table=report.attempts.map(a=>`| ${a.attempt_id} | ${a.test_name} | ${a.correct}/${a.total} | ${a.answered} | ${a.unanswered} | ${a.elapsed_wall_seconds.toFixed(1)} |`).join('\n');
  const markdown=`# Kiểm tra dữ liệu học tập — ${data.user.full_name}\n\nMốc snapshot: ${proof.captured_at}; database \`${proof.database}\`, timezone ${proof.timezone}. Transaction READ ONLY = ${proof.read_only}, kết thúc ROLLBACK.\n\n## Kết quả thực tế\n\n| Attempt | Bài | Đúng/tổng | Đã trả lời | Bỏ trống | Giây start–end |\n|---|---|---:|---:|---:|---:|\n${table}\n\n- Learning Events: **${report.events.total}**; theo loại: ${JSON.stringify(report.events.by_type)}.\n- Trùng event_id: ${report.events.duplicate_ids}; trùng session/sequence: ${report.events.duplicate_sequences}; khoảng trống sequence nội bộ session: ${report.events.session_internal_gaps.length}.\n- Revision đáp án persisted: ${report.revisions.total}; baseline chưa rõ: ${report.revisions.baseline_unknown}. Client answer events và persisted revisions có nhịp ghi khác nhau, không yêu cầu số hàng bằng nhau.\n- Observation: ${report.observations.total}; first ${report.observations.first}; repeat ${report.observations.repeated}; BKT-ready **${report.observations.eligible}**.\n- Lỗi đối chiếu: **${report.issues.length}**. Chi tiết trong [audit.json](audit.json).\n\n## Mapping và nội dung\n\n- ${components.length} KC; ${reviews.length} dòng review; trạng thái ${JSON.stringify(report.mapping_readiness.review_statuses)}. Registry có ${data.registry.length} hàng. File review không tự đồng bộ với registry.\n- ${presentedIds.size} câu đã phát, ${priority.length} cạnh mapping được trích vào [mapping_review_priority.csv](mapping_review_priority.csv); đây là danh sách ưu tiên, không phải quyết định duyệt.\n- Câu đã phát còn quality flag: ${report.mapping_readiness.pending_quality_question_ids.join(', ')||'không'}. Không tự sửa key hoặc loại khỏi lịch sử; tạm chặn sử dụng mastery. Duplicate-content flag khác với key sai, cần người duyệt xác nhận riêng.\n- Trạng thái audio: ${JSON.stringify(report.mapping_readiness.audio_review_statuses)}. File tồn tại/hash có giá trị không chứng minh audio khớp script.\n- Hash proposal SHA và version snapshot HMAC khác hợp đồng. Cần đối chiếu nội dung/media trước khi tạo mapping có version. Không gắn chỉ bằng question_id.\n\n## Giới hạn và quyết định\n\nĐây là thống kê mô tả từ đáp án thực tế theo snapshot, không là mastery, điểm TOEIC chuẩn hay chẩn đoán nguyên nhân sai. Part 2/3/6/7 chưa được đo trên tài khoản này; không gọi là yếu. Các bài có độ khó và độ phủ khác nhau. Không xếp hạng năng lực Part bằng tỷ lệ đúng này.\n\nKhông có approved evidence thì chưa tạo assessment theo KC hoặc chuỗi BKT đủ điều kiện. Không dùng xác suất LightGBM thay nhãn. Một câu/attempt chỉ một observation; secondary KC chỉ là ngữ cảnh, không nhân số quan sát.\n\nSnapshot media_verified chỉ kiểm tra availability/hash; chưa xác nhận nội dung. Thời gian câu do client đo và thuộc câu đang focus; màn nhóm audio không đo riêng được thời gian nhận thức mỗi câu. Timestamp local được xuất trực tiếp từ PostgreSQL, không đoán timezone qua JSON Date.\n\n${report.events.late_received} client events được nhận sau completion; có thể gồm xem lời giải hoặc gửi muộn. Không coi mọi event muộn là lỗi và không dùng để sửa nhãn cuối. Không có sequence gap trong dữ liệu đã nhận cũng không chứng minh outbox trên máy đã rỗng; cần kiểm tra trạng thái đồng bộ trên Android. Không có log rejected HTTP request trong bảng này để kết luận không từng xảy ra lỗi.\n\n## Bước tiếp theo\n\n1. Người quản trị xử lý quality flags, duyệt riêng primary/secondary cho các câu đã làm và nghe xác nhận audio bằng công cụ review hiện có. Không auto-approve.\n2. Chuẩn bị importer kiểm định ở chế độ dry-run: reviewer, thời gian, taxonomy, provenance, version, một primary, Part/section, content/audio confirmation; chưa ghi vào môi trường thu thập dữ liệu.\n3. Sau khi có duyệt thật, xây Assessment MVP theo KC với số câu/bằng chứng và insufficient_data; policy recommendation dựa metadata đã duyệt.\n4. Muốn dùng bài cũ sau duyệt, thiết kế derived evidence có version và cutoff riêng, giữ observation gốc; không cập nhật lịch sử để lấp mapping.\n5. Thu thập thêm người học thật và câu mới khác nhau trong KC trước thử BKT; chưa đặt số lượng tối thiểu tùy ý thành tiêu chuẩn chất lượng.\n\nChỉ tạo công cụ offline/báo cáo. Không gọi endpoint có side effect, không migrate, sửa dữ liệu/taxonomy, duyệt mapping, train hoặc thay mô hình; không thay cấu hình dịch vụ đang chạy.\n`;
  fs.writeFileSync(path.join(dir,'REPORT.md'),markdown);
  console.log(JSON.stringify({report_directory:dir,user:data.user,attempts:report.attempts,issues:report.issues,events:report.events,observations:report.observations,mapping_readiness:report.mapping_readiness},null,2));
  return output;
}
if(require.main===module) run(Number(process.argv[2])).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={analyze};
