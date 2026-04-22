const mongoose = require("mongoose");

const staffPayrollAdjustmentSchema = new mongoose.Schema(
  {
    staffRef: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", required: true, index: true },
    staffId: { type: String, required: true, trim: true, index: true },
    staffName: { type: String, required: true, trim: true },
    month: { type: String, required: true, trim: true, index: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: ["allowance", "deduction"], required: true },
    amountLKR: { type: Number, required: true },
    note: { type: String, default: "" },

    sourceType: {
      type: String,
      enum: ["manual", "appointment_overtime"],
      default: "manual",
      index: true
    },
    isSystemGenerated: { type: Boolean, default: false },
    sourceAppointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", default: null },
    bookingMode: { type: String, default: "", trim: true },
    appointmentDate: { type: String, default: "", trim: true },
    appointmentTime: { type: String, default: "", trim: true },
    appointmentEndTime: { type: String, default: "", trim: true },
    serviceRef: { type: mongoose.Schema.Types.ObjectId, ref: "Service", default: null },
    serviceName: { type: String, default: "", trim: true },
    overtimeMinutes: { type: Number, default: 0 },
    overtimeBeforeMinutes: { type: Number, default: 0 },
    overtimeAfterMinutes: { type: Number, default: 0 },
    regularWindowStart: { type: String, default: "08:00", trim: true },
    regularWindowEnd: { type: String, default: "17:00", trim: true },
    rateSource: {
      type: String,
      enum: ["unknown", "salary_hourly", "commission_hourly", "manual_staff_ot_hourly"],
      default: "unknown"
    },
    referenceHourlyRateLKR: { type: Number, default: 0 },
    overtimeMultiplier: { type: Number, default: 1.5 },
    overtimeHourlyRateLKR: { type: Number, default: 0 }
  },
  { timestamps: true, autoIndex: false }
);

staffPayrollAdjustmentSchema.index({ staffRef: 1, month: 1 });
staffPayrollAdjustmentSchema.index(
  { sourceAppointmentId: 1 },
  {
    name: "sourceAppointmentId_unique_when_present",
    unique: true,
    partialFilterExpression: { sourceAppointmentId: { $type: "objectId" } }
  }
);

module.exports = mongoose.model("StaffPayrollAdjustment", staffPayrollAdjustmentSchema);
