// Multipart headers are read as Latin-1 by Busboy, while browsers send UTF-8.
// Decode only when the original bytes form valid UTF-8; retain genuine Latin-1.
function decodeUploadFilename(name) {
  if (!/[^\x00-\x7f]/.test(name) || [...name].some(c => c.codePointAt(0) > 255)) return name;
  try { return new TextDecoder('utf-8', {fatal:true}).decode(Buffer.from(name,'latin1')); }
  catch { return name; }
}
function rangeFilename(name) {
  return name.normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g,'-');
}
module.exports={decodeUploadFilename,rangeFilename};
