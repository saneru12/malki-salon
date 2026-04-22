const express = require("express");
const GalleryItem = require("../models/GalleryItem");
const { authRequired, adminOnly } = require("../middleware/auth");

const router = express.Router();

// GET gallery items
router.get("/", async (req, res, next) => {
  try {
    const items = await GalleryItem.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (e) { next(e); }
});

// Admin: list all
router.get("/admin/all", authRequired, adminOnly, async (req, res, next) => {
  try {
    const list = await GalleryItem.find({}).sort({ createdAt: -1 });
    res.json(list);
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const item = await GalleryItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Not found" });
    res.json(item);
  } catch (e) { next(e); }
});

// POST create gallery item (application/json)
// Body: { title?, imageUrl, tags?: string[] | "tag1,tag2" }
router.post("/", authRequired, adminOnly, async (req, res, next) => {
  try {
    const { title = "", imageUrl, tags = [] } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ message: "imageUrl is required (direct google/unsplash link)" });
    }

    let tagArr = [];
    if (Array.isArray(tags)) tagArr = tags.map(String).map(t => t.trim()).filter(Boolean);
    else if (typeof tags === "string" && tags.trim()) tagArr = tags.split(",").map(t => t.trim()).filter(Boolean);

    const created = await GalleryItem.create({ title, imageUrl, tags: tagArr });

    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.put("/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const updated = await GalleryItem.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete("/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const deleted = await GalleryItem.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
