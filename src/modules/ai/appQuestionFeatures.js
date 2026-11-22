// Preparation only: app skills are NOT Riiid tag IDs. No model invocation.
const crypto=require('node:crypto');
function fingerprint(question) {
  const choices=(question.choices || []).map(c=>[c.choice_label || c.label,c.choice_text || c.text]).sort((a,b)=>a[0].localeCompare(b[0]));
  const passages=(question.passages || []).map(p=>[p.passage_id,p.content || '',p.image_url || '']);
  return crypto.createHash('sha256').update(JSON.stringify([
    Number(question.part_number),question.question_text || '',question.correct_answer || '',
    question.image_url || '',question.group_image_url || '',question.material_audio || question.audio_url || '',
    question.passage_content || '',question.passage_image_url || '',choices,passages,
  ])).digest('hex');
}
function buildAppQuestionPreview({question,userId,evidence,asOf}) {
  const cutoff=new Date(asOf).getTime();
  if(!Number.isFinite(cutoff))throw Error('Invalid asOf');
  const qid=Number(question.question_id),part=Number(question.part_number);
  if(!Number.isInteger(qid)||![1,2,3,4,5,6,7].includes(part))throw Error('Invalid question');
  const valid=evidence.filter(r=>r.is_completed===true && r.end_time && new Date(r.end_time).getTime()<cutoff &&
    ['A','B','C','D'].includes(r.user_answer) && ['A','B','C','D'].includes(r.question_snapshot?.correct_answer) &&
    [1,2,3,4,5,6,7].includes(Number(r.question_snapshot?.part_number)));
  const own=valid.filter(r=>Number(r.user_id)===Number(userId));
  const ownPart=own.filter(r=>Number(r.question_snapshot.part_number)===part);
  const version=fingerprint(question);
  const same=valid.filter(r=>Number(r.question_id)===qid&&fingerprint(r.question_snapshot)===version);
  const ownQuestion=same.filter(r=>Number(r.user_id)===Number(userId));
  // Other learners provide question-difficulty evidence. Keep personal history
  // separate, so one learner's repeated answers don't become a crowd estimate.
  const others=same.filter(r=>Number(r.user_id)!==Number(userId));
  const otherHistory=valid.filter(r=>Number(r.user_id)!==Number(userId));
  const correct=rows=>rows.filter(r=>r.user_answer===r.question_snapshot.correct_answer).length;
  const accuracy=rows=>(correct(rows)+1)/(rows.length+2);
  const prior=accuracy(otherHistory);
  return {
    status:'preparation_only',question_id:qid,part,as_of:new Date(cutoff).toISOString(),question_fingerprint:version,
    features:{part,user_acc:accuracy(own),attempt_count:own.length,user_part_acc:accuracy(ownPart),user_part_count:ownPart.length,
      user_question_acc:accuracy(ownQuestion),user_question_count:ownQuestion.length,
      question_acc:(correct(others)+20*prior)/(others.length+20),question_count:others.length,question_unseen:Number(others.length===0)},
    evidence:{personal_answers:own.length,question_answers_from_other_learners:others.length,other_learners_for_question:new Set(others.map(r=>r.user_id)).size},
    missing_v3_features:['tag_count','bundle_size','tag_acc','tag_evidence_mean','user_tag_acc','user_tag_evidence_mean','tags_missing'],
    blockers:['App skill IDs have no verified mapping to Riiid tags.','Question catalog and prior come from app history, not the Riiid training distribution; validate or retrain before deployment.'],
    model_called:false,
  };
}
module.exports={fingerprint,buildAppQuestionPreview};
