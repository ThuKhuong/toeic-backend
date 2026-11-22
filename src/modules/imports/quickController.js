const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const multer = require('multer');
const Zip = require('adm-zip');
const { stagingDir } = require('../../middlewares/upload');
const { openArchive } = require('./archive');
const { parseArchive } = require('./parser');
const { validateItems, saveBatch } = require('./importService');
const { decodeUploadFilename } = require('./filenames');
const receive = multer({ dest: stagingDir, limits: { files: 50, fileSize: 10 * 1024 * 1024, fields: 2 },
  fileFilter(req, file, cb) {
    file.originalname = decodeUploadFilename(file.originalname);
    if (!/\.(xlsx|xls|zip|mp3|wav|m4a|ogg|png|jpg|jpeg|webp|gif)$/i.test(file.originalname)) return cb(Object.assign(new Error('File không được hỗ trợ: ' + file.originalname), { status: 400 }));
    cb(null, true);
  },
}).array('files', 50);

function upload(req, res, next) {
  receive(req, res, error => { if (error) return next(error); next(); });
}
async function processImport(req, res, reading = false) {
  let context, temporary;
  try {
    const part = Number(req.params.part);
    if (!(reading ? [6,7] : [1,2,3,4]).includes(part)) throw Object.assign(new Error(reading ? 'Nhập nhanh Reading hỗ trợ Part 6 và Part 7.' : 'Chỉ hỗ trợ Part 1–4.'), { status: 400 });
    const sourceSet = String(req.body.source_set || '').trim().replace(/\s+/g, ' ');
    if (!sourceSet || sourceSet.length > 150) throw Object.assign(new Error('Nhập tên bộ đề, tối đa 150 ký tự.'), {status:400});
    const files = req.files || [];
    if (!files.length || files.reduce((n, f) => n + f.size, 0) > 50 * 1024 * 1024) throw Object.assign(new Error('Chọn file; tổng dung lượng tối đa 50 MB.'), { status: 400 });
    const zip = new Zip();
    const names = new Set();
    const zipped = files.filter(f => /\.zip$/i.test(f.originalname));
    temporary = path.join(stagingDir, randomUUID() + '.zip');
    if (zipped.length) {
      if (files.length !== 1) throw Object.assign(new Error('Chọn một ZIP hoặc Excel cùng media, không trộn cả hai.'), { status: 400 });
      fs.copyFileSync(zipped[0].path, temporary);
    } else {
      for (const f of [...files].sort((a,b) => a.originalname.localeCompare(b.originalname))) {
        const name = f.originalname;
        if (/[\\/:]/.test(name) || names.has(name.toLowerCase())) throw Object.assign(new Error('Tên file trùng hoặc không hợp lệ: ' + name), { status: 400 });
        names.add(name.toLowerCase());
        zip.addFile(name, fs.readFileSync(f.path));
        zip.getEntry(name).header.time = new Date(2000, 0, 1);
      }
      zip.writeZip(temporary);
    }
    context = openArchive({ path: temporary, originalname: reading ? 'quick-reading.zip' : 'quick-listening.zip' });
    if (context.workbooks.length !== 1) throw Object.assign(new Error('Mỗi lần nhập nhanh chỉ chọn một file Excel.'), { status: 422 });
    const parsed = reading ? (part === 7 ? require('./quickPart7').parseQuickPart7(context) : require('./quickReading').parseQuickPart6(context)) : parseArchive(context, null, { listeningPart: part });
    const items = validateItems(parsed.items, reading ? 'reading' : 'listening', parsed.errors);
    items.forEach(q => { q.source_set = sourceSet; });
    if (items.some(q => q.part_number !== part)) throw Object.assign(new Error('Part trong Excel khác Part đang chọn.'), { status: 422 });
    if (req.params.action === 'preview') {
      const grouped = new Map();
      for (const q of items) {
        const key = q.group_key || `question-${q.order_in_test}`;
        if (!grouped.has(key)) grouped.set(key, { group: key, image: (q.image_url || q.passages?.[0]?.image_url) ? decodeURIComponent((q.image_url || q.passages[0].image_url).split('/').pop()) : null, title: reading ? q.passages[0].title : q.material.title, audio: reading ? null : decodeURIComponent(q.material.audio_url.split('/').pop()), questions: [] });
        grouped.get(key).questions.push({ number: q.order_in_test, text: q.question_text, row: q._source.row });
      }
      return res.json({ total: items.length, groups: [...grouped.values()], errors: [] });
    }
    // Separate namespace from legacy imports and between Parts.
    context.fingerprint = require('node:crypto').createHash('sha256').update(`quick-v2:${sourceSet.toLowerCase()}:${part}:${context.fingerprint}`).digest('hex');
    const result = await saveBatch(items, reading ? 'reading' : 'listening', context);
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Không thể xử lý bộ file.', errors: e.errors || [], created: 0 });
  } finally {
    if (context) context.cleanup();
    else if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary);
    for (const file of req.files || []) if (path.dirname(path.resolve(file.path)) === path.resolve(stagingDir) && fs.existsSync(file.path)) fs.unlinkSync(file.path);
  }
}
module.exports = { upload, handle: (req,res)=>processImport(req,res), handleReading: (req,res)=>processImport(req,res,true) };
