const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const backend = path.resolve(__dirname, '../../..');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
const hash = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function content(q) {
  return Object.fromEntries(['part_number','question_text','correct_answer','explanation','image_url','group_image_url',
    'audio_url','material_audio','material_transcript','passage_content','passage_image_url','passage_translation','passage_explanation']
    .map(key=>[key,q[key]??null]).concat([['choices',(q.choices||[]).map(c=>[c.choice_label,c.choice_text]).sort()],
      ['passages',(q.passages||[]).map(p=>[p.content,p.image_url,p.translation,p.explanation])]]));
}
async function attachVersion(q) {
  const urls=[...new Set([q.image_url,q.group_image_url,q.material_audio,q.audio_url,q.passage_image_url,
    ...(q.passages||[]).map(p=>p.image_url)].filter(Boolean))].sort();
  const media=[];
  for(const url of urls) {
    let sha256=null;
    try {
      const decoded=decodeURIComponent(url);
      const file=path.resolve(backend,decoded.replace(/^\//,''));
      const uploads=path.join(backend,'uploads')+path.sep;
      if(!decoded.startsWith('/uploads/')||!file.startsWith(uploads))throw Error('External media');
      sha256=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
    } catch { /* Preserve unavailable media explicitly; never invent a hash. */ }
    media.push({url,sha256});
  }
  const secret=process.env.LEARNING_VERSION_SECRET;
  if(typeof secret!=='string'||secret.length<32)throw Error('LEARNING_VERSION_SECRET must contain at least 32 characters');
  // Public version tokens must not expose a brute-forceable hash of a small answer-key space.
  const token=crypto.createHmac('sha256',secret).update(JSON.stringify(canonical({content:content(q),media}))).digest('hex');
  q.learning_version={scheme:'snapshot_media_hmac_v1',question_version:token,media,
    media_verified:media.every(m=>m.sha256!==null)};
  return q;
}
function versionOf(q) {
  if(q.learning_version?.question_version)return q.learning_version.question_version;
  const publicContent=content(q);
  for(const key of ['correct_answer','explanation','material_transcript','passage_translation','passage_explanation'])delete publicContent[key];
  publicContent.passages=(q.passages||[]).map(p=>[p.content,p.image_url]);
  return `legacy:${hash(publicContent)}`;
}
module.exports={canonical,hash,attachVersion,versionOf};
