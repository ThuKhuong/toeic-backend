// Review validation and planning only. Intentionally has NO database writer/import mode.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const XLSX=require('xlsx');
const core=require('../../toeic-ai/reports/mapping_review_v1/review_core');
const {canonical}=require('../src/modules/learning/version');
const root=path.resolve(__dirname,'../..'),ai=path.join(root,'toeic-ai');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const readCSV=file=>{const w=XLSX.readFile(file,{raw:true});return XLSX.utils.sheet_to_json(w.Sheets[w.SheetNames[0]],{defval:''});};
const validTime=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value&&Date.parse(value)<=Date.now();
function loadPackage() {
  const folder=path.join(ai,'reports/mapping_review_v1');
  const meta=readJSON(path.join(folder,'package_validation.json'));
  const bytes=Object.entries(meta.source_files).map(([name,hash])=>{
    if(path.basename(name)!==name)throw Error('Invalid source path');
    const b=fs.readFileSync(path.join(ai,name));if(sha(b)!==hash)throw Error(`Source changed: ${name}`);return b;
  });
  if(sha(Buffer.concat(bytes))!==meta.source_bundle_sha256)throw Error('Source bundle digest mismatch');
  const html=fs.readFileSync(path.join(folder,'MAPPING_REVIEW.html'),'utf8');
  const match=html.match(/<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/);
  if(!match)throw Error('Missing embedded review source');
  const data=JSON.parse(match[1]);
  if(data.source_bundle_sha256!==meta.source_bundle_sha256)throw Error('Review HTML belongs to another source');
  const mappings=readCSV(path.join(ai,'question_skill_mapping_proposal.csv')).map(m=>({...m,question_id:Number(m.question_id)}));
  const components=readCSV(path.join(ai,'knowledge_components.csv'));
  if(JSON.stringify(canonical(mappings))!==JSON.stringify(canonical(data.mappings))||JSON.stringify(canonical(components))!==JSON.stringify(canonical(data.components)))throw Error('Embedded review data differs from checked CSV');
  const questions=readJSON(path.join(ai,'reports/taxonomy_v1/source_snapshot.json')).questions;
  if(JSON.stringify(canonical(questions))!==JSON.stringify(canonical(data.questions)))throw Error('Embedded questions differ from source snapshot');
  return data;
}
// A common content projection connects source objects to attempt snapshots without
// pretending that a proposal SHA-256 and a public HMAC version token are equal.
function projection(q,source=false) {
  const v=source?{...q,group_image_url:q.question_group?.image_url??null,
    material_audio:q.material?.audio_url??null,material_transcript:q.material?.transcript??null,
    passage_content:q.direct_passage?.content??null,passage_image_url:q.direct_passage?.image_url??null,
    passage_translation:q.direct_passage?.translation??null,passage_explanation:q.direct_passage?.explanation??null}:q;
  const fields=['part_number','question_text','correct_answer','explanation','image_url','group_image_url','audio_url','material_audio','material_transcript','passage_content','passage_image_url','passage_translation','passage_explanation'];
  return canonical({...Object.fromEntries(fields.map(k=>[k,v[k]??null])),
    choices:(v.choices||[]).map(c=>[c.choice_label,c.choice_text]).sort(),
    passages:(v.passages||[]).map(p=>[p.content??null,p.image_url??null,p.translation??null,p.explanation??null])});
}
function evaluate(data,bundle,confirmations=[],quality=[],audio=[],mediaChecks=new Map()) {
  const current=core.validateBundle(bundle,data);
  for(const event of bundle.events)if(!validTime(event.reviewed_at_utc))throw Error('Invalid/future decision timestamp');
  const byId=new Map();
  for(const row of confirmations) {
    const id=Number(row.question_id);
    if(!data.questions.some(q=>q.question_id===id)||byId.has(id))throw Error('Duplicate or unknown content confirmation question');
    byId.set(id,row);
  }
  return data.questions.map(q=>{
    const sources=data.mappings.filter(m=>m.question_id===q.question_id);
    const decisions=sources.map(m=>current[m.mapping_id]);
    const approved=decisions.filter(d=>d?.review_status==='approved');
    const primary=approved.filter(d=>d.reviewed_kc_role==='primary');
    const blockers=[];
    if(primary.length!==1)blockers.push('exactly_one_approved_primary_required');
    if(decisions.some(d=>!d||d.review_status==='pending_review'))blockers.push('unresolved_mapping_edges');
    if(sources.some(m=>m.evidence_status==='insufficient_evidence'))blockers.push('insufficient_source_evidence');
    const content=byId.get(q.question_id);
    const sourceHash=sources[0]?.question_content_sha256;
    if(!content||content.review_status!=='confirmed_original_correct'||content.question_content_sha256!==sourceHash||
      content.taxonomy_version!==sources[0]?.taxonomy_version||content.confirmed_correct_answer!==q.correct_answer||
      !String(content.reviewer||'').trim()||!String(content.confirmation_source||'').trim()||!validTime(content.reviewed_at_utc))
      blockers.push('versioned_content_and_original_key_confirmation_required');
    const flags=quality.filter(r=>Number(r.question_id)===q.question_id);
    const requiresQualityReview=sources.some(m=>m.content_issue||m.content_quality_status==='needs_content_review');
    if((requiresQualityReview&&!flags.length)||flags.some(r=>r.review_status!=='confirmed_original_correct'||r.confirmed_correct_answer!==q.correct_answer||
      r.question_content_sha256!==sourceHash||r.taxonomy_version!==sources[0]?.taxonomy_version||!String(r.reviewer||'').trim()||!String(r.confirmation_source||'').trim()||!validTime(r.reviewed_at_utc)))
      blockers.push('unresolved_content_quality_flag');
    const urls=[...new Set(sources.flatMap(m=>String(m.media_urls||'').split(';').filter(Boolean)))];
    if(urls.some(url=>mediaChecks.get(url)!==true))blockers.push('missing_or_changed_media');
    if(Number(q.part_number)<=4) {
      const audioRows=audio.filter(r=>String(r.question_ids).split(';').includes(String(q.question_id)));
      const sourceAudio=q.material?.audio_url||q.audio_url;
      const expectedMedia=(data.media||[]).find(m=>m.url===sourceAudio);
      const scriptQuestions=(expectedMedia?.question_ids||[]).map(id=>data.questions.find(item=>item.question_id===id)).filter(Boolean);
      const uniqueScripts=[];
      for(const item of scriptQuestions) {
        const entry=[item.material?.transcript?'transcript':'explanation',item.material?.transcript||item.explanation||''];
        if(!uniqueScripts.some(s=>s[0]===entry[0]&&s[1]===entry[1]))uniqueScripts.push(entry);
      }
      const expectedScript=uniqueScripts.map(s=>s[1]).join('\n\n');
      if(!sourceAudio||!audioRows.some(r=>r.audio_path===sourceAudio))blockers.push('audio_manifest_entry_required');
      if(!audioRows.length||!expectedMedia||!expectedScript||audioRows.some(r=>r.audio_sha256!==expectedMedia.sha256||r.current_script!==expectedScript||
        r.taxonomy_version!==sources[0]?.taxonomy_version||r.listening_review_status!=='verified'||r.comparison_result!=='matches_script'||
        !String(r.confirmed_by||'').trim()||!String(r.confirmation_source||'').trim()||!validTime(r.confirmed_at_utc)||mediaChecks.get(r.audio_path)!==true))
        blockers.push('verified_audio_script_match_required');
    }
    return {question_id:q.question_id,part_number:Number(q.part_number),taxonomy_version:sources[0]?.taxonomy_version,
      proposal_question_content_sha256:sourceHash,primary_kc:primary[0]?.reviewed_knowledge_component||null,
      secondary_kcs:approved.filter(d=>d.reviewed_kc_role==='secondary').map(d=>d.reviewed_knowledge_component),
      decision_provenance:approved.map(d=>({mapping_id:d.mapping_id,review_revision:d.review_revision,reviewer:d.reviewer,reviewed_at_utc:d.reviewed_at_utc})),
      content_confirmation_provenance:content?{...content}:null,
      quality_confirmation_provenance:flags,
      audio_confirmation_provenance:Number(q.part_number)<=4?audio.filter(r=>String(r.question_ids).split(';').includes(String(q.question_id))).map(r=>({
        audio_id:r.audio_id,audio_path:r.audio_path,audio_sha256:r.audio_sha256,confirmed_by:r.confirmed_by,confirmed_at_utc:r.confirmed_at_utc,
        confirmation_source:r.confirmation_source,listening_review_status:r.listening_review_status,comparison_result:r.comparison_result})):[],
      offline_review_ready:blockers.length===0,blockers,import_executed:false,bkt_eligible:false};
  });
}
async function run(options) {
  const data=loadPackage();
  const bundle=options.decisions?readJSON(options.decisions):{format_version:1,source_bundle_sha256:data.source_bundle_sha256,events:[]};
  const confirmations=options.content?readCSV(options.content):[];
  const quality=readCSV(options.quality||path.join(ai,'CONTENT_QUALITY_REVIEW.csv'));
  const audio=readCSV(options.audio||path.join(ai,'AUDIO_VERIFICATION_MANIFEST.csv'));
  const media=readJSON(path.join(ai,'reports/taxonomy_v1/media_manifest.json')).media;
  const mediaChecks=new Map();
  for(const m of media) {
    const local=path.resolve(root,'toeic_be',String(m.url).replace(/^\//,''));
    const uploads=path.join(root,'toeic_be','uploads')+path.sep;
    mediaChecks.set(m.url,local.startsWith(uploads)&&fs.existsSync(local)&&sha(fs.readFileSync(local))===m.sha256);
  }
  const questions=evaluate(data,bundle,confirmations,quality,audio,mediaChecks);
  const bindings=[];
  let database=null;
  if(options.snapshots) {
    const {connect}=require('./learningDevEnvironment');const c=await connect('toeic_learning_events_dev');
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await c.query("SET LOCAL statement_timeout='15s'");
      const context=(await c.query("SELECT current_database() AS database,current_setting('transaction_read_only') AS read_only,now()::text AS captured_at,shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker")).rows[0];
      if(context.marker!=='TOEIC_LEARNING_EVENTS_ISOLATED_DEVELOPMENT')throw Error('Wrong development database marker');
      const snapshots=(await c.query('SELECT DISTINCT question_id,question_snapshot FROM attempt_questions')).rows;
      for(const row of snapshots) {
        const source=data.questions.find(q=>q.question_id===row.question_id),q=row.question_snapshot;
        const review=questions.find(r=>r.question_id===row.question_id);
        const contentMatches=!!source&&JSON.stringify(projection(source,true))===JSON.stringify(projection(q));
        const token=q.learning_version?.question_version;
        const mediaMatches=!!q.learning_version?.media_verified&&q.learning_version.media.every(m=>mediaChecks.get(m.url)===true&&media.find(s=>s.url===m.url)?.sha256===m.sha256);
        bindings.push({question_id:row.question_id,question_version:token||null,content_matches_proposal:contentMatches,media_matches_review_source:mediaMatches,
          binding_status:contentMatches&&mediaMatches&&token?'matched_readonly_snapshot':'blocked_version_or_content',
          planned_mapping_ready:!!(review?.offline_review_ready&&contentMatches&&mediaMatches&&token),
          retrospective_bkt_eligible:false});
      }
      database=context;await c.query('ROLLBACK');
    }finally{await c.end();}
  }
  const output=path.join(ai,'reports/mapping_dry_run',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(output,{recursive:true});
  const summary={format_version:1,mode:'dry_run_only',created_at:new Date().toISOString(),source_bundle_sha256:data.source_bundle_sha256,
    decision_file_supplied:!!options.decisions,decision_events:bundle.events.length,question_count:questions.length,
    offline_review_ready:questions.filter(q=>q.offline_review_ready).length,snapshot_bindings_checked:bindings.length,
    matched_snapshot_bindings:bindings.filter(b=>b.binding_status==='matched_readonly_snapshot').length,
    planned_mapping_ready:bindings.filter(b=>b.planned_mapping_ready).length,database,
    writes_executed:0,approvals_created:0,bkt_eligibility_changed:false,
    warnings:['Reviewer identity is self-declared; local review JSON is not authentication or a digital signature.',
      'No automatic retrospective reassignment. Existing observations remain immutable.',
      'Snapshot binding does not establish current bank equivalence; future importer must compare a fresh content/media version in the same controlled operation.'],questions,bindings};
  fs.writeFileSync(path.join(output,'dry_run.json'),JSON.stringify(summary,null,2)+'\n');
  const template=data.questions.map(q=>({question_id:q.question_id,question_content_sha256:data.mappings.find(m=>m.question_id===q.question_id)?.question_content_sha256,
    taxonomy_version:data.mappings.find(m=>m.question_id===q.question_id)?.taxonomy_version,review_status:'pending_review',confirmed_correct_answer:'',reviewer:'',reviewed_at_utc:'',confirmation_source:'',notes:''}));
  fs.writeFileSync(path.join(output,'content_confirmation_template.csv'),'\uFEFF'+XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(template)));
  console.log(JSON.stringify({output,questions:summary.question_count,offline_review_ready:summary.offline_review_ready,
    matched_snapshot_bindings:summary.matched_snapshot_bindings,planned_mapping_ready:summary.planned_mapping_ready,writes_executed:0},null,2));
  return summary;
}
if(require.main===module) {
  const args=process.argv.slice(2),options={};
  try {
    for(let i=0;i<args.length;i++) {
      if(args[i]==='--read-snapshots'){options.snapshots=true;continue;}
      const key={'--decisions':'decisions','--content-confirmations':'content','--quality':'quality','--audio':'audio'}[args[i]];
      if(!key||!args[i+1]||args[i+1].startsWith('--'))throw Error('Unknown or incomplete argument; no import/write option exists');
      options[key]=path.resolve(args[++i]);
    }
    run(options).catch(e=>{console.error(e.message);process.exitCode=1;});
  } catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={evaluate,projection,validTime,loadPackage};
