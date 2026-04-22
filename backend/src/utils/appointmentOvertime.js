const Appointment = require("../models/Appointment");
const Staff = require("../models/Staff");
const Service = require("../models/Service");
const Settings = require("../models/Settings");
const StaffPayrollAdjustment = require("../models/StaffPayrollAdjustment");
const {
  monthFromDate,
  normalizeCompensation,
  resolveStaffServiceConfig,
  getServiceDurationForStaff,
  getServicePriceForStaff,
  buildStaffSnapshot
} = require("./staffManagement");

const DEFAULT_REGULAR_START = "08:00";
const DEFAULT_REGULAR_END = "17:00";
const DEFAULT_OT_MULTIPLIER = 1.5;

function parseTimeToMin(value) {
  const t = String(value || "").trim();
  if (t === "24:00") return 24 * 60;
  const match = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return NaN;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return NaN;
  return hh * 60 + mm;
}

function minToTime(min) {
  const value = Math.max(0, Math.min(24 * 60, Math.floor(Number(min) || 0)));
  if (value === 24 * 60) return "24:00";
  const hh = String(Math.floor(value / 60)).padStart(2, "0");
  const mm = String(value % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function roundMoney(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function roundHoursFromMinutes(minutes) {
  return Number(((Math.max(0, Number(minutes) || 0)) / 60).toFixed(2));
}

function getRegularWindow(settings) {
  let start = String(settings?.openTime || DEFAULT_REGULAR_START).trim();
  let end = String(settings?.closeTime || DEFAULT_REGULAR_END).trim();
  let startMin = parseTimeToMin(start);
  let endMin = parseTimeToMin(end);

  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) {
    start = DEFAULT_REGULAR_START;
    end = DEFAULT_REGULAR_END;
    startMin = parseTimeToMin(start);
    endMin = parseTimeToMin(end);
  }

  return { start, end, startMin, endMin };
}

function computeOutsideWindowMinutes(startMin, endMin, regularStartMin, regularEndMin) {
  const beforeMinutes = startMin < regularStartMin
    ? Math.max(0, Math.min(endMin, regularStartMin) - startMin)
    : 0;

  const afterMinutes = endMin > regularEndMin
    ? Math.max(0, endMin - Math.max(startMin, regularEndMin))
    : 0;

  return {
    beforeMinutes,
    afterMinutes,
    totalMinutes: beforeMinutes + afterMinutes
  };
}

async function getSettingsDoc() {
  try {
    return await Settings.findOne({ key: "default" }).lean();
  } catch {
    return null;
  }
}

function buildRateSourceLabel(rateSource) {
  if (rateSource === "salary_hourly") return "base salary hourly rate";
  if (rateSource === "commission_hourly") return "estimated commission hourly rate";
  if (rateSource === "manual_staff_ot_hourly") return "manual staff OT hourly rate";
  return "unavailable";
}

function computeOvertimePlan({ appointment, staff, service, settings }) {
  if (!appointment || !appointment._id) {
    return { action: "delete", reason: "Appointment not found." };
  }

  if (String(appointment.status || "") !== "approved") {
    return { action: "delete", reason: "Appointment is not approved." };
  }

  if (appointment.allowAnyTimeBooking !== true) {
    return { action: "delete", reason: "Appointment is not a 24/7 booking." };
  }

  if (!staff) {
    return { action: "delete", reason: "Linked staff member not found." };
  }

  const month = monthFromDate(appointment.date);
  if (!month) {
    return { action: "delete", reason: "Appointment date is invalid." };
  }

  const regularWindow = getRegularWindow(settings);
  const startMin = parseTimeToMin(appointment.time);
  if (!Number.isFinite(startMin)) {
    return { action: "delete", reason: "Appointment time is missing or invalid." };
  }

  let durationMin = Math.max(0, Number(appointment.durationMin || 0));
  if (!durationMin && service) {
    durationMin = getServiceDurationForStaff(staff, service);
  }

  let endMin = parseTimeToMin(appointment.endTime);
  if (!Number.isFinite(endMin) || endMin <= startMin) {
    endMin = startMin + durationMin;
  }

  if (!Number.isFinite(endMin) || endMin <= startMin) {
    return { action: "delete", reason: "Appointment end time cannot be determined." };
  }

  const outside = computeOutsideWindowMinutes(startMin, endMin, regularWindow.startMin, regularWindow.endMin);
  if (outside.totalMinutes <= 0) {
    return { action: "delete", reason: "Appointment stays fully inside normal working hours." };
  }

  const compensation = normalizeCompensation(staff.compensation || {});
  if (compensation.overtimeDisabled) {
    return { action: "delete", reason: "Staff overtime is disabled." };
  }

  const regularDayMinutes = Math.max(60, regularWindow.endMin - regularWindow.startMin);
  const dayRateLKR = compensation.expectedWorkingDays > 0
    ? compensation.baseSalaryLKR / compensation.expectedWorkingDays
    : 0;
  const salaryHourlyRateLKR = dayRateLKR > 0
    ? dayRateLKR / (regularDayMinutes / 60)
    : 0;

  let estimatedCommissionHourlyRateLKR = 0;
  let commissionRatePct = Math.max(0, Number(compensation.defaultCommissionRatePct || 0));
  let servicePriceLKR = 0;
  let serviceRef = null;
  let serviceName = String(appointment.serviceName || "").trim();

  if (service) {
    const cfg = resolveStaffServiceConfig(staff, service);
    commissionRatePct = Math.max(0, Number((cfg.allowed ? cfg.commissionRatePct : compensation.defaultCommissionRatePct) || 0));
    servicePriceLKR = Math.max(0, Number(cfg.allowed ? getServicePriceForStaff(staff, service) : service.priceLKR || 0));
    const rateDurationMin = Math.max(1, Number(durationMin || getServiceDurationForStaff(staff, service) || service.durationMin || 0));
    const estimatedCommissionLKR = (servicePriceLKR * commissionRatePct) / 100;
    estimatedCommissionHourlyRateLKR = estimatedCommissionLKR > 0
      ? estimatedCommissionLKR / (rateDurationMin / 60)
      : 0;
    serviceRef = service._id || null;
    serviceName = String(service.name || serviceName || "").trim();
  }

  let rateSource = "unknown";
  let referenceHourlyRateLKR = 0;
  let overtimeMultiplier = DEFAULT_OT_MULTIPLIER;
  let overtimeHourlyRateLKR = 0;
  const manualOvertimeHourlyRateLKR = Math.max(0, Number(compensation.overtimeHourlyRateLKR || 0));

  if (manualOvertimeHourlyRateLKR > 0) {
    rateSource = "manual_staff_ot_hourly";
    referenceHourlyRateLKR = manualOvertimeHourlyRateLKR;
    overtimeMultiplier = 1;
    overtimeHourlyRateLKR = manualOvertimeHourlyRateLKR;
  } else if (salaryHourlyRateLKR > 0) {
    rateSource = "salary_hourly";
    referenceHourlyRateLKR = salaryHourlyRateLKR;
    overtimeHourlyRateLKR = referenceHourlyRateLKR * overtimeMultiplier;
  } else if (estimatedCommissionHourlyRateLKR > 0) {
    rateSource = "commission_hourly";
    referenceHourlyRateLKR = estimatedCommissionHourlyRateLKR;
    overtimeHourlyRateLKR = referenceHourlyRateLKR * overtimeMultiplier;
  }

  const amountLKR = roundMoney((outside.totalMinutes / 60) * overtimeHourlyRateLKR);
  const endTime = Number.isFinite(endMin) ? minToTime(endMin) : String(appointment.endTime || "").trim();

  const rateExplanation = rateSource === "manual_staff_ot_hourly"
    ? `Rate source: ${buildRateSourceLabel(rateSource)}.${overtimeHourlyRateLKR > 0 ? ` LKR ${roundMoney(overtimeHourlyRateLKR)}/h.` : ""}`
    : `Rate source: ${buildRateSourceLabel(rateSource)}.` +
      (referenceHourlyRateLKR > 0 ? ` Reference LKR ${roundMoney(referenceHourlyRateLKR)}/h × ${overtimeMultiplier}.` : "");

  const note = [
    `Auto-generated OT for approved 24/7 booking on ${String(appointment.date || "")} ${String(appointment.time || "")}${endTime ? `-${endTime}` : ""}.`,
    `Normal hours: ${regularWindow.start}-${regularWindow.end}.`,
    `Outside-hours OT: ${roundHoursFromMinutes(outside.totalMinutes)}h` +
      (outside.beforeMinutes ? ` (before open ${roundHoursFromMinutes(outside.beforeMinutes)}h)` : "") +
      (outside.afterMinutes ? ` (after close ${roundHoursFromMinutes(outside.afterMinutes)}h)` : "") + ".",
    rateExplanation
  ].join(" ");

  return {
    action: "upsert",
    payload: {
      ...buildStaffSnapshot(staff),
      month,
      label: `Outside-hours OT • ${serviceName || "24/7 booking"}`,
      type: "allowance",
      amountLKR,
      note,
      sourceType: "appointment_overtime",
      isSystemGenerated: true,
      sourceAppointmentId: appointment._id,
      bookingMode: String(appointment.bookingMode || "").trim(),
      appointmentDate: String(appointment.date || "").trim(),
      appointmentTime: String(appointment.time || "").trim(),
      appointmentEndTime: endTime,
      serviceRef,
      serviceName,
      overtimeMinutes: outside.totalMinutes,
      overtimeBeforeMinutes: outside.beforeMinutes,
      overtimeAfterMinutes: outside.afterMinutes,
      regularWindowStart: regularWindow.start,
      regularWindowEnd: regularWindow.end,
      rateSource,
      referenceHourlyRateLKR: roundMoney(referenceHourlyRateLKR),
      overtimeMultiplier,
      overtimeHourlyRateLKR: roundMoney(overtimeHourlyRateLKR)
    }
  };
}

async function purgeAppointmentOvertimeAdjustment(appointmentId) {
  if (!appointmentId) return { action: "delete", removedCount: 0 };
  const result = await StaffPayrollAdjustment.deleteOne({ sourceAppointmentId: appointmentId });
  return { action: "delete", removedCount: Number(result.deletedCount || 0) };
}

async function syncAppointmentOvertimeAdjustment(appointmentOrId, options = {}) {
  const looksLikeAppointment = Boolean(
    appointmentOrId &&
      typeof appointmentOrId === "object" &&
      (typeof appointmentOrId.toObject === "function" || Object.prototype.hasOwnProperty.call(appointmentOrId, "_id"))
  );

  const appointment = looksLikeAppointment
    ? (appointmentOrId.toObject ? appointmentOrId.toObject() : appointmentOrId)
    : await Appointment.findById(appointmentOrId).lean();

  if (!appointment || !appointment._id) {
    return purgeAppointmentOvertimeAdjustment(appointmentOrId);
  }

  const staffId = String(appointment.staffId || "").trim();
  const serviceId = appointment.serviceId?._id || appointment.serviceId || null;
  const [staff, service, settings] = await Promise.all([
    staffId ? Staff.findOne({ staffId }).lean() : null,
    serviceId ? Service.findById(serviceId).lean() : null,
    options.settings || getSettingsDoc()
  ]);

  const plan = computeOvertimePlan({ appointment, staff, service, settings });
  if (plan.action === "delete") {
    const removed = await purgeAppointmentOvertimeAdjustment(appointment._id);
    return { ...plan, removedCount: removed.removedCount };
  }

  const adjustment = await StaffPayrollAdjustment.findOneAndUpdate(
    { sourceAppointmentId: appointment._id },
    { $set: plan.payload },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true
    }
  );

  return { ...plan, adjustmentId: adjustment?._id || null };
}

async function syncStaffAppointmentOvertimeAdjustments(staffPublicId, options = {}) {
  const staffId = String(staffPublicId || "").trim();
  if (!staffId) {
    return { processed: 0, upserted: 0, removed: 0 };
  }

  const settings = options.settings || await getSettingsDoc();
  const appointments = await Appointment.find({ staffId }).lean();
  let upserted = 0;
  let removed = 0;

  for (const appointment of appointments) {
    const result = await syncAppointmentOvertimeAdjustment(appointment, { settings });
    if (result.action === "upsert") upserted += 1;
    if (result.action === "delete") removed += Number(result.removedCount || 0);
  }

  return {
    processed: appointments.length,
    upserted,
    removed
  };
}

async function syncAllAppointmentOvertimeAdjustments() {
  const settings = await getSettingsDoc();
  const appointments = await Appointment.find({}).lean();
  let upserted = 0;
  let removed = 0;

  for (const appointment of appointments) {
    const result = await syncAppointmentOvertimeAdjustment(appointment, { settings });
    if (result.action === "upsert") upserted += 1;
    if (result.action === "delete") removed += Number(result.removedCount || 0);
  }

  const existingAppointments = new Set(appointments.map((item) => String(item._id)));
  const orphanResult = await StaffPayrollAdjustment.deleteMany({
    sourceType: "appointment_overtime",
    sourceAppointmentId: {
      $nin: Array.from(existingAppointments)
    }
  });

  return {
    processed: appointments.length,
    upserted,
    removed,
    removedOrphans: Number(orphanResult.deletedCount || 0)
  };
}

module.exports = {
  parseTimeToMin,
  minToTime,
  computeOvertimePlan,
  syncAppointmentOvertimeAdjustment,
  purgeAppointmentOvertimeAdjustment,
  syncStaffAppointmentOvertimeAdjustments,
  syncAllAppointmentOvertimeAdjustments
};
