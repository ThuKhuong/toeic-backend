const path = require('node:path');
const { readWorkbook, rows } = require('./archive');
const { error, text } = require('./importService');
const { rangeFilename } = require('./filenames');

function parseQuickPart7(context) {
  const file = context.workbooks[0], wb = readWorkbook(file);
  const errors = [], items = [], seen = new Set();
  for (const sheet of wb.SheetNames) if (sheet !== 'questions') errors.push(error({file:file.rel,sheet},'sheet','Mẫu Part 7 chỉ cần sheet questions.'));
  const groups = new Map();
  for (const f of context.files.filter(f => f !== file)) {
    const match = rangeFilename(path.posix.parse(f.rel).name).match(/^(\d+)-(\d+)(?:-(\d+))?$/);
    if (!['.png','.jpg','.jpeg','.webp','.gif'].includes(f.ext) || !match) {
      errors.push(error({file:f.rel},'image','Ảnh đặt tên theo khoảng câu: 147-148.png; nhóm nhiều ảnh: 176-180-1.png, 176-180-2.png.')); continue;
    }
    const start=Number(match[1]), end=Number(match[2]), position=Number(match[3] || 1), key=`${start}-${end}`;
    if (end-start<1 || end-start>4 || position<1 || position>3) errors.push(error({file:f.rel},'image','Nhóm Part 7 cần 2–5 câu và tối đa 3 ảnh.'));
    if (!groups.has(key)) groups.set(key,{key,start,end,images:[],questions:[]});
    groups.get(key).images.push({...f,position});
  }
  for (const q of rows(wb.Sheets.questions,{file:file.rel,sheet:'questions'})) {
    const n=Number(q.question_number);
    if (!Number.isSafeInteger(n) || n<=0 || seen.has(n)) errors.push(error(q._source,'question_number','Số câu phải là số nguyên dương và không trùng.'));
    seen.add(n);
    const matches=[...groups.values()].filter(g=>n>=g.start && n<=g.end);
    if(matches.length!==1) {errors.push(error(q._source,'image',matches.length?'Khoảng câu của các nhóm ảnh bị chồng nhau.':`Không có ảnh đoạn văn cho câu ${n}.`));continue;}
    matches[0].questions.push({...q,number:n});
  }
  for (const g of groups.values()) {
    const source=g.questions[0]?._source || {file:g.images[0].rel};
    if(g.questions.length!==g.end-g.start+1) errors.push(error(source,'question_number',`Nhóm ${g.key} phải đủ các câu từ ${g.start} đến ${g.end}.`));
    g.images.sort((a,b)=>a.position-b.position);
    if(g.images.some((f,i)=>f.position!==i+1)) errors.push(error(source,'image',`Ảnh nhóm ${g.key} bị trùng hoặc thiếu thứ tự; dùng hậu tố -1, -2, -3.`));
    if(g.images.length>1 && g.questions.length!==5) errors.push(error(source,'image','Nhóm nhiều đoạn văn phải có 5 câu hỏi.'));
    const common = column => {
      const values=[...new Set(g.questions.map(q=>text(q[column])).filter(Boolean))];
      if(values.length>1) errors.push(error(source,column,`Nhóm ${g.key} có dữ liệu ${column} không thống nhất. Chỉ nhập ở một dòng của nhóm.`));
      return values[0] || '';
    };
    const translation=common('passage_translation'), explanation=common('passage_explanation');
    const passages=g.images.map((f,i)=>{
      let image_url=null;
      try {image_url=context.media(f.rel,file.rel,'image');} catch(e){errors.push(error(source,'image',e.message));}
      return {title:`Part 7 - Câu ${g.key}${g.images.length>1?` · Đoạn ${i+1}`:''}`,content:'',image_url,translation:i===0?translation:'',explanation:i===0?explanation:''};
    });
    for(const q of g.questions.sort((a,b)=>a.number-b.number)) items.push({_source:q._source,part_number:7,order_in_test:q.number,group_key:g.key,question_text:text(q.question_text),correct_answer:text(q.correct_answer).toUpperCase(),explanation:text(q.explanation),choices:['A','B','C','D'].map(label=>({label,text:text(q[label])})),passages});
  }
  return {items,errors};
}
module.exports={parseQuickPart7};
