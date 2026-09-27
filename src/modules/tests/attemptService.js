const pool = require('../../../db');

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function publicQuestion(snapshot) {
  const { correct_answer, explanation, material_transcript, ...question } = snapshot;
  question.choices = snapshot.choices.map(({ is_correct, ...choice }) => choice);
  return question;
}

async function ownedAttempt(client, attemptId, userId) {
  const { rows } = await client.query(
    'SELECT * FROM user_test_attempts WHERE attempt_id=$1 AND user_id=$2 FOR UPDATE',
    [attemptId, userId]
  );
  if (!rows[0]) fail(404, 'Attempt not found');
  return rows[0];
}

async function startAttempt(userId, testId) {
  return transaction(async (client) => {
    // One statement takes a consistent snapshot of questions, choices and media.
    const { rows } = await client.query(`
      SELECT t.test_id, t.test_type, t.time_limit, COALESCE((SELECT jsonb_agg(item ORDER BY item.order_in_test, item.question_id)
        FROM (
          SELECT q.*, rp.title AS passage_title, rp.content AS passage_content,
            rp.image_url AS passage_image_url, lm.title AS material_title,
            lm.audio_url AS material_audio, lm.transcript AS material_transcript,
            g.image_url AS group_image_url,
            COALESCE((SELECT jsonb_agg(ac ORDER BY ac.choice_label)
              FROM answer_choices ac WHERE ac.question_id=q.question_id), '[]') AS choices,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('skill_id', s.skill_id,
              'code', s.code, 'name', s.name, 'weight', qs.weight))
              FROM question_skills qs JOIN skills s USING (skill_id)
              WHERE qs.question_id=q.question_id), '[]') AS skills,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('passage_id', p.passage_id,
              'title', p.title, 'content', p.content, 'image_url', p.image_url,
              'position', gp.position) ORDER BY gp.position)
              FROM question_group_passages gp JOIN reading_passages p USING (passage_id)
              WHERE gp.group_id=q.group_id), '[]') AS passages
          FROM questions q
          LEFT JOIN question_groups g ON g.group_id=q.group_id
          LEFT JOIN reading_passages rp ON rp.passage_id=q.passage_id
          LEFT JOIN listening_materials lm ON lm.material_id=COALESCE(q.material_id,g.material_id)
          WHERE q.test_id=t.test_id
        ) item), '[]') AS questions
      FROM tests t WHERE t.test_id=$1 AND t.is_active=true FOR SHARE OF t`, [testId]);
    if (!rows[0]) return null;
    const questions = rows[0].questions;
    if (!questions.length) fail(409, 'Test has no questions');
    for (const q of questions) {
      const labels = q.choices.map(c => c.choice_label);
      const expected = q.part_number === 2 ? ['A','B','C'] : ['A','B','C','D'];
      if (expected.some(label => !labels.includes(label)) || labels.length !== expected.length ||
          !labels.includes(q.correct_answer)) fail(409, 'Test has incomplete answer choices');
      // correct_answer is the canonical key, including for old imported questions.
      q.choices = q.choices.map(c => ({ ...c, is_correct: c.choice_label === q.correct_answer }));
    }
    const attempt = (await client.query(`INSERT INTO user_test_attempts
      (user_id,test_id,total_questions,duration_seconds,deadline_at)
      VALUES ($1,$2,$3,$4::integer,CASE WHEN $5::boolean THEN CURRENT_TIMESTAMP+make_interval(secs=>$4::integer) ELSE NULL END) RETURNING *`,
      [userId,testId,questions.length,(rows[0].time_limit || 60)*60,rows[0].test_type==='full_test'])).rows[0];
    await client.query(`INSERT INTO attempt_questions (attempt_id,question_id,position,question_snapshot)
      SELECT $1,(q->>'question_id')::integer,position::integer,q
      FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS items(q,position)`,
      [attempt.attempt_id,JSON.stringify(questions)]);
    return { ...attempt, questions: questions.map(publicQuestion) };
  });
}

