const express = require("express");
const mongoose = require("mongoose");
const OrderModel = require("../models/Order");
const Product = require("../models/Product");
const Customer = require("../models/Customer");
const ContactMessage = require("../models/ContactMessage");
const { authRequired, adminOnly, customerOnly } = require("../middleware/auth");

const router = express.Router();
const Order = OrderModel;
const { computeOrderTotals } = OrderModel;

const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "shipped",
  "out_for_delivery",
  "delivered",
  "completed",
  "delivery_issue",
  "cancelled"
];
const ISSUE_STATUSES = ["none", "open", "replied", "resolved"];
const CUSTOMER_CAN_CANCEL = ["pending"];
const ADMIN_CAN_CANCEL = ["pending", "confirmed"];
const CUSTOMER_CAN_CONFIRM_DELIVERY = ["shipped", "out_for_delivery", "delivered", "delivery_issue"];

const STATUS_TITLES = {
  pending: "Order placed",
  confirmed: "Order approved",
  shipped: "Handed to courier",
  out_for_delivery: "Out for delivery",
  delivered: "Marked delivered",
  completed: "Customer confirmed received",
  delivery_issue: "Delivery issue reported",
  cancelled: "Order cancelled"
};

function safeInt(n, def = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return def;
  return Math.floor(v);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  const map = new Map();
  for (const it of items) {
    const pid = String(it?.productId || it?.id || "").trim();
    if (!pid) continue;
    const qty = safeInt(it?.qty, 0);
    if (qty <= 0) continue;
    map.set(pid, (map.get(pid) || 0) + qty);
  }
  return Array.from(map.entries()).map(([productId, qty]) => ({ productId, qty }));
}

function normalizeCancellationSelections(items) {
  if (!Array.isArray(items)) return [];
  const map = new Map();
  for (const it of items) {
    const lineId = normalizeText(it?.lineId, 80);
    const qty = safeInt(it?.qty, 0);
    if (!lineId || qty <= 0) continue;
    map.set(lineId, (map.get(lineId) || 0) + qty);
  }
  return Array.from(map.entries()).map(([lineId, qty]) => ({ lineId, qty }));
}

function normalizeText(value, max = 2000) {
  return String(value || "").trim().slice(0, max);
}

function toDateOrNull(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function orderRef(order) {
  return order?.orderNumber || `ORD-${String(order?._id || "").slice(-6).toUpperCase()}`;
}

function pushStatusHistory(order, status, { by = "system", note = "", title, visibleToCustomer = true } = {}) {
  if (!order.statusHistory) order.statusHistory = [];
  order.statusHistory.push({
    status,
    title: title || STATUS_TITLES[status] || status,
    note: normalizeText(note, 4000),
    visibleToCustomer,
    by,
    at: new Date()
  });
}

function buildLegacyLineId(item, index) {
  const raw = String(item?.productId || `item-${index + 1}`)
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-12)
    .toUpperCase();
  return `OLI-LEGACY-${raw || "ITEM"}-${index + 1}`;
}

function getItemRemainingQty(item) {
  const qty = Math.max(0, safeInt(item?.qty, 0));
  const cancelledQty = clamp(safeInt(item?.cancelledQty, 0), 0, qty);
  return Math.max(0, qty - cancelledQty);
}

function ensureOrderShape(order) {
  let changed = false;

  if (!Array.isArray(order.items)) {
    order.items = [];
    changed = true;
  }

  order.items.forEach((item, index) => {
    const lineId = normalizeText(item?.lineId, 80) || buildLegacyLineId(item, index);
    if (String(item.lineId || "") !== lineId) {
      item.lineId = lineId;
      changed = true;
    }

    const qty = Math.max(1, safeInt(item?.qty, 1));
    if (safeInt(item?.qty, 1) !== qty) {
      item.qty = qty;
      changed = true;
    }

    const cancelledQty = clamp(safeInt(item?.cancelledQty, 0), 0, qty);
    if (safeInt(item?.cancelledQty, 0) !== cancelledQty) {
      item.cancelledQty = cancelledQty;
      changed = true;
    }
  });

  if (!Array.isArray(order.itemCancellationHistory)) {
    order.itemCancellationHistory = [];
    changed = true;
  }

  const totals = computeOrderTotals(order.items);
  if (Number(order.originalTotalLKR || 0) !== totals.originalTotalLKR) {
    order.originalTotalLKR = totals.originalTotalLKR;
    changed = true;
  }
  if (Number(order.cancelledTotalLKR || 0) !== totals.cancelledTotalLKR) {
    order.cancelledTotalLKR = totals.cancelledTotalLKR;
    changed = true;
  }
  if (Number(order.totalLKR || 0) !== totals.totalLKR) {
    order.totalLKR = totals.totalLKR;
    changed = true;
  }

  return { changed, totals };
}

