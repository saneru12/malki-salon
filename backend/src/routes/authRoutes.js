const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { authRequired, adminOnly } = require("../middleware/auth");

const router = express.Router();

function signToken(user) {
  const secret = process.env.JWT_SECRET || "dev_secret_change_me";
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign(
    {
      uid: user._id.toString(),
      email: user.email,
      role: user.role || "admin",
      displayName: user.displayName || ""
    },
    secret,
    { expiresIn }
  );
}

function normalizeEmail(value) {
  return String(value || "").toLowerCase().trim();
}

function serializeUser(user) {
  return {
    _id: user._id,
    email: user.email,
    role: user.role,
    displayName: user.displayName || "",
    isActive: user.isActive !== false,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

async function requireUniqueEmail(email, ignoreId = null) {
  const existing = await User.findOne({ email: normalizeEmail(email) }).select("_id");
  if (existing && String(existing._id) !== String(ignoreId || "")) {
    const err = new Error("That email address is already in use.");
    err.status = 409;
    throw err;
  }
}

function validatePassword(password, { required = false } = {}) {
  const value = String(password || "");
  if (!value && !required) return "";
  if (value.length < 6) {
    const err = new Error("Password must be at least 6 characters long.");
    err.status = 400;
    throw err;
  }
  return value;
}

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ message: "email and password required" });

    const user = await User.findOne({ email: normalizeEmail(email) });
    if (!user || user.isActive === false) return res.status(401).json({ message: "Invalid credentials" });

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const token = signToken(user);
    res.json({ token, user: serializeUser(user) });
  } catch (e) {
    next(e);
  }
});

router.get("/me", authRequired, async (req, res, next) => {
  try {
    if (!req.user?.uid) return res.json({ user: req.user || null });
    const user = await User.findById(req.user.uid).select("email role displayName isActive createdAt updatedAt");
    if (!user || user.isActive === false) {
      return res.status(401).json({ message: "Account not found or inactive" });
    }
    res.json({ user: serializeUser(user) });
  } catch (e) {
    next(e);
  }
});

router.get("/staff-managers", authRequired, adminOnly, async (req, res, next) => {
  try {
    const users = await User.find({ role: "staff_manager" }).sort({ createdAt: -1, email: 1 });
    res.json(users.map(serializeUser));
  } catch (e) {
    next(e);
  }
});

router.post("/staff-managers", authRequired, adminOnly, async (req, res, next) => {
  try {
    const displayName = String(req.body?.displayName || "").trim();
    const email = normalizeEmail(req.body?.email);
    const password = validatePassword(req.body?.password, { required: true });
    const isActive = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true;

    if (!displayName || !email) {
      return res.status(400).json({ message: "displayName, email and password are required" });
    }

    await requireUniqueEmail(email);
    const passwordHash = await bcrypt.hash(password, 10);
    const created = await User.create({
      displayName,
      email,
      passwordHash,
      role: "staff_manager",
      isActive
    });
    res.status(201).json(serializeUser(created));
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.put("/staff-managers/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.params.id, role: "staff_manager" });
    if (!user) return res.status(404).json({ message: "Staff manager account not found" });

    const displayName = String(req.body?.displayName ?? user.displayName ?? "").trim();
    const email = normalizeEmail(req.body?.email ?? user.email);
    const isActive = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : user.isActive !== false;
    const password = validatePassword(req.body?.password, { required: false });

    if (!displayName || !email) {
      return res.status(400).json({ message: "displayName and email are required" });
    }

    await requireUniqueEmail(email, user._id);
    user.displayName = displayName;
    user.email = email;
    user.isActive = isActive;
    if (password) user.passwordHash = await bcrypt.hash(password, 10);
    await user.save();

    res.json(serializeUser(user));
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.delete("/staff-managers/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const deleted = await User.findOneAndDelete({ _id: req.params.id, role: "staff_manager" });
    if (!deleted) return res.status(404).json({ message: "Staff manager account not found" });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
