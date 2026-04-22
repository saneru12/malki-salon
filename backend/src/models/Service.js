const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema(
  {
    category: { type: String, required: true },
    name: { type: String, required: true },
    priceLKR: { type: Number, required: true },
    durationMin: { type: Number, default: 30 },
    imageUrl: { type: String, default: "" },
    bookingMode: {
      type: String,
      enum: ["instant", "manual-review"],
      default: "instant"
    },
    allowAnyTimeBooking: { type: Boolean, default: false },
    requiresPhotoUpload: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Service", serviceSchema);