function getRemainingSelections(order) {
  return (Array.isArray(order?.items) ? order.items : [])
    .map((item) => ({ lineId: String(item?.lineId || "").trim(), qty: getItemRemainingQty(item) }))
    .filter((entry) => entry.lineId && entry.qty > 0);
}

function describeSelections(entries) {
  return entries
    .map((entry) => `${normalizeText(entry?.item?.name || entry?.name || "Item", 120)} x${safeInt(entry?.qty, 0)}`)
    .join(", ");
}

function buildCancellationAuditNote(summary, note) {
  const safeSummary = normalizeText(summary, 2000);
  const safeNote = normalizeText(note, 1500);
  if (!safeSummary && !safeNote) return "";
  if (safeSummary && !safeNote) return safeSummary;
  if (!safeSummary && safeNote) return `Note: ${safeNote}`;
  return `${safeSummary}\nNote: ${safeNote}`;
}

async function applySelectedItemCancellation(order, selections, { by = "customer", note = "" } = {}) {
  ensureOrderShape(order);

  const normalizedSelections = normalizeCancellationSelections(selections);
  if (!normalizedSelections.length) {
    throw new Error("Please choose at least one item to cancel.");
  }

  const itemsByLineId = new Map((order.items || []).map((item) => [String(item.lineId || "").trim(), item]));
  const validated = [];

  for (const selection of normalizedSelections) {
    const item = itemsByLineId.get(selection.lineId);
    if (!item) throw new Error("One of the selected items could not be found in this order.");

    const remainingQty = getItemRemainingQty(item);
    if (remainingQty <= 0) {
      throw new Error(`${item.name || "This item"} has already been fully cancelled.`);
    }
    if (selection.qty > remainingQty) {
      throw new Error(`You can cancel only ${remainingQty} remaining item(s) from ${item.name || "this product"}.`);
    }

    validated.push({
      lineId: selection.lineId,
      qty: selection.qty,
      item,
      amountLKR: Math.max(0, Number(item.priceLKR || 0)) * selection.qty
    });
  }

  const eventTime = new Date();

  for (const entry of validated) {
    entry.item.cancelledQty = clamp(safeInt(entry.item.cancelledQty, 0) + entry.qty, 0, safeInt(entry.item.qty, 0));

    await Product.updateOne(
      { _id: entry.item.productId, stockQty: { $type: "number" } },
      { $inc: { stockQty: entry.qty } }
    );

    order.itemCancellationHistory.push({
      lineId: entry.item.lineId,
      productId: entry.item.productId,
      name: entry.item.name || "",
      qty: entry.qty,
      priceLKR: Math.max(0, Number(entry.item.priceLKR || 0)),
      amountLKR: entry.amountLKR,
      note: normalizeText(note, 1500),
      by,
      at: eventTime
    });
  }

  const totals = computeOrderTotals(order.items);
  order.originalTotalLKR = totals.originalTotalLKR;
  order.cancelledTotalLKR = totals.cancelledTotalLKR;
  order.totalLKR = totals.totalLKR;

  const summary = describeSelections(validated);
  const historyNote = buildCancellationAuditNote(summary, note);

  if (totals.remainingQtyTotal <= 0) {
    order.status = "cancelled";
    pushStatusHistory(order, "cancelled", {
      by,
      title: by === "customer" ? "Order cancelled by customer" : "Order cancelled",
      note: historyNote
    });
    return { fullCancellation: true, summary, totals, selections: validated };
  }

  pushStatusHistory(order, order.status || "pending", {
    by,
    title: by === "customer" ? "Customer cancelled selected items" : "Selected items cancelled",
    note: historyNote
  });

  return { fullCancellation: false, summary, totals, selections: validated };
}

