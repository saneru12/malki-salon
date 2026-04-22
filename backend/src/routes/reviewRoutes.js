const express = require("express");
const Order = require("../models/Order");
const { authRequired, customerOnly } = require("../middleware/auth");

const router = express.Router();

const REVIEW_VISIBLE_STATUSES = ["delivered", "completed", "delivery_issue"];
const REVIEW_CONFIRMATION_STATUSES = ["received", "not_received"];

function normalizeText(value, max = 2000) {
  return String(value || "").trim().slice(0, max);
}

function safeInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function normalizeRating(value, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    return required ? null : null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 5) return undefined;
  return rounded;
}

function normalizeOptionalBoolean(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  const lowered = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(lowered)) return true;
  if (["false", "0", "no", "n"].includes(lowered)) return false;
  return undefined;
}

function canShowReviewSection(order) {
  return REVIEW_VISIBLE_STATUSES.includes(String(order?.status || "").trim());
}

function canSubmitReview(order) {
  const confirmation = String(order?.delivery?.customerConfirmationStatus || "pending").trim();
  return canShowReviewSection(order) && REVIEW_CONFIRMATION_STATUSES.includes(confirmation);
}

function maskReviewerName(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return "Verified customer";

  const first = parts[0];
  const firstMasked = first.length <= 2 ? `${first[0] || ""}*` : `${first.slice(0, Math.min(first.length, 10))}`;

  if (parts.length === 1) {
    return `${firstMasked}${first.length <= 2 ? "" : ""}`;
  }

  const last = parts[parts.length - 1];
  return `${firstMasked} ${last[0].toUpperCase()}.`;
}

function summarizePurchasedItems(items) {
  const names = Array.isArray(items)
    ? items
        .map((item) => {
          const orderedQty = Math.max(0, safeInt(item?.qty, 0));
          const cancelledQty = Math.min(orderedQty, Math.max(0, safeInt(item?.cancelledQty, 0)));
          const remainingQty = Math.max(0, orderedQty - cancelledQty);
          if (remainingQty <= 0) return "";
          const name = normalizeText(item?.name, 80);
          if (!name) return "";
          return remainingQty > 1 ? `${name} x${remainingQty}` : name;
        })
        .filter(Boolean)
    : [];

  if (!names.length) return "Shop order";
  if (names.length <= 2) return names.join(" • ");
  return `${names.slice(0, 2).join(" • ")} +${names.length - 2} more`;
}

function mapPublicReview(order) {
  const review = order?.review || {};
  return {
    orderId: String(order?._id || ""),
    rating: Number(review.rating || 0),
    title: review.title || "",
    comment: review.comment || "",
    wouldRecommend: typeof review.wouldRecommend === "boolean" ? review.wouldRecommend : null,
    productQualityRating:
      Number.isFinite(Number(review.productQualityRating)) && Number(review.productQualityRating) > 0
        ? Number(review.productQualityRating)
        : null,
    deliveryServiceRating:
      Number.isFinite(Number(review.deliveryServiceRating)) && Number(review.deliveryServiceRating) > 0
        ? Number(review.deliveryServiceRating)
        : null,
    salonSupportRating:
      Number.isFinite(Number(review.salonSupportRating)) && Number(review.salonSupportRating) > 0
        ? Number(review.salonSupportRating)
        : null,
    submittedAt: review.updatedAt || review.submittedAt || order?.updatedAt || order?.createdAt || null,
    verifiedPurchase: review.verifiedPurchase !== false,
    reviewerName: maskReviewerName(order?.customerSnapshot?.name),
    purchasedItems: summarizePurchasedItems(order?.items),
    deliveryOutcome: String(order?.delivery?.customerConfirmationStatus || "pending")
  };
}

