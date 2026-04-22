function getCustomerToken() {
  return localStorage.getItem("malki_customer_token") || "";
}

function getCustomerObj() {
  try {
    return JSON.parse(localStorage.getItem("malki_customer") || "null");
  } catch {
    return null;
  }
}

function authHeaders(extra = {}) {
  const token = getCustomerToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

let MAX_APPOINTMENTS_PER_DAY = 4;
let OPEN_TIME = "08:00";
let CLOSE_TIME = "17:00";
let MANUAL_REQUEST_OPEN_TIME = "08:00";
let MANUAL_REQUEST_CLOSE_TIME = "17:00";
let SLOT_INTERVAL_MIN = 15;
let TIME_SLOTS = ["09:00", "11:00", "13:00", "15:00"];
const SALON_TIMEZONE = "Asia/Colombo";

let STAFF = [];
let SERVICES = [];
let selectedStaff = null;
let selectedFlow = null;
let selectedManualPhotos = [];

const FLOW_META = {
  manual: {
    title: "Hair consultation request",
    desc: "Upload hair photos, choose only your preferred date, and let the salon send an exact time proposal to My Account.",
    badge: "Manual review"
  },
  instant: {
    title: "Regular appointment",
    desc: "Book a fixed-time service with real-time slot availability during normal salon hours.",
    badge: "Instant"
  },
  anytime: {
    title: "Normal / bridal dressing",
    desc: "Exact slot booking with 24-hour time selection for services that may start very early or late.",
    badge: "24/7 booking"
  }
};

function getTimeZoneParts(value = new Date(), timeZone = SALON_TIMEZONE) {
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
  const lookup = {};
  for (const part of formatter.formatToParts(value)) lookup[part.type] = part.value;
  const date = `${lookup.year}-${lookup.month}-${lookup.day}`;
  const hour = Number(lookup.hour || 0) % 24;
  const minute = Number(lookup.minute || 0);
  return {
    date,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    minutes: hour * 60 + minute
  };
}

function getSalonNowMeta() {
  return getTimeZoneParts(new Date(), SALON_TIMEZONE);
}

function addDaysToISODate(isoDate, days = 0) {
  const base = new Date(`${String(isoDate).slice(0, 10)}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}

function localDateString(value = new Date()) {
  if (typeof value === "string") return String(value).slice(0, 10);
  return getTimeZoneParts(value, SALON_TIMEZONE).date;
}

function chip(text, kind = "") {
  return `<span class="chip ${kind}">${text}</span>`;
}

function parseTimeToMin(value) {
  const t = String(value || "").trim();
  if (t === "24:00") return 24 * 60;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
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

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function serviceText(service) {
  return `${service?.category || ""} ${service?.name || ""}`.toLowerCase();
}

function getServiceBookingMode(service) {
  const explicit = String(service?.bookingMode || "").trim();
  if (explicit === "manual-review" || explicit === "instant") return explicit;
  return /(straight|rebond|relax|keratin)/i.test(serviceText(service)) ? "manual-review" : "instant";
}

function serviceAllowsAnyTime(service) {
  if (service?.allowAnyTimeBooking === true) return true;
  return /(bridal dressing|normal dressing)/i.test(serviceText(service));
}

function serviceRequiresPhotoUpload(service) {
  return service?.requiresPhotoUpload === true || getServiceBookingMode(service) === "manual-review";
}

function getServiceFlow(service) {
  if (getServiceBookingMode(service) === "manual-review") return "manual";
  if (serviceAllowsAnyTime(service)) return "anytime";
  return "instant";
}

function getInstantWindow(service) {
  if (serviceAllowsAnyTime(service)) return { open: "00:00", close: "24:00" };
  return { open: OPEN_TIME, close: CLOSE_TIME };
}

function getGroupedServices(staff = selectedStaff) {
  const pool = getServicesForStaff(staff);
  return {
    manual: pool.filter((s) => getServiceFlow(s) === "manual"),
    instant: pool.filter((s) => getServiceFlow(s) === "instant"),
    anytime: pool.filter((s) => getServiceFlow(s) === "anytime")
  };
}

function getSelectedService() {
  const serviceId = document.getElementById("serviceId")?.value || "";
  return SERVICES.find((item) => String(item._id) === String(serviceId)) || null;
}

function getStaffAssignments(staff) {
  return (Array.isArray(staff?.serviceAssignments) ? staff.serviceAssignments : []).filter(
    (item) => item && item.isActive !== false && (item.service || item.serviceId)
  );
}

function staffHasAssignedServices(staff) {
  return getStaffAssignments(staff).length > 0;
}

function getAssignmentServiceId(assignment) {
  return String(assignment?.service?._id || assignment?.serviceId || "");
}

function getStaffAssignmentForService(staff, serviceId) {
  const target = String(serviceId || "");
  return getStaffAssignments(staff).find((item) => getAssignmentServiceId(item) === target) || null;
}

function staffOffersService(staff, serviceId) {
  if (!staff) return true;
  if (!staffHasAssignedServices(staff)) return true;
  return Boolean(getStaffAssignmentForService(staff, serviceId));
}

function getServicesForStaff(staff) {
  if (!staff) return SERVICES.slice();
  if (!staffHasAssignedServices(staff)) return SERVICES.slice();
  const allowed = new Set(getStaffAssignments(staff).map((item) => getAssignmentServiceId(item)));
  return SERVICES.filter((service) => allowed.has(String(service._id)));
}

function getServiceDurationForStaff(staff, service) {
  const assignment = getStaffAssignmentForService(staff, service?._id);
  return Number(assignment?.customDurationMin || service?.durationMin || 30);
}

function getServicePriceForStaff(staff, service) {
  const assignment = getStaffAssignmentForService(staff, service?._id);
  return Number(assignment?.customPriceLKR ?? service?.priceLKR ?? 0);
}

function setDayStatus(isFull, count) {
  const dayStatus = document.getElementById("dayStatus");
  const countStatus = document.getElementById("countStatus");
  if (!dayStatus || !countStatus) return;
  dayStatus.className = `badge ${isFull ? "badge-danger" : "badge-success"}`;
  dayStatus.textContent = isFull ? "Fully booked" : "Available";
  countStatus.textContent = `${Number(count || 0)} / ${MAX_APPOINTMENTS_PER_DAY} active bookings for this staff member`;
}

function setSubmitEnabled(enabled) {
  const btn = document.getElementById("submitBtn");
  if (!btn) return;
  btn.disabled = !enabled;
  btn.style.opacity = enabled ? "1" : ".6";
  btn.style.cursor = enabled ? "pointer" : "not-allowed";
}

function formatApptLine(a) {
  const end = a.endTime ? `-${a.endTime}` : "";
  return `${a.time}${end} • ${a.customerName} • ${a.serviceName} (${a.status})`;
}

async function loadBookingConfig() {
  try {
    const sRes = await fetch(`${API_BASE}/settings`);
    if (sRes.ok) {
      const s = await sRes.json();
      if (s && Number(s.maxAppointmentsPerDay)) MAX_APPOINTMENTS_PER_DAY = Number(s.maxAppointmentsPerDay);
      if (s?.openTime) OPEN_TIME = String(s.openTime);
      if (s?.closeTime) CLOSE_TIME = String(s.closeTime);
      if (s?.manualRequestOpenTime) MANUAL_REQUEST_OPEN_TIME = String(s.manualRequestOpenTime);
      if (s?.manualRequestCloseTime) MANUAL_REQUEST_CLOSE_TIME = String(s.manualRequestCloseTime);
      if (Number.isFinite(Number(s?.slotIntervalMin)) && Number(s.slotIntervalMin) > 0) SLOT_INTERVAL_MIN = Number(s.slotIntervalMin);
      if (Array.isArray(s?.timeSlots) && s.timeSlots.length) TIME_SLOTS = s.timeSlots.map(String);
    }
  } catch {}

  try {
    const stRes = await fetch(`${API_BASE}/staff`);
    if (stRes.ok) {
      const list = await stRes.json();
      STAFF = (list || []).map((x) => ({
        id: x.staffId,
        name: x.name,
        role: x.role || "",
        desc: x.desc || "",
        img: x.imgUrl || "",
        _id: x._id,
        serviceAssignments: (x.serviceAssignments || []).map((item) => ({
          serviceId: item.service?._id || item.serviceId || null,
          service: item.service || null,
          customPriceLKR: item.customPriceLKR ?? null,
          customDurationMin: item.customDurationMin ?? null,
          commissionRatePct: item.commissionRatePct ?? null,
          isActive: item.isActive !== false
        }))
      }));
    }
  } catch {}

  if (!STAFF.length) {
    STAFF = [
      { id: "staff1", name: "Malki", role: "Senior Stylist", desc: "Haircuts, bridal styling, and color consultation.", img: "assets/img/staff1.svg" },
      { id: "staff2", name: "Nethmi", role: "Makeup Artist", desc: "Party makeup, bridal makeup, and skincare prep.", img: "assets/img/staff2.svg" },
      { id: "staff3", name: "Sewwandi", role: "Nail & Beauty", desc: "Manicure, pedicure, waxing, and facials.", img: "assets/img/staff3.svg" }
    ];
  }

  try {
    SERVICES = await loadServicesToPage(null, null);
  } catch {
    SERVICES = [];
  }
}

async function fetchAppointmentsByDate(dateStr, staffId = null) {
  const qs = new URLSearchParams({ date: dateStr });
  if (staffId) qs.set("staffId", staffId);
  const res = await fetch(`${API_BASE}/appointments?${qs.toString()}`);
  if (!res.ok) throw new Error("Failed to load appointments");
  return res.json();
}

async function fetchAppointmentsForTodayByStaff() {
  const today = localDateString();
  const results = {};
  for (const s of STAFF) {
    try {
      results[s.id] = await fetchAppointmentsByDate(today, s.id);
    } catch {
      results[s.id] = [];
    }
  }
  return { today, results };
}

async function computeAvailability(staffId, service, nextDays = 14) {
  const salonNow = getSalonNowMeta();
  const dates = [];
  const staff = STAFF.find((item) => item.id === staffId) || selectedStaff || null;
  for (let i = 0; i < nextDays; i += 1) {
    dates.push(addDaysToISODate(salonNow.date, i));
  }

  const bookedByDate = new Map();
  const fullDates = new Set();

  for (const ds of dates) {
    try {
      const appts = await fetchAppointmentsByDate(ds, staffId);
      const times = (appts || []).map((a) => a.time).filter(Boolean).sort();
      bookedByDate.set(ds, times);

      if (!service) {
        if (times.length >= MAX_APPOINTMENTS_PER_DAY) fullDates.add(ds);
        continue;
      }

      const isFull = times.length >= MAX_APPOINTMENTS_PER_DAY;
      const durationMin = getServiceDurationForStaff(staff, service);
      const bookedIntervals = (appts || []).map((a) => {
        const s = parseTimeToMin(a.time);
        const d = Number(a.durationMin) || 30;
        const e = parseTimeToMin(a.endTime) || (Number.isFinite(s) ? s + d : NaN);
        return { start: s, end: e };
      }).filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end));

      const windowCfg = getInstantWindow(service);
      const openMin = parseTimeToMin(windowCfg.open);
      const closeMin = parseTimeToMin(windowCfg.close);
      let hasSlot = false;
      if (!isFull && Number.isFinite(openMin) && Number.isFinite(closeMin)) {
        const step = Number.isFinite(SLOT_INTERVAL_MIN) && SLOT_INTERVAL_MIN > 0 ? SLOT_INTERVAL_MIN : 15;
        for (let t = openMin; t <= closeMin - durationMin; t += step) {
          if (ds === salonNow.date && t < salonNow.minutes) continue;
          const end = t + durationMin;
          if (!bookedIntervals.some((b) => intervalsOverlap(t, end, b.start, b.end))) {
            hasSlot = true;
            break;
          }
        }
      }

      if (!hasSlot) fullDates.add(ds);
    } catch {
      bookedByDate.set(ds, []);
    }
  }

  return { dates, bookedByDate, fullDates };
}

function staffDomId(staffId) {
  return `staffBookings_${String(staffId || "").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function renderStaffCards() {
  const grid = document.getElementById("staffGrid");
  if (!grid) return;

  grid.innerHTML = STAFF.map((s) => {
    const availableServices = getServicesForStaff(s);
    const countLabel = staffHasAssignedServices(s)
      ? `${availableServices.length} assigned service${availableServices.length === 1 ? "" : "s"}`
      : `${SERVICES.length} active service${SERVICES.length === 1 ? "" : "s"}`;
    const preview = availableServices.slice(0, 3).map((item) => item.name).join(" • ");
    return `
      <div class="card staff-card" data-staff="${s.id}" role="button" tabindex="0" aria-label="Select ${s.name}">
        <img src="${imgUrl(s.img) || s.img}" alt="${s.name}" />
        <div class="card-body">
          <div class="staff-meta">
            <div>
              <h3 style="margin:0 0 4px">${s.name}</h3>
              <div class="muted">${s.role}</div>
            </div>
            <span class="staff-pill">Select</span>
          </div>
          <div class="muted" style="margin-top:10px">${s.desc}</div>
          <div class="muted" style="margin-top:10px"><b>Services:</b> ${countLabel}</div>
          <div class="muted" style="margin-top:6px">${preview || "No services assigned yet"}${availableServices.length > 3 ? " • ..." : ""}</div>
        </div>
      </div>
    `;
  }).join("");

  function chooseStaff(staffId) {
    selectedStaff = STAFF.find((x) => x.id === staffId) || null;
    if (!selectedStaff) return;
    grid.querySelectorAll(".staff-card").forEach((c) => {
      c.classList.toggle("selected", c.getAttribute("data-staff") === staffId);
    });
    const pillEl = document.getElementById("selectedStaffPill");
    if (pillEl) {
      pillEl.style.display = "inline-flex";
      pillEl.textContent = `Selected: ${selectedStaff.name}`;
    }
  }

  grid.querySelectorAll(".staff-card").forEach((card) => {
    const pick = () => {
      if (!getCustomerToken()) {
        alert("Booking එකක් දාන්න login වෙන්න ඕනේ.");
        try {
          if (typeof requireCustomer === "function") requireCustomer();
        } catch {}
        return;
      }
      const staffId = card.getAttribute("data-staff");
      const staff = STAFF.find((x) => x.id === staffId) || null;
      if (staff && getServicesForStaff(staff).length === 0) {
        alert("මෙම staff member ට තව service assign කරලා නැහැ. Admin panel එකෙන් services assign කරන්න.");
        return;
      }
      chooseStaff(staffId);
      showBookingForm();
    };
    card.addEventListener("click", pick);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pick();
      }
    });
  });
}

function renderTodayBookingsCards() {
  const grid = document.getElementById("todayBookingsGrid");
  if (!grid) return;
  if (!STAFF.length) {
    grid.innerHTML = `<div class="muted">No staff members found. Add staff from the admin panel.</div>`;
    return;
  }

  grid.innerHTML = STAFF.map(
    (s, idx) => `
      <div class="card" style="padding:14px;">
        <div class="badge">Staff ${idx + 1}</div>
        <h3 style="margin:0 0 8px;">${s.name}</h3>
        <textarea id="${staffDomId(s.id)}" readonly placeholder="No bookings yet..."></textarea>
      </div>
    `
  ).join("");
}

async function refreshTodayFields() {
  renderTodayBookingsCards();
  const { today, results } = await fetchAppointmentsForTodayByStaff();
  for (const s of STAFF) {
    const ta = document.getElementById(staffDomId(s.id));
    if (!ta) continue;
    const list = (results[s.id] || []).sort((a, b) => String(a.time).localeCompare(String(b.time)));
    ta.value = list.length ? list.map(formatApptLine).join("\n") : `No bookings for ${today}`;
  }
}

function buildManualWindowOptions() {
  return [];
}

function renderManualWindowSelect() {}

function renderCategoryCards() {
  const grid = document.getElementById("bookingCategoryGrid");
  if (!grid) return;
  const groups = getGroupedServices(selectedStaff);
  const availableFlows = Object.keys(FLOW_META).filter((key) => groups[key].length > 0);
  if (!selectedFlow || !availableFlows.includes(selectedFlow)) {
    selectedFlow = availableFlows[0] || "manual";
  }

  grid.innerHTML = Object.entries(FLOW_META).map(([key, meta]) => {
    const count = groups[key].length;
    const disabled = count === 0;
    return `
      <button
        type="button"
        class="flow-card ${selectedFlow === key ? "active" : ""} ${disabled ? "disabled" : ""}"
        data-flow="${key}"
        ${disabled ? "disabled" : ""}
      >
        <div class="flow-top">
          <span class="badge">${meta.badge}</span>
          <span class="muted">${count} service${count === 1 ? "" : "s"}</span>
        </div>
        <h4>${meta.title}</h4>
        <div class="muted">${meta.desc}</div>
      </button>
    `;
  }).join("");

  grid.querySelectorAll("button[data-flow]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const flow = btn.getAttribute("data-flow");
      if (!getGroupedServices(selectedStaff)[flow]?.length) return;
      selectedFlow = flow;
      renderCategoryCards();
      renderServiceOptions();
      updateFlowUI();
      if (selectedFlow !== "manual") refreshInstantAvailability();
      setStatusText("", "");
    });
  });
}

