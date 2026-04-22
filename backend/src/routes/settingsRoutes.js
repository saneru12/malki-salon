const express = require("express");
const Settings = require("../models/Settings");
const { authRequired, adminOnly } = require("../middleware/auth");

const router = express.Router();

async function getOrCreateSettings() {
  let s = await Settings.findOne({ key: "default" });
  if (!s) s = await Settings.create({ key: "default" });
  return s;
}

// Public: get settings
router.get("/", async (req, res, next) => {
  try {
    const s = await getOrCreateSettings();
    res.json(s);
  } catch (e) {
    next(e);
  }
});

// Admin: update settings
router.put("/", authRequired, adminOnly, async (req, res, next) => {
  try {
    const updated = await Settings.findOneAndUpdate(
      { key: "default" },
      { $set: req.body || {} },
      { new: true, upsert: true }
    );
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