async function cancelAllRemainingItems(order, options = {}) {
  ensureOrderShape(order);
  const selections = getRemainingSelections(order);
  if (!selections.length) {
    throw new Error("This order has no remaining items to cancel.");
  }
  return applySelectedItemCancellation(order, selections, options);
}

async function createOrderMessage(order, sender, message, adminEmail = "") {
  const finalMessage = normalizeText(message, 4000);
  if (!finalMessage || !order?.customerId) return;
  await ContactMessage.create({
    customer: order.customerId,
    sender,
    message: `[Order ${orderRef(order)}] ${finalMessage}`,
    readByAdmin: sender === "admin",
    readByCustomer: sender !== "admin",
    customerSnapshot: {
      name: order.customerSnapshot?.name || "",
      email: order.customerSnapshot?.email || "",
      phone: order.customerSnapshot?.phone || ""
    },
    adminSnapshot: sender === "admin" ? { email: adminEmail || "" } : { email: "" }
  }).catch(() => {});
}

async function applyStatusChange(order, nextStatus, { by = "admin", note = "" } = {}) {
  ensureOrderShape(order);

  if (!ORDER_STATUSES.includes(nextStatus)) {
    throw new Error("Invalid status");
  }

  const currentStatus = String(order.status || "pending");
  if (currentStatus === nextStatus) return false;

  if (currentStatus === "cancelled") {
    throw new Error("Cancelled orders cannot be changed.");
  }
  if (currentStatus === "completed" && nextStatus !== "completed") {
    throw new Error("Completed orders cannot be changed.");
  }
  if (nextStatus === "cancelled" && !ADMIN_CAN_CANCEL.includes(currentStatus) && by === "admin") {
    throw new Error("Orders can be cancelled only before they are handed to the courier.");
  }

  const now = new Date();
  const delivery = order.delivery || (order.delivery = {});

  if (["shipped", "out_for_delivery", "delivered", "completed"].includes(nextStatus)) {
    if (!normalizeText(delivery.courierService, 120)) {
      throw new Error("Courier service is required before marking the order as handed to courier.");
    }
    if (!normalizeText(delivery.trackingNumber, 120)) {
      throw new Error("Tracking number is required before marking the order as handed to courier.");
    }
  }

  if (nextStatus === "cancelled") {
    await cancelAllRemainingItems(order, { by, note });
    return true;
  }

  if (nextStatus === "shipped") {
    if (!delivery.shippedAt) delivery.shippedAt = now;
  }

  if (nextStatus === "out_for_delivery") {
    if (!delivery.shippedAt) delivery.shippedAt = now;
    if (!delivery.outForDeliveryAt) delivery.outForDeliveryAt = now;
  }

  if (nextStatus === "delivered") {
    if (!delivery.shippedAt) delivery.shippedAt = now;
    if (!delivery.deliveredAt) delivery.deliveredAt = now;
  }

  if (nextStatus === "completed") {
    if (!delivery.shippedAt) delivery.shippedAt = now;
    if (!delivery.deliveredAt) delivery.deliveredAt = now;
    delivery.issueStatus = "resolved";
    if (delivery.customerConfirmationStatus === "pending") {
      delivery.customerConfirmationStatus = by === "customer" ? "received" : delivery.customerConfirmationStatus;
    }
  }

  if (nextStatus === "delivery_issue") {
    delivery.issueStatus = "open";
  }

  order.status = nextStatus;
  pushStatusHistory(order, nextStatus, { by, note });
  return true;
}

