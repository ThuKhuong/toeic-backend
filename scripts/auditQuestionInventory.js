// Aggregate-only, read-only inventory; no learner data or credentials exported.
const fs=require('node:fs'),path=require('node:path'),pool=require('../db');
(async()=>{try{
 const rows=(await pool.query(`SELECT q.part_number,COUNT(*)::integer AS questions,
   COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM question_skills s WHERE s.question_id=q.question_id))::integer AS labeled_questions,
   COUNT(*) FILTER (WHERE q.group_id IS NOT NULL)::integer AS grouped_questions
   FROM questions q WHERE q.part_number BETWEEN 1 AND 7 GROUP BY q.part_number ORDER BY q.part_number`)).rows;
 const skills=(await pool.query('SELECT COUNT(*)::integer AS count FROM skills')).rows[0].count;
 const out=path.resolve(__dirname,'../../toeic-ai/reports/question_data_audit/app_inventory.json');
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({parts:rows,skill_definitions:skills},null,2));
 console.log(JSON.stringify({parts:rows,skill_definitions:skills}));
}finally{await pool.end();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
