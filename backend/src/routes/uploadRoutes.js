const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { authRequired, adminOnly, customerOnly } = require("../middleware/auth");

const router = express.Router();

const bookingPhotoDir = path.join(__dirname, "..", "..", "uploads", "booking-photos");
const paymentSlipDir = path.join(__dirname, "..", "..", "uploads", "payment-slips");
const cryptoQrDir = path.join(__dirname, "..", "..", "uploads", "crypto-qr");
fs.mkdirSync(bookingPhotoDir, { recursive: true });
fs.mkdirSync(paymentSlipDir, { recursive: true });
fs.mkdirSync(cryptoQrDir, { recursive: true });

function safeName(name) {
  return String(name || "file")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "file";
}

function buildStorage(uploadDir, fallbackExt) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "") || fallbackExt;
      const base = path.basename(file.originalname || "file", ext);
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName(base)}${ext.toLowerCase()}`);
    }
  });
}

const bookingPhotoUpload = multer({
  storage: buildStorage(bookingPhotoDir, ".jpg"),
  limits: {
    files: 4,
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    if (String(file.mimetype || "").startsWith("image/")) return cb(null, true);
    return cb(new Error("Only image files are allowed"));
  }
});

const paymentSlipUpload = multer({
  storage: buildStorage(paymentSlipDir, ".jpg"),
  limits: {
    files: 1,
    fileSize: 8 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || "").toLowerCase();
    if (mime.startsWith("image/") || mime === "application/pdf") return cb(null, true);
    return cb(new Error("Only image or PDF files are allowed"));
  }
});

const cryptoQrUpload = multer({
  storage: buildStorage(cryptoQrDir, ".png"),
  limits: {
    files: 1,
    fileSize: 4 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || "").toLowerCase();
    if (mime.startsWith("image/")) return cb(null, true);
    return cb(new Error("Only image files are allowed for the crypto QR code."));
  }
});

router.post("/booking-photos", authRequired, customerOnly, (req, res) => {
  bookingPhotoUpload.array("photos", 4)(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || "Upload failed" });

    const files = (req.files || []).map((file) => ({
      url: `/uploads/booking-photos/${file.filename}`,
      filename: file.filename,
      originalName: file.originalname,
      size: file.size
    }));

    return res.json({ files });
  });
});

router.post("/payment-slip", authRequired, customerOnly, (req, res) => {
  paymentSlipUpload.single("slip")(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || "Upload failed" });
    if (!req.file) return res.status(400).json({ message: "Please choose a slip file to upload." });

    const file = req.file;
    return res.json({
      file: {
        url: `/uploads/payment-slips/${file.filename}`,
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        uploadedAt: new Date().toISOString()
      }
    });
  });
});

router.post("/crypto-qr", authRequired, adminOnly, (req, res) => {
  cryptoQrUpload.single("qr")(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || "Upload failed" });
    if (!req.file) return res.status(400).json({ message: "Please choose a QR image to upload." });

    const file = req.file;
    return res.json({
      file: {
        url: `/uploads/crypto-qr/${file.filename}`,
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        uploadedAt: new Date().toISOString()
      }
    });
  });
});

module.exports = router;
