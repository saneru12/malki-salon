const mongoose = require("mongoose");

const proposalSchema = new mongoose.Schema(
  {
    date: { type: String, default: "" },
    time: { type: String, default: "" },
    durationMin: { type: Number, default: 0 },
    endTime: { type: String, default: "" },
    note: { type: String, default: "" },
    proposedAt: { type: Date, default: null },
    proposalRound: { type: Number, default: 0 }
  },
  { _id: false }
);

const proposalHistorySchema = new mongoose.Schema(
  {
    date: { type: String, default: "" },
    time: { type: String, default: "" },
    durationMin: { type: Number, default: 0 },
    endTime: { type: String, default: "" },
    note: { type: String, default: "" },
    proposedAt: { type: Date, default: null },
    proposalRound: { type: Number, default: 0 },
    customerResponse: { type: String, default: "pending" },
    customerResponseNote: { type: String, default: "" },
    respondedAt: { type: Date, default: null }
  },
  { _id: false }
);

const paymentProofSchema = new mongoose.Schema(
  {
    url: { type: String, default: "" },
    filename: { type: String, default: "" },
    originalName: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    size: { type: Number, default: 0 },
    uploadedAt: { type: Date, default: null }
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    totalAmountLKR: { type: Number, default: 0 },
    depositPercent: { type: Number, default: 25 },
    depositAmountLKR: { type: Number, default: 0 },
    balanceAmountLKR: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["not_due", "pending_customer_payment", "submitted", "confirmed", "rejected"],
      default: "not_due"
    },
    method: {
      type: String,
      enum: ["", "bank_transfer", "online_transfer", "crypto", "skrill"],
      default: ""
    },
    proof: { type: paymentProofSchema, default: () => ({}) },
    customerReference: { type: String, default: "" },
    customerNote: { type: String, default: "" },
    submittedAt: { type: Date, default: null },
    adminNote: { type: String, default: "" },
    reviewedAt: { type: Date, default: null },
    confirmedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null }
  },
  { _id: false }
);

const appointmentSchema = new mongoose.Schema(
  {
    staffId: { type: String, required: true },
    staffName: { type: String, required: true },

    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
    customerName: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, default: "" },

    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "Service", required: true },
    serviceName: { type: String, required: true },

    preferredDate: { type: String, default: "" },
    date: { type: String, required: true },
    time: { type: String, default: "" },
    durationMin: { type: Number, default: 0 },
    endTime: { type: String, default: "" },

    bookingMode: { type: String, default: "instant" },
    allowAnyTimeBooking: { type: Boolean, default: false },
    preferredWindowLabel: { type: String, default: "" },
    preferredWindowStart: { type: String, default: "" },
    preferredWindowEnd: { type: String, default: "" },
    pendingProposal: { type: proposalSchema, default: () => ({}) },
    proposalHistory: { type: [proposalHistorySchema], default: [] },
    adminReviewNote: { type: String, default: "" },
    customerResponseNote: { type: String, default: "" },
    finalConfirmedAt: { type: Date, default: null },
    referencePhotos: {
      type: [
        {
          url: { type: String, required: true },
          filename: { type: String, default: "" },
          originalName: { type: String, default: "" }
        }
      ],
      default: []
    },

    payment: { type: paymentSchema, default: () => ({}) },

    notes: { type: String, default: "" },
    status: { type: String, default: "pending" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Appointment", appointmentSchema);