function renderServiceOptions(preselectId = "") {
  const sel = document.getElementById("serviceId");
  if (!sel) return;
  const groups = getGroupedServices(selectedStaff);
  const list = groups[selectedFlow] || [];
  if (!list.length) {
    sel.innerHTML = `<option value="">No services available for this staff member in this category</option>`;
    return;
  }

  let selectedId = preselectId || sel.value;
  if (!list.some((item) => String(item._id) === String(selectedId))) {
    selectedId = String(list[0]._id);
  }

  sel.innerHTML = `<option value="">-- Select a service --</option>` + list.map((s) => {
    const displayPrice = getServicePriceForStaff(selectedStaff, s);
    const duration = getServiceDurationForStaff(selectedStaff, s);
    return `<option value="${s._id}" ${String(s._id) === String(selectedId) ? "selected" : ""}>${s.category} - ${s.name} (LKR ${displayPrice} • ${duration} min)</option>`;
  }).join("");
}

function renderServiceMeta(service) {
  const meta = document.getElementById("serviceMeta");
  if (!meta) return;
  if (!service) {
    meta.textContent = "Select a service to see booking rules.";
    return;
  }

  const modeText = getServiceFlow(service) === "manual"
    ? "Manual review request · choose your preferred date only"
    : serviceAllowsAnyTime(service)
      ? "Instant slot booking · exact times available 24 hours"
      : `Instant slot booking · salon hours ${OPEN_TIME}-${CLOSE_TIME}`;

  const priceText = `Price: LKR ${getServicePriceForStaff(selectedStaff, service)}`;
  const durationText = getServiceFlow(service) === "manual"
    ? "Exact duration will be finalized after photo review"
    : `Duration: ${getServiceDurationForStaff(selectedStaff, service)} minutes`;

  meta.textContent = `${modeText} · ${durationText} · ${priceText}`;
}

