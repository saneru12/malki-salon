const express = require("express");
const Appointment = require("../models/Appointment");
const Service = require("../models/Service");
const Staff = require("../models/Staff");
const Settings = require("../models/Settings");
const Customer = require("../models/Customer");
const { authRequired, adminOnly, customerOnly } = require("../middleware/auth");
const { resolveStaffServiceConfig, getServiceDurationForStaff, getServicePriceForStaff } = require("../utils/staffManagement");
const { syncAppointmentOvertimeAdjustment, purgeAppointmentOvertimeAdjustment } = require("../utils/appointmentOvertime");

const router = express.Router();

const ACTIVE_STATUSES = ["pending", "approved"];
const MANUAL_OPEN_STATUSES = ["pending_review", "proposal_sent", "customer_reschedule_requested"];
const CANCELLABLE_STATUSES = [...ACTIVE_STATUSES, ...MANUAL_OPEN_STATUSES];
const DEFAULT_OPEN_TIME = "08:00";
const DEFAULT_CLOSE_TIME = "17:00";
const DEFAULT_ADVANCE_PAYMENT_PERCENT = 25;
const PAYMENT_METHODS = ["bank_transfer", "online_transfer", "crypto", "skrill"];
const SALON_TIME_ZONE = process.env.SALON_TIME_ZONE || "Asia/Colombo";

function getTimeZoneSnapshot(date = new Date(), timeZone = SALON_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(date);
  const lookup = {};
  for (const part of parts) lookup[part.type] = part.value;
  const isoDate = `${lookup.year}-${lookup.month}-${lookup.day}`;
  const hour = Number(lookup.hour || 0) % 24;
  const minute = Number(lookup.minute || 0);
  return {
    date: isoDate,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    minutes: hour * 60 + minute
  };
}

function ensureFutureBookingTime(date, time, label = "Selected time") {
  const targetDate = String(date || "").trim();
  const startMin = parseTimeToMin(time);
  if (!targetDate) {
    const err = new Error("Please choose a valid booking date.");
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(startMin)) {
    const err = new Error("Invalid time format. Use HH:MM (24h).");
    err.status = 400;
    throw err;
  }

  const now = getTimeZoneSnapshot();
  if (targetDate < now.date) {
    const err = new Error("Past dates cannot be booked.");
    err.status = 409;
    throw err;
  }
  if (targetDate === now.date && startMin < now.minutes) {
    const err = new Error(`${label} has already passed in salon time. Please choose a future time.`);
    err.status = 409;
    throw err;
  }
}

function parseTimeToMin(value) {
  const t = String(value || "").trim();
  if (t === "24:00") return 24 * 60;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return NaN;
  return hh * 60 + mm;
}