router.get("/shop", async (req, res, next) => {
  try {
    const page = Math.max(1, safeInt(req.query?.page, 1));
    const limit = clamp(safeInt(req.query?.limit, 6) || 6, 1, 12);
    const match = {
      "review.isPublished": true,
      "review.rating": { $gte: 1, $lte: 5 }
    };

    const [summaryRows, reviewOrders] = await Promise.all([
      Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalReviews: { $sum: 1 },
            averageRating: { $avg: "$review.rating" },
            recommendCount: {
              $sum: {
                $cond: [{ $eq: ["$review.wouldRecommend", true] }, 1, 0]
              }
            },
            rating5: { $sum: { $cond: [{ $eq: ["$review.rating", 5] }, 1, 0] } },
            rating4: { $sum: { $cond: [{ $eq: ["$review.rating", 4] }, 1, 0] } },
            rating3: { $sum: { $cond: [{ $eq: ["$review.rating", 3] }, 1, 0] } },
            rating2: { $sum: { $cond: [{ $eq: ["$review.rating", 2] }, 1, 0] } },
            rating1: { $sum: { $cond: [{ $eq: ["$review.rating", 1] }, 1, 0] } }
          }
        }
      ]),
      Order.find(match)
        .sort({ "review.updatedAt": -1, "review.submittedAt": -1, updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("customerSnapshot.name items delivery.customerConfirmationStatus review createdAt updatedAt")
        .lean()
    ]);

    const summary = summaryRows[0] || {};
    const totalReviews = Number(summary.totalReviews || 0);
    const averageRating = totalReviews ? Number((Number(summary.averageRating || 0)).toFixed(1)) : 0;
    const recommendationRate = totalReviews
      ? Math.round(((Number(summary.recommendCount || 0) / totalReviews) * 100))
      : 0;

    const breakdown = [5, 4, 3, 2, 1].map((rating) => {
      const count = Number(summary[`rating${rating}`] || 0);
      return {
        rating,
        count,
        percent: totalReviews ? Math.round((count / totalReviews) * 100) : 0
      };
    });

    return res.json({
      averageRating,
      totalReviews,
      recommendationRate,
      breakdown,
      page,
      limit,
      pages: totalReviews ? Math.ceil(totalReviews / limit) : 1,
      hasMore: page * limit < totalReviews,
      reviews: reviewOrders.map(mapPublicReview)
    });
  } catch (err) {
    return next(err);
  }
});

router.put("/orders/:id", authRequired, customerOnly, async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, customerId: req.user.cid });
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (!canShowReviewSection(order)) {
      return res.status(409).json({
        message: "Review becomes available after the order is marked delivered."
      });
    }

    if (!canSubmitReview(order)) {
      return res.status(409).json({
        message: "Please press Item received or Item not received first. Then your verified rating can be published."
      });
    }

    const rating = normalizeRating(req.body?.rating, { required: true });
    if (!rating) {
      return res.status(400).json({ message: "Overall rating must be between 1 and 5 stars." });
    }

    const title = normalizeText(req.body?.title, 120);
    const comment = normalizeText(req.body?.comment, 2000);
    const wouldRecommend = normalizeOptionalBoolean(req.body?.wouldRecommend);
    const productQualityRating = normalizeRating(req.body?.productQualityRating);
    const deliveryServiceRating = normalizeRating(req.body?.deliveryServiceRating);
    const salonSupportRating = normalizeRating(req.body?.salonSupportRating);

    if (wouldRecommend === undefined) {
      return res.status(400).json({ message: "wouldRecommend must be true or false when provided." });
    }
    if (productQualityRating === undefined || deliveryServiceRating === undefined || salonSupportRating === undefined) {
      return res.status(400).json({ message: "Optional aspect ratings must be between 1 and 5 stars." });
    }

    const now = new Date();
    const existingReview = order.review || {};
    const firstSubmittedAt = existingReview.submittedAt || now;

    order.review = {
      rating,
      title,
      comment,
      wouldRecommend,
      productQualityRating,
      deliveryServiceRating,
      salonSupportRating,
      verifiedPurchase: true,
      isPublished: true,
      submittedAt: firstSubmittedAt,
      updatedAt: now
    };

    await order.save();

    return res.json({
      ok: true,
      message: existingReview?.isPublished ? "Review updated successfully." : "Review published successfully.",
      review: order.review
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
