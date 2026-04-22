const express = require("express");
const Product = require("../models/Product");
const { authRequired, adminOnly } = require("../middleware/auth");

const router = express.Router();

// GET all active products (public)
router.get("/", async (req, res, next) => {
  try {
    const list = await Product.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 });
    return res.json(list);
  } catch (e) {
    return next(e);
  }
});

// Admin: list all products (including inactive)
router.get("/admin/all", authRequired, adminOnly, async (req, res, next) => {
  try {
    const list = await Product.find({}).sort({ sortOrder: 1, createdAt: -1 });
    return res.json(list);
  } catch (e) {
    return next(e);
  }
});

// GET product by id (public)
router.get("/:id", async (req, res, next) => {
  try {
    const p = await Product.findById(req.params.id);
    if (!p) return res.status(404).json({ message: "Not found" });
    return res.json(p);
  } catch (e) {
    return next(e);
  }
});

// POST create product (admin)
// Body: { name, category?, description?, priceLKR, imageUrl?, stockQty?, sortOrder?, isActive? }
router.post("/", authRequired, adminOnly, async (req, res, next) => {
  try {
    const { name, category, description, priceLKR, imageUrl, stockQty, sortOrder, isActive } = req.body || {};

    if (!name || priceLKR === undefined) {
      return res.status(400).json({ message: "name and priceLKR are required" });
    }

    const created = await Product.create({
      name: String(name).trim(),
      category: category ? String(category).trim() : "General",
      description: description ? String(description).trim() : "",
      priceLKR: Number(priceLKR),
      imageUrl: imageUrl ? String(imageUrl).trim() : "",
      stockQty: stockQty !== undefined && String(stockQty) !== "" ? Math.max(0, Number(stockQty)) : null,
      sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
      isActive: isActive !== undefined ? Boolean(isActive) : true
    });

    return res.status(201).json(created);
  } catch (e) {
    return next(e);
  }
});

// PUT update product (admin)
router.put("/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const patch = { ...req.body };
    if (patch.name !== undefined) patch.name = String(patch.name).trim();
    if (patch.category !== undefined) patch.category = String(patch.category).trim();
    if (patch.description !== undefined) patch.description = String(patch.description).trim();
    if (patch.priceLKR !== undefined) patch.priceLKR = Number(patch.priceLKR);
    if (patch.imageUrl !== undefined) patch.imageUrl = String(patch.imageUrl).trim();
    if (patch.stockQty !== undefined) {
      patch.stockQty = String(patch.stockQty) === "" || patch.stockQty === null ? null : Math.max(0, Number(patch.stockQty));
    }
    if (patch.sortOrder !== undefined) patch.sortOrder = Number(patch.sortOrder);
    if (patch.isActive !== undefined) patch.isActive = Boolean(patch.isActive);

    const updated = await Product.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!updated) return res.status(404).json({ message: "Not found" });
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

// DELETE product (admin)
router.delete("/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const deleted = await Product.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Not found" });
    return res.json({ ok: true });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
