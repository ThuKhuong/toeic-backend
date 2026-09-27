const multer = require("multer");
const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "../..");
const uploadsDir = path.join(rootDir, "uploads");
const importsDir = path.join(uploadsDir, "imports");
const stagingDir = path.join(rootDir, '.import-tmp');
fs.mkdirSync(stagingDir, { recursive: true });
const { randomUUID } = require('node:crypto');
const avatarsDir = path.join(uploadsDir, "avatars");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(importsDir)) {
  fs.mkdirSync(importsDir, { recursive: true });
}
if (!fs.existsSync(avatarsDir)) {
  fs.mkdirSync(avatarsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, stagingDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    const safeBase = base.replace(/[^a-zA-Z0-9_-]/g, "_");
    cb(null, `${randomUUID()}_${safeBase}${ext}`);
  },
});

const fileFilter = function (req, file, cb) {
  const allowed = [".zip"];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error("Unsupported file type"));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Avatar upload storage
const avatarStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const userId = (req.user && req.user.user_id) || "anonymous";
    const userDir = path.join(avatarsDir, String(userId));
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, "_");
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

module.exports = { upload, uploadsDir, importsDir, stagingDir, avatarsDir, avatarUpload };

