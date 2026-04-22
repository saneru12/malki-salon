const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const connectDB = require("./config/db");
const User = require("./models/User");
const Staff = require("./models/Staff");
const Settings = require("./models/Settings");
const StaffWorkLog = require("./models/StaffWorkLog");
const StaffPayrollAdjustment = require("./models/StaffPayrollAdjustment");
const { syncAllAppointmentOvertimeAdjustments } = require("./utils/appointmentOvertime");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false
  })
);

const uploadRoot = path.join(__dirname, "..", "uploads");
fs.mkdirSync(uploadRoot, { recursive: true });
app.use("/uploads", express.static(uploadRoot));

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/customers", require("./routes/customerRoutes"));
app.use("/api/services", require("./routes/serviceRoutes"));
app.use("/api/packages", require("./routes/packageRoutes"));
app.use("/api/gallery", require("./routes/galleryRoutes"));
app.use("/api/staff", require("./routes/staffRoutes"));
app.use("/api/staff-management", require("./routes/staffManagementRoutes"));
app.use("/api/settings", require("./routes/settingsRoutes"));
app.use("/api/appointments", require("./routes/appointmentRoutes"));
app.use("/api/uploads", require("./routes/uploadRoutes"));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/orders", require("./routes/orderRoutes"));
app.use("/api/reviews", require("./routes/reviewRoutes"));
app.use("/api/messages", require("./routes/messageRoutes"));

app.use((err, req, res, next) => {
  console.error("ERROR:", err);
  res.status(500).json({ message: err.message || "Server error" });
});

const PORT = process.env.PORT || 5000;

async function ensureStaffWorkLogIndexes() {
  const collectionName = StaffWorkLog.collection.collectionName;
  const nativeDb = StaffWorkLog.db?.db;
  if (!nativeDb) throw new Error("Mongo database connection is not ready for index sync.");

  const collections = await nativeDb.listCollections({ name: collectionName }, { nameOnly: true }).toArray();
  if (collections.length > 0) {
    const indexes = await StaffWorkLog.collection.indexes();
    const appointmentIndexes = indexes.filter((item) => item.name !== "_id_" && item.key && item.key.appointmentId === 1);

    for (const item of appointmentIndexes) {
      const isDesiredIndex =
        item.name === "appointmentId_unique_when_present" &&
        item.unique === true &&
        item.partialFilterExpression?.appointmentId?.$type === "objectId";
      if (!isDesiredIndex) {
        await StaffWorkLog.collection.dropIndex(item.name);
        console.log(`Dropped legacy StaffWorkLog index ${item.name}`);
      }
    }
  }

  await StaffWorkLog.syncIndexes();
  console.log("StaffWorkLog indexes synchronized");
}

async function ensureStaffPayrollAdjustmentIndexes() {
  const collectionName = StaffPayrollAdjustment.collection.collectionName;
  const nativeDb = StaffPayrollAdjustment.db?.db;
  if (!nativeDb) throw new Error("Mongo database connection is not ready for payroll adjustment index sync.");

  const collections = await nativeDb.listCollections({ name: collectionName }, { nameOnly: true }).toArray();
  if (collections.length > 0) {
    const indexes = await StaffPayrollAdjustment.collection.indexes();
    const appointmentIndexes = indexes.filter((item) => item.name !== "_id_" && item.key && item.key.sourceAppointmentId === 1);

    for (const item of appointmentIndexes) {
      const isDesiredIndex =
        item.name === "sourceAppointmentId_unique_when_present" &&
        item.unique === true &&
        item.partialFilterExpression?.sourceAppointmentId?.$type === "objectId";
      if (!isDesiredIndex) {
        await StaffPayrollAdjustment.collection.dropIndex(item.name);
        console.log(`Dropped legacy StaffPayrollAdjustment index ${item.name}`);
      }
    }
  }

  await StaffPayrollAdjustment.syncIndexes();
  console.log("StaffPayrollAdjustment indexes synchronized");
}

async function ensureDefaults() {
  await Settings.findOneAndUpdate({ key: "default" }, { $setOnInsert: { key: "default" } }, { upsert: true });

  const adminEmail = (process.env.ADMIN_EMAIL || "admin@malkisalon.local").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "admin1234";
  const adminDisplayName = process.env.ADMIN_DISPLAY_NAME || "Main Admin";

  const existing = await User.findOne({ email: adminEmail });
  if (!existing) {
    const passwordHash = await bcrypt.hash(String(adminPassword), 10);
    await User.create({
      email: adminEmail,
      passwordHash,
      displayName: adminDisplayName,
      role: "admin",
      isActive: true
    });
    console.log(`Admin user created: ${adminEmail} (change ADMIN_PASSWORD in .env)`);
  } else {
    let changed = false;
    if (existing.role !== "admin") {
      existing.role = "admin";
      changed = true;
    }
    if (existing.isActive === false) {
      existing.isActive = true;
      changed = true;
    }
    if (!String(existing.displayName || "").trim()) {
      existing.displayName = adminDisplayName;
      changed = true;
    }
    if (changed) await existing.save();
  }

  const staffCount = await Staff.countDocuments({});
  if (staffCount === 0) {
    await Staff.insertMany([
      {
        staffId: "staff1",
        name: "Malki",
        role: "Senior Stylist",
        desc: "Haircuts, bridal styling, and color consultation.",
        imgUrl: "assets/img/staff1.svg",
        sortOrder: 1,
        isActive: true
      },
      {
        staffId: "staff2",
        name: "Nethmi",
        role: "Makeup Artist",
        desc: "Party makeup, bridal makeup, and skincare prep.",
        imgUrl: "assets/img/staff2.svg",
        sortOrder: 2,
        isActive: true
      },
      {
        staffId: "staff3",
        name: "Sewwandi",
        role: "Nail & Beauty",
        desc: "Manicure, pedicure, waxing, and facials.",
        imgUrl: "assets/img/staff3.svg",
        sortOrder: 3,
        isActive: true
      }
    ]);
    console.log("Default staff created");
  }
}

connectDB()
  .then(() => ensureStaffWorkLogIndexes())
  .then(() => ensureStaffPayrollAdjustmentIndexes())
  .then(() => ensureDefaults())
  .then(() => syncAllAppointmentOvertimeAdjustments())
  .then((syncResult) => {
    console.log(
      `Appointment OT sync complete: processed ${syncResult.processed}, upserted ${syncResult.upserted}, removed ${syncResult.removed}, removed orphans ${syncResult.removedOrphans}`
    );
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("DB connection failed:", err.message);
    process.exit(1);
  });
