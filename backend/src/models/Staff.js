const mongoose = require("mongoose");

const serviceAssignmentSchema = new mongoose.Schema(
  {
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "Service", required: true },
    customPriceLKR: { type: Number, default: null },
    customDurationMin: { type: Number, default: null },
    commissionRatePct: { type: Number, default: null },
    isActive: { type: Boolean, default: true }
  },
  { _id: false }
);

const compensationSchema = new mongoose.Schema(
  {
    payrollMode: {
      type: String,
      enum: ["salary_plus_commission", "salary_only", "commission_only"],
      default: "salary_plus_commission"
    },
    baseSalaryLKR: { type: Number, default: 0 },
    defaultCommissionRatePct: { type: Number, default: 0 },
    expectedWorkingDays: { type: Number, default: 26 },
    overtimeDisabled: { type: Boolean, default: false },
    overtimeHourlyRateLKR: { type: Number, default: 0 }
  },
  { _id: false }
);

const staffSchema = new mongoose.Schema(
  {
    staffId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    joinedDate: { type: String, default: "" },
    desc: { type: String, default: "" },
    imgUrl: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: String, default: "" },
    archiveReason: { type: String, default: "" },
    sortOrder: { type: Number, default: 0 },
    serviceAssignments: { type: [serviceAssignmentSchema], default: [] },
    compensation: { type: compensationSchema, default: () => ({}) }
  },
  { timestamps: true }
);

staffSchema.index({ isArchived: 1, isActive: 1, sortOrder: 1, name: 1 });

module.exports = mongoose.model("Staff", staffSchema);