async function submitAnswer(attemptId, questionId, answer, seconds, userId) {
  if (answer !== null && !['A','B','C','D'].includes(answer)) fail(400,'Invalid answer');
  seconds = seconds ?? 0;
  if (!Number.isSafeInteger(seconds) || seconds < 0) fail(400,'Invalid time_spent');
  return transaction(async client => {
    const attempt = await ownedAttempt(client,attemptId,userId);
    if (attempt.is_completed) fail(409,'Attempt already completed');
    if (attempt.deadline_at && new Date(attempt.deadline_at) <= new Date()) fail(409,'Time limit reached');
    const q = (await client.query(`SELECT question_snapshot FROM attempt_questions
      WHERE attempt_id=$1 AND question_id=$2`,[attemptId,questionId])).rows[0]?.question_snapshot;
    if (!q) fail(400,'Question was not presented in this attempt');
    if (answer !== null && !q.choices.some(c => c.choice_label === answer)) fail(400,'Invalid choice');
    const { rows } = await client.query(`INSERT INTO user_answers
      (attempt_id,question_id,user_answer,is_correct,time_spent) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (attempt_id,question_id) DO UPDATE SET user_answer=EXCLUDED.user_answer,
        is_correct=EXCLUDED.is_correct,time_spent=EXCLUDED.time_spent,answered_at=CURRENT_TIMESTAMP
      RETURNING answer_id,attempt_id,question_id,user_answer,time_spent,answered_at`,
      [attemptId,questionId,answer,answer === q.correct_answer,seconds]);
    return rows[0];
  });
}

async function finishAttempt(attemptId,userId) {
  return transaction(async client => {
    const previous = await ownedAttempt(client,attemptId,userId);
    if (previous.is_completed) return previous;
    await client.query(`UPDATE user_answers ua SET is_correct=
      COALESCE(ua.user_answer=aq.question_snapshot->>'correct_answer',false)
      FROM attempt_questions aq WHERE aq.attempt_id=ua.attempt_id
      AND aq.question_id=ua.question_id AND ua.attempt_id=$1`,[attemptId]);
    const counts = (await client.query(`SELECT COUNT(*)::integer AS total,
      COUNT(*) FILTER (WHERE ua.is_correct)::integer AS correct,
      COUNT(ua.user_answer)::integer AS answered
      FROM attempt_questions aq LEFT JOIN user_answers ua
      USING (attempt_id,question_id) WHERE aq.attempt_id=$1`,[attemptId])).rows[0];
    if (!counts.total) fail(409,'Attempt has no question snapshots');
    const attempt = (await client.query(`UPDATE user_test_attempts SET end_time=CURRENT_TIMESTAMP,
      total_questions=$2,total_correct=$3,score=$4,is_completed=true,
      time_spent=CASE WHEN deadline_at IS NOT NULL THEN
        GREATEST(0,ROUND(LEAST(duration_seconds,EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-start_time)))/60))
        ELSE GREATEST(0,ROUND(elapsed_seconds/60.0)) END
      WHERE attempt_id=$1 RETURNING *`,
      [attemptId,counts.total,counts.correct,Math.round(counts.correct/counts.total*100)])).rows[0];
    await client.query(`INSERT INTO user_stats
      (user_id,tests_completed,total_answers,correct_answers,total_study_time,last_study_date)
      VALUES ($1,1,$2,$3,$4,CURRENT_DATE) ON CONFLICT (user_id) DO UPDATE SET
      tests_completed=COALESCE(user_stats.tests_completed,0)+1,
      total_answers=COALESCE(user_stats.total_answers,0)+EXCLUDED.total_answers,
      correct_answers=COALESCE(user_stats.correct_answers,0)+EXCLUDED.correct_answers,
      total_study_time=COALESCE(user_stats.total_study_time,0)+EXCLUDED.total_study_time,
      last_study_date=CURRENT_DATE,updated_at=CURRENT_TIMESTAMP`,
      [userId,counts.answered,counts.correct,attempt.time_spent]);
    return attempt;
  });
}

