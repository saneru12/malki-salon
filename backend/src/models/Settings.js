const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },
    maxAppointmentsPerDay: { type: Number, default: 4 },
    openTime: { type: String, default: "08:00" },
    closeTime: { type: String, default: "17:00" },
    bridalOpenTime: { type: String, default: "00:00" },
    slotIntervalMin: { type: Number, default: 15 },
    manualRequestOpenTime: { type: String, default: "08:00" },
    manualRequestCloseTime: { type: String, default: "17:00" },
    timeSlots: { type: [String], default: ["09:00", "11:00", "13:00", "15:00"] },
    siteName: { type: String, default: "Malki Salon" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    address: { type: String, default: "" },
    whatsapp: { type: String, default: "" },
    facebook: { type: String, default: "" },
    instagram: { type: String, default: "" },
    googleMapsEmbedUrl: { type: String, default: "" },
    contactMessagingEnabled: { type: Boolean, default: true },

    advancePaymentPercent: { type: Number, default: 25 },
    paymentInstructionsNote: { type: String, default: "Upload the transfer proof after sending the required advance payment." },

    bankAccountName: { type: String, default: "" },
    bankName: { type: String, default: "" },
    bankBranch: { type: String, default: "" },
    bankAccountNumber: { type: String, default: "" },
    bankTransferInstructions: { type: String, default: "" },
    onlineTransferInstructions: { type: String, default: "" },

    cryptoWalletLabel: { type: String, default: "USDT Wallet" },
    cryptoWalletAddress: { type: String, default: "" },
    cryptoNetwork: { type: String, default: "" },
    cryptoInstructions: { type: String, default: "" },
    cryptoWalletQrImageUrl: { type: String, default: "" },

    skrillEmail: { type: String, default: "" },
    skrillInstructions: { type: String, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Settings", settingsSchema);
