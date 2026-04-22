const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Customer = require("../models/Customer");
const { authRequired, customerOnly } = require("../middleware/auth");

const router = express.Router();

const SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

function signCustomerToken(customer) {
  return jwt.sign(
    { cid: customer._id.toString(), email: customer.email, role: "customer", name: customer.name },
    SECRET,
    { expiresIn: EXPIRES_IN }
  );
}

// POST /api/customers/register
// Body: { name, email, phone, password }
router.post("/register", async (req, res, next) => {
  try {
    const { name, email, phone, password } = req.body || {};
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ message: "name, email, phone, password required" });
    }

    const e = String(email).toLowerCase().trim();
    const existing = await Customer.findOne({ email: e });
    if (existing) return res.status(409).json({ message: "Email already registered" });

    const passwordHash = await bcrypt.hash(String(password), 10);
    const customer = await Customer.create({
      name: String(name).trim(),
      email: e,
      phone: String(phone).trim(),
      passwordHash,
      isActive: true
    });

    // IMPORTANT: Do NOT auto-login right after registration.
    // Customer must login via the login panel.
    return res.status(201).json({
      message: "Registered successfully. Please login.",
      customer: { id: customer._id, name: customer.name, email: customer.email, phone: customer.phone }
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/customers/login
// Body: { email, password }
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ message: "email and password required" });

    const customer = await Customer.findOne({ email: String(email).toLowerCase().trim() });
    if (!customer || !customer.isActive) return res.status(401).json({ message: "Invalid credentials" });

    const ok = await bcrypt.compare(String(password), customer.passwordHash);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const token = signCustomerToken(customer);
    return res.json({
      token,
      customer: { id: customer._id, name: customer.name, email: customer.email, phone: customer.phone }
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/customers/me
router.get("/me", authRequired, customerOnly, async (req, res, next) => {
  try {
    const customer = await Customer.findById(req.user.cid).select("-passwordHash");
    if (!customer) return res.status(404).json({ message: "Not found" });
    return res.json({ customer });
  } catch (e) {
    next(e);
  }
});

// PUT /api/customers/me
// Body: { name?, phone?, password? }
router.put("/me", authRequired, customerOnly, async (req, res, next) => {
  try {
    const { name, phone, password } = req.body || {};
    const customer = await Customer.findById(req.user.cid);
    if (!customer) return res.status(404).json({ message: "Not found" });

    if (name) customer.name = String(name).trim();
    if (phone) customer.phone = String(phone).trim();
    if (password) customer.passwordHash = await bcrypt.hash(String(password), 10);

    await customer.save();

    const token = signCustomerToken(customer); // refresh token with latest name
    return res.json({
      token,
      customer: { id: customer._id, name: customer.name, email: customer.email, phone: customer.phone }
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
