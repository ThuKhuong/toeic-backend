const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const uploadsPath = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}
const parentUploadsPath = path.join(__dirname, "../uploads");
app.use(
  "/uploads",
  express.static(uploadsPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".m4a")) res.setHeader("Content-Type", "audio/mp4");
    },
  })
);
if (fs.existsSync(parentUploadsPath)) {
  app.use(
    "/uploads",
    express.static(parentUploadsPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".m4a")) res.setHeader("Content-Type", "audio/mp4");
      },
    })
  );
}

// Import routes
const authRoutes = require("./src/modules/auth/authRoutes");
const vocabularyStudentRoutes = require("./src/modules/vocabulary/vocabularyStudentRoute");
const vocabularyAdminRoutes = require("./src/modules/vocabulary/vocabularyAdminRoutes");
const questionsStudentRoutes = require("./src/modules/questions/studentRoutes");
const questionsAdminRoutes = require("./src/modules/questions/adminRoutes");
const testsStudentRoutes = require("./src/modules/tests/testsStudentRoutes");
const testsAdminRoutes = require("./src/modules/tests/testsAdminRoutes");
const adminRoutes = require("./src/modules/admin/adminRoutes");
const usersAdminRoutes = require("./src/modules/users/usersAdminRoutes");
const usersStudentRoutes = require("./src/modules/users/usersStudentRoutes");
const listeningAdminRoutes = require("./src/modules/listening/adminRoutes");

// Setup routes
app.use("/api/auth", authRoutes);

app.use("/api/student/vocabulary", vocabularyStudentRoutes);
app.use("/api/admin/vocabulary", vocabularyAdminRoutes);

app.use("/api/questions", questionsStudentRoutes);
app.use("/api/admin/questions", questionsAdminRoutes);

app.use("/api/tests", testsStudentRoutes);
app.use("/api/admin/tests", testsAdminRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/users", usersAdminRoutes);
app.use("/api/users", usersStudentRoutes);
app.use("/api/admin/listening", listeningAdminRoutes);


app.get("/api", (req, res) =>
  res.json({
    message: "TOEIC API is running",
    version: "1.0.0",
    endpoints: [
      "/api/auth",
      "/api/student/vocabulary",
      "/api/admin/vocabulary",
      "/api/tests",
      "/api/admin/tests",
      "/api/questions",
      "/api/admin/questions",
      "/api/admin",
      "/api/admin/users",
      "/api/users",
      "/api/admin/listening",
    ],
  })
);

// Consistent JSON errors for parser/upload limits, including oversized ZIPs.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.code === 'LIMIT_FILE_SIZE' || err.type === 'entity.too.large' ? 413 : err.status || (err.name === 'MulterError' || err.message === 'Unsupported file type' ? 400 : 500);
  res.status(status).json({ error: status === 413 ? 'File hoặc dữ liệu vượt giới hạn cho phép.' : status === 500 ? 'Lỗi xử lý yêu cầu.' : err.message, created: 0, errors: [] });
});
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
}
module.exports = app;

