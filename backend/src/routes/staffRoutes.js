const express = require("express");
const Staff = require("../models/Staff");
const Appointment = require("../models/Appointment");
const StaffAttendance = require("../models/StaffAttendance");
const StaffWorkLog = require("../models/StaffWorkLog");
const StaffPayrollAdjustment = require("../models/StaffPayrollAdjustment");
const { authRequired, adminOrStaffManagerOnly } = require("../middleware/auth");
const {
  normalizeCompensation,
  normalizeServiceAssignments,
  staffHasConfiguredServices
} = require("../utils/staffManagement");
const { syncStaffAppointmentOvertimeAdjustments } = require("../utils/appointmentOvertime");

const router = express.Router();

function dedupeAssignments(assignments = []) {
  const map = new Map();
  for (const item of assignments) {
    const key = String(item?.serviceId || "").trim();
    if (!key) continue;
    map.set(key, item);
  }
  return Array.from(map.values());
}

function sanitizeStaffPayload(body = {}) {
  return {
    staffId: String(body.staffId || "").trim(),
    name: String(body.name || "").trim(),
    role: String(body.role || "").trim(),
    phone: String(body.phone || "").trim(),
    email: String(body.email || "").trim(),
    joinedDate: String(body.joinedDate || "").trim(),
    desc: String(body.desc || "").trim(),
    imgUrl: String(body.imgUrl || "").trim(),
    sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
    serviceAssignments: dedupeAssignments(normalizeServiceAssignments(body.serviceAssignments || [])),
    compensation: normalizeCompensation(body.compensation || {})
  };
}

function serializeAssignments(assignments = [], { publicView = false } = {}) {
  return (Array.isArray(assignments) ? assignments : [])
    .map((item) => {
      const service = item?.serviceId?._id ? item.serviceId : item?.service;
      if (publicView && service && service.isActive === false) return null;
      return {
        serviceId: service?._id || item?.serviceId || null,
        service: service
          ? {
              _id: service._id,
              category: service.category || "",
              name: service.name || "",
              priceLKR: Number(service.priceLKR || 0),
              durationMin: Number(service.durationMin || 0),
              isActive: service.isActive !== false
            }
          : null,
        customPriceLKR: item?.customPriceLKR ?? null,
        customDurationMin: item?.customDurationMin ?? null,
        commissionRatePct: item?.commissionRatePct ?? null,
        isActive: item?.isActive !== false
      };
    })
    .filter(Boolean);
}

function serializeStaff(doc, { publicView = false } = {}) {
  const obj = doc?.toObject ? doc.toObject() : { ...(doc || {}) };
  const base = {
    _id: obj._id,
    staffId: obj.staffId,
    name: obj.name,
    role: obj.role || "",
    phone: obj.phone || "",
    email: obj.email || "",
    joinedDate: obj.joinedDate || "",
    desc: obj.desc || "",
    imgUrl: obj.imgUrl || "",
    isActive: obj.isActive !== false,
    sortOrder: Number(obj.sortOrder || 0),
    serviceAssignments: serializeAssignments(obj.serviceAssignments || [], { publicView })
  };

  if (publicView) return base;

  return {
    ...base,
    compensation: normalizeCompensation(obj.compensation || {})
  };
}

async function getHistoryCounts(staff) {
  const staffId = String(staff?.staffId || "").trim();
  const staffRef = staff?._id || null;
  const [appointments, attendance, workLogs, adjustments] = await Promise.all([
    Appointment.countDocuments({ staffId }),
    staffRef ? StaffAttendance.countDocuments({ staffRef }) : 0,
    staffRef ? StaffWorkLog.countDocuments({ staffRef }) : 0,
    staffRef ? StaffPayrollAdjustment.countDocuments({ staffRef }) : 0
  ]);
  return { appointments, attendance, workLogs, adjustments, total: appointments + attendance + workLogs + adjustments };
}

async function fetchStaff(filter) {
  return Staff.find(filter)
    .populate({
      path: "serviceAssignments.serviceId",
      select: "category name priceLKR durationMin isActive"
    })
    .sort({ sortOrder: 1, name: 1 });
}

router.get("/", async (req, res, next) => {
  try {
    const serviceId = String(req.query.serviceId || "").trim();
    const list = await fetchStaff({ isActive: true });
    const payload = list
      .map((item) => serializeStaff(item, { publicView: true }))
      .filter((staff) => {
        if (!serviceId) return true;
        if (!staffHasConfiguredServices(staff)) return true;
        return (staff.serviceAssignments || []).some(
          (assignment) => assignment.isActive !== false && String(assignment.serviceId || assignment.service?._id || "") === serviceId
        );
      });
    res.json(payload);
  } catch (e) {
    next(e);
  }
});

router.get("/admin/all", authRequired, adminOrStaffManagerOnly, async (req, res, next) => {
  try {
    const list = await fetchStaff({});
    res.json(list.map((item) => serializeStaff(item)));
  } catch (e) {
    next(e);
  }
});

router.post("/admin", authRequired, adminOrStaffManagerOnly, async (req, res, next) => {
  try {
    const payload = sanitizeStaffPayload(req.body || {});
    if (!payload.staffId || !payload.name) {
      return res.status(400).json({ message: "staffId and name are required" });
    }

    const created = await Staff.create(payload);
    const loaded = await Staff.findById(created._id).populate({
      path: "serviceAssignments.serviceId",
      select: "category name priceLKR durationMin isActive"
    });
    res.status(201).json(serializeStaff(loaded));
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ message: "That Staff ID already exists." });
    }
    next(e);
  }
});

router.put("/admin/:id", authRequired, adminOrStaffManagerOnly, async (req, res, next) => {
  try {
    const existing = await Staff.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Not found" });

    const payload = sanitizeStaffPayload({ ...existing.toObject(), ...(req.body || {}) });
    if (!payload.staffId || !payload.name) {
      return res.status(400).json({ message: "staffId and name are required" });
    }

    if (String(payload.staffId) !== String(existing.staffId)) {
      const history = await getHistoryCounts(existing);
      if (history.total > 0) {
        return res.status(409).json({
          message: "This staff member already has booking/payroll history. Keep the Staff ID unchanged to preserve records."
        });
      }
    }

    existing.staffId = payload.staffId;
    existing.name = payload.name;
    existing.role = payload.role;
    existing.phone = payload.phone;
    existing.email = payload.email;
    existing.joinedDate = payload.joinedDate;
    existing.desc = payload.desc;
    existing.imgUrl = payload.imgUrl;
    existing.sortOrder = payload.sortOrder;
    existing.isActive = payload.isActive;
    existing.serviceAssignments = payload.serviceAssignments;
    existing.compensation = payload.compensation;
    await existing.save();
    await syncStaffAppointmentOvertimeAdjustments(existing.staffId);

    const loaded = await Staff.findById(existing._id).populate({
      path: "serviceAssignments.serviceId",
      select: "category name priceLKR durationMin isActive"
    });
    res.json(serializeStaff(loaded));
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ message: "That Staff ID already exists." });
    }
    next(e);
  }
});

router.delete("/admin/:id", authRequired, adminOrStaffManagerOnly, async (req, res, next) => {
  try {
    const staff = await Staff.findById(req.params.id);
    if (!staff) return res.status(404).json({ message: "Not found" });

    const history = await getHistoryCounts(staff);
    if (history.total > 0) {
      return res.status(409).json({
        message:
          "This staff member already has appointment, attendance, or payroll history. Set the profile to inactive instead of deleting it so past records stay correct."
      });
    }

    await Staff.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
