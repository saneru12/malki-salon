const mongoose = require("mongoose");

// Online shop product/item
// Controlled via Admin Panel.

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, default: "General", trim: true },
    description: { type: String, default: "", trim: true },
    priceLKR: { type: Number, required: true, min: 0 },
    imageUrl: { type: String, default: "", trim: true },
    // If null => unlimited / stock not tracked.
    stockQty: { type: Number, default: null, min: 0 },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Product", productSchema);
