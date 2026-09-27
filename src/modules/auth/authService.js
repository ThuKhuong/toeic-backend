// d:\hoctaphk1nam4\DOANCHUYENNGANH\TOEIC\toeic_be\src\modules\auth\authService.js
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const AuthModel = require("./authModel");

async function login(email, password) {
  const user = await AuthModel.getUserByEmail(email);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  const token = jwt.sign(
    { user_id: user.user_id, email: user.email, role: user.role },
    process.env.JWT_SECRET || "secret123",
    { expiresIn: "7d" }
  );
  const { password_hash, ...safe } = user;
  return { token, user: safe };
}

async function register({ email, password, full_name, role }) {
  const exists = await AuthModel.getUserByEmail(email);
  if (exists) throw new Error("EMAIL_EXISTS");
  const hash = await bcrypt.hash(password, 10);
  const newUser = await AuthModel.createUser({
    email,
    password_hash: hash,
    full_name,
    role,
  });
  const token = jwt.sign(
    { user_id: newUser.user_id, email: newUser.email, role: newUser.role },
    process.env.JWT_SECRET || "secret123",
    { expiresIn: "7d" }
  );
  return { token, user: newUser };
}

module.exports = { login, register };
