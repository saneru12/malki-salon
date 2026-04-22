function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toNullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function monthFromDate(value) {
  const s = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(0, 7) : "";
}

function normalizeMonth(value, fallback = null) {
  const s = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (fallback) return fallback;
  return new Date().toISOString().slice(0, 7);
}

function normalizeDate(value, fallback = "") {
  const s = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return fallback;
}

function getMonthRange(monthInput) {
  const month = normalizeMonth(monthInput);
  const [yy, mm] = month.split("-").map(Number);
  const start = `${month}-01`;
  const endDate = new Date(Date.UTC(yy, mm, 0));
  const end = `${month}-${String(endDate.getUTCDate()).padStart(2, "0")}`;
  return { month, start, end };
}

function attendanceUnit(status) {
  const value = String(status || "").trim();
  if (value === "present" || value === "paid_leave") return 1;
  if (value === "half_day") return 0.5;
  return 0;
}

function computeWorkedHours(attendance) {
  const inTime = String(attendance?.inTime || "").trim();
  const outTime = String(attendance?.outTime || "").trim();
  const inMatch = inTime.match(/^(\d{1,2}):(\d{2})$/);
  const outMatch = outTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!inMatch || !outMatch) return 0;
  const start = Number(inMatch[1]) * 60 + Number(inMatch[2]);
  const end = Number(outMatch[1]) * 60 + Number(outMatch[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Number(((end - start) / 60).toFixed(2));
}

function normalizeCompensation(raw = {}) {
  const payrollMode = ["salary_plus_commission", "salary_only", "commission_only"].includes(String(raw.payrollMode || ""))
    ? String(raw.payrollMode)
    : "salary_plus_commission";

  return {
    payrollMode,
    baseSalaryLKR: Math.max(0, toNumber(raw.baseSalaryLKR, 0)),
    defaultCommissionRatePct: Math.max(0, toNumber(raw.defaultCommissionRatePct, 0)),
    expectedWorkingDays: Math.max(1, toNumber(raw.expectedWorkingDays, 26)),
    overtimeDisabled: raw.overtimeDisabled === true || String(raw.overtimeDisabled || "").trim() === "true",
    overtimeHourlyRateLKR: Math.max(0, toNumber(raw.overtimeHourlyRateLKR, 0))
  };
}

function normalizeServiceAssignments(rawAssignments = []) {
  if (!Array.isArray(rawAssignments)) return [];
  return rawAssignments
    .map((item) => {
      const serviceId = String(item?.serviceId || item?.service?._id || item?.service?._id || "").trim();
      if (!serviceId) return null;
      return {
        serviceId,
        customPriceLKR: toNullableNumber(item.customPriceLKR),
        customDurationMin: toNullableNumber(item.customDurationMin),
        commissionRatePct: toNullableNumber(item.commissionRatePct),
        isActive: item?.isActive !== false
      };
    })
    .filter(Boolean);
}

function staffHasConfiguredServices(staff) {
  const assignments = Array.isArray(staff?.serviceAssignments) ? staff.serviceAssignments : [];
  return assignments.some((item) => item && item.isActive !== false && item.serviceId);
}

function resolveStaffServiceConfig(staff, service) {
  const serviceId = String(service?._id || service || "").trim();
  const compensation = normalizeCompensation(staff?.compensation || {});
  const defaults = {
    allowed: true,
    customPriceLKR: null,
    customDurationMin: null,
    commissionRatePct: compensation.defaultCommissionRatePct
  };

  const assignments = Array.isArray(staff?.serviceAssignments) ? staff.serviceAssignments : [];
  const activeAssignments = assignments.filter((item) => item && item.isActive !== false && item.serviceId);
  if (!activeAssignments.length) return defaults;

  const match = activeAssignments.find((item) => String(item.serviceId?._id || item.serviceId) === serviceId);
  if (!match) {
    return { ...defaults, allowed: false };
  }

  return {
    allowed: true,
    customPriceLKR: toNullableNumber(match.customPriceLKR),
    customDurationMin: toNullableNumber(match.customDurationMin),
    commissionRatePct: toNullableNumber(match.commissionRatePct) ?? compensation.defaultCommissionRatePct
  };
}

function getServiceDurationForStaff(staff, service) {
  const cfg = resolveStaffServiceConfig(staff, service);
  return cfg.customDurationMin || Math.max(15, toNumber(service?.durationMin, 30));
}

function getServicePriceForStaff(staff, service) {
  const cfg = resolveStaffServiceConfig(staff, service);
  return cfg.customPriceLKR || Math.max(0, toNumber(service?.priceLKR, 0));
}

function buildStaffSnapshot(staff) {
  return {
    staffRef: staff?._id || null,
    staffId: String(staff?.staffId || "").trim(),
    staffName: String(staff?.name || "").trim()
  };
}

function buildServiceSnapshot(service) {
  return {
    serviceRef: service?._id || null,
    serviceName: String(service?.name || "").trim(),
    serviceCategory: String(service?.category || "").trim()
  };
}

function calculateCommissionAmount({ grossAmountLKR = 0, ratePct = 0 }) {
  const gross = Math.max(0, toNumber(grossAmountLKR, 0));
  const rate = Math.max(0, toNumber(ratePct, 0));
  return Number(((gross * rate) / 100).toFixed(2));
}

module.exports = {
  toNumber,
  toNullableNumber,
  monthFromDate,
  normalizeMonth,
  normalizeDate,
  getMonthRange,
  attendanceUnit,
  computeWorkedHours,
  normalizeCompensation,
  normalizeServiceAssignments,
  staffHasConfiguredServices,
  resolveStaffServiceConfig,
  getServiceDurationForStaff,
  getServicePriceForStaff,
  buildStaffSnapshot,
  buildServiceSnapshot,
  calculateCommissionAmount
};