function buildStatusNotification(order, status) {
  const d = order.delivery || {};
  const eta = d.expectedDeliveryDate ? ` Expected delivery: ${new Date(d.expectedDeliveryDate).toLocaleDateString("en-CA")}.` : "";
  const trackingLine = d.trackingNumber
    ? ` Tracking number: ${d.trackingNumber}.${d.trackingUrl ? ` Track here: ${d.trackingUrl}` : ""}`
    : "";

  if (status === "confirmed") {
    return "Your order has been approved by the salon and is now being prepared for courier pickup.";
  }
  if (status === "shipped") {
    return `Your order has been handed to ${d.courierService || "the courier"}.${trackingLine}${eta}`.trim();
  }
  if (status === "out_for_delivery") {
    return `Your parcel is out for delivery with ${d.courierService || "the courier"}.${trackingLine}`.trim();
  }
  if (status === "delivered") {
    return "The courier marked your parcel as delivered. Please open My Account and confirm whether you received it or not.";
  }
  if (status === "cancelled") {
    return "Your order has been cancelled. If you need help, please contact the salon.";
  }
  if (status === "completed") {
    return "Your order has been marked completed. Thank you for shopping with Malki Salon.";
  }
  return "";
}

function buildCustomerCancellationMessage(result, note = "") {
  const prefix = result?.fullCancellation
    ? "I cancelled all remaining items in this order"
    : "I cancelled some items from this order";
  const summary = normalizeText(result?.summary, 1500);
  const safeNote = normalizeText(note, 1000);
  if (summary && safeNote) return `${prefix}: ${summary}. Note: ${safeNote}`;
  if (summary) return `${prefix}: ${summary}.`;
  if (safeNote) return `${prefix}. Note: ${safeNote}`;
  return `${prefix}.`;
}

// CUSTOMER: create order
router.post("/", authRequired, customerOnly, async (req, res, next) => {
  try {
    const rawItems = normalizeItems(req.body?.items);
    const deliveryAddress = normalizeText(req.body?.deliveryAddress, 1000);
    const customerNote = normalizeText(req.body?.customerNote, 1500);

    if (!rawItems.length) {
      return res.status(400).json({ message: "Cart is empty" });
    }
    if (!deliveryAddress) {
      return res.status(400).json({ message: "Delivery address is required" });
    }

    const c = await Customer.findById(req.user.cid).select("name email phone isActive");
    if (!c || !c.isActive) return res.status(401).json({ message: "Customer account not active" });

    const ids = rawItems.map((x) => x.productId).filter((x) => mongoose.isValidObjectId(x));
    if (ids.length !== rawItems.length) {
      return res.status(400).json({ message: "Invalid product id in cart" });
    }

    const products = await Product.find({ _id: { $in: ids } });
    const byId = new Map(products.map((p) => [p._id.toString(), p]));

    const items = [];
    let total = 0;

    for (const it of rawItems) {
      const p = byId.get(String(it.productId));
      if (!p) return res.status(404).json({ message: "Product not found" });
      if (!p.isActive) return res.status(409).json({ message: `Product not available: ${p.name}` });
      const qty = Math.min(999, Math.max(1, safeInt(it.qty, 1)));
      if (p.stockQty !== undefined && p.stockQty !== null) {
        if (Number(p.stockQty) <= 0) return res.status(409).json({ message: `Out of stock: ${p.name}` });
        if (qty > Number(p.stockQty)) {
          return res.status(409).json({ message: `Not enough stock for ${p.name}. Available: ${p.stockQty}` });
        }
      }
      const price = Number(p.priceLKR) || 0;
      total += price * qty;
      items.push({
        productId: p._id,
        name: p.name,
        priceLKR: price,
        imageUrl: p.imageUrl || "",
        qty,
        cancelledQty: 0
      });
    }

    const order = await Order.create({
      customerId: c._id,
      customerSnapshot: { name: c.name, email: c.email, phone: c.phone },
      items,
      originalTotalLKR: total,
      cancelledTotalLKR: 0,
      totalLKR: total,
      deliveryAddress,
      customerNote,
      status: "pending",
      statusHistory: [{ status: "pending", title: STATUS_TITLES.pending, by: "customer" }],
      delivery: {
        courierService: "",
        trackingNumber: "",
        trackingUrl: "",
        expectedDeliveryDate: null,
        shippedAt: null,
        outForDeliveryAt: null,
        deliveredAt: null,
        customerConfirmationStatus: "pending",
        customerConfirmationMessage: "",
        customerConfirmationAt: null,
        issueStatus: "none",
        feedbackThread: []
      }
    });

    for (const it of items) {
      await Product.updateOne({ _id: it.productId, stockQty: { $type: "number" } }, { $inc: { stockQty: -it.qty } });
    }

    ensureOrderShape(order);
    return res.status(201).json({ ok: true, order });
  } catch (e) {
    return next(e);
  }
});

