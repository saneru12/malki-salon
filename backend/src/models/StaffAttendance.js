const mongoose = require("mongoose");

const staffAttendanceSchema = new mongoose.Schema(
  {
    staffRef: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", required: true, index: true },
    staffId: { type: String, required: true, trim: true, index: true },
    staffName: { type: String, required: true, trim: true },
    date: { type: String, required: true, trim: true, index: true },
    status: {
      type: String,
      enum: ["present", "half_day", "absent", "paid_leave", "unpaid_leave"],
      default: "present"
    },
    inTime: { type: String, default: "" },
    outTime: { type: String, default: "" },
    note: { type: String, default: "" },
    markedBy: { type: String, default: "" }
  },
  { timestamps: true }
);

staffAttendanceSchema.index({ staffRef: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("StaffAttendance", staffAttendanceSchema);
