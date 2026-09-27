const { readWorkbook, rows } = require('./archive');
const { text, error, invalid, MAX_ROWS } = require('./importService');
function parseArchive(context, part) {
  const items = [], errors = [];
  function media(value,file,type,source,column) {
    try { return context.media(value,file,type); } catch(e) { errors.push(error(source,column,e.message)); return null; }
  }
  for (const f of context.workbooks) {
    let wb;
    try { wb = readWorkbook(f); } catch(e) { errors.push(error({file:f.rel},'file',e.message)); continue; }
    if (!part) {
      for (const sn of wb.SheetNames) {
        const source = {file:f.rel,sheet:sn};
        let parsed;
        try { parsed = rows(wb.Sheets[sn],source); } catch(e) { errors.push(...(e.errors || [error(source,'sheet',e.message)])); continue; }
        let previous = null;
        for (const r of parsed) {
          const pn = Number(r.part_number || r.part || r.Part);
          const group = text(r.group_key);
          let audio = r.audio_url || r.audio || r['Audio URL'] || r.audio_path;
          let title = text(r.material_title || r['Material Title'] || r.title);
          let transcript = text(r.transcript);
          // Only an explicit shared group / adjacent Part 3–4 set may inherit audio.
          if (!audio && [3,4].includes(pn) && previous?.part === pn && group === previous.group) {
            audio = previous.audio; title ||= previous.title; transcript ||= previous.transcript;
          }
          previous = {part:pn,group,audio,title,transcript};
          const q = { _source:r._source,part_number:pn,group_key:group,question_text:text(r.question_text || r.question || r.Question),correct_answer:text(r.correct_answer || r.answer || r.correct || r.Correct).toUpperCase(),explanation:text(r.explanation),order_in_test:r.order_in_test || null,
            image_url:media(r.image_url || r.image || r['Image URL'] || r.image_path,f.rel,'image',r._source,'image_url'),
            material:{title, audio_url:media(audio,f.rel,'audio',r._source,'audio_url'),transcript,duration:Number(r.duration || 0),topic:text(r.topic),speaker_count:Number(r.speaker_count || 1),accent:text(r.accent)},
            choices:(pn===2 ? ['A','B','C'] : ['A','B','C','D']).map(label=>({label,text:text(r['choice'+label] ?? r[label] ?? r['Choice '+label])})) };
          if (pn === 2 && text(r.choiceD || r.D || r['Choice D'])) errors.push(error(r._source,'D','Part 2 chỉ có A, B, C.'));
          items.push(q);
        }
      }
    } else {
      const source = {file:f.rel};
      let passages, questions;
      try { passages=rows(wb.Sheets.passages,{...source,sheet:'passages'}); questions=rows(wb.Sheets.questions,{...source,sheet:'questions'}); }
      catch(e) { errors.push(...(e.errors || [error(source,'sheet',e.message)])); continue; }
      const map=new Map();
      for(const p of passages) {
        const key=text(p.key);
        if(!key || map.has(key)) { errors.push(error(p._source,'key',key ? 'Mã ngữ liệu bị trùng trong workbook.' : 'Thiếu mã ngữ liệu.')); continue; }
        map.set(key,{title:text(p.title),content:text(p.content),image_url:media(p.image_url,f.rel,'image',p._source,'image_url')});
      }
      for(const q of questions) {
        const keys=text(q.passage_keys || q.passage_key).split(/[|;,]/).map(text).filter(Boolean);
        if(!keys.length || new Set(keys).size !== keys.length || keys.some(k=>!map.has(k))) errors.push(error(q._source,'passage_keys','Mã ngữ liệu bị thiếu, trùng hoặc không tồn tại trong sheet passages.'));
        items.push({_source:q._source,part_number:part,group_key:text(q.group_key) || keys.join('|'),passage_key:keys.join('|'),passages:keys.filter(k=>map.has(k)).map(k=>map.get(k)),question_text:text(q.question_text),correct_answer:text(q.correct_answer).toUpperCase(),explanation:text(q.explanation),order_in_test:q.order_in_test || null,choices:['A','B','C','D'].map(label=>({label,text:text(q[label])}))});
      }
    }
    if(items.length>MAX_ROWS) throw invalid([error({file:f.rel},'file',`Tối đa ${MAX_ROWS} câu cho một đợt nhập.`)],items.length);
  }
  return {items,errors};
}
module.exports = { parseArchive };
