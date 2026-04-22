const mongoose = require("mongoose");

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

function generateOrderNumber() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `MSO-${stamp}-${random}`;
}

function generateOrderLineId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `OLI-${stamp}-${random}`;
}

function safeInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeOrderTotals(items) {
  let originalTotalLKR = 0;
  let cancelledTotalLKR = 0;
  let remainingQtyTotal = 0;
  let remainingLineCount = 0;

  for (const rawItem of Array.isArray(items) ? items : []) {
    const price = Math.max(0, Number(rawItem?.priceLKR || 0));
    const qty = Math.max(0, safeInt(rawItem?.qty, 0));
    const cancelledQty = clamp(safeInt(rawItem?.cancelledQty, 0), 0, qty);
    const remainingQty = Math.max(0, qty - cancelledQty);

    originalTotalLKR += price * qty;
    cancelledTotalLKR += price * cancelledQty;
    remainingQtyTotal += remainingQty;
    if (remainingQty > 0) remainingLineCount += 1;
  }

  return {
    originalTotalLKR,
    cancelledTotalLKR,
    totalLKR: Math.max(0, originalTotalLKR - cancelledTotalLKR),
    remainingQtyTotal,
    remainingLineCount
  };
}

const orderItemSchema = new mongoose.Schema(
  {
    lineId: {
      type: String,
      default: generateOrderLineId,
      trim: true,
      maxlength: 80
    },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true },
    priceLKR: { type: Number, required: true, min: 0 },
    imageUrl: { type: String, default: "" },
    qty: { type: Number, required: true, min: 1 },
    cancelledQty: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    title: { type: String, default: "" },
    note: { type: String, default: "" },
    visibleToCustomer: { type: Boolean, default: true },
    at: { type: Date, default: Date.now },
    by: { type: String, default: "system" } // customer | admin | system
  },
  { _id: false }
);

const deliveryFeedbackSchema = new mongoose.Schema(
  {
    sender: {
      type: String,
      enum: ["customer", "admin", "system"],
      required: true
    },
    type: {
      type: String,
      enum: ["info", "received", "not_received", "reply", "message"],
      default: "message"
    },
    message: { type: String, default: "", trim: true, maxlength: 2000 },
    at: { type: Date, default: Date.now }
  },
  { _id: false }
);

const orderReviewSchema = new mongoose.Schema(
  {
    rating: { type: Number, default: null, min: 1, max: 5 },
    title: { type: String, default: "", trim: true, maxlength: 120 },
    comment: { type: String, default: "", trim: true, maxlength: 2000 },
    wouldRecommend: { type: Boolean, default: null },
    productQualityRating: { type: Number, default: null, min: 1, max: 5 },
    deliveryServiceRating: { type: Number, default: null, min: 1, max: 5 },
    salonSupportRating: { type: Number, default: null, min: 1, max: 5 },
    verifiedPurchase: { type: Boolean, default: true },
    isPublished: { type: Boolean, default: false },
    submittedAt: { type: Date, default: null },
    updatedAt: { type: Date, default: null }
  },
  { _id: false }
);

const itemCancellationHistorySchema = new mongoose.Schema(
  {
    lineId: { type: String, default: "", trim: true, maxlength: 80 },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    name: { type: String, default: "", trim: true, maxlength: 160 },
    qty: { type: Number, required: true, min: 1 },
    priceLKR: { type: Number, default: 0, min: 0 },
    amountLKR: { type: Number, default: 0, min: 0 },
    note: { type: String, default: "", trim: true, maxlength: 1500 },
    by: { type: String, enum: ["customer", "admin", "system"], default: "customer" },
    at: { type: Date, default: Date.now }
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      default: generateOrderNumber,
      unique: true,
      sparse: true,
      index: true,
      trim: true
    },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
    customerSnapshot: {
      name: { type: String, default: "" },
      email: { type: String, default: "" },
      phone: { type: String, default: "" }
    },
    items: { type: [orderItemSchema], default: [] },
    originalTotalLKR: { type: Number, default: 0, min: 0 },
    cancelledTotalLKR: { type: Number, default: 0, min: 0 },
    totalLKR: { type: Number, required: true, min: 0 },
    deliveryAddress: { type: String, default: "", trim: true },
    customerNote: { type: String, default: "", trim: true },
    adminNote: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: ORDER_STATUSES,
      default: "pending",
      index: true
    },
    statusHistory: { type: [statusHistorySchema], default: [] },
    itemCancellationHistory: { type: [itemCancellationHistorySchema], default: [] },
    delivery: {
      courierService: { type: String, default: "", trim: true },
      trackingNumber: { type: String, default: "", trim: true },
      trackingUrl: { type: String, default: "", trim: true },
      expectedDeliveryDate: { type: Date, default: null },
      shippedAt: { type: Date, default: null },
      outForDeliveryAt: { type: Date, default: null },
      deliveredAt: { type: Date, default: null },
      customerConfirmationStatus: {
        type: String,
        enum: ["pending", "received", "not_received"],
        default: "pending"
      },
      customerConfirmationMessage: { type: String, default: "", trim: true },
      customerConfirmationAt: { type: Date, default: null },
      issueStatus: {
        type: String,
        enum: ["none", "open", "replied", "resolved"],
        default: "none"
      },
      feedbackThread: { type: [deliveryFeedbackSchema], default: [] }
    },
    review: {
      type: orderReviewSchema,
      default: () => ({
        verifiedPurchase: true,
        isPublished: false,
        rating: null,
        title: "",
        comment: "",
        wouldRecommend: null,
        productQualityRating: null,
        deliveryServiceRating: null,
        salonSupportRating: null,
        submittedAt: null,
        updatedAt: null
      })
    }
  },
  { timestamps: true }
);

orderSchema.pre("validate", function orderPreValidate(next) {
  if (!Array.isArray(this.items)) this.items = [];
  if (!Array.isArray(this.itemCancellationHistory)) this.itemCancellationHistory = [];

  for (const item of this.items) {
    if (!item.lineId) item.lineId = generateOrderLineId();
    item.qty = Math.max(1, safeInt(item.qty, 1));
    item.cancelledQty = clamp(safeInt(item.cancelledQty, 0), 0, item.qty);
  }

  const totals = computeOrderTotals(this.items);
  this.originalTotalLKR = totals.originalTotalLKR;
  this.cancelledTotalLKR = totals.cancelledTotalLKR;
  this.totalLKR = totals.totalLKR;
  next();
});

orderSchema.index({ customerId: 1, createdAt: -1 });
orderSchema.index({ orderNumber: 1, customerId: 1 });
orderSchema.index({ "delivery.trackingNumber": 1 });
orderSchema.index({ "review.isPublished": 1, "review.rating": -1, "review.submittedAt": -1 });

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;
module.exports.ORDER_STATUSES = ORDER_STATUSES;
module.exports.generateOrderLineId = generateOrderLineId;
module.exports.computeOrderTotals = computeOrderTotals;