function minToTime(min) {
  const value = Math.max(0, Math.min(24 * 60, Math.floor(Number(min) || 0)));
  if (value === 24 * 60) return "24:00";
  const hh = String(Math.floor(value / 60)).padStart(2, "0");
  const mm = String(value % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function getServiceText(service) {
  return `${service?.category || ""} ${service?.name || ""}`.toLowerCase();
}

function getServiceBookingMode(service) {
  const explicit = String(service?.bookingMode || "").trim();
  if (explicit === "manual-review" || explicit === "instant") return explicit;
  const text = getServiceText(service);
  if (/(straight|rebond|relax|keratin)/i.test(text)) return "manual-review";
  return "instant";
}

function serviceAllowsAnyTime(service) {
  if (service?.allowAnyTimeBooking === true) return true;
  const text = getServiceText(service);
  return /(bridal dressing|normal dressing)/i.test(text);
}

function serviceRequiresPhotoUpload(service) {
  if (service?.requiresPhotoUpload === true) return true;
  return getServiceBookingMode(service) === "manual-review";
}

async function getSettingsDoc() {
  try {
    return await Settings.findOne({ key: "default" });
  } catch {
    return null;
  }
}

async function getMaxPerDay() {
  const s = await getSettingsDoc();
  const n = Number(s?.maxAppointmentsPerDay);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

async function getInstantBookingWindow(service) {
  if (serviceAllowsAnyTime(service)) {
    return { open: "00:00", close: "24:00" };
  }
  const s = await getSettingsDoc();
  return {
    open: String(s?.openTime || DEFAULT_OPEN_TIME),
    close: String(s?.closeTime || DEFAULT_CLOSE_TIME)
  };
}

function activeQuery(extra = {}) {
  return { status: { $in: ACTIVE_STATUSES }, ...extra };
}

function normalizePhotoList(referencePhotos) {
  return (Array.isArray(referencePhotos) ? referencePhotos : [])
    .map((item) => {
      if (!item) return null;
      if (typeof item === "string") return { url: item.trim(), filename: "", originalName: "" };
      return {
        url: String(item.url || "").trim(),
        filename: String(item.filename || "").trim(),
        originalName: String(item.originalName || "").trim()
      };
    })
    .filter((item) => item && item.url);
}

function roundMoney(value) {
  return Number((Math.max(0, Number(value) || 0)).toFixed(2));
}

function emptyPaymentProof() {
  return {
    url: "",
    filename: "",
    originalName: "",
    mimeType: "",
    size: 0,
    uploadedAt: null
  };
}

function normalizePaymentProof(file) {
  if (!file || typeof file !== "object") return emptyPaymentProof();
  const uploadedAt = file.uploadedAt ? new Date(file.uploadedAt) : null;
  return {
    url: String(file.url || "").trim(),
    filename: String(file.filename || "").trim(),
    originalName: String(file.originalName || "").trim(),
    mimeType: String(file.mimeType || file.mimetype || "").trim(),
    size: Math.max(0, Number(file.size) || 0),
    uploadedAt: uploadedAt && !Number.isNaN(uploadedAt.getTime()) ? uploadedAt : null
  };
}

function buildPaymentSnapshot(totalAmountLKR = 0, depositPercent = DEFAULT_ADVANCE_PAYMENT_PERCENT, status = "not_due") {
  const total = roundMoney(totalAmountLKR);
  const pct = Number.isFinite(Number(depositPercent)) && Number(depositPercent) > 0
    ? Number(depositPercent)
    : DEFAULT_ADVANCE_PAYMENT_PERCENT;
  const deposit = roundMoney((total * pct) / 100);
  const balance = roundMoney(Math.max(0, total - deposit));

  return {
    totalAmountLKR: total,
    depositPercent: pct,
    depositAmountLKR: deposit,
    balanceAmountLKR: balance,
    status,
    method: "",
    proof: emptyPaymentProof(),
    customerReference: "",
    customerNote: "",
    submittedAt: null,
    adminNote: "",
    reviewedAt: null,
    confirmedAt: null,
    rejectedAt: null
  };
}

function normalizePaymentFields(payment, appointmentStatus = "") {
  const base = payment && typeof payment === "object"
    ? payment
    : buildPaymentSnapshot(0, DEFAULT_ADVANCE_PAYMENT_PERCENT, appointmentStatus === "approved" ? "pending_customer_payment" : "not_due");

  const totalAmountLKR = roundMoney(base.totalAmountLKR || 0);
  const depositPercent = Number.isFinite(Number(base.depositPercent)) && Number(base.depositPercent) > 0
    ? Number(base.depositPercent)
    : DEFAULT_ADVANCE_PAYMENT_PERCENT;
  const depositAmountLKR = roundMoney(base.depositAmountLKR || (totalAmountLKR * depositPercent) / 100);
  const balanceAmountLKR = roundMoney(base.balanceAmountLKR || Math.max(0, totalAmountLKR - depositAmountLKR));

  let status = String(base.status || "").trim();
  if (!["not_due", "pending_customer_payment", "submitted", "confirmed", "rejected"].includes(status)) {
    status = appointmentStatus === "approved" ? "pending_customer_payment" : "not_due";
  }
  if (appointmentStatus === "approved" && !["submitted", "confirmed", "rejected"].includes(status)) {
    status = "pending_customer_payment";
  }
  if (appointmentStatus !== "approved" && !["submitted", "confirmed", "rejected"].includes(status)) {
    status = "not_due";
  }

  const method = PAYMENT_METHODS.includes(String(base.method || "").trim()) ? String(base.method).trim() : "";

  return {
    totalAmountLKR,
    depositPercent,
    depositAmountLKR,
    balanceAmountLKR,
    status,
    method,
    proof: normalizePaymentProof(base.proof),
    customerReference: String(base.customerReference || "").trim(),
    customerNote: String(base.customerNote || "").trim(),
    submittedAt: base.submittedAt || null,
    adminNote: String(base.adminNote || "").trim(),
    reviewedAt: base.reviewedAt || null,
    confirmedAt: base.confirmedAt || null,
    rejectedAt: base.rejectedAt || null
  };
}

function syncPaymentState(appt, { totalAmountLKR = null, depositPercent = null } = {}) {
  const current = normalizePaymentFields(appt?.payment, appt?.status);
  const total = totalAmountLKR === null || totalAmountLKR === undefined
    ? current.totalAmountLKR
    : roundMoney(totalAmountLKR);
  const pct = Number.isFinite(Number(depositPercent)) && Number(depositPercent) > 0
    ? Number(depositPercent)
    : current.depositPercent || DEFAULT_ADVANCE_PAYMENT_PERCENT;
  const deposit = roundMoney((total * pct) / 100);
  const balance = roundMoney(Math.max(0, total - deposit));

  let status = current.status;
  if (String(appt?.status || "").trim() === "approved") {
    if (!["submitted", "confirmed", "rejected"].includes(status)) status = "pending_customer_payment";
  } else if (!["submitted", "confirmed", "rejected"].includes(status)) {
    status = "not_due";
  }

  appt.payment = {
    ...current,
    totalAmountLKR: total,
    depositPercent: pct,
    depositAmountLKR: deposit,
    balanceAmountLKR: balance,
    status
  };

  return appt.payment;
}

async function getAdvancePaymentPercent() {
  const s = await getSettingsDoc();
  const n = Number(s?.advancePaymentPercent);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ADVANCE_PAYMENT_PERCENT;
}

async function resolveAppointmentPriceSnapshot({ staff = null, service = null, staffId = "", serviceId = "" }) {
  const staffDoc = staff || (staffId ? await Staff.findOne({ staffId: String(staffId).trim() }) : null);
  const serviceDoc = service || (serviceId ? await Service.findById(serviceId) : null);
  if (!serviceDoc) return 0;
  if (!staffDoc) return roundMoney(serviceDoc.priceLKR || 0);

  const cfg = resolveStaffServiceConfig(staffDoc, serviceDoc);
  const totalAmountLKR = cfg.allowed ? getServicePriceForStaff(staffDoc, serviceDoc) : Math.max(0, Number(serviceDoc.priceLKR || 0));
  return roundMoney(totalAmountLKR);
}

function emptyProposal() {
  return {
    date: "",
    time: "",
    durationMin: 0,
    endTime: "",
    note: "",
    proposedAt: null,
    proposalRound: 0
  };
}

function hasPendingProposal(appt) {
  return Boolean(appt?.pendingProposal?.date && appt?.pendingProposal?.time);
}

function getNextProposalRound(appt) {
  const rounds = [];
  for (const entry of Array.isArray(appt?.proposalHistory) ? appt.proposalHistory : []) {
    const n = Number(entry?.proposalRound);
    if (Number.isFinite(n) && n > 0) rounds.push(n);
  }
  const current = Number(appt?.pendingProposal?.proposalRound);
  if (Number.isFinite(current) && current > 0) rounds.push(current);
  return (rounds.length ? Math.max(...rounds) : 0) + 1;
}

function archivePendingProposal(appt, { customerResponse = "pending", customerResponseNote = "", respondedAt = new Date() } = {}) {
  if (!hasPendingProposal(appt)) return;
  const pending = appt.pendingProposal || emptyProposal();
  const history = Array.isArray(appt.proposalHistory) ? appt.proposalHistory : [];
  history.push({
    date: String(pending.date || ""),
    time: String(pending.time || ""),
    durationMin: Number(pending.durationMin) || 0,
    endTime: String(pending.endTime || ""),
    note: String(pending.note || ""),
    proposedAt: pending.proposedAt || null,
    proposalRound: Number(pending.proposalRound) || 0,
    customerResponse: String(customerResponse || "pending"),
    customerResponseNote: String(customerResponseNote || "").trim(),
    respondedAt: respondedAt || null
  });
  appt.proposalHistory = history;
}

function normalizeManualFields(obj) {
  if (obj.bookingMode !== "manual-review") return obj;
  if (!obj.preferredDate) obj.preferredDate = obj.date || "";
  if (!obj.pendingProposal || typeof obj.pendingProposal !== "object") obj.pendingProposal = emptyProposal();
  if (!Array.isArray(obj.proposalHistory)) obj.proposalHistory = [];
  return obj;
}

function normalizeAppointment(doc) {
  const obj = doc?.toObject ? doc.toObject() : { ...(doc || {}) };
  normalizeManualFields(obj);
  if (obj.bookingMode !== "manual-review") {
    const start = parseTimeToMin(obj.time);
    const dur = Number(obj.durationMin) || Number(obj?.serviceId?.durationMin) || 30;
    const end = Number.isFinite(start) ? start + dur : NaN;
    if (!obj.durationMin) obj.durationMin = dur;
    if (!obj.endTime && Number.isFinite(end)) obj.endTime = minToTime(end);
  }
  obj.payment = normalizePaymentFields(obj.payment, obj.status);
  return obj;
}

async function ensureCapacityAndNoOverlap({ appointmentIdToIgnore = null, date, staffId, startTime, durationMin }) {
  const startMin = parseTimeToMin(startTime);
  const dur = Number(durationMin);
  if (!Number.isFinite(startMin) || !Number.isFinite(dur) || dur <= 0) {
    throw new Error("Invalid start time or duration.");
  }
  const endMin = startMin + dur;

  const MAX_PER_DAY = await getMaxPerDay();
  const q = activeQuery({ date: String(date), staffId: String(staffId) });
  if (appointmentIdToIgnore) q._id = { $ne: appointmentIdToIgnore };

  const dayCount = await Appointment.countDocuments(q);
  if (dayCount >= MAX_PER_DAY) {
    throw new Error("This staff member is fully booked for this day. Please choose another date or time.");
  }

  const existing = await Appointment.find(q).populate("serviceId", "durationMin").sort({ time: 1 });
  for (const a of existing) {
    const aStart = parseTimeToMin(a.time);
    const aDur = Number(a.durationMin) || Number(a?.serviceId?.durationMin) || 30;
    const aEnd = aStart + aDur;
    if (Number.isFinite(aStart) && intervalsOverlap(startMin, endMin, aStart, aEnd)) {
      throw new Error(`Time conflict: ${a.time}-${a.endTime || minToTime(aEnd)} is already booked for the selected staff member.`);
    }
  }

  return { startMin, endMin };
}

router.post("/", authRequired, customerOnly, async (req, res) => {
  try {
    let {
      staffId,
      staffName,
      customerName,
      phone,
      email,
      serviceId,
      date,
      time,
      notes,
      referencePhotos
    } = req.body || {};

    const customer = await Customer.findById(req.user.cid).select("name email phone isActive");
    if (!customer || !customer.isActive) {
      return res.status(401).json({ message: "Customer account not active" });
    }

    customerName = customer.name;
    phone = customer.phone;
    email = customer.email;

    if (!staffId || !serviceId || !date) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const service = await Service.findById(serviceId);
    if (!service) return res.status(404).json({ message: "Service not found" });

    const staff = await Staff.findOne({ staffId: String(staffId).trim(), isActive: true });
    if (!staff) return res.status(404).json({ message: "Selected staff member is not available." });

    const staffServiceConfig = resolveStaffServiceConfig(staff, service);
    if (!staffServiceConfig.allowed) {
      return res.status(409).json({ message: "This staff member does not currently offer the selected service." });
    }

    staffId = staff.staffId;
    staffName = staff.name;

    const bookingMode = getServiceBookingMode(service);
    const servicePriceLKR = await resolveAppointmentPriceSnapshot({ staff, service, staffId, serviceId });
    const depositPercent = await getAdvancePaymentPercent();
    const allowAnyTimeBooking = serviceAllowsAnyTime(service);
    const normalizedDate = String(date).trim();

    if (bookingMode === "manual-review") {
      const photos = normalizePhotoList(referencePhotos);
      if (serviceRequiresPhotoUpload(service) && photos.length < 2) {
        return res.status(400).json({ message: "Please upload at least 2 hair photos for this request." });
      }

      const appt = await Appointment.create({
        customerId: req.user.cid,
        staffId: String(staffId).trim(),
        staffName: String(staffName).trim(),
        customerName: String(customerName).trim(),
        phone: String(phone).trim(),
        email: String(email || "").trim(),
        serviceId,
        serviceName: service.name,
        preferredDate: normalizedDate,
        date: normalizedDate,
        time: "",
        endTime: "",
        durationMin: 0,
        bookingMode,
        allowAnyTimeBooking,
        preferredWindowStart: "",
        preferredWindowEnd: "",
        preferredWindowLabel: "",
        pendingProposal: emptyProposal(),
        proposalHistory: [],
        adminReviewNote: "",
        customerResponseNote: "",
        referencePhotos: photos,
        payment: buildPaymentSnapshot(servicePriceLKR, depositPercent, "not_due"),
        notes: String(notes || "").trim(),
        status: "pending_review"
      });

      return res.status(201).json({
        message: "Request sent successfully. The salon will review your photos and send an exact date/time proposal to My Account.",
        appointment: normalizeAppointment(appt)
      });
    }

    if (!time) return res.status(400).json({ message: "Please select a time slot." });

    const durationMin = getServiceDurationForStaff(staff, service);
    const instantWindow = await getInstantBookingWindow(service);
    const openMin = parseTimeToMin(instantWindow.open);
    const closeMin = parseTimeToMin(instantWindow.close);
    const startMin = parseTimeToMin(time);
    const endMin = startMin + durationMin;

    if (!Number.isFinite(startMin)) {
      return res.status(400).json({ message: "Invalid time format. Use HH:MM (24h)." });
    }
    try {
      ensureFutureBookingTime(normalizedDate, time, allowAnyTimeBooking ? "Selected 24/7 booking time" : "Selected booking time");
    } catch (err) {
      return res.status(err.status || 409).json({ message: err.message || "Please choose a future time." });
    }
    if (!Number.isFinite(openMin) || !Number.isFinite(closeMin)) {
      return res.status(500).json({ message: "Booking hours are misconfigured on the server." });
    }
    if (startMin < openMin || startMin >= closeMin || endMin > closeMin) {
      return res.status(409).json({
        message: allowAnyTimeBooking
          ? "Selected time is outside the 24-hour bookable range for this service."
          : `Selected time is outside salon hours (${instantWindow.open} - ${instantWindow.close}), or the service cannot finish before closing.`
      });
    }

    try {
      await ensureCapacityAndNoOverlap({
        date: normalizedDate,
        staffId: String(staffId).trim(),
        startTime: String(time).trim(),
        durationMin
      });
    } catch (err) {
      return res.status(409).json({ message: err.message || "Time conflict" });
    }

    const appt = await Appointment.create({
      customerId: req.user.cid,
      staffId: String(staffId).trim(),
      staffName: String(staffName).trim(),
      customerName: String(customerName).trim(),
      phone: String(phone).trim(),
      email: String(email || "").trim(),
      serviceId,
      serviceName: service.name,
      preferredDate: normalizedDate,
      date: normalizedDate,
      time: String(time).trim(),
      durationMin,
      endTime: minToTime(endMin),
      bookingMode,
      allowAnyTimeBooking,
      payment: buildPaymentSnapshot(servicePriceLKR, depositPercent, "not_due"),
      notes: String(notes || "").trim(),
      status: "pending"
    });

    return res.status(201).json({ message: "Appointment created", appointment: normalizeAppointment(appt) });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

router.get("/", async (req, res) => {
  try {
    const { date, staffId, includeCancelled } = req.query;
    const q = {};
    if (date) q.date = String(date);
    if (staffId) q.staffId = String(staffId);
    if (String(includeCancelled).toLowerCase() !== "true") {
      q.status = { $in: ACTIVE_STATUSES };
    }

    const sort = date ? { time: 1, createdAt: -1 } : { createdAt: -1 };
    const appts = await Appointment.find(q).populate("serviceId", "durationMin").sort(sort);
    return res.json((appts || []).map(normalizeAppointment));
  } catch (err) {
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

router.get("/me", authRequired, customerOnly, async (req, res) => {
  try {
    const { status } = req.query;
    const q = { customerId: req.user.cid };
    if (status) q.status = String(status);
    const list = await Appointment.find(q).sort({ createdAt: -1 });
    return res.json((list || []).map(normalizeAppointment));
  } catch (err) {
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

router.put("/me/:id/respond-manual", authRequired, customerOnly, async (req, res) => {
  try {
    const appt = await Appointment.findOne({ _id: req.params.id, customerId: req.user.cid }).populate("serviceId", "durationMin allowAnyTimeBooking bookingMode category name");
    if (!appt) return res.status(404).json({ message: "Not found" });
    if (appt.bookingMode !== "manual-review") {
      return res.status(409).json({ message: "This booking does not use the manual review process." });
    }
    if (appt.status !== "proposal_sent" || !hasPendingProposal(appt)) {
      return res.status(409).json({ message: "There is no active salon proposal to respond to." });
    }

    const action = String(req.body?.action || "").trim().toLowerCase();
    const note = String(req.body?.note || "").trim();
    if (!["accept", "reject"].includes(action)) {
      return res.status(400).json({ message: "Invalid response action." });
    }

    if (action === "reject") {
      archivePendingProposal(appt, {
        customerResponse: "rejected",
        customerResponseNote: note,
        respondedAt: new Date()
      });
      appt.pendingProposal = emptyProposal();
      appt.customerResponseNote = note;
      appt.status = "customer_reschedule_requested";
      await appt.save();
      return res.json({
        ok: true,
        message: "Your request for another date/time was sent to the salon.",
        appointment: normalizeAppointment(appt)
      });
    }

    const proposed = appt.pendingProposal || emptyProposal();
    try {
      ensureFutureBookingTime(proposed.date, proposed.time, "This proposed time");
      await ensureCapacityAndNoOverlap({
        appointmentIdToIgnore: appt._id,
        date: proposed.date,
        staffId: appt.staffId,
        startTime: proposed.time,
        durationMin: proposed.durationMin
      });
    } catch (err) {
      archivePendingProposal(appt, {
        customerResponse: "expired",
        customerResponseNote: note || "Customer tried to accept, but the slot was no longer available.",
        respondedAt: new Date()
      });
      appt.pendingProposal = emptyProposal();
      appt.customerResponseNote = note;
      appt.status = "customer_reschedule_requested";
      await appt.save();
      return res.status(409).json({
        message: "That proposed slot is no longer available. The salon must send you another option.",
        appointment: normalizeAppointment(appt)
      });
    }

    archivePendingProposal(appt, {
      customerResponse: "accepted",
      customerResponseNote: note,
      respondedAt: new Date()
    });
    appt.date = String(proposed.date || appt.date || "").trim();
    appt.time = String(proposed.time || "").trim();
    appt.durationMin = Number(proposed.durationMin) || 0;
    appt.endTime = String(proposed.endTime || "").trim();
    appt.pendingProposal = emptyProposal();
    appt.customerResponseNote = note;
    appt.finalConfirmedAt = new Date();
    appt.status = "approved";
    const acceptedTotalAmountLKR = roundMoney(appt?.payment?.totalAmountLKR || await resolveAppointmentPriceSnapshot({
      staffId: appt.staffId,
      serviceId: appt.serviceId
    }));
    const acceptedDepositPercent = Number(appt?.payment?.depositPercent) > 0
      ? Number(appt.payment.depositPercent)
      : await getAdvancePaymentPercent();
    syncPaymentState(appt, { totalAmountLKR: acceptedTotalAmountLKR, depositPercent: acceptedDepositPercent });
    await appt.save();
    await syncAppointmentOvertimeAdjustment(appt);

    return res.json({
      ok: true,
      message: "Appointment confirmed successfully.",
      appointment: normalizeAppointment(appt)
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

router.put("/me/:id/payment-proof", authRequired, customerOnly, async (req, res) => {
  try {
    const appt = await Appointment.findOne({ _id: req.params.id, customerId: req.user.cid });
    if (!appt) return res.status(404).json({ message: "Not found" });
    if (appt.status !== "approved") {
      return res.status(409).json({ message: "You can upload the 25% advance payment proof only after the booking is approved." });
    }

    const method = String(req.body?.method || "").trim();
    if (!PAYMENT_METHODS.includes(method)) {
      return res.status(400).json({ message: "Please choose a valid payment method." });
    }

    const proofFile = normalizePaymentProof(req.body?.proofFile || req.body?.proof || {});
    if (!proofFile.url) {
      return res.status(400).json({ message: "Please upload the transfer slip first." });
    }

    const totalAmountLKR = roundMoney(appt?.payment?.totalAmountLKR || await resolveAppointmentPriceSnapshot({
      staffId: appt.staffId,
      serviceId: appt.serviceId
    }));
    const depositPercent = Number(appt?.payment?.depositPercent) > 0
      ? Number(appt.payment.depositPercent)
      : await getAdvancePaymentPercent();

    syncPaymentState(appt, { totalAmountLKR, depositPercent });
    if (appt.payment.status === "confirmed") {
      return res.status(409).json({ message: "This advance payment has already been confirmed by admin." });
    }

    appt.payment.method = method;
    appt.payment.proof = {
      ...proofFile,
      uploadedAt: proofFile.uploadedAt || new Date()
    };
    appt.payment.customerReference = String(req.body?.customerReference || "").trim();
    appt.payment.customerNote = String(req.body?.customerNote || "").trim();
    appt.payment.submittedAt = new Date();
    appt.payment.adminNote = "";
    appt.payment.reviewedAt = null;
    appt.payment.confirmedAt = null;
    appt.payment.rejectedAt = null;
    appt.payment.status = "submitted";

    await appt.save();
    return res.json({
      ok: true,
      message: "Advance payment proof uploaded successfully. The salon will verify it soon.",
      appointment: normalizeAppointment(appt)
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

router.put("/me/:id/cancel", authRequired, customerOnly, async (req, res) => {
  try {
    const appt = await Appointment.findOne({ _id: req.params.id, customerId: req.user.cid });
    if (!appt) return res.status(404).json({ message: "Not found" });
    if (!CANCELLABLE_STATUSES.includes(appt.status)) {
      return res.status(409).json({ message: "This appointment cannot be cancelled." });
    }
    if (appt.bookingMode === "manual-review" && hasPendingProposal(appt) && appt.status === "proposal_sent") {
      archivePendingProposal(appt, {
        customerResponse: "cancelled",
        customerResponseNote: "Booking request cancelled by customer.",
        respondedAt: new Date()
      });
      appt.pendingProposal = emptyProposal();
    }
    appt.status = "cancelled";
    syncPaymentState(appt);
    await appt.save();
    await syncAppointmentOvertimeAdjustment(appt);
    return res.json({ ok: true, appointment: normalizeAppointment(appt) });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

router.get("/admin/all", authRequired, adminOnly, async (req, res) => {
  try {
    const { status, date, staffId, paymentStatus } = req.query;
    const q = {};
    if (status) q.status = String(status);
    if (date) q.date = String(date);
    if (staffId) q.staffId = String(staffId);
    if (paymentStatus) q["payment.status"] = String(paymentStatus);
    const list = await Appointment.find(q).sort({ createdAt: -1 });
    return res.json((list || []).map(normalizeAppointment));
  } catch (err) {
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

router.put("/admin/:id/propose-manual", authRequired, adminOnly, async (req, res) => {
  try {
    const appt = await Appointment.findById(req.params.id).populate("serviceId");
    if (!appt) return res.status(404).json({ message: "Not found" });
    if (appt.bookingMode !== "manual-review") {
      return res.status(409).json({ message: "This booking is not a manual review request." });
    }
    if (["approved", "cancelled"].includes(appt.status)) {
      return res.status(409).json({ message: "This booking can no longer receive new proposals." });
    }

    const service = appt.serviceId || (await Service.findById(appt.serviceId));
    const window = await getInstantBookingWindow(service);
    const date = String(req.body?.date || "").trim();
    const time = String(req.body?.time || "").trim();
    const durationMin = Number(req.body?.durationMin || appt.pendingProposal?.durationMin || service?.durationMin || 180);
    const adminReviewNote = String(req.body?.adminReviewNote ?? req.body?.notes ?? appt.adminReviewNote ?? "").trim();

    if (!date || !time || !Number.isFinite(durationMin) || durationMin <= 0) {
      return res.status(400).json({ message: "date, time and durationMin are required to send a proposal." });
    }

    const startMin = parseTimeToMin(time);
    const endMin = startMin + durationMin;
    const openMin = parseTimeToMin(window.open);
    const closeMin = parseTimeToMin(window.close);
    if (!Number.isFinite(startMin)) {
      return res.status(400).json({ message: "Invalid time format. Use HH:MM (24h)." });
    }
    try {
      ensureFutureBookingTime(date, time, "The proposed time");
    } catch (err) {
      return res.status(err.status || 409).json({ message: err.message || "Please choose a future time." });
    }
    if (startMin < openMin || startMin >= closeMin || endMin > closeMin) {
      return res.status(409).json({
        message: serviceAllowsAnyTime(service)
          ? "The proposed time must stay within the service's 24-hour booking rules."
          : `The proposed time must stay within salon hours (${window.open} - ${window.close}).`
      });
    }

    try {
      await ensureCapacityAndNoOverlap({
        appointmentIdToIgnore: appt._id,
        date,
        staffId: appt.staffId,
        startTime: time,
        durationMin
      });
    } catch (err) {
      return res.status(409).json({ message: err.message || "Time conflict" });
    }

    if (hasPendingProposal(appt)) {
      archivePendingProposal(appt, {
        customerResponse: "superseded",
        customerResponseNote: "Proposal updated by the salon before customer response.",
        respondedAt: new Date()
      });
    }

    appt.pendingProposal = {
      date,
      time,
      durationMin,
      endTime: minToTime(endMin),
      note: adminReviewNote,
      proposedAt: new Date(),
      proposalRound: getNextProposalRound(appt)
    };
    appt.adminReviewNote = adminReviewNote;
    appt.status = "proposal_sent";
    await appt.save();

    return res.json({
      ok: true,
      message: "Proposal sent to customer account.",
      appointment: normalizeAppointment(appt)
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

router.put("/admin/:id/payment-review", authRequired, adminOnly, async (req, res) => {
  try {
    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ message: "Not found" });
    if (!appt?.payment?.proof?.url) {
      return res.status(409).json({ message: "This booking does not have an uploaded payment proof yet." });
    }

    const action = String(req.body?.action || "").trim().toLowerCase();
    if (!["confirm", "reject"].includes(action)) {
      return res.status(400).json({ message: "Invalid payment review action." });
    }

    const totalAmountLKR = roundMoney(appt?.payment?.totalAmountLKR || await resolveAppointmentPriceSnapshot({
      staffId: appt.staffId,
      serviceId: appt.serviceId
    }));
    const depositPercent = Number(appt?.payment?.depositPercent) > 0
      ? Number(appt.payment.depositPercent)
      : await getAdvancePaymentPercent();

    syncPaymentState(appt, { totalAmountLKR, depositPercent });
    appt.payment.adminNote = String(req.body?.adminNote || "").trim();
    appt.payment.reviewedAt = new Date();

    if (action === "confirm") {
      appt.payment.status = "confirmed";
      appt.payment.confirmedAt = new Date();
      appt.payment.rejectedAt = null;
    } else {
      appt.payment.status = "rejected";
      appt.payment.rejectedAt = new Date();
      appt.payment.confirmedAt = null;
    }

    await appt.save();
    return res.json({
      ok: true,
      message: action === "confirm" ? "Advance payment confirmed." : "Advance payment proof rejected.",
      appointment: normalizeAppointment(appt)
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

router.put("/admin/:id", authRequired, adminOnly, async (req, res) => {
  try {
    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ message: "Not found" });

    const prevStatus = String(appt.status || "").trim();
    const allowedFields = ["status", "notes", "adminReviewNote", "customerResponseNote", "preferredDate", "date", "time", "endTime"];
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
        appt[field] = typeof req.body[field] === "string" ? req.body[field].trim() : req.body[field];
      }
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "durationMin")) {
      const durationMin = Number(req.body.durationMin);
      if (!Number.isFinite(durationMin) || durationMin < 0) {
        return res.status(400).json({ message: "Invalid durationMin" });
      }
      appt.durationMin = durationMin;
    }

    if (String(appt.status || "").trim() === "approved" && prevStatus !== "approved") {
      appt.finalConfirmedAt = new Date();
    }

    const totalAmountLKR = roundMoney(appt?.payment?.totalAmountLKR || await resolveAppointmentPriceSnapshot({
      staffId: appt.staffId,
      serviceId: appt.serviceId
    }));
    const depositPercent = Number(appt?.payment?.depositPercent) > 0
      ? Number(appt.payment.depositPercent)
      : await getAdvancePaymentPercent();
    syncPaymentState(appt, { totalAmountLKR, depositPercent });

    await appt.save();
    await syncAppointmentOvertimeAdjustment(appt);
    return res.json(normalizeAppointment(appt));
  } catch (err) {
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

router.delete("/admin/:id", authRequired, adminOnly, async (req, res) => {
  try {
    const deleted = await Appointment.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Not found" });
    await purgeAppointmentOvertimeAdjustment(deleted._id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

module.exports = router;
