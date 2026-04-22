const jwt = require("jsonwebtoken");
const User = require("../models/User");

const SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

function parseToken(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  return token || null;
}

async function hydrateStaffUser(payload) {
  if (!payload?.uid || payload?.role === "customer") {
    return { ...payload };
  }

  const user = await User.findById(payload.uid).select("email role displayName isActive");
  if (!user || user.isActive === false) return null;

  return {
    ...payload,
    uid: user._id.toString(),
    email: user.email,
    role: user.role || payload.role || "admin",
    displayName: user.displayName || ""
  };
}

async function authOptional(req, _res, next) {
  const token = parseToken(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, SECRET);
    const hydrated = await hydrateStaffUser(payload);
    if (hydrated) req.user = hydrated;
  } catch {
    // ignore invalid token in optional mode
  }
  return next();
}

async function authRequired(req, res, next) {
  const token = parseToken(req);
  if (!token) return res.status(401).json({ message: "Missing token" });

  try {
    const payload = jwt.verify(token, SECRET);
    const hydrated = await hydrateStaffUser(payload);
    if (!hydrated) {
      return res.status(401).json({ message: "Account not found or inactive" });
    }
    req.user = hydrated;
    return next();
  } catch (_e) {
    return res.status(401).json({ message: "Invalid/expired token" });
  }
}

function hasAnyRole(user, roles = []) {
  return Boolean(user && roles.includes(String(user.role || "").trim()));
}

function rolesAllowed(...roles) {
  return (req, res, next) => {
    if (!hasAnyRole(req.user, roles)) {
      return res.status(403).json({ message: "Access denied" });
    }
    return next();
  };
}

const adminOnly = rolesAllowed("admin");
const adminOrStaffManagerOnly = rolesAllowed("admin", "staff_manager");
const customerOnly = rolesAllowed("customer");

module.exports = {
  authOptional,
  authRequired,
  adminOnly,
  adminOrStaffManagerOnly,
  customerOnly,
  hasAnyRole,
  rolesAllowed
};