// CUSTOMER: list my orders
router.get("/me", authRequired, customerOnly, async (req, res, next) => {
  try {
    const list = await Order.find({ customerId: req.user.cid }).sort({ createdAt: -1 });
    list.forEach((item) => ensureOrderShape(item));
    return res.json(list);
  } catch (e) {
    return next(e);
  }
});

// CUSTOMER: get my order details
router.get("/me/:id", authRequired, customerOnly, async (req, res, next) => {
  try {
    const o = await Order.findOne({ _id: req.params.id, customerId: req.user.cid });
    if (!o) return res.status(404).json({ message: "Not found" });
    ensureOrderShape(o);
    return res.json(o);
  } catch (e) {
    return next(e);
  }
});

// CUSTOMER: cancel selected items from my order
router.put("/me/:id/cancel-items", authRequired, customerOnly, async (req, res, next) => {
  try {
    const o = await Order.findOne({ _id: req.params.id, customerId: req.user.cid });
    if (!o) return res.status(404).json({ message: "Not found" });
    ensureOrderShape(o);

    if (!CUSTOMER_CAN_CANCEL.includes(o.status)) {
      return res.status(409).json({ message: "Selected items can be cancelled only before the salon approves the order." });
    }

    const note = normalizeText(req.body?.note, 1500);
    const result = await applySelectedItemCancellation(o, req.body?.items, { by: "customer", note });
    await o.save();

    await createOrderMessage(o, "customer", buildCustomerCancellationMessage(result, note));

    ensureOrderShape(o);
    return res.json({ ok: true, order: o, cancellation: result });
  } catch (e) {
    return next(e);
  }
});

// CUSTOMER: cancel my full remaining order
router.put("/me/:id/cancel", authRequired, customerOnly, async (req, res, next) => {
  try {
    const o = await Order.findOne({ _id: req.params.id, customerId: req.user.cid });
    if (!o) return res.status(404).json({ message: "Not found" });
    ensureOrderShape(o);

    if (!CUSTOMER_CAN_CANCEL.includes(o.status)) {
      return res.status(409).json({ message: "This order can be cancelled only before the salon approves it." });
    }

    const result = await cancelAllRemainingItems(o, { by: "customer", note: "Customer cancelled before salon approval." });
    await o.save();

    await createOrderMessage(o, "customer", buildCustomerCancellationMessage(result, "Customer cancelled before salon approval."));

    ensureOrderShape(o);
    return res.json({ ok: true, order: o });
  } catch (e) {
    return next(e);
  }
});