function renderBookedTimes(times) {
  const wrap = document.getElementById("bookedTimes");
  if (!wrap) return;
  if (!times || !times.length) {
    wrap.innerHTML = chip("No bookings yet", "ok");
    return;
  }
  wrap.innerHTML = times.map((t) => chip(t, "warn")).join("");
}

function renderAvailableDates(dates, fullDates) {
  const wrap = document.getElementById("availableDates");
  if (!wrap) return;

  const available = dates.filter((d) => !fullDates.has(d));
  if (!available.length) {
    wrap.innerHTML = chip("No available dates in the next 14 days", "danger");
    return;
  }

  wrap.innerHTML = available.map((d) => `<button type="button" class="chip chip-btn" data-date="${d}">${d}</button>`).join("");
  wrap.querySelectorAll("button[data-date]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dateInput = document.getElementById("dateInput");
      if (!dateInput) return;
      dateInput.value = btn.getAttribute("data-date");
      dateInput.dispatchEvent(new Event("change"));
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function renderTimeSlots(availableTimes, meta = {}) {
  const select = document.getElementById("timeSlot");
  const help = document.getElementById("timeHelp");
  const durationMin = Number(meta.durationMin) || 0;
  if (!select) return;

  if (!availableTimes.length) {
    select.innerHTML = `<option value="" disabled selected>No available times</option>`;
    if (help) {
      help.textContent = meta.isFullDay
        ? "This day reached the maximum number of active bookings for this staff member. Please choose another date or staff member."
        : meta.filteredPastTimes
          ? "Past times for today are hidden. Please choose a later time or another date."
          : "No available start times can fit this service without overlapping an existing booking.";
    }
    return;
  }

  select.innerHTML = `<option value="">-- Select a time --</option>` + availableTimes.map((t) => {
    const end = durationMin ? minToTime(parseTimeToMin(t) + durationMin) : "";
    return `<option value="${t}">${t}${end ? ` - ${end}` : ""}</option>`;
  }).join("");

  if (help) help.textContent = `${meta.filteredPastTimes ? "Past times for today are hidden. " : ""}Only conflict-free slots are shown. Duration used: ${durationMin} minutes.`;
}

function setStatusText(text, kind) {
  const status = document.getElementById("status");
  if (!status) return;
  status.textContent = text || "";
  status.className = `status ${kind || ""}`;
}

function updateFlowUI() {
  const manualSection = document.getElementById("manualSection");
  const instantSection = document.getElementById("instantSection");
  const submitBtn = document.getElementById("submitBtn");
  const instantTitle = document.getElementById("instantTitle");
  const instantSub = document.getElementById("instantSub");
  const dateInput = document.getElementById("dateInput");
  const timeSlot = document.getElementById("timeSlot");
  const manualDate = document.getElementById("manualDateInput");

  const service = getSelectedService();
  renderServiceMeta(service);

  const isManual = selectedFlow === "manual";
  if (manualSection) manualSection.style.display = isManual ? "block" : "none";
  if (instantSection) instantSection.style.display = isManual ? "none" : "block";
  if (submitBtn) submitBtn.textContent = isManual ? "Send Request" : "Confirm Booking";

  if (manualDate) manualDate.required = isManual;
  if (dateInput) dateInput.required = !isManual;
  if (timeSlot) timeSlot.required = !isManual;

  if (!isManual) {
    if (instantTitle) instantTitle.textContent = serviceAllowsAnyTime(service) ? "Choose exact time (24-hour booking)" : "Choose date and time";
    if (instantSub) {
      instantSub.textContent = serviceAllowsAnyTime(service)
        ? "This service is configured for 24-hour exact slot booking. Only non-overlapping times are shown."
        : `This service uses normal salon hours (${OPEN_TIME}-${CLOSE_TIME}) with real-time conflict prevention.`;
    }
  }

  if (isManual) {
    setSubmitEnabled(Boolean(service));
  }
}

function renderManualPhotoPreview() {
  const preview = document.getElementById("manualPhotoPreview");
  const status = document.getElementById("manualUploadStatus");
  if (!preview || !status) return;
  if (!selectedManualPhotos.length) {
    preview.innerHTML = "";
    status.textContent = "Add 2-4 photos for manual hair review services.";
    return;
  }

  status.textContent = `${selectedManualPhotos.length} file(s) selected`;
  preview.innerHTML = selectedManualPhotos.map((file) => {
    const url = URL.createObjectURL(file);
    return `
      <div class="preview-thumb">
        <img src="${url}" alt="${file.name}" />
        <span>${file.name}</span>
      </div>
    `;
  }).join("");
}

async function refreshInstantAvailability() {
  if (!selectedStaff || selectedFlow === "manual") return;
  const dateInput = document.getElementById("dateInput");
  const service = getSelectedService();
  if (!dateInput || !service) {
    renderTimeSlots([], { durationMin: 0, isFullDay: false });
    renderBookedTimes([]);
    setDayStatus(false, 0);
    setSubmitEnabled(false);
    return;
  }

  const selectedDate = dateInput.value;
  if (!selectedDate) return;

  const salonNow = getSalonNowMeta();
  const filteredPastTimes = selectedDate === salonNow.date;

  let appts = [];
  try {
    appts = await fetchAppointmentsByDate(selectedDate, selectedStaff.id);
  } catch {
    appts = [];
  }

  const times = (appts || []).map((a) => a.time).filter(Boolean).sort();
  const isFull = times.length >= MAX_APPOINTMENTS_PER_DAY;
  const durationMin = getServiceDurationForStaff(selectedStaff, service);
  const bookedIntervals = (appts || []).map((a) => {
    const s = parseTimeToMin(a.time);
    const d = Number(a.durationMin) || 30;
    const e = parseTimeToMin(a.endTime) || (Number.isFinite(s) ? s + d : NaN);
    return {
      start: s,
      end: e,
      time: a.time,
      endTime: a.endTime || (Number.isFinite(e) ? minToTime(e) : "")
    };
  }).filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end));

  const windowCfg = getInstantWindow(service);
  const openMin = parseTimeToMin(windowCfg.open);
  const closeMin = parseTimeToMin(windowCfg.close);
  let availableTimes = [];

  if (!isFull && Number.isFinite(openMin) && Number.isFinite(closeMin)) {
    const lastStart = closeMin - durationMin;
    const step = Number.isFinite(SLOT_INTERVAL_MIN) && SLOT_INTERVAL_MIN > 0 ? SLOT_INTERVAL_MIN : 15;
    for (let t = openMin; t <= lastStart; t += step) {
      if (filteredPastTimes && t < salonNow.minutes) continue;
      const end = t + durationMin;
      const overlaps = bookedIntervals.some((b) => intervalsOverlap(t, end, b.start, b.end));
      if (!overlaps) availableTimes.push(minToTime(t));
    }
  }

  renderBookedTimes(bookedIntervals.map((b) => `${b.time}-${b.endTime}`));
  renderTimeSlots(availableTimes, { durationMin, isFullDay: isFull, filteredPastTimes });
  setDayStatus(isFull, times.length);
  setSubmitEnabled(!isFull && availableTimes.length > 0);

  const cache = await computeAvailability(selectedStaff.id, service, 14);
  renderAvailableDates(cache.dates, cache.fullDates);
}

