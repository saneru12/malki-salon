const express = require("express");
const Staff = require("../models/Staff");
const Service = require("../models/Service");
const Appointment = require("../models/Appointment");
const StaffAttendance = require("../models/StaffAttendance");
const StaffWorkLog = require("../models/StaffWorkLog");
const StaffPayrollAdjustment = require("../models/StaffPayrollAdjustment");
const { authRequired, adminOrStaffManagerOnly } = require("../middleware/auth");
const {
  toNumber,
  normalizeMonth,
  normalizeDate,
  getMonthRange,
  monthFromDate,
  attendanceUnit,
  computeWorkedHours,
  normalizeCompensation,
  resolveStaffServiceConfig,
  getServiceDurationForStaff,
  getServicePriceForStaff,
  buildStaffSnapshot,
  buildServiceSnapshot,
  calculateCommissionAmount
} = require("../utils/staffManagement");

const router = express.Router();

router.use(authRequired, adminOrStaffManagerOnly);

function monthRegex(month) {
  return new RegExp(`^${normalizeMonth(month)}-`);
}

async function requireStaff(staffRef) {
  const staff = await Staff.findById(staffRef);
  if (!staff) {
    const err = new Error("Staff member not found.");
    err.status = 404;
    throw err;
  }
  return staff;
}

async function findStaffByPublicId(staffId) {
  return Staff.findOne({ staffId: String(staffId || "").trim() });
}

