// Read-only database export. Draft labels are never applied automatically.
const fs=require('node:fs'),path=require('node:path'),pool=require('../db');
const {buildAppQuestionPreview}=require('../src/modules/ai/appQuestionFeatures');
function propose(q){
 const text=String(q.question_text || '').toLowerCase(),part=Number(q.part_number);
 if(part===1)return['listening_visual_detail','Dạng bài Part 1; cần kiểm tra ảnh/lời thoại.'];
 if(part===2)return['listening_response','Dạng bài Part 2; cần kiểm tra lời thoại.'];
 const section=part<=4?'listening':'reading';
 if(/\b(suggested|implied|inferred|most likely|probably)\b/.test(text))return[section+'_inference','Câu hỏi có từ gợi ý suy luận; cần đọc/nghe ngữ cảnh để xác nhận.'];
 if(/\b(main purpose|purpose of|mainly about|primarily about|main topic)\b/.test(text))return[section+'_main_idea','Câu hỏi có từ gợi ý mục đích/ý chính; cần xác nhận.'];
 if(part>=6&&/\b(closest in meaning|word .+ mean|synonym)\b/.test(text))return['reading_vocabulary','Câu hỏi có từ gợi ý nghĩa từ; cần xác nhận.'];
 return['','Chưa đủ căn cứ từ câu hỏi; cần xem đoạn văn/ảnh/audio và đáp án.'];
}
const csv=value=>'"'+String(value??'').replaceAll('"','""')+'"';
(async()=>{try{
 const asOf=(await pool.query('SELECT CURRENT_TIMESTAMP AS time')).rows[0].time;
 const questions=(await pool.query(`SELECT q.*,lm.audio_url AS material_audio,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('choice_label',c.choice_label,'choice_text',c.choice_text) ORDER BY c.choice_label) FROM answer_choices c WHERE c.question_id=q.question_id),'[]') AS choices,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('passage_id',p.passage_id,'content',p.content,'image_url',p.image_url) ORDER BY gp.position) FROM question_group_passages gp JOIN reading_passages p USING(passage_id) WHERE gp.group_id=q.group_id),'[]') AS passages
   FROM questions q LEFT JOIN listening_materials lm USING(material_id) WHERE q.part_number BETWEEN 1 AND 7 ORDER BY q.part_number,q.order_in_test,q.question_id`)).rows;
 const skills=(await pool.query('SELECT code,name,section FROM skills ORDER BY skill_id')).rows;
 const evidence=(await pool.query(`SELECT a.user_id,a.is_completed,a.end_time,aq.question_id,aq.question_snapshot,ua.user_answer
   FROM user_test_attempts a JOIN attempt_questions aq USING(attempt_id) JOIN user_answers ua USING(attempt_id,question_id)
   WHERE a.is_completed=true AND a.end_time<$1 AND ua.user_answer IN ('A','B','C','D')`,[asOf])).rows;
 const users=[...new Set(evidence.map(r=>r.user_id))];
 const draft=questions.map(q=>{const [code,reason]=propose(q);return{
   question_id:q.question_id,part:q.part_number,source_set:q.source_set || '',source_question_number:q.source_question_number || q.order_in_test || '',
   question_text:q.question_text || '',suggested_skill_code:code,reason,approved_skill_code:'',review_status:'pending',
 };});
 const stats=questions.map(q=>{
   const rows=evidence.filter(r=>Number(r.question_id)===Number(q.question_id));
   return{question_id:q.question_id,part:q.part_number,answers:rows.length,learners:new Set(rows.map(r=>r.user_id)).size};
 });
 const preview=questions.map(q=>buildAppQuestionPreview({question:q,userId:users[0] ?? -1,evidence,asOf}));
 const output=path.resolve(__dirname,'../../toeic-ai/reports/app_feature_readiness');fs.mkdirSync(output,{recursive:true});
 const file=path.join(output,'skill_labels_draft.csv');
 // Preserve any reviewer edits from a previous run.
 if(!fs.existsSync(file)&&draft.length)fs.writeFileSync(file,'\uFEFF'+[Object.keys(draft[0]).map(csv).join(','),...draft.map(r=>Object.values(r).map(csv).join(','))].join('\r\n'));
 const reviewFile=path.join(output,'skill_labels_review.xlsx');
 if(!fs.existsSync(reviewFile)){
   const X=require('xlsx'),book=X.utils.book_new();
   const sheet=X.utils.json_to_sheet(draft);sheet['!cols']=[{wch:14},{wch:8},{wch:25},{wch:22},{wch:75},{wch:30},{wch:70},{wch:30},{wch:18}];sheet['!autofilter']={ref:sheet['!ref']};
   X.utils.book_append_sheet(book,sheet,'questions');X.utils.book_append_sheet(book,X.utils.json_to_sheet(skills),'skills');
   X.utils.book_append_sheet(book,X.utils.aoa_to_sheet([
     ['BƯỚC','CÁCH LÀM'],
     ['1','Mở sheet questions. Các nhãn suggested_skill_code chỉ là gợi ý theo quy tắc, chưa phải AI phân loại và chưa được nhập vào hệ thống.'],
     ['2','Đọc câu hỏi cùng ảnh/đoạn văn/audio trên trang quản trị. Không đoán kỹ năng chỉ bằng số Part.'],
     ['3','Sang sheet skills, chọn code phù hợp. Điền code đã kiểm tra vào approved_skill_code.'],
     ['4','Điền approved vào review_status cho dòng đã xác nhận. Không chắc thì giữ pending và để trống approved_skill_code.'],
     ['5','Không sửa question_id, source_question_number hay question_text. Có thể làm trước một nhóm 10 câu.'],
     ['6','Lưu file và gửi lại để kiểm tra trước khi nhập nhãn vào hệ thống.'],
     ['LƯU Ý','Nhãn kỹ năng của app không tự tương ứng với mã tags Riiid. Hoàn thành file không đồng nghĩa mô hình v3 có thể dùng ngay.'],
   ]),'HUONG_DAN');
   book.Sheets.HUONG_DAN['!cols']=[{wch:15},{wch:130}];X.writeFile(book,reviewFile);
 }
 const inventory={as_of:asOf,questions:questions.length,learners_with_completed_answers:users.length,answered_events:evidence.length,
   questions_with_answer_history:stats.filter(q=>q.answers>0).length,questions_with_multiple_learners:stats.filter(q=>q.learners>1).length,
   labels_applied:false,model_called:false,parts:[...new Set(questions.map(q=>q.part_number))].map(part=>({part,questions:stats.filter(q=>q.part===part).length,with_history:stats.filter(q=>q.part===part&&q.answers>0).length})),
   note:'Feature examples use one existing learner internally; no user identifiers exported. 0.5 without evidence is a smoothing prior, not model confidence.'};
 fs.writeFileSync(path.join(output,'inventory.json'),JSON.stringify(inventory,null,2));
 fs.writeFileSync(path.join(output,'skills.json'),JSON.stringify(skills,null,2));
 fs.writeFileSync(path.join(output,'question_evidence.json'),JSON.stringify(stats,null,2));
 fs.writeFileSync(path.join(output,'feature_examples.json'),JSON.stringify(preview,null,2));
 console.log(JSON.stringify(inventory,null,2));console.log('Draft and feature examples: '+output);
}finally{await pool.end();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