function applyCustomerAutofill() {
  try {
    const c = getCustomerObj();
    const form = document.getElementById("bookingForm");
    if (c && form) {
      if (form.customerName) {
        form.customerName.value = c.name || "";
        form.customerName.readOnly = true;
      }
      if (form.phone) {
        form.phone.value = c.phone || "";
        form.phone.readOnly = true;
      }
      if (form.email) {
        form.email.value = c.email || "";
        form.email.readOnly = true;
      }
      const note = document.getElementById("customerAutofillNote");
      if (note) note.style.display = "block";
    }
  } catch {}
}

function clearManualPhotos() {
  selectedManualPhotos = [];
  const input = document.getElementById("manualPhotos");
  if (input) input.value = "";
  renderManualPhotoPreview();
}

async function uploadManualPhotos(service) {
  if (!selectedManualPhotos.length) {
    if (serviceRequiresPhotoUpload(service)) {
      throw new Error("Please upload at least 2 hair photos before sending this request.");
    }
    return [];
  }
  if (selectedManualPhotos.length < 2 && serviceRequiresPhotoUpload(service)) {
    throw new Error("Please upload at least 2 hair photos before sending this request.");
  }

  const formData = new FormData();
  selectedManualPhotos.slice(0, 4).forEach((file) => formData.append("photos", file));

  const uploadStatus = document.getElementById("manualUploadStatus");
  if (uploadStatus) uploadStatus.textContent = "Uploading photos...";

  const res = await fetch(`${API_BASE}/uploads/booking-photos`, {
    method: "POST",
    headers: authHeaders(),
    body: formData
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Photo upload failed");
  if (uploadStatus) uploadStatus.textContent = `${(data.files || []).length} photo(s) uploaded successfully.`;
  return data.files || [];
}

function validateInstantConflict(appts, payload, service) {
  const salonNow = getSalonNowMeta();
  const times = (appts || []).map((a) => a.time);
  if (times.length >= MAX_APPOINTMENTS_PER_DAY) {
    throw new Error("This day is fully booked for the selected staff member. Please choose another date.");
  }

  const dur = getServiceDurationForStaff(selectedStaff, service);
  const newStart = parseTimeToMin(payload.time);
  if (payload.date < salonNow.date) {
    throw new Error("Past dates cannot be booked.");
  }
  if (payload.date === salonNow.date && newStart < salonNow.minutes) {
    throw new Error("Past times for today cannot be selected. Please choose a future time.");
  }
  const newEnd = newStart + dur;
  const bookedIntervals = (appts || []).map((a) => {
    const s = parseTimeToMin(a.time);
    const d = Number(a.durationMin) || 30;
    const e = parseTimeToMin(a.endTime) || (Number.isFinite(s) ? s + d : NaN);
    return { start: s, end: e };
  }).filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end));

  if (bookedIntervals.some((b) => intervalsOverlap(newStart, newEnd, b.start, b.end))) {
    throw new Error("This time conflicts with an existing booking. Please choose another slot.");
  }
}

