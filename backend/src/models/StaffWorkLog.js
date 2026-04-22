const mongoose = require("mongoose");

const staffWorkLogSchema = new mongoose.Schema(
  {
    staffRef: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", required: true, index: true },
    staffId: { type: String, required: true, trim: true, index: true },
    staffName: { type: String, required: true, trim: true },

    serviceRef: { type: mongoose.Schema.Types.ObjectId, ref: "Service", default: null, index: true },
    serviceName: { type: String, default: "", trim: true },
    serviceCategory: { type: String, default: "", trim: true },

    // Appointment-based work logs must stay unique, but manual logs are allowed
    // to keep appointmentId as null without triggering duplicate-key errors.
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", default: null },
    customerName: { type: String, default: "", trim: true },
    workDate: { type: String, required: true, trim: true, index: true },
    quantity: { type: Number, default: 1 },
    unitPriceLKR: { type: Number, default: 0 },
    grossAmountLKR: { type: Number, default: 0 },
    commissionRatePct: { type: Number, default: 0 },
    commissionAmountLKR: { type: Number, default: 0 },
    source: { type: String, enum: ["appointment", "walk_in", "manual"], default: "manual" },
    note: { type: String, default: "" },
    status: { type: String, enum: ["completed", "cancelled"], default: "completed" }
  },
  { timestamps: true, autoIndex: false }
);

staffWorkLogSchema.index({ staffRef: 1, workDate: 1 });
staffWorkLogSchema.index(
  { appointmentId: 1 },
  {
    name: "appointmentId_unique_when_present",
    unique: true,
    partialFilterExpression: { appointmentId: { $type: "objectId" } }
  }
);

module.exports = mongoose.model("StaffWorkLog", staffWorkLogSchema);
