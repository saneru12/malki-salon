const mongoose = require("mongoose");

// Simple inbox-style messaging between a logged-in customer and the admin.
// One document per message (easy to query + paginate).

const contactMessageSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true, index: true },

    sender: {
      type: String,
      enum: ["customer", "admin"],
      required: true,
      index: true
    },

    message: { type: String, required: true, trim: true, maxlength: 4000 },

    // Read markers (for basic "unread" counts)
    readByAdmin: { type: Boolean, default: false, index: true },
    readByCustomer: { type: Boolean, default: false, index: true },

    // Optional snapshots for display convenience
    customerSnapshot: {
      name: { type: String, default: "" },
      email: { type: String, default: "" },
      phone: { type: String, default: "" }
    },
    adminSnapshot: {
      email: { type: String, default: "" }
    }
  },
  { timestamps: true }
);

// Helpful compound index for listing conversations
contactMessageSchema.index({ customer: 1, createdAt: -1 });

module.exports = mongoose.model("ContactMessage", contactMessageSchema);