function restoreDefaultDates() {
  const today = getSalonNowMeta().date;
  const dateInput = document.getElementById("dateInput");
  const manualDateInput = document.getElementById("manualDateInput");
  if (dateInput) {
    dateInput.min = today;
    if (!dateInput.value) dateInput.value = today;
  }
  if (manualDateInput) {
    manualDateInput.min = today;
    if (!manualDateInput.value) manualDateInput.value = today;
  }
}

async function handleFormSubmit(e) {
  e.preventDefault();
  setStatusText("Checking booking rules...", "");

  if (!getCustomerToken()) {
    setStatusText("Booking submit කරන්න login වෙන්න ඕනේ.", "error");
    try {
      if (typeof requireCustomer === "function") requireCustomer();
    } catch {}
    return;
  }

  const form = document.getElementById("bookingForm");
  const service = getSelectedService();
  if (!service) {
    setStatusText("Please select a service.", "error");
    return;
  }

  const payload = {
    staffId: form.staffId.value,
    staffName: form.staffName.value,
    customerName: form.customerName.value.trim(),
    phone: form.phone.value.trim(),
    email: (form.email.value || "").trim(),
    serviceId: form.serviceId.value,
    notes: (form.notes.value || "").trim()
  };

  try {
    if (selectedFlow === "manual") {
      const manualDate = document.getElementById("manualDateInput")?.value || "";
      if (!manualDate) {
        throw new Error("Please choose your preferred date.");
      }
      const uploadedPhotos = await uploadManualPhotos(service);
      payload.date = manualDate;
      payload.preferredDate = manualDate;
      payload.referencePhotos = uploadedPhotos;
    } else {
      const date = document.getElementById("dateInput")?.value || "";
      const time = document.getElementById("timeSlot")?.value || "";
      if (!date || !time) throw new Error("Please choose a valid date and time slot.");
      payload.date = date;
      payload.time = time;

      const appts = await fetchAppointmentsByDate(payload.date, payload.staffId);
      validateInstantConflict(appts, payload, service);
    }
  } catch (err) {
    setStatusText(err.message || "Please check the booking details.", "error");
    return;
  }

  setStatusText(selectedFlow === "manual" ? "Sending request..." : "Submitting booking...", "");

  try {
    const res = await fetch(`${API_BASE}/appointments`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatusText(data.message || "Error", "error");
      if (selectedFlow !== "manual") await refreshInstantAvailability();
      return;
    }

    setStatusText(
      selectedFlow === "manual"
        ? "Request sent successfully. The salon will review the photos and send an exact date/time proposal to My Account."
        : "Booking created successfully!",
      "success"
    );

    const keepStaffId = form.staffId.value;
    const keepStaffName = form.staffName.value;
    const flowToKeep = selectedFlow;
    form.reset();
    form.staffId.value = keepStaffId;
    form.staffName.value = keepStaffName;
    selectedFlow = flowToKeep;
    clearManualPhotos();
    restoreDefaultDates();
    renderCategoryCards();
    renderServiceOptions();
    updateFlowUI();
    applyCustomerAutofill();
    if (selectedFlow !== "manual") await refreshInstantAvailability();
    await refreshTodayFields();
  } catch {
    setStatusText("Server not reachable. Check backend is running.", "error");
  }
}

