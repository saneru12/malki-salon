const express = require("express");
const mongoose = require("mongoose");

const { authRequired, adminOnly, customerOnly } = require("../middleware/auth");
const ContactMessage = require("../models/ContactMessage");
const Customer = require("../models/Customer");
const Settings = require("../models/Settings");

const router = express.Router();

async function isMessagingEnabled() {
  const s = await Settings.findOne({ key: "default" }).lean();
  // default to true if missing
  return s ? s.contactMessagingEnabled !== false : true;
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id));
}

// ------------------- Customer -------------------

// POST /api/messages/me
// Body: { message }
router.post("/me", authRequired, customerOnly, async (req, res, next) => {
  try {
    const enabled = await isMessagingEnabled();
    if (!enabled) return res.status(403).json({ message: "Messaging is currently disabled" });

    const msg = String(req.body?.message || "").trim();
    if (!msg) return res.status(400).json({ message: "message is required" });

    const customer = await Customer.findById(req.user.cid).lean();
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    const created = await ContactMessage.create({
      customer: customer._id,
      sender: "customer",
      message: msg,
      readByAdmin: false,
      readByCustomer: true,
      customerSnapshot: { name: customer.name, email: customer.email, phone: customer.phone }
    });

    return res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

// GET /api/messages/me
router.get("/me", authRequired, customerOnly, async (req, res, next) => {
  try {
    const list = await ContactMessage.find({ customer: req.user.cid }).sort({ createdAt: 1 }).lean();
    return res.json(list);
  } catch (e) {
    next(e);
  }
});

// PUT /api/messages/me/read
// Marks all admin messages as read by customer
router.put("/me/read", authRequired, customerOnly, async (req, res, next) => {
  try {
    const r = await ContactMessage.updateMany(
      { customer: req.user.cid, sender: "admin", readByCustomer: false },
      { $set: { readByCustomer: true } }
    );
    return res.json({ ok: true, modified: r.modifiedCount ?? r.nModified ?? 0 });
  } catch (e) {
    next(e);
  }
});

// ------------------- Admin -------------------

// GET /api/messages/admin/threads
// Returns conversation list (1 per customer) with unread counts.
router.get("/admin/threads", authRequired, adminOnly, async (req, res, next) => {
  try {
    const agg = await ContactMessage.aggregate([
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$customer",
          lastMessage: { $first: "$message" },
          lastSender: { $first: "$sender" },
          lastAt: { $first: "$createdAt" },
          unreadFromCustomer: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$sender", "customer"] }, { $eq: ["$readByAdmin", false] }] },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $lookup: {
          from: "customers",
          localField: "_id",
          foreignField: "_id",
          as: "customer"
        }
      },
      { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          customerId: "$_id",
          customerName: "$customer.name",
          customerEmail: "$customer.email",
          customerPhone: "$customer.phone",
          lastMessage: 1,
          lastSender: 1,
          lastAt: 1,
          unreadFromCustomer: 1
        }
      },
      { $sort: { lastAt: -1 } }
    ]);

    return res.json(agg);
  } catch (e) {
    next(e);
  }
});

// GET /api/messages/admin/thread/:customerId
router.get("/admin/thread/:customerId", authRequired, adminOnly, async (req, res, next) => {
  try {
    const { customerId } = req.params;
    if (!isValidObjectId(customerId)) return res.status(400).json({ message: "Invalid customerId" });

    const customer = await Customer.findById(customerId).select("name email phone").lean();

    const list = await ContactMessage.find({ customer: customerId }).sort({ createdAt: 1 }).lean();
    return res.json({ customer, messages: list });
  } catch (e) {
    next(e);
  }
});

// POST /api/messages/admin/thread/:customerId/reply
// Body: { message }
router.post("/admin/thread/:customerId/reply", authRequired, adminOnly, async (req, res, next) => {
  try {
    const { customerId } = req.params;
    if (!isValidObjectId(customerId)) return res.status(400).json({ message: "Invalid customerId" });

    const msg = String(req.body?.message || "").trim();
    if (!msg) return res.status(400).json({ message: "message is required" });

    const customer = await Customer.findById(customerId).lean();
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    const created = await ContactMessage.create({
      customer: customer._id,
      sender: "admin",
      message: msg,
      readByAdmin: true,
      readByCustomer: false,
      customerSnapshot: { name: customer.name, email: customer.email, phone: customer.phone },
      adminSnapshot: { email: req.user.email || "" }
    });

    return res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

// PUT /api/messages/admin/thread/:customerId/read
// Marks all customer messages as read by admin
router.put("/admin/thread/:customerId/read", authRequired, adminOnly, async (req, res, next) => {
  try {
    const { customerId } = req.params;
    if (!isValidObjectId(customerId)) return res.status(400).json({ message: "Invalid customerId" });

    const r = await ContactMessage.updateMany(
      { customer: customerId, sender: "customer", readByAdmin: false },
      { $set: { readByAdmin: true } }
    );
    return res.json({ ok: true, modified: r.modifiedCount ?? r.nModified ?? 0 });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
