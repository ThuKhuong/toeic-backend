const {randomUUID}=require('node:crypto');
const message='Dự đoán thử nghiệm khả năng trả lời đúng ở lượt tiếp theo theo Part từ lịch sử đến khi nộp bài. Không phải xác suất của từng câu cụ thể, điểm TOEIC hay kết luận năng lực. Mô hình học từ Riiid; chưa kiểm định độ chính xác trên người dùng ứng dụng.';
function createAttemptPredictor({pool,fetchImpl=fetch,baseUrl='http://127.0.0.1:8000',timeoutMs=4000}) {
  return async function predict(attemptId,userId,{retry=false}={}) {
    const attempt=(await pool.query('SELECT * FROM user_test_attempts WHERE attempt_id=$1 AND user_id=$2',[attemptId,userId])).rows[0];
    if(!attempt)throw Object.assign(new Error('Attempt not found'),{status:404});
    if(!attempt.is_completed)throw Object.assign(new Error('Nộp bài trước khi xem dự đoán.'),{status:409});
    const previous=attempt.ai_prediction;
    if(previous && (previous.status==='ready' || (!retry && previous.status!=='processing'))) return previous;
    if(previous?.status==='processing' && Date.now()-Date.parse(previous.started_at)<60000)return previous;
    // Freeze evidence at this submission. Retries reuse the saved inputs even
    // after the learner completes other tests. Labels come from snapshots.
    let inputs=previous?.inputs;
    if(!inputs){
      const history=(await pool.query(`SELECT (aq.question_snapshot->>'part_number')::integer AS part,
        COUNT(*)::integer AS answered,
        COUNT(*) FILTER (WHERE ua.user_answer=aq.question_snapshot->>'correct_answer')::integer AS correct
        FROM user_test_attempts a JOIN attempt_questions aq USING(attempt_id)
        JOIN user_answers ua ON ua.attempt_id=aq.attempt_id AND ua.question_id=aq.question_id
        WHERE a.user_id=$1 AND a.is_completed=true AND a.end_time IS NOT NULL
        AND (a.end_time,a.attempt_id)<=(SELECT end_time,attempt_id FROM user_test_attempts WHERE attempt_id=$2)
        AND ua.user_answer IN ('A','B','C','D')
        AND aq.question_snapshot->>'part_number' IN ('1','2','3','4','5','6','7')
        GROUP BY 1`,[userId,attemptId])).rows;
      const parts=(await pool.query("SELECT DISTINCT (question_snapshot->>'part_number')::integer AS part FROM attempt_questions WHERE attempt_id=$1 ORDER BY 1",[attemptId])).rows;
      const answered=history.reduce((n,p)=>n+p.answered,0),correct=history.reduce((n,p)=>n+p.correct,0);
      inputs=parts.filter(p=>p.part>=1&&p.part<=7).map(({part})=>{const p=history.find(h=>h.part===part);return{part,answered_count:answered,correct_count:correct,part_answered_count:p?.answered || 0,part_correct_count:p?.correct || 0};});
    }
    const token=randomUUID(),started_at=new Date().toISOString();
    const initial={version:'attempt_lightgbm_v1',status:'processing',token,started_at,as_of:attempt.end_time,inputs,parts:previous?.parts || [],message};
    const claimed=await pool.query(`UPDATE user_test_attempts SET ai_prediction=$3::jsonb
      WHERE attempt_id=$1 AND user_id=$2 AND (ai_prediction IS NULL OR
        (ai_prediction->>'status'='processing' AND (ai_prediction->>'started_at')::timestamptz < CURRENT_TIMESTAMP-interval '60 seconds') OR
        ($4::boolean AND ai_prediction->>'status' IN ('failed','partial','insufficient_data')))
      RETURNING ai_prediction`,[attemptId,userId,JSON.stringify(initial),retry]);
    if(!claimed.rows.length)return (await pool.query('SELECT ai_prediction FROM user_test_attempts WHERE attempt_id=$1 AND user_id=$2',[attemptId,userId])).rows[0].ai_prediction;
    const parts=await Promise.all(inputs.map(async input=>{
      const saved=previous?.parts?.find(p=>p.part===input.part && p.status==='ready');if(saved)return saved;
      if(!input.part_answered_count)return{part:input.part,status:'insufficient_data',probability:null};
      try{
        const response=await fetchImpl(`${baseUrl.replace(/\/$/,'')}/predict`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(timeoutMs)});
        if(!response.ok)throw Error('prediction failed');
        const result=await response.json();
        if(result.model!=='lightgbm_v2'||result.part!==input.part||typeof result.probability!=='number'||!Number.isFinite(result.probability)||result.probability<0||result.probability>1||!/^[a-f0-9]{64}$/.test(result.artifact_sha256 || ''))throw Error('invalid model response');
        return{part:input.part,status:'ready',probability:result.probability,model:result.model,artifact_sha256:result.artifact_sha256,feature_version:'group_history_v1',time_feature_missing:true};
      }catch{return{part:input.part,status:'failed',probability:null,message:'Chưa kết nối được mô hình hoặc phản hồi không hợp lệ. Bạn có thể thử lại.'};}
    }));
    const ready=parts.filter(p=>p.status==='ready').length,failed=parts.some(p=>p.status==='failed');
    const result={...initial,status:failed?(ready?'partial':'failed'):ready?'ready':'insufficient_data',parts,completed_at:new Date().toISOString()};
    delete result.token;
    const stored=await pool.query("UPDATE user_test_attempts SET ai_prediction=$3::jsonb WHERE attempt_id=$1 AND user_id=$2 AND ai_prediction->>'token'=$4 RETURNING ai_prediction",[attemptId,userId,JSON.stringify(result),token]);
    return stored.rows[0]?.ai_prediction || result;
  };
}
const predictAttempt=createAttemptPredictor({pool:require('../../../db'),baseUrl:process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000'});
module.exports={createAttemptPredictor,predictAttempt};