async function getAttemptResults(attemptId,userId) {
  return transaction(async client => {
    const attempt = await ownedAttempt(client,attemptId,userId);
    if (!attempt.is_completed) fail(409,'Complete the attempt before viewing results');
    const { rows } = await client.query(`SELECT aq.question_snapshot,aq.question_id,
      ua.answer_id,aq.attempt_id,ua.user_answer,COALESCE(ua.is_correct,false) AS is_correct,
      ua.time_spent,ua.answered_at FROM attempt_questions aq LEFT JOIN user_answers ua
      USING (attempt_id,question_id) WHERE aq.attempt_id=$1 ORDER BY aq.position`,[attemptId]);
    const test = (await client.query('SELECT test_name,test_type,time_limit FROM tests WHERE test_id=$1',
      [attempt.test_id])).rows[0];
    return { attempt: { ...attempt,...test }, answers: rows.map(({question_snapshot,...row}) =>
      ({ ...question_snapshot,...row })) };
  });
}

async function resumeAttempt(attemptId,userId) {
  const result = await transaction(async client => {
    const a = await ownedAttempt(client,attemptId,userId);
    if (a.is_completed || (a.deadline_at && new Date(a.deadline_at)<=new Date())) return { completed:true };
    const rows = (await client.query(`SELECT aq.question_snapshot,ua.user_answer,ua.time_spent
      FROM attempt_questions aq LEFT JOIN user_answers ua USING(attempt_id,question_id)
      WHERE aq.attempt_id=$1 ORDER BY aq.position`,[attemptId])).rows;
    if (!rows.length) fail(409,'Bài cũ không có dữ liệu câu hỏi để tiếp tục.');
    const test = (await client.query('SELECT test_id,test_name,test_type,time_limit FROM tests WHERE test_id=$1',[a.test_id])).rows[0];
    return { attempt_id:a.attempt_id, test, current_index:a.current_index,
      elapsed_seconds:a.elapsed_seconds, duration_seconds:a.duration_seconds,
      deadline_at:a.deadline_at,
      remaining_seconds:a.deadline_at ? Math.max(0,Math.ceil((new Date(a.deadline_at)-Date.now())/1000)) : Math.max(0,a.duration_seconds-a.elapsed_seconds),
      questions:rows.map(r=>({...publicQuestion(r.question_snapshot),user_answer:r.user_answer,time_spent:r.time_spent || 0})) };
  });
  if (result.completed) { await finishAttempt(attemptId,userId); return { completed:true }; }
  return result;
}

async function saveProgress(attemptId,userId,data) {
  return transaction(async client=>{
    const a=await ownedAttempt(client,attemptId,userId);
    if(a.is_completed) fail(409,'Attempt already completed');
    if(a.deadline_at && new Date(a.deadline_at)<=new Date()) fail(409,'Time limit reached');
    const {current_index,elapsed_seconds,answers}=data;
    if(!Number.isInteger(current_index)||current_index<0||current_index>=a.total_questions ||
       !Number.isSafeInteger(elapsed_seconds)||elapsed_seconds<0 || !Array.isArray(answers)||answers.length>a.total_questions) fail(400,'Invalid progress');
    const snapshots=new Map((await client.query('SELECT question_id,question_snapshot FROM attempt_questions WHERE attempt_id=$1',[attemptId])).rows.map(r=>[r.question_id,r.question_snapshot]));
    const seen=new Set();
    for(const row of answers) {
      const q=snapshots.get(row.question_id);
      if(!q||seen.has(row.question_id)||!Number.isSafeInteger(row.time_spent)||row.time_spent<0 ||
        (row.user_answer!==null&&!q.choices.some(c=>c.choice_label===row.user_answer))) fail(400,'Invalid answer');
      seen.add(row.question_id);
      await client.query(`INSERT INTO user_answers(attempt_id,question_id,user_answer,time_spent)
        VALUES($1,$2,$3,$4) ON CONFLICT(attempt_id,question_id) DO UPDATE SET
        user_answer=EXCLUDED.user_answer,time_spent=GREATEST(user_answers.time_spent,EXCLUDED.time_spent),answered_at=CURRENT_TIMESTAMP`,
        [attemptId,row.question_id,row.user_answer,row.time_spent]);
    }
    await client.query(`UPDATE user_test_attempts SET current_index=$2,
      elapsed_seconds=GREATEST(elapsed_seconds,LEAST($3,COALESCE(duration_seconds,$3))) WHERE attempt_id=$1`,[attemptId,current_index,elapsed_seconds]);
    return {saved:true};
  });
}
module.exports = { startAttempt,submitAnswer,finishAttempt,getAttemptResults,resumeAttempt,saveProgress };