// CUSTOMER: confirm received / report not received
router.put("/me/:id/delivery-feedback", authRequired, customerOnly, async (req, res, next) => {
  try {
    const o = await Order.findOne({ _id: req.params.id, customerId: req.user.cid });
    if (!o) return res.status(404).json({ message: "Not found" });
    ensureOrderShape(o);

    const action = normalizeText(req.body?.action, 40);
    const message = normalizeText(req.body?.message, 1500);

    if (!["received", "not_received"].includes(action)) {
      return res.status(400).json({ message: "Invalid delivery feedback action" });
    }

    if (!CUSTOMER_CAN_CONFIRM_DELIVERY.includes(o.status)) {
      return res.status(409).json({ message: "You can confirm delivery only after the order has been dispatched." });
    }

    if (!o.delivery) o.delivery = {};
    if (!Array.isArray(o.delivery.feedbackThread)) o.delivery.feedbackThread = [];

    const now = new Date();

    if (action === "received") {
      o.delivery.customerConfirmationStatus = "received";
      o.delivery.customerConfirmationMessage = message;
      o.delivery.customerConfirmationAt = now;
      o.delivery.issueStatus = "resolved";
      o.delivery.feedbackThread.push({
        sender: "customer",
        type: "received",
        message: message || "Item received successfully.",
        at: now
      });
      if (!o.delivery.deliveredAt) o.delivery.deliveredAt = now;
      if (o.status !== "completed") {
        o.status = "completed";
        pushStatusHistory(o, "completed", {
          by: "customer",
          note: message || "Customer confirmed that the parcel was received."
        });
      }
      await o.save();
      await createOrderMessage(o, "customer", message || "I received the parcel successfully.");
      ensureOrderShape(o);
      return res.json({ ok: true, order: o });
    }

    o.delivery.customerConfirmationStatus = "not_received";
    o.delivery.customerConfirmationMessage = message;
    o.delivery.customerConfirmationAt = now;
    o.delivery.issueStatus = "open";
    o.delivery.feedbackThread.push({
      sender: "customer",
      type: "not_received",
      message: message || "I have not received this parcel yet.",
      at: now
    });
    if (o.status !== "delivery_issue") {
      o.status = "delivery_issue";
      pushStatusHistory(o, "delivery_issue", {
        by: "customer",
        note: message || "Customer reported that the parcel was not received."
      });
    }
    await o.save();
    await createOrderMessage(o, "customer", message || "I have not received this parcel yet. Please check with the courier.");
    ensureOrderShape(o);
    return res.json({ ok: true, order: o });
  } catch (e) {
    return next(e);
  }
});

// CUSTOMER: send follow-up on delivery issue
router.post("/me/:id/delivery-followup", authRequired, customerOnly, async (req, res, next) => {
  try {
    const o = await Order.findOne({ _id: req.params.id, customerId: req.user.cid });
    if (!o) return res.status(404).json({ message: "Not found" });
    ensureOrderShape(o);

    const message = normalizeText(req.body?.message, 1500);
    if (!message) return res.status(400).json({ message: "Message is required" });

    if (!o.delivery || !["open", "replied"].includes(String(o.delivery.issueStatus || "none"))) {
      return res.status(409).json({ message: "This order does not currently have an open delivery issue." });
    }

    if (!Array.isArray(o.delivery.feedbackThread)) o.delivery.feedbackThread = [];
    o.delivery.feedbackThread.push({ sender: "customer", type: "message", message, at: new Date() });
    o.delivery.issueStatus = "open";
    if (o.status !== "delivery_issue") {
      o.status = "delivery_issue";
      pushStatusHistory(o, "delivery_issue", { by: "customer", note: message });
    }
    await o.save();

    await createOrderMessage(o, "customer", message);
    ensureOrderShape(o);
    return res.status(201).json({ ok: true, order: o });
  } catch (e) {
    return next(e);
  }
});

// ADMIN: list all orders
// GET /api/orders/admin/all?status=pending&search=emailOrPhoneOrNameOrOrderNoOrTracking
router.get("/admin/all", authRequired, adminOnly, async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const q = {};
    if (status) q.status = String(status);
    if (search) {
      const s = String(search).trim();
      if (s) {
        const rx = new RegExp(escapeRegex(s), "i");
        q.$or = [
          { orderNumber: rx },
          { "customerSnapshot.email": rx },
          { "customerSnapshot.phone": rx },
          { "customerSnapshot.name": rx },
          { "delivery.trackingNumber": rx },
          { "delivery.courierService": rx }
        ];
      }
    }

    const list = await Order.find(q).sort({ createdAt: -1 });
    list.forEach((item) => ensureOrderShape(item));
    return res.json(list);
  } catch (e) {
    return next(e);
  }
});

// ADMIN: get order
router.get("/admin/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const o = await Order.findById(req.params.id);
    if (!o) return res.status(404).json({ message: "Not found" });
    ensureOrderShape(o);
    return res.json(o);
  } catch (e) {
    return next(e);
  }
});

