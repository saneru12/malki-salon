const express = require("express");
const Service = require("../models/Service");
const { authRequired, adminOnly, adminOrStaffManagerOnly } = require("../middleware/auth");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const services = await Service.find({ isActive: true }).sort({ category: 1, name: 1 });
    res.json(services);
  } catch (e) {
    next(e);
  }
});

router.get("/admin/all", authRequired, adminOrStaffManagerOnly, async (req, res, next) => {
  try {
    const services = await Service.find({}).sort({ category: 1, name: 1 });
    res.json(services);
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const s = await Service.findById(req.params.id);
    if (!s) return res.status(404).json({ message: "Not found" });
    res.json(s);
  } catch (e) {
    next(e);
  }
});

router.post("/", authRequired, adminOnly, async (req, res, next) => {
  try {
    const {
      category,
      name,
      priceLKR,
      durationMin,
      imageUrl,
      bookingMode,
      allowAnyTimeBooking,
      requiresPhotoUpload,
      isActive
    } = req.body;

    if (!category || !name || priceLKR === undefined) {
      return res.status(400).json({ message: "category, name, priceLKR are required" });
    }

    const created = await Service.create({
      category,
      name,
      priceLKR: Number(priceLKR),
      durationMin: durationMin !== undefined ? Number(durationMin) : undefined,
      imageUrl: imageUrl || "",
      bookingMode: bookingMode === "manual-review" ? "manual-review" : "instant",
      allowAnyTimeBooking: Boolean(allowAnyTimeBooking),
      requiresPhotoUpload: Boolean(requiresPhotoUpload),
      isActive: isActive !== undefined ? Boolean(isActive) : undefined
    });

    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const patch = { ...req.body };
    if (patch.priceLKR !== undefined) patch.priceLKR = Number(patch.priceLKR);
    if (patch.durationMin !== undefined) patch.durationMin = Number(patch.durationMin);
    if (patch.allowAnyTimeBooking !== undefined) patch.allowAnyTimeBooking = Boolean(patch.allowAnyTimeBooking);
    if (patch.requiresPhotoUpload !== undefined) patch.requiresPhotoUpload = Boolean(patch.requiresPhotoUpload);
    if (patch.isActive !== undefined) patch.isActive = Boolean(patch.isActive);
    if (patch.bookingMode !== undefined) patch.bookingMode = patch.bookingMode === "manual-review" ? "manual-review" : "instant";

    const updated = await Service.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const deleted = await Service.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
