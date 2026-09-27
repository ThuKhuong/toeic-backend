const { openArchive, validateLocalMedia } = require('./archive');
const { parseArchive } = require('./parser');
const { validateItems, saveBatch, error, invalid } = require('./importService');
function failure(res,e) {
  if (!e.status) console.error('Import failed:',e);
  return res.status(e.status || 500).json({error:e.status ? e.message : 'Không thể nhập dữ liệu. Hãy thử lại.',created:0,total:e.total || 0,errors:e.errors || [],items:[]});
}
function zip(part = null) {
  return async (req,res) => {
    let context;
    try {
      context=openArchive(req.file);
      const parsed=parseArchive(context,part);
      const kind=part ? 'reading' : 'listening';
      const items=validateItems(parsed.items,kind,parsed.errors);
      // Namespace by parser/Part as the same ZIP can be submitted to different endpoints.
      context.fingerprint = require('node:crypto').createHash('sha256').update(`v1:${part || 'listening'}:${context.fingerprint}`).digest('hex');
      const result=await saveBatch(items,kind,context);
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch(e) { failure(res,e); }
    finally { if(context) context.cleanup(); }
  };
}
async function importJson(input,kind) {
  const items=validateItems(input,kind);
  const errors=[];
  for(const q of items) {
    const media=(object,key,type)=>{if(!object?.[key])return;try{object[key]=validateLocalMedia(object[key],type);}catch(e){errors.push(error(q._source,key,e.message));}};
    media(q,'image_url','image');media(q,'audio_url','audio');media(q.material,'audio_url','audio');
    for(const p of q.passages || []) media(p,'image_url','image');
  }
  if(errors.length)throw invalid(errors,items.length);
  return saveBatch(items,kind);
}
function json(kind) { return async(req,res)=>{try{const result=await importJson(req.body.items,kind);res.status(result.duplicate?200:201).json(result);}catch(e){failure(res,e);}}; }
module.exports={zip,json,importJson};