async function requireService(serviceRef) {
  if (!serviceRef) return null;
  const service = await Service.findById(serviceRef);
  if (!service) {
    const err = new Error("Service not found.");
    err.status = 404;
    throw err;
  }
  return service;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function sanitizeAttendanceTime(value) {
  const time = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(time) ? time : "";
}

function attendanceLocksTime(status) {
  return ["paid_leave", "unpaid_leave", "absent"].includes(String(status || "").trim());
}

function sanitizeAttendancePayload(body, markedBy = "") {
  const status = ["present", "half_day", "absent", "paid_leave", "unpaid_leave"].includes(String(body.status || ""))
    ? String(body.status)
    : "present";
  const lockTime = attendanceLocksTime(status);

  return {
    date: normalizeDate(body.date),
    status,
    inTime: lockTime ? "" : sanitizeAttendanceTime(body.inTime),
    outTime: lockTime ? "" : sanitizeAttendanceTime(body.outTime),
    note: String(body.note || "").trim(),
    markedBy: String(markedBy || "").trim()
  };
}

function summarizeAttendance(list = []) {
  return (list || []).reduce(
    (acc, item) => {
      acc.totalRecords += 1;
      if (item.status === "present") acc.present += 1;
      if (item.status === "half_day") acc.halfDay += 1;
      if (item.status === "absent") acc.absent += 1;
      if (item.status === "paid_leave") acc.paidLeave += 1;
      if (item.status === "unpaid_leave") acc.unpaidLeave += 1;
      acc.paidUnits += attendanceUnit(item.status);
      acc.workedHours += computeWorkedHours(item);
      return acc;
    },
    {
      totalRecords: 0,
      present: 0,
      halfDay: 0,
      absent: 0,
      paidLeave: 0,
      unpaidLeave: 0,
      paidUnits: 0,
      workedHours: 0
    }
  );
}

function summarizeWorkLogs(list = []) {
  return (list || []).reduce(
    (acc, item) => {
      if (item.status === "cancelled") {
        acc.cancelledCount += 1;
        return acc;
      }
      acc.jobsCount += 1;
      acc.totalQty += Number(item.quantity || 0);
      acc.grossRevenue += Number(item.grossAmountLKR || 0);
      acc.commissionTotal += Number(item.commissionAmountLKR || 0);
      return acc;
    },
    {
      jobsCount: 0,
      cancelledCount: 0,
      totalQty: 0,
      grossRevenue: 0,
      commissionTotal: 0
    }
  );
}

function summarizeAdjustments(list = []) {
  return (list || []).reduce(
    (acc, item) => {
      const amount = Math.max(0, Number(item.amountLKR || 0));
      const sourceType = String(item?.sourceType || "manual");
      const overtimeMinutes = Math.max(0, Number(item?.overtimeMinutes || 0));

      if (sourceType === "appointment_overtime") {
        acc.systemCount += 1;
        acc.overtimeCount += 1;
        acc.overtimeMinutes += overtimeMinutes;
      } else {
        acc.manualCount += 1;
      }

      if (item.type === "deduction") {
        acc.deductions += amount;
        acc.net -= amount;
        if (sourceType !== "appointment_overtime") {
          acc.manualDeductions += amount;
        }
        return acc;
      }

      acc.allowances += amount;
      acc.net += amount;
      if (sourceType === "appointment_overtime") {
        acc.systemAllowances += amount;
        acc.overtimeAllowance += amount;
      } else {
        acc.manualAllowances += amount;
      }
      return acc;
    },
    {
      allowances: 0,
      deductions: 0,
      net: 0,
      manualAllowances: 0,
      manualDeductions: 0,
      systemAllowances: 0,
      overtimeAllowance: 0,
      overtimeMinutes: 0,
      overtimeCount: 0,
      manualCount: 0,
      systemCount: 0
    }
  );
}

function payrollSummaryForStaff(staff, attendanceList = [], workLogs = [], adjustments = []) {
  const comp = normalizeCompensation(staff?.compensation || {});
  const attendance = summarizeAttendance(attendanceList);
  const work = summarizeWorkLogs(workLogs);
  const adjustmentSummary = summarizeAdjustments(adjustments);

  const baseSalaryPayable = comp.payrollMode === "commission_only"
    ? 0
    : Number(((comp.baseSalaryLKR * Math.min(attendance.paidUnits, comp.expectedWorkingDays)) / comp.expectedWorkingDays).toFixed(2));
  const commissionPayable = comp.payrollMode === "salary_only" ? 0 : Number(work.commissionTotal.toFixed(2));
  const totalPayable = Number((baseSalaryPayable + commissionPayable + adjustmentSummary.net).toFixed(2));

  return {
    staffRef: staff._id,
    staffId: staff.staffId,
    staffName: staff.name,
    role: staff.role || "",
    compensation: comp,
    attendance,
    work,
    adjustments: adjustmentSummary,
    baseSalaryPayable,
    commissionPayable,
    totalPayable
  };
}

async function buildWorkLogPayload(body = {}, existing = null) {
  const staff = await requireStaff(body.staffRef || existing?.staffRef);
  const service = await requireService(body.serviceRef || existing?.serviceRef || null);
  if (service) {
    const cfg = resolveStaffServiceConfig(staff, service);
    const editingSameHistoricalService = Boolean(existing && String(existing.serviceRef || "") === String(service._id || ""));
    if (!cfg.allowed && !editingSameHistoricalService) {
      throw httpError(409, "This service is not assigned to the selected staff member.");
    }
  }

  const quantity = Math.max(1, toNumber(body.quantity, existing?.quantity || 1));
  const unitPriceLKR = body.unitPriceLKR !== undefined && body.unitPriceLKR !== ""
    ? Math.max(0, toNumber(body.unitPriceLKR, 0))
    : service
      ? getServicePriceForStaff(staff, service)
      : Math.max(0, toNumber(existing?.unitPriceLKR, 0));
  const grossAmountLKR = body.grossAmountLKR !== undefined && body.grossAmountLKR !== ""
    ? Math.max(0, toNumber(body.grossAmountLKR, unitPriceLKR * quantity))
    : Number((unitPriceLKR * quantity).toFixed(2));
  const defaultRate = service
    ? resolveStaffServiceConfig(staff, service).commissionRatePct
    : normalizeCompensation(staff.compensation || {}).defaultCommissionRatePct;
  const commissionRatePct = body.commissionRatePct !== undefined && body.commissionRatePct !== ""
    ? Math.max(0, toNumber(body.commissionRatePct, 0))
    : Math.max(0, toNumber(existing?.commissionRatePct, defaultRate));
  const commissionAmountLKR = calculateCommissionAmount({ grossAmountLKR, ratePct: commissionRatePct });
  const workDate = normalizeDate(body.workDate || existing?.workDate || "");
  if (!workDate) throw httpError(400, "workDate is required in YYYY-MM-DD format.");

  return {
    ...buildStaffSnapshot(staff),
    ...(service ? buildServiceSnapshot(service) : { serviceRef: null, serviceName: "", serviceCategory: "" }),
    customerName: String(body.customerName || existing?.customerName || "").trim(),
    workDate,
    quantity,
    unitPriceLKR,
    grossAmountLKR,
    commissionRatePct,
    commissionAmountLKR,
    source: ["appointment", "walk_in", "manual"].includes(String(body.source || existing?.source || ""))
      ? String(body.source || existing?.source)
      : "manual",
    note: String(body.note || existing?.note || "").trim(),
    status: ["completed", "cancelled"].includes(String(body.status || existing?.status || ""))
      ? String(body.status || existing?.status)
      : "completed"
  };
}

router.get("/attendance", async (req, res, next) => {
  try {
    const month = normalizeMonth(req.query.month);
    const q = { date: monthRegex(month) };
    if (req.query.staffRef) q.staffRef = req.query.staffRef;
    const records = await StaffAttendance.find(q).sort({ date: -1, staffName: 1 });
    res.json({ month, records, summary: summarizeAttendance(records) });
  } catch (err) {
    next(err);
  }
});

router.post("/attendance", async (req, res, next) => {
  try {
    const staff = await requireStaff(req.body?.staffRef);
    const payload = sanitizeAttendancePayload(req.body || {}, req.user?.email || req.user?.uid || "admin");
    if (!payload.date) return res.status(400).json({ message: "date is required in YYYY-MM-DD format" });

    const doc = await StaffAttendance.findOneAndUpdate(
      { staffRef: staff._id, date: payload.date },
      {
        $set: {
          ...buildStaffSnapshot(staff),
          ...payload
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json(doc);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
});

router.put("/attendance/:id", async (req, res, next) => {
  try {
    const existing = await StaffAttendance.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    const staff = await requireStaff(req.body?.staffRef || existing.staffRef);
    const payload = sanitizeAttendancePayload({ ...existing.toObject(), ...(req.body || {}) }, req.user?.email || "admin");
    existing.staffRef = staff._id;
    existing.staffId = staff.staffId;
    existing.staffName = staff.name;
    existing.date = payload.date;
    existing.status = payload.status;
    existing.inTime = payload.inTime;
    existing.outTime = payload.outTime;
    existing.note = payload.note;
    existing.markedBy = payload.markedBy;
    await existing.save();
    res.json(existing);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err?.code === 11000) return res.status(409).json({ message: "Attendance for this staff member and date already exists." });
    next(err);
  }
});

router.delete("/attendance/:id", async (req, res, next) => {
  try {
    const deleted = await StaffAttendance.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/work-logs", async (req, res, next) => {
  try {
    const month = normalizeMonth(req.query.month);
    const q = { workDate: monthRegex(month) };
    if (req.query.staffRef) q.staffRef = req.query.staffRef;
    const records = await StaffWorkLog.find(q).sort({ workDate: -1, createdAt: -1 });
    res.json({ month, records, summary: summarizeWorkLogs(records) });
  } catch (err) {
    next(err);
  }
});

router.post("/work-logs", async (req, res, next) => {
  try {
    const payload = await buildWorkLogPayload(req.body || {});
    const created = await StaffWorkLog.create(payload);
    res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err?.code === 11000) return res.status(409).json({ message: "This appointment is already linked to another work log." });
    next(err);
  }
});

router.put("/work-logs/:id", async (req, res, next) => {
  try {
    const existing = await StaffWorkLog.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    const payload = await buildWorkLogPayload(req.body || {}, existing);
    Object.assign(existing, payload);
    await existing.save();
    res.json(existing);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err?.code === 11000) return res.status(409).json({ message: "This appointment is already linked to another work log." });
    next(err);
  }
});

router.delete("/work-logs/:id", async (req, res, next) => {
  try {
    const deleted = await StaffWorkLog.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/appointment-candidates", async (req, res, next) => {
  try {
    const month = normalizeMonth(req.query.month);
    const q = { status: "approved", date: monthRegex(month) };
    if (req.query.staffRef) {
      const staff = await requireStaff(req.query.staffRef);
      q.staffId = staff.staffId;
    }
    const [appointments, workLogs] = await Promise.all([
      Appointment.find(q).sort({ date: -1, time: -1 }),
      StaffWorkLog.find({ appointmentId: { $ne: null } }).select("appointmentId")
    ]);
    const used = new Set(workLogs.map((item) => String(item.appointmentId || "")).filter(Boolean));
    res.json({
      month,
      records: appointments
        .filter((item) => !used.has(String(item._id)))
        .map((item) => ({
          _id: item._id,
          date: item.date,
          time: item.time,
          endTime: item.endTime,
          staffId: item.staffId,
          staffName: item.staffName,
          serviceId: item.serviceId,
          serviceName: item.serviceName,
          customerName: item.customerName,
          bookingMode: item.bookingMode,
          notes: item.notes || ""
        }))
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
});

router.post("/work-logs/from-appointment", async (req, res, next) => {
  try {
    const appointmentId = String(req.body?.appointmentId || "").trim();
    if (!appointmentId) return res.status(400).json({ message: "appointmentId is required" });

    const appt = await Appointment.findById(appointmentId);
    if (!appt) return res.status(404).json({ message: "Appointment not found" });
    if (appt.status !== "approved") {
      return res.status(409).json({ message: "Only approved appointments can be converted into completed work logs." });
    }

    const existing = await StaffWorkLog.findOne({ appointmentId: appt._id });
    if (existing) return res.status(409).json({ message: "A work log for this appointment already exists." });

    const staff = await findStaffByPublicId(appt.staffId);
    if (!staff) return res.status(404).json({ message: "The linked staff member was not found." });
    const service = await Service.findById(appt.serviceId);
    if (!service) return res.status(404).json({ message: "The linked service was not found." });

    const cfg = resolveStaffServiceConfig(staff, service);

    const quantity = 1;
    const unitPriceLKR = cfg.allowed ? getServicePriceForStaff(staff, service) : Math.max(0, Number(service.priceLKR || 0));
    const grossAmountLKR = Number((unitPriceLKR * quantity).toFixed(2));
    const commissionRatePct = Math.max(
      0,
      Number(cfg.allowed ? cfg.commissionRatePct : staff.compensation?.defaultCommissionRatePct || 0)
    );
    const commissionAmountLKR = calculateCommissionAmount({ grossAmountLKR, ratePct: commissionRatePct });

    const created = await StaffWorkLog.create({
      ...buildStaffSnapshot(staff),
      ...buildServiceSnapshot(service),
      appointmentId: appt._id,
      customerName: appt.customerName || "",
      workDate: normalizeDate(appt.date),
      quantity,
      unitPriceLKR,
      grossAmountLKR,
      commissionRatePct,
      commissionAmountLKR,
      source: "appointment",
      note: `Created from appointment ${String(appt.date || "")} ${String(appt.time || "")}`.trim(),
      status: "completed"
    });

    res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err?.code === 11000) return res.status(409).json({ message: "A work log for this appointment already exists." });
    next(err);
  }
});

router.get("/adjustments", async (req, res, next) => {
  try {
    const month = normalizeMonth(req.query.month);
    const q = { month };
    if (req.query.staffRef) q.staffRef = req.query.staffRef;
    const records = await StaffPayrollAdjustment.find(q).sort({ appointmentDate: -1, createdAt: -1 });
    res.json({ month, records, summary: summarizeAdjustments(records) });
  } catch (err) {
    next(err);
  }
});

router.post("/adjustments", async (req, res, next) => {
  try {
    const staff = await requireStaff(req.body?.staffRef);
    const month = normalizeMonth(req.body?.month || monthFromDate(req.body?.date));
    const label = String(req.body?.label || "").trim();
    const type = ["allowance", "deduction"].includes(String(req.body?.type || "")) ? String(req.body.type) : "allowance";
    const amountLKR = Math.max(0, toNumber(req.body?.amountLKR, 0));
    if (!label) return res.status(400).json({ message: "label is required" });
    if (!amountLKR) return res.status(400).json({ message: "amountLKR must be greater than 0" });

    const created = await StaffPayrollAdjustment.create({
      ...buildStaffSnapshot(staff),
      month,
      label,
      type,
      amountLKR,
      note: String(req.body?.note || "").trim(),
      sourceType: "manual",
      isSystemGenerated: false
    });
    res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
});

router.put("/adjustments/:id", async (req, res, next) => {
  try {
    const existing = await StaffPayrollAdjustment.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (String(existing.sourceType || "manual") !== "manual" || existing.isSystemGenerated === true) {
      return res.status(409).json({ message: "System-generated OT adjustments are read-only. Edit the appointment instead." });
    }
    const staff = await requireStaff(req.body?.staffRef || existing.staffRef);
    existing.staffRef = staff._id;
    existing.staffId = staff.staffId;
    existing.staffName = staff.name;
    existing.month = normalizeMonth(req.body?.month || existing.month);
    existing.label = String(req.body?.label || existing.label || "").trim();
    existing.type = ["allowance", "deduction"].includes(String(req.body?.type || existing.type))
      ? String(req.body?.type || existing.type)
      : "allowance";
    existing.amountLKR = Math.max(0, toNumber(req.body?.amountLKR, existing.amountLKR || 0));
    existing.note = String(req.body?.note || existing.note || "").trim();
    await existing.save();
    res.json(existing);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
});

router.delete("/adjustments/:id", async (req, res, next) => {
  try {
    const existing = await StaffPayrollAdjustment.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (String(existing.sourceType || "manual") !== "manual" || existing.isSystemGenerated === true) {
      return res.status(409).json({ message: "System-generated OT adjustments are removed automatically from the linked appointment." });
    }
    await existing.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/payroll", async (req, res, next) => {
  try {
    const month = normalizeMonth(req.query.month);
    const q = {};
    if (req.query.staffRef) q._id = req.query.staffRef;
    const staffList = await Staff.find(q).sort({ sortOrder: 1, name: 1 });

    const [attendanceList, workLogs, adjustments] = await Promise.all([
      StaffAttendance.find({ date: monthRegex(month), ...(req.query.staffRef ? { staffRef: req.query.staffRef } : {}) }),
      StaffWorkLog.find({ workDate: monthRegex(month), ...(req.query.staffRef ? { staffRef: req.query.staffRef } : {}) }),
      StaffPayrollAdjustment.find({ month, ...(req.query.staffRef ? { staffRef: req.query.staffRef } : {}) })
    ]);

    const summaries = staffList.map((staff) =>
      payrollSummaryForStaff(
        staff,
        attendanceList.filter((item) => String(item.staffRef) === String(staff._id)),
        workLogs.filter((item) => String(item.staffRef) === String(staff._id)),
        adjustments.filter((item) => String(item.staffRef) === String(staff._id))
      )
    );

    const totals = summaries.reduce(
      (acc, item) => {
        acc.staffCount += 1;
        acc.baseSalaryPayable += Number(item.baseSalaryPayable || 0);
        acc.commissionPayable += Number(item.commissionPayable || 0);
        acc.adjustmentsNet += Number(item.adjustments?.net || 0);
        acc.totalPayable += Number(item.totalPayable || 0);
        return acc;
      },
      { staffCount: 0, baseSalaryPayable: 0, commissionPayable: 0, adjustmentsNet: 0, totalPayable: 0 }
    );

    res.json({ month, summaries, totals });
  } catch (err) {
    next(err);
  }
});

// Helpful meta endpoint for future reporting
router.get("/month-range", async (req, res) => {
  const range = getMonthRange(req.query.month);
  res.json(range);
});

router.use((err, req, res, next) => {
  if (err?.status) return res.status(err.status).json({ message: err.message });
  return next(err);
});

module.exports = router;
