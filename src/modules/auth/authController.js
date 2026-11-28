// d:\hoctaphk1nam4\DOANCHUYENNGANH\TOEIC\toeic_be\src\modules\auth\authController.js
const AuthService = require("./authService");

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password are required" });
    const result = await AuthService.login(email, password);
    if (!result) return res.status(401).json({ error: "Invalid credentials" });
    res.json(result);
  } catch {
    res.status(500).json({ error: "Server error" });
  }
};

exports.register = async (req, res) => {
  try {
    const { email, password, full_name, role } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password are required" });
    const result = await AuthService.register({
      email,
      password,
      full_name,
      role,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.message === "EMAIL_EXISTS")
      return res.status(409).json({ error: "Email already in use" });
    res.status(500).json({ error: "Server error" });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    if (!email || !newPassword) {
      return res.status(400).json({ error: "Vui lòng nhập email và mật khẩu mới" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Mật khẩu mới phải từ 6 ký tự trở lên" });
    }
    const result = await AuthService.forgotPassword(email, newPassword);
    res.json(result);
  } catch (err) {
    if (err.message === "USER_NOT_FOUND") {
      return res.status(404).json({ error: "Email chưa được đăng ký trong hệ thống" });
    }
    res.status(500).json({ error: "Server error" });
  }
};