async function initBookingForSelectedStaff() {
  if (!selectedStaff) return;

  const form = document.getElementById("bookingForm");
  const title = document.getElementById("bookWithTitle");
  const sub = document.getElementById("bookWithSub");
  const qp = new URLSearchParams(location.search);
  const preServiceId = qp.get("serviceId") || "";
  const preService = SERVICES.find((item) => String(item._id) === String(preServiceId)) || null;

  document.getElementById("staffId").value = selectedStaff.id;
  document.getElementById("staffName").value = selectedStaff.name;
  title.textContent = `Book with ${selectedStaff.name}`;
  sub.textContent = `${selectedStaff.role} • ${selectedStaff.desc}`;

  restoreDefaultDates();
  renderCategoryCards();

  if (preService) {
    selectedFlow = getServiceFlow(preService);
    renderCategoryCards();
    renderServiceOptions(preServiceId);
  } else {
    renderServiceOptions();
  }

  updateFlowUI();
  applyCustomerAutofill();
  if (selectedFlow !== "manual") await refreshInstantAvailability();

  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function showBookingForm() {
  if (!selectedStaff) return;
  const staffSection = document.getElementById("staffSection");
  const form = document.getElementById("bookingForm");
  const changeWrap = document.getElementById("changeStaffWrap");

  form.style.display = "block";
  changeWrap.style.display = "block";
  staffSection.style.display = "none";

  await initBookingForSelectedStaff();
}

function showStaffSelection() {
  selectedStaff = null;
  const staffSection = document.getElementById("staffSection");
  const form = document.getElementById("bookingForm");
  const changeWrap = document.getElementById("changeStaffWrap");
  staffSection.style.display = "block";
  form.style.display = "none";
  changeWrap.style.display = "none";
  const pillEl = document.getElementById("selectedStaffPill");
  if (pillEl) pillEl.style.display = "none";
  document.querySelectorAll(".staff-card").forEach((c) => c.classList.remove("selected"));
  setStatusText("", "");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function initBookingPage() {
  await loadBookingConfig();
  renderStaffCards();
  await refreshTodayFields();
  applyCustomerAutofill();
  restoreDefaultDates();
  renderManualWindowSelect();

  const form = document.getElementById("bookingForm");
  const changeBtn = document.getElementById("changeStaffBtn");
  const serviceSelect = document.getElementById("serviceId");
  const dateInput = document.getElementById("dateInput");
  const manualPhotosInput = document.getElementById("manualPhotos");

  if (changeBtn) changeBtn.addEventListener("click", showStaffSelection);
  if (form) form.addEventListener("submit", handleFormSubmit);

  if (serviceSelect) {
    serviceSelect.addEventListener("change", async () => {
      const service = getSelectedService();
      if (service && getServiceFlow(service) !== selectedFlow) {
        selectedFlow = getServiceFlow(service);
        renderCategoryCards();
        renderServiceOptions(String(service._id));
      }
      updateFlowUI();
      if (selectedFlow !== "manual") await refreshInstantAvailability();
      else setSubmitEnabled(Boolean(service));
    });
  }

  if (dateInput) dateInput.addEventListener("change", refreshInstantAvailability);
  if (manualPhotosInput) {
    manualPhotosInput.addEventListener("change", (e) => {
      selectedManualPhotos = Array.from(e.target.files || []).slice(0, 4);
      renderManualPhotoPreview();
    });
  }
}

document.addEventListener("DOMContentLoaded", initBookingPage);
