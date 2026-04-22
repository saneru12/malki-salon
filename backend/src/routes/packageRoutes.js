const express = require("express");
const Package = require("../models/Package");
const { authRequired, adminOnly } = require("../middleware/auth");

const router = express.Router();

// GET active packages
router.get("/", async (req, res, next) => {
  try {
    const items = await Package.find({ isActive: true }).sort({ createdAt: -1 });
    res.json(items);
  } catch (e) { next(e); }
});

// Admin: list all
router.get("/admin/all", authRequired, adminOnly, async (req, res, next) => {
  try {
    const list = await Package.find({}).sort({ name: 1 });
    res.json(list);
  } catch (e) { next(e); }
});

// Public: get by id
router.get("/:id", async (req, res, next) => {
  try {
    const p = await Package.findById(req.params.id);
    if (!p) return res.status(404).json({ message: "Not found" });
    res.json(p);
  } catch (e) { next(e); }
});

// POST create package (application/json)
// Body: { title, description?, priceLKR, imageUrl, isActive? }
router.post("/", authRequired, adminOnly, async (req, res, next) => {
  try {
    const { title, description = "", priceLKR, imageUrl, isActive } = req.body;

    if (!title || priceLKR === undefined) {
      return res.status(400).json({ message: "title and priceLKR are required" });
    }
    if (!imageUrl) {
      return res.status(400).json({ message: "imageUrl is required (direct google/unsplash link)" });
    }

    const created = await Package.create({
      title,
      description,
      priceLKR: Number(priceLKR),
      imageUrl,
      isActive: isActive !== undefined ? Boolean(isActive) : undefined
    });

    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.put("/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const patch = { ...req.body };
    if (patch.priceLKR !== undefined) patch.priceLKR = Number(patch.priceLKR);
    const updated = await Package.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete("/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const deleted = await Package.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