// ADMIN: update order delivery/state
// Body: { status?, adminNote?, courierService?, trackingNumber?, trackingUrl?, expectedDeliveryDate?, issueStatus? }
router.put("/admin/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const { status, adminNote, courierService, trackingNumber, trackingUrl, expectedDeliveryDate, issueStatus } = req.body || {};
    const o = await Order.findById(req.params.id);
    if (!o) return res.status(404).json({ message: "Not found" });
    ensureOrderShape(o);

    if (!o.delivery) o.delivery = {};

    if (adminNote !== undefined) o.adminNote = normalizeText(adminNote, 2000);
    if (courierService !== undefined) o.delivery.courierService = normalizeText(courierService, 120);
    if (trackingNumber !== undefined) o.delivery.trackingNumber = normalizeText(trackingNumber, 120);
    if (trackingUrl !== undefined) o.delivery.trackingUrl = normalizeText(trackingUrl, 1000);

    const parsedExpectedDate = toDateOrNull(expectedDeliveryDate);
    if (expectedDeliveryDate !== undefined && parsedExpectedDate === undefined) {
      return res.status(400).json({ message: "Invalid expectedDeliveryDate" });
    }
    if (expectedDeliveryDate !== undefined) o.delivery.expectedDeliveryDate = parsedExpectedDate;

    if (issueStatus !== undefined) {
      const normalizedIssueStatus = normalizeText(issueStatus, 40);
      if (!ISSUE_STATUSES.includes(normalizedIssueStatus)) {
        return res.status(400).json({ message: "Invalid issueStatus" });
      }
      o.delivery.issueStatus = normalizedIssueStatus;
    }

    let statusChanged = false;
    if (status !== undefined && status !== null && status !== "") {
      const nextStatus = normalizeText(status, 40);
      if (!ORDER_STATUSES.includes(nextStatus)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      statusChanged = await applyStatusChange(o, nextStatus, { by: "admin" });
    }

    await o.save();

    if (statusChanged) {
      const note = buildStatusNotification(o, o.status);
      if (note) await createOrderMessage(o, "admin", note, req.user.email || "");
    }

    ensureOrderShape(o);
    return res.json(o);
  } catch (e) {
    return next(e);
  }
});

// ADMIN: reply to delivery issue / follow-up
router.post("/admin/:id/delivery-reply", authRequired, adminOnly, async (req, res, next) => {
  try {
    const o = await Order.findById(req.params.id);
    if (!o) return res.status(404).json({ message: "Not found" });
    ensureOrderShape(o);

    const message = normalizeText(req.body?.message, 1500);
    const issueStatus = normalizeText(req.body?.issueStatus, 40) || "replied";
    const nextStatus = normalizeText(req.body?.status, 40);

    if (!message) return res.status(400).json({ message: "Message is required" });
    if (!ISSUE_STATUSES.includes(issueStatus)) return res.status(400).json({ message: "Invalid issueStatus" });
    if (nextStatus && !ORDER_STATUSES.includes(nextStatus)) return res.status(400).json({ message: "Invalid status" });

    if (!o.delivery) o.delivery = {};
    if (!Array.isArray(o.delivery.feedbackThread)) o.delivery.feedbackThread = [];

    o.delivery.feedbackThread.push({ sender: "admin", type: "reply", message, at: new Date() });
    o.delivery.issueStatus = issueStatus;

    if (!o.status || o.status === "pending") {
      o.status = "delivery_issue";
    }

    let statusChanged = false;
    if (nextStatus) {
      statusChanged = await applyStatusChange(o, nextStatus, { by: "admin", note: message });
    } else if (o.status !== "delivery_issue" && issueStatus !== "resolved") {
      o.status = "delivery_issue";
      pushStatusHistory(o, "delivery_issue", { by: "admin", note: message });
      statusChanged = true;
    }

    await o.save();

    await createOrderMessage(o, "admin", message, req.user.email || "");
    if (statusChanged) {
      const note = buildStatusNotification(o, o.status);
      if (note) await createOrderMessage(o, "admin", note, req.user.email || "");
    }

    ensureOrderShape(o);
    return res.status(201).json({ ok: true, order: o });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
