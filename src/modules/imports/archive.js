const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const AdmZip = require('adm-zip');
const { crc32 } = require('adm-zip/util');
const XLSX = require('xlsx');
const { importsDir, stagingDir } = require('../../middlewares/upload');
const { MAX_ROWS, invalid, error, text } = require('./importService');
const MAX_FILES = 500, MAX_EXPANDED = 200 * 1024 * 1024, MAX_FILE = 50 * 1024 * 1024;
const mediaExts = new Set(['.jpg','.jpeg','.png','.webp','.gif','.mp3','.wav','.m4a','.ogg']);
function inside(root, target) { const rel = path.relative(path.resolve(root), path.resolve(target)); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel); }
function removeOwned(root, target) {
  if (!inside(root,target)) throw new Error('Refusing cleanup outside import directory');
  fs.rmSync(target, { recursive:true, force:true });
}
function zipEntries(buffer, budget = MAX_EXPANDED, maxFiles = MAX_FILES) {
  const entries = new AdmZip(buffer).getEntries();
  if (entries.length > maxFiles) throw new Error(`ZIP vượt giới hạn ${maxFiles} mục.`);
  let size = 0;
  const seen = new Set();
  for (const e of entries) {
    const name = e.entryName.replace(/\\/g,'/');
    if (name.startsWith('/') || name.includes(':') || name.includes('\0') || name.split('/').some(p => p === '..') || name.split('/').length > 12) throw new Error('Đường dẫn ZIP không hợp lệ.');
    if (((e.attr >>> 16) & 0xf000) === 0xa000 || e.header.encrypted) throw new Error('Không nhận symlink hoặc ZIP mã hóa.');
    if (seen.has(name.toLowerCase())) throw new Error('ZIP có đường dẫn trùng nhau.');
    seen.add(name.toLowerCase());
    size += e.header.size;
    if (e.header.size > MAX_FILE || size > budget) throw new Error('Dung lượng giải nén vượt giới hạn.');
  }
  return entries;
}
function unpack(e) {
  const data = e.header.method === 0 ? e.getCompressedData() : e.header.method === 8 ? zlib.inflateRawSync(e.getCompressedData(), { maxOutputLength: Math.min(MAX_FILE,e.header.size + 1) }) : null;
  if (!data || data.length !== e.header.size || crc32(data) !== e.header.crc) throw new Error('File nén hỏng hoặc sai kích thước/CRC.');
  return data;
}
function openArchive(file) {
  if (!file?.path || !inside(stagingDir,file.path)) throw invalid([error(null,'file','Thiếu file ZIP hợp lệ.')]);
  const stage = fs.mkdtempSync(path.join(stagingDir,'extract-'));
  const publicDir = path.join(importsDir,crypto.randomUUID());
  const context = { stage, publicDir, committed:false, files:[], referenced:new Set() };
  context.cleanup = () => { removeOwned(stagingDir,stage); removeOwned(stagingDir,file.path); if (!context.committed && fs.existsSync(publicDir)) removeOwned(importsDir,publicDir); };
  try {
    const buffer = fs.readFileSync(file.path);
    context.fingerprint = crypto.createHash('sha256').update(buffer).digest('hex');
    for (const e of zipEntries(buffer)) {
      if (e.isDirectory) continue;
      const rel = e.entryName.replace(/\\/g,'/');
      const ext = path.extname(rel).toLowerCase();
      if (rel.startsWith('__MACOSX/') || path.basename(rel).startsWith('.')) continue;
      // Template instructions are not data and are never published to uploads.
      if (path.basename(rel) === 'HUONG_DAN.txt') { unpack(e); continue; }
      if (!mediaExts.has(ext) && !['.xlsx','.xls'].includes(ext)) throw new Error(`File không được hỗ trợ: ${rel}`);
      const dest = path.resolve(stage,rel);
      if (!inside(stage,dest)) throw new Error('Đường dẫn ZIP không hợp lệ.');
      fs.mkdirSync(path.dirname(dest),{recursive:true});
      fs.writeFileSync(dest,unpack(e),{flag:'wx'});
      context.files.push({rel,path:dest,ext});
    }
    context.workbooks = context.files.filter(f => ['.xlsx','.xls'].includes(f.ext));
    if (!context.workbooks.length || context.workbooks.length > 20) throw new Error('ZIP cần từ 1 đến 20 workbook.');
    context.publish = () => {
      if (!context.referenced.size) return;
      fs.mkdirSync(publicDir,{recursive:true});
      for (const rel of context.referenced) {
        const target = path.resolve(publicDir,rel);
        if (!inside(publicDir,target)) throw new Error('Đường dẫn media không hợp lệ.');
        fs.mkdirSync(path.dirname(target),{recursive:true});
        fs.copyFileSync(path.resolve(stage,rel),target,fs.constants.COPYFILE_EXCL);
      }
    };
    context.media = (value, workbook, type) => {
      const v = text(value).replace(/\\/g,'/');
      if (!v) return null;
      if (/^https?:\/\//i.test(v)) return v;
      if (v.startsWith('/uploads/')) return validateLocalMedia(v,type);
      if (v.startsWith('/') || v.includes(':') || v.split('/').includes('..')) throw new Error('Đường dẫn media không hợp lệ.');
      const relative = path.posix.join(path.posix.dirname(workbook),v);
      let candidates = context.files.filter(f => f.rel === relative);
      if (!candidates.length) candidates = context.files.filter(f => f.rel === v);
      if (!candidates.length) candidates = context.files.filter(f => path.posix.basename(f.rel).toLowerCase() === path.posix.basename(v).toLowerCase());
      if (candidates.length !== 1) throw new Error(candidates.length ? 'Tên media bị trùng; cần đường dẫn rõ ràng.' : `Không tìm thấy media: ${v}`);
      const f = candidates[0]; checkMediaExt(f.ext,type);
      context.referenced.add(f.rel);
      return `/uploads/imports/${path.basename(publicDir)}/${f.rel.split('/').map(encodeURIComponent).join('/')}`;
    };
    return context;
  } catch (e) { context.cleanup(); throw invalid([error({file:file.originalname},'file',e.message)]); }
}
function checkMediaExt(ext,type) {
  const allowed = type === 'audio' ? ['.mp3','.wav','.m4a','.ogg'] : ['.jpg','.jpeg','.png','.webp','.gif'];
  if (!allowed.includes(ext.toLowerCase())) throw new Error(`Định dạng ${type} không được hỗ trợ.`);
}
function validateLocalMedia(value,type) {
  const v = text(value); if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (!v.startsWith('/uploads/')) throw new Error('Media phải là URL http(s) hoặc file trong /uploads/.');
  const { uploadsDir } = require('../../middlewares/upload');
  const relative = decodeURIComponent(v.slice('/uploads/'.length));
  const target = path.resolve(uploadsDir,relative);
  if (!inside(uploadsDir,target) || !fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error('File media local không tồn tại.');
  if (!inside(fs.realpathSync(uploadsDir),fs.realpathSync(target))) throw new Error('Media nằm ngoài thư mục uploads.');
  checkMediaExt(path.extname(target),type); return v;
}
function readWorkbook(file) {
  const buffer = fs.readFileSync(file.path);
  // XLSX is itself a ZIP: validate its expanded XML budget before parsing.
  if (file.ext === '.xlsx') for (const e of zipEntries(buffer,40*1024*1024,1000)) if (!e.isDirectory) unpack(e);
  return XLSX.read(buffer,{type:'buffer',sheetRows:MAX_ROWS+2});
}
function rows(sheet,source) {
  if (!sheet) throw invalid([error(source,'sheet','Thiếu sheet bắt buộc.')]);
  const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
  if (range.e.r > MAX_ROWS || range.e.c > 100) throw invalid([error(source,'sheet','Sheet vượt giới hạn 2000 dòng dữ liệu hoặc 101 cột.')]);
  return XLSX.utils.sheet_to_json(sheet,{defval:''}).map(r=>({...r,_source:{...source,row:r.__rowNum__+1}}));
}
module.exports = { openArchive, readWorkbook, rows, validateLocalMedia };
