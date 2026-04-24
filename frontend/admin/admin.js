/* Malki Salon Admin Panel (vanilla JS)
   - JWT auth (backend /api/auth/login)
   - Full CRUD: services, packages, gallery, staff
   - Appointments: approve/cancel/delete + payment proof review
   - Settings: booking rules + contact info + payment instructions
*/

(function () {
  const $ = (s) => document.querySelector(s);
  const content = $("#content");
  const loginBox = $("#loginBox");
  const loginForm = $("#loginForm");
  const loginStatus = $("#loginStatus");
  const whoami = $("#whoami");
  const logoutBtn = $("#logoutBtn");
  const viewTitle = $("#viewTitle");
  const viewHint = $("#viewHint");

  const TOK_KEY = "malki_admin_token";
  // Session-only auth: closing the tab/browser clears the session.
  // Additionally, if the browser restores this page via back/forward cache,
  // we force a logout to avoid staying signed in when navigating back.
  let token = sessionStorage.getItem(TOK_KEY) || "";
  let currentView = "dashboard";
  let currentUser = null;

  function forceLogout() {
    token = "";
    currentUser = null;
    sessionStorage.removeItem(TOK_KEY);
    setLoginVisible(true);
    whoami.textContent = "Not signed in";
    applyRoleNavigation();
  }

  // If the page is opened via Back/Forward navigation (BFCache restore), auto-logout.
  try {
    const nav = performance.getEntriesByType("navigation")[0];
    if (nav && nav.type === "back_forward") {
      forceLogout();
    }
  } catch {}

  // Some browsers mark BFCache restores via the pageshow event.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      forceLogout();
    }
  });

  function setLoginVisible(visible) {
    loginBox.classList.toggle("hidden", !visible);
  }

  function setStatus(el, text, kind) {
    if (!el) return;
    el.style.display = text ? "block" : "none";
    el.textContent = text || "";
    el.className = "status " + (kind || "");
  }

  function applyRoleNavigation() {
    const role = String(currentUser?.role || "");
    const isStaffManager = role === "staff_manager";
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      const allowed = !isStaffManager || btn.dataset.view === "staff";
      btn.style.display = allowed ? "" : "none";
    });
    const brandSub = document.querySelector(".brand-sub");
    if (brandSub) brandSub.textContent = isStaffManager ? "Staff Management" : "Admin Panel";
    if (isStaffManager && currentView !== "staff") currentView = "staff";
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.message || `Request failed: ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  function pill(text, kind) {
    return `<span class="pill ${kind || ""}">${escapeHtml(text)}</span>`;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function fmtMoney(n) {
    const v = Number(n || 0);
    return v.toLocaleString("en-LK");
  }

  // -------- Modal --------
  const modal = document.createElement("div");
  modal.className = "modal hidden";
  modal.innerHTML = `
    <div class="card modal-card modal-card--md">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:12px">
          <div>
            <h2 id="mTitle" style="margin:0 0 4px"></h2>
            <div class="muted" id="mSub"></div>
          </div>
          <button class="btn secondary" id="mClose" type="button">Close</button>
        </div>
        <div id="mBody" style="margin-top:12px"></div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const modalCard = modal.querySelector(".modal-card");
  const mTitle = modal.querySelector("#mTitle");
  const mSub = modal.querySelector("#mSub");
  const mBody = modal.querySelector("#mBody");
  modal.querySelector("#mClose").addEventListener("click", () => hideModal());
  modal.addEventListener("click", (e) => {
    if (e.target === modal) hideModal();
  });

  function showModal(title, sub, bodyHtml, options = {}) {
    const size = typeof options === "string" ? options : options.size || "md";
    modalCard.className = `card modal-card modal-card--${size}`;
    mTitle.textContent = title || "";
    mSub.textContent = sub || "";
    mBody.innerHTML = bodyHtml || "";
    modal.classList.remove("hidden");
  }
  function hideModal() {
    modal.classList.add("hidden");
    modalCard.className = "card modal-card modal-card--md";
    mBody.innerHTML = "";
  }


  async function crudView(config) {
    const {
      title,
      hint,
      listPath,
      createPath,
      updatePathFor,
      deletePathFor,
      columns = [],
      form,
      normalize
    } = config || {};

    viewTitle.textContent = title || "Manage Items";
    viewHint.textContent = hint || "";
    content.innerHTML = `
      <div class="card">
        <div class="card-body">
          <div style="display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:12px;">
            <div>
              <div class="muted">Create, edit, and remove records for this section.</div>
            </div>
            <div class="actions">
              <button class="btn" type="button" id="crudAddBtn">Add New</button>
              <button class="btn secondary" type="button" id="crudRefreshBtn">Refresh</button>
            </div>
          </div>
          <div id="crudWrap" class="muted">Loading...</div>
        </div>
      </div>`;

    const wrap = document.getElementById("crudWrap");
    const addBtn = document.getElementById("crudAddBtn");
    const refreshBtn = document.getElementById("crudRefreshBtn");
    let items = [];

    function renderTable(list) {
      if (!list || !list.length) {
        return `<div class="muted">No records found in this section yet.</div>`;
      }

      const head = columns.map((c) => `<th>${escapeHtml(c.header || "")}</th>`).join("");
      const body = list
        .map((item) => {
          const cells = columns
            .map((c) => `<td>${typeof c.render === "function" ? c.render(item) : escapeHtml(item?.[c.key] ?? "")}</td>`)
            .join("");
          return `
            <tr>
              ${cells}
              <td>
                <div class="actions">
                  <button class="btn" type="button" data-crud-act="edit" data-id="${escapeHtml(item._id)}">Edit</button>
                  <button class="btn secondary" type="button" data-crud-act="delete" data-id="${escapeHtml(item._id)}">Delete</button>
                </div>
              </td>
            </tr>`;
        })
        .join("");

      return `
        <div class="muted" style="margin-bottom:10px">${escapeHtml(String(list.length))} item(s)</div>
        <table class="table">
          <thead>
            <tr>${head}<th>Actions</th></tr>
          </thead>
          <tbody>${body}</tbody>
        </table>`;
    }

    async function loadList() {
      wrap.textContent = "Loading...";
      try {
        items = await api(listPath);
        wrap.innerHTML = renderTable(items);
        wireCrudActions();
      } catch (err) {
        wrap.innerHTML = `<div class="status error">${escapeHtml(err.message)}</div>`;
      }
    }

    function openFormModal(item = null) {
      const editing = Boolean(item && item._id);
      showModal(
        editing ? `Edit ${title}` : `Add ${title}`,
        editing ? "Update this record and save changes." : "Create a new record for this section.",
        typeof form === "function" ? form(item || {}) : ""
      );

      const formEl = document.getElementById("crudForm");
      const statusEl = document.getElementById("crudStatus");
      if (!formEl) return;

      renderCryptoQrPreview(formEl.cryptoWalletQrImageUrl?.value || "");

    qrUploadBtn?.addEventListener("click", async () => {
      const file = qrInputEl?.files?.[0] || null;
      if (!file) {
        setStatus(qrStatusEl, "Please choose a QR image file first.", "error");
        return;
      }
      setStatus(qrStatusEl, "Uploading QR image...", "");
      qrUploadBtn.disabled = true;
      try {
        const uploaded = await uploadCryptoQrImage(file);
        formEl.cryptoWalletQrImageUrl.value = uploaded.url || "";
        if (qrInputEl) qrInputEl.value = "";
        renderCryptoQrPreview(formEl.cryptoWalletQrImageUrl.value);
        setStatus(qrStatusEl, "QR image uploaded. Save settings to publish it to customers.", "success");
      } catch (err) {
        setStatus(qrStatusEl, err.message, "error");
      } finally {
        qrUploadBtn.disabled = false;
      }
    });

    qrRemoveBtn?.addEventListener("click", () => {
      formEl.cryptoWalletQrImageUrl.value = "";
      if (qrInputEl) qrInputEl.value = "";
      renderCryptoQrPreview("");
      setStatus(qrStatusEl, "QR image removed from this form. Save settings to apply the change.", "success");
    });

    formEl.addEventListener("submit", async (e) => {
        e.preventDefault();
        setStatus(statusEl, editing ? "Saving changes..." : "Creating record...", "");
        try {
          const fd = new FormData(formEl);
          const payload = typeof normalize === "function" ? normalize(fd, item || {}) : Object.fromEntries(fd.entries());
          await api(editing ? updatePathFor(item) : createPath, {
            method: editing ? "PUT" : "POST",
            body: JSON.stringify(payload)
          });
          setStatus(statusEl, editing ? "Saved" : "Created", "success");
          setTimeout(() => {
            hideModal();
            loadList();
          }, 250);
        } catch (err) {
          setStatus(statusEl, err.message, "error");
        }
      });
    }

    function wireCrudActions() {
      wrap.querySelectorAll("button[data-crud-act]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const act = btn.getAttribute("data-crud-act");
          const id = btn.getAttribute("data-id");
          const item = items.find((entry) => String(entry._id) === String(id));
          if (!item) return;

          if (act === "edit") {
            openFormModal(item);
            return;
          }

          if (act === "delete") {
            if (!confirm(`Delete this ${String(title || "item").toLowerCase()} record?`)) return;
            try {
              await api(deletePathFor(item), { method: "DELETE" });
              await loadList();
            } catch (err) {
              alert(err.message);
            }
          }
        });
      });
    }

    addBtn.addEventListener("click", () => openFormModal());
    refreshBtn.addEventListener("click", loadList);

    await loadList();
  }

  // -------- Views --------
  async function viewDashboard() {
    viewTitle.textContent = "Dashboard";
    viewHint.textContent = "Quick overview";
    content.innerHTML = `
      <div class="admin-grid">
        <div class="card col-6"><div class="card-body"><div class="muted">Pending appointments</div><div id="kPending" style="font-size:34px;font-weight:800">—</div></div></div>
        <div class="card col-6"><div class="card-body"><div class="muted">Pending orders</div><div id="kOrders" style="font-size:34px;font-weight:800">—</div></div></div>
        <div class="card col-6"><div class="card-body"><div class="muted">Active services</div><div id="kServices" style="font-size:34px;font-weight:800">—</div></div></div>
        <div class="card col-6"><div class="card-body"><div class="muted">Active staff</div><div id="kStaff" style="font-size:34px;font-weight:800">—</div></div></div>

        <div class="card col-12">
          <div class="card-body">
            <h3 style="margin:0 0 10px">Latest appointments</h3>
            <div id="latestWrap" class="muted">Loading...</div>
          </div>
        </div>

        <div class="card col-12">
          <div class="card-body">
            <h3 style="margin:0 0 10px">Latest orders</h3>
            <div id="latestOrdersWrap" class="muted">Loading...</div>
          </div>
        </div>
      </div>`;

    try {
      const appts = await api("/appointments/admin/all");
      const services = await api("/services/admin/all");
      const staff = await api("/staff/admin/all");
      const orders = await api("/orders/admin/all");

      const pending = appts.filter((a) => ["pending", "pending_review", "proposal_sent", "customer_reschedule_requested"].includes(a.status)).length;
      const pendingOrders = orders.filter((o) => o.status === "pending").length;
      const activeServices = services.filter((s) => s.isActive).length;
      const activeStaff = staff.filter((s) => s.isActive).length;

      $("#kPending").textContent = pending;
      $("#kOrders").textContent = pendingOrders;
      $("#kServices").textContent = activeServices;
      $("#kStaff").textContent = activeStaff;

      const latest = appts.slice(0, 8);
      const html = latest.length
        ? `<table class="table">
            <thead><tr><th>Date</th><th>Time</th><th>Staff</th><th>Customer</th><th>Service</th><th>Status</th></tr></thead>
            <tbody>
              ${latest
                .map((a) => {
                  const dateText = a.bookingMode === "manual-review" && a.status !== "approved" ? (a.preferredDate || a.date || "") : (a.date || "");
                  const timeText = a.bookingMode === "manual-review"
                    ? (a.status === "proposal_sent" && a.pendingProposal?.time
                        ? `${a.pendingProposal.date || ""} • ${a.pendingProposal.time}${a.pendingProposal.endTime ? ` - ${a.pendingProposal.endTime}` : ""}`
                        : a.status === "deleted_by_admin"
                          ? "Removed by salon"
                        : a.status === "approved"
                          ? `${a.time || ""}${a.endTime ? ` - ${a.endTime}` : ""}`
                          : "Manual review")
                    : `${a.time || ""}${a.endTime ? ` - ${a.endTime}` : ""}`;
                  const kind = a.status === "approved" ? "ok" : ["cancelled", "deleted_by_admin"].includes(a.status) ? "bad" : "warn";
                  return `
                    <tr>
                      <td>${escapeHtml(dateText)}</td>
                      <td>${escapeHtml(timeText)}</td>
                      <td>${escapeHtml(a.staffName)}</td>
                      <td>${escapeHtml(a.customerName)}<div class="muted">${escapeHtml(a.phone)}</div></td>
                      <td>${escapeHtml(a.serviceName)}</td>
                      <td>${pill(appointmentStatusLabel(a.status), kind)}</td>
                    </tr>`;
                })
                .join("")}
            </tbody>
          </table>`
        : `<div class="muted">No appointments yet.</div>`;

      $("#latestWrap").innerHTML = html;

      const latestOrders = orders.slice(0, 8);
      const ohtml = latestOrders.length
        ? `<table class="table">
            <thead><tr><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>
              ${latestOrders
                .map((o) => {
                  const items = (o.items || []).map((it) => `${escapeHtml(it.name)} x${escapeHtml(it.qty)}`).join("<br>");
                  const kind = ["completed", "delivered"].includes(o.status) ? "ok" : ["cancelled", "delivery_issue"].includes(o.status) ? "bad" : ["pending", "confirmed", "shipped", "out_for_delivery"].includes(o.status) ? "warn" : "";
                  return `
                    <tr>
                      <td>${escapeHtml(new Date(o.createdAt).toLocaleString())}</td>
                      <td>${escapeHtml(o.customerSnapshot?.name || "")}<div class="muted">${escapeHtml(o.customerSnapshot?.phone || "")} ${o.customerSnapshot?.email ? "• " + escapeHtml(o.customerSnapshot.email) : ""}</div></td>
                      <td>${items || "—"}</td>
                      <td><b>LKR ${fmtMoney(o.totalLKR)}</b></td>
                      <td>${pill(o.status, kind)}</td>
                    </tr>`;
                })
                .join("")}
            </tbody>
          </table>`
        : `<div class="muted">No orders yet.</div>`;

      $("#latestOrdersWrap").innerHTML = ohtml;
    } catch (e) {
      $("#latestWrap").innerHTML = `<div class="status error">${escapeHtml(e.message)}</div>`;
      $("#latestOrdersWrap").innerHTML = `<div class="status error">${escapeHtml(e.message)}</div>`;
    }
  }


  function appointmentStatusLabel(status) {
    const map = {
      pending: "Pending",
      pending_review: "Pending review",
      proposal_sent: "Proposal sent",
      customer_reschedule_requested: "Needs new proposal",
      approved: "Approved",
      cancelled: "Cancelled",
      deleted_by_admin: "Removed by salon"
    };
    return map[String(status || "").trim()] || String(status || "—");
  }

  function appointmentStatusKind(status) {
    if (status === "approved") return "ok";
    if (status === "cancelled" || status === "deleted_by_admin") return "bad";
    return "warn";
  }

  function appointmentHasPendingProposal(item) {
    return Boolean(item?.pendingProposal?.date && item?.pendingProposal?.time);
  }

  function appointmentRange(date, time, endTime) {
    const parts = [date || ""].filter(Boolean);
    if (time) parts.push(endTime ? `${time} - ${endTime}` : time);
    return parts.join(" • ") || "—";
  }

  function paymentStatusLabel(status) {
    const map = {
      not_due: "Not due yet",
      pending_customer_payment: "Advance required",
      submitted: "Slip sent",
      confirmed: "Advance confirmed",
      rejected: "Slip rejected"
    };
    return map[String(status || "").trim()] || String(status || "—");
  }

  function paymentStatusKind(status) {
    if (status === "confirmed") return "ok";
    if (status === "rejected") return "bad";
    if (status === "submitted" || status === "pending_customer_payment") return "warn";
    return "";
  }

  function paymentMethodLabel(method) {
    const map = {
      bank_transfer: "Bank transfer",
      online_transfer: "Online transfer",
      crypto: "Crypto",
      skrill: "Skrill"
    };
    return map[String(method || "").trim()] || "—";
  }

  function paymentProofIsImage(proof) {
    const mime = String(proof?.mimeType || "").toLowerCase();
    const url = String(proof?.url || "").toLowerCase();
    return mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(url);
  }

  function appointmentPaymentSummaryHtml(item) {
    const payment = item?.payment || {};
    const status = payment.status || "not_due";
    return `
      <div class="muted" style="margin-top:8px;">Total: LKR ${fmtMoney(payment.totalAmountLKR)} • Advance: LKR ${fmtMoney(payment.depositAmountLKR)}</div>
      <div style="margin-top:6px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        ${pill(paymentStatusLabel(status), paymentStatusKind(status))}
        ${payment.method ? `<span class="muted">${escapeHtml(paymentMethodLabel(payment.method))}</span>` : ""}
      </div>`;
  }

  function paymentProofPreviewHtml(proof) {
    if (!proof?.url) return `<div class="muted">No payment proof uploaded yet.</div>`;
    const link = `<a href="${escapeHtml(imgUrl(proof.url))}" target="_blank" rel="noreferrer">${escapeHtml(proof.originalName || proof.filename || "Open uploaded slip")}</a>`;
    const uploadedAt = proof.uploadedAt ? `<div class="muted" style="margin-top:6px;">Uploaded: ${escapeHtml(new Date(proof.uploadedAt).toLocaleString())}</div>` : "";
    const preview = paymentProofIsImage(proof)
      ? `<div style="margin-top:10px;"><img src="${escapeHtml(imgUrl(proof.url))}" alt="Payment proof" style="max-width:320px; width:100%; border-radius:14px; border:1px solid rgba(255,255,255,.10);" /></div>`
      : `<div class="muted" style="margin-top:8px;">PDF/document proof uploaded.</div>`;
    return `<div>${link}${uploadedAt}${preview}</div>`;
  }

  function proposalHistoryHtml(item) {
    const history = Array.isArray(item?.proposalHistory) ? item.proposalHistory : [];
    if (!history.length) return `<div class="muted">No proposal history yet.</div>`;
    return history
      .slice()
      .reverse()
      .map((entry) => {
        const note = entry.note ? `<div class="muted" style="margin-top:6px;">Salon note: ${escapeHtml(entry.note)}</div>` : "";
        const responseNote = entry.customerResponseNote ? `<div class="muted" style="margin-top:6px;">Customer reply: ${escapeHtml(entry.customerResponseNote)}</div>` : "";
        return `
          <div style="padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,.10); background:rgba(255,255,255,.04); margin-top:8px;">
            <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
              <div><b>Round ${escapeHtml(entry.proposalRound || "—")}</b></div>
              <div>${pill(entry.customerResponse || "pending", entry.customerResponse === "accepted" ? "ok" : entry.customerResponse === "cancelled" ? "bad" : "warn")}</div>
            </div>
            <div class="muted" style="margin-top:6px;">${escapeHtml(appointmentRange(entry.date, entry.time, entry.endTime))}</div>
            ${note}
            ${responseNote}
          </div>
        `;
      })
      .join("");
  }

  function appointmentWhenHtml(item) {
    if (item.bookingMode !== "manual-review") {
      return `${escapeHtml(item.date || "")}<div class="muted">${escapeHtml(item.time || "")}${item.endTime ? ` - ${escapeHtml(item.endTime)}` : ""}</div>`;
    }

    const preferredDate = item.preferredDate || item.date || "";
    let html = `${escapeHtml(preferredDate || "—")}<div class="muted">Preferred date</div>`;

    if (item.status === "approved") {
      html = `${escapeHtml(item.date || preferredDate || "—")}<div class="muted">${escapeHtml(item.time || "")}${item.endTime ? ` - ${escapeHtml(item.endTime)}` : ""}</div>`;
      if (preferredDate && preferredDate !== item.date) {
        html += `<div class="muted" style="margin-top:6px;">Originally requested: ${escapeHtml(preferredDate)}</div>`;
      }
      return html;
    }

    if (item.status === "deleted_by_admin") {
      html += `<div class="muted" style="margin-top:6px;">Removed by salon${item.adminDeletedAt ? ` • ${escapeHtml(new Date(item.adminDeletedAt).toLocaleString())}` : ""}</div>`;
      return html;
    }

    if (appointmentHasPendingProposal(item)) {
      html += `<div class="muted" style="margin-top:6px;"><b>Current proposal:</b> ${escapeHtml(appointmentRange(item.pendingProposal.date, item.pendingProposal.time, item.pendingProposal.endTime))}</div>`;
    } else if (item.status === "customer_reschedule_requested") {
      html += `<div class="muted" style="margin-top:6px;">Customer asked for another date/time.</div>`;
    } else {
      html += `<div class="muted" style="margin-top:6px;">Awaiting salon review.</div>`;
    }

    return html;
  }

  async function viewAppointments() {
    viewTitle.textContent = "Appointments";
    viewHint.textContent = "Review manual consultations, approve instant bookings, and confirm uploaded 25% advance payment slips";
    content.innerHTML = `
      <div class="card">
        <div class="card-body">
          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end">
            <div style="min-width:180px">
              <label>Status</label>
              <select id="fStatus">
                <option value="" selected>All</option>
                <option value="pending">Pending</option>
                <option value="pending_review">Pending Review</option>
                <option value="proposal_sent">Proposal Sent</option>
                <option value="customer_reschedule_requested">Needs New Proposal</option>
                <option value="approved">Approved</option>
                <option value="cancelled">Cancelled</option>
                <option value="deleted_by_admin">Removed by Salon</option>
              </select>
            </div>
            <div style="min-width:210px">
              <label>Payment status</label>
              <select id="fPaymentStatus">
                <option value="" selected>All</option>
                <option value="pending_customer_payment">Advance required</option>
                <option value="submitted">Slip sent</option>
                <option value="confirmed">Advance confirmed</option>
                <option value="rejected">Slip rejected</option>
              </select>
            </div>
            <div style="min-width:200px">
              <label>Date (YYYY-MM-DD)</label>
              <input class="input" id="fDate" placeholder="2026-01-17" />
            </div>
            <div style="min-width:200px">
              <label>Staff ID (optional)</label>
              <input class="input" id="fStaff" placeholder="staff1" />
            </div>
            <button class="btn" type="button" id="btnLoad">Load</button>
          </div>
          <div style="margin-top:12px" id="apptWrap" class="muted">Loading...</div>
        </div>
      </div>`;

    async function load() {
      const status = $("#fStatus").value.trim();
      const paymentStatus = $("#fPaymentStatus").value.trim();
      const date = $("#fDate").value.trim();
      const staffId = $("#fStaff").value.trim();
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      if (paymentStatus) qs.set("paymentStatus", paymentStatus);
      if (date) qs.set("date", date);
      if (staffId) qs.set("staffId", staffId);

      $("#apptWrap").textContent = "Loading...";
      try {
        const list = await api(`/appointments/admin/all?${qs.toString()}`);
        $("#apptWrap").innerHTML = renderAppointmentTable(list);
        wireAppointmentActions(list, load);
      } catch (e) {
        $("#apptWrap").innerHTML = `<div class="status error">${escapeHtml(e.message)}</div>`;
      }
    }

    $("#btnLoad").addEventListener("click", load);
    await load();
  }

  function renderAppointmentTable(list) {
    if (!list || !list.length) return `<div class="muted">No appointments found.</div>`;
    return `
      <table class="table">
        <thead>
          <tr><th>When</th><th>Staff</th><th>Customer</th><th>Service</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          ${list
            .map((a) => {
              const kind = appointmentStatusKind(a.status);
              const isManual = a.bookingMode === "manual-review";
              const modeText = isManual ? "Manual review request" : a.allowAnyTimeBooking ? "24/7 exact slot" : "Instant slot";
              const whenHtml = appointmentWhenHtml(a);
              const photoCount = Array.isArray(a.referencePhotos) ? a.referencePhotos.length : 0;
              const proposalTag = isManual && appointmentHasPendingProposal(a)
                ? `<div class="muted" style="margin-top:6px;">Waiting for customer reply</div>`
                : "";
              const paymentSummary = appointmentPaymentSummaryHtml(a);
              const paymentAction = a?.payment?.proof?.url
                ? `<button class="btn secondary" data-act="payment" data-id="${a._id}">${a.payment?.status === "submitted" ? "Review Payment" : "Payment Details"}</button>`
                : "";
              const primaryAction = isManual
                ? (["pending_review", "proposal_sent", "customer_reschedule_requested"].includes(a.status)
                    ? `<button class="btn" data-act="propose" data-id="${a._id}">${a.status === "proposal_sent" ? "Revise Proposal" : "Send Proposal"}</button>`
                    : "")
                : (!["approved", "cancelled", "deleted_by_admin"].includes(a.status)
                    ? `<button class="btn" data-act="approve" data-id="${a._id}">Approve</button>`
                    : "");
              return `
                <tr>
                  <td>${whenHtml}</td>
                  <td>${escapeHtml(a.staffName)}<div class="muted">${escapeHtml(a.staffId)}</div></td>
                  <td>${escapeHtml(a.customerName)}<div class="muted">${escapeHtml(a.phone)} ${a.email ? "• " + escapeHtml(a.email) : ""}</div></td>
                  <td>
                    <b>${escapeHtml(a.serviceName)}</b>
                    <div class="muted">${escapeHtml(modeText)}${photoCount ? ` • ${photoCount} photo(s)` : ""}</div>
                    ${proposalTag}
                    ${paymentSummary}
                  </td>
                  <td>${pill(appointmentStatusLabel(a.status), kind)}</td>
                  <td>
                    <div class="actions">
                      <button class="btn secondary" data-act="view" data-id="${a._id}">View</button>
                      ${primaryAction}
                      ${paymentAction}
                      ${!["cancelled", "deleted_by_admin"].includes(a.status) ? `<button class="btn secondary" data-act="cancel" data-id="${a._id}">Cancel</button>` : ""}
                      <button class="btn secondary" data-act="note" data-id="${a._id}">Edit salon note</button>
                      ${a.status !== "deleted_by_admin" ? `<button class="btn secondary" data-act="delete" data-id="${a._id}">Remove</button>` : ""}
                    </div>
                  </td>
                </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;
  }

  function showAppointmentDetailsModal(item) {
    const photos = (item.referencePhotos || []).length
      ? `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:10px; margin-top:8px;">${(item.referencePhotos || []).map((p) => `
            <a href="${escapeHtml(imgUrl(p.url || ""))}" target="_blank" rel="noreferrer" style="display:block; text-decoration:none; color:inherit;">
              <div style="border:1px solid rgba(255,255,255,.10); border-radius:14px; overflow:hidden; background:rgba(255,255,255,.04);">
                <img src="${escapeHtml(imgUrl(p.url || ""))}" alt="Reference" style="width:100%; height:120px; object-fit:cover; display:block;" />
                <div style="padding:8px; font-size:12px;">${escapeHtml(p.originalName || p.filename || "Photo")}</div>
              </div>
            </a>`).join("")}</div>`
      : `<div class="muted">No uploaded photos.</div>`;

    const proposalNow = appointmentHasPendingProposal(item)
      ? `<div><b>Current proposal:</b><div class="muted" style="margin-top:4px;">${escapeHtml(appointmentRange(item.pendingProposal.date, item.pendingProposal.time, item.pendingProposal.endTime))}</div>${item.pendingProposal.note ? `<div class="muted" style="margin-top:6px;">${escapeHtml(item.pendingProposal.note)}</div>` : ""}</div>`
      : `<div class="muted">No active proposal.</div>`;

    showModal(
      "Appointment details",
      item.bookingMode === "manual-review" ? "Manual review request" : "Appointment",
      `
        <div class="admin-grid">
          <div class="col-6"><div class="muted">Customer</div><div><b>${escapeHtml(item.customerName)}</b><br>${escapeHtml(item.phone || "")} ${item.email ? `• ${escapeHtml(item.email)}` : ""}</div></div>
          <div class="col-6"><div class="muted">Staff</div><div><b>${escapeHtml(item.staffName)}</b><br>${escapeHtml(item.staffId || "")}</div></div>
          <div class="col-6"><div class="muted">Service</div><div><b>${escapeHtml(item.serviceName)}</b><br>${escapeHtml(item.bookingMode === "manual-review" ? "Manual review request" : item.allowAnyTimeBooking ? "24/7 exact slot" : "Instant slot")}</div></div>
          <div class="col-6"><div class="muted">Status</div><div>${pill(appointmentStatusLabel(item.status), appointmentStatusKind(item.status))}</div></div>
          <div class="col-6"><div class="muted">Preferred date</div><div>${escapeHtml(item.preferredDate || item.date || "—")}</div></div>
          <div class="col-6"><div class="muted">Confirmed slot</div><div>${escapeHtml(item.status === "approved" || item.status === "deleted_by_admin" ? appointmentRange(item.date, item.time, item.endTime) : "Not confirmed yet")}</div></div>
          <div class="col-12"><div class="muted">Customer note</div><div>${escapeHtml(item.notes || "—")}</div></div>
          <div class="col-12"><div class="muted">Salon note</div><div>${escapeHtml(item.adminReviewNote || "—")}</div></div>
          <div class="col-12"><div class="muted">Removal details</div><div>${escapeHtml(item.adminDeletedAt ? `Removed on ${new Date(item.adminDeletedAt).toLocaleString()}` : "—")}${item.adminDeletionReason ? `<div class="muted" style="margin-top:6px;">${escapeHtml(item.adminDeletionReason)}</div>` : ""}</div></div>
          <div class="col-12"><div class="muted">Latest customer response</div><div>${escapeHtml(item.customerResponseNote || "—")}</div></div>
          <div class="col-12"><div class="muted">Current proposal</div>${proposalNow}</div>
          <div class="col-12"><div class="muted">Proposal history</div>${proposalHistoryHtml(item)}</div>
          <div class="col-12"><div class="muted">Advance payment</div>${appointmentPaymentSummaryHtml(item)}${item?.payment?.customerReference ? `<div class="muted" style="margin-top:8px;">Reference: ${escapeHtml(item.payment.customerReference)}</div>` : ""}${item?.payment?.customerNote ? `<div class="muted" style="margin-top:6px;">Customer note: ${escapeHtml(item.payment.customerNote)}</div>` : ""}${item?.payment?.adminNote ? `<div class="muted" style="margin-top:6px;">Admin note: ${escapeHtml(item.payment.adminNote)}</div>` : ""}<div style="margin-top:10px;">${paymentProofPreviewHtml(item?.payment?.proof)}</div></div>
          <div class="col-12"><div class="muted">Uploaded Photos</div>${photos}</div>
        </div>`
    );
  }

  function showPaymentReviewModal(item, refreshFn) {
    const payment = item?.payment || {};
    showModal(
      "Review advance payment",
      "Open the uploaded slip and confirm or reject the required 25% advance payment.",
      `
        <div class="admin-grid">
          <div class="col-6"><div class="muted">Customer</div><div><b>${escapeHtml(item.customerName || "—")}</b><br>${escapeHtml(item.phone || "")}</div></div>
          <div class="col-6"><div class="muted">Service</div><div><b>${escapeHtml(item.serviceName || "—")}</b><br>${escapeHtml(item.staffName || "")}</div></div>
          <div class="col-4"><div class="muted">Total amount</div><div><b>LKR ${fmtMoney(payment.totalAmountLKR)}</b></div></div>
          <div class="col-4"><div class="muted">Advance required</div><div><b>LKR ${fmtMoney(payment.depositAmountLKR)}</b></div></div>
          <div class="col-4"><div class="muted">Method</div><div>${escapeHtml(paymentMethodLabel(payment.method))}</div></div>
          <div class="col-12"><div class="muted">Current payment status</div><div>${pill(paymentStatusLabel(payment.status), paymentStatusKind(payment.status))}</div></div>
          <div class="col-12"><div class="muted">Customer reference / note</div><div>${escapeHtml(payment.customerReference || "—")}${payment.customerNote ? `<div class="muted" style="margin-top:6px;">${escapeHtml(payment.customerNote)}</div>` : ""}</div></div>
          <div class="col-12"><div class="muted">Uploaded proof</div>${paymentProofPreviewHtml(payment.proof)}</div>
          <div class="col-12">
            <label>Admin note</label>
            <textarea class="input" id="paymentReviewNote" rows="4" placeholder="Optional note shown to the customer when you confirm or reject the slip...">${escapeHtml(payment.adminNote || "")}</textarea>
          </div>
          <div class="col-12">
            <div class="actions">
              <button class="btn" type="button" id="paymentConfirmBtn">Confirm advance payment</button>
              <button class="btn secondary" type="button" id="paymentRejectBtn">Reject proof</button>
            </div>
            <div class="status" id="paymentReviewStatus" style="display:none; margin-top:10px;"></div>
          </div>
        </div>`,
      { size: "lg" }
    );

    async function submitReview(action) {
      try {
        await api(`/appointments/admin/${item._id}/payment-review`, {
          method: "PUT",
          body: JSON.stringify({
            action,
            adminNote: $("#paymentReviewNote")?.value || ""
          })
        });
        setStatus($("#paymentReviewStatus"), action === "confirm" ? "Advance payment confirmed" : "Payment proof rejected", "success");
        setTimeout(() => {
          hideModal();
          refreshFn();
        }, 350);
      } catch (err) {
        setStatus($("#paymentReviewStatus"), err.message, "error");
      }
    }

    $("#paymentConfirmBtn")?.addEventListener("click", () => submitReview("confirm"));
    $("#paymentRejectBtn")?.addEventListener("click", () => submitReview("reject"));
  }

  function showManualProposalModal(item, refreshFn) {
    const defaultDate = item.pendingProposal?.date || item.preferredDate || item.date || "";
    const defaultTime = item.pendingProposal?.time || item.time || "08:00";
    const defaultDuration = item.pendingProposal?.durationMin || item.durationMin || 180;
    const defaultNote = item.pendingProposal?.note || item.adminReviewNote || "";
    showModal(
      item.status === "proposal_sent" ? "Revise customer proposal" : "Send customer proposal",
      "Choose a real date/time option for the customer. The booking becomes final only after the customer accepts it in My Account.",
      `
        <form id="proposalForm" class="grid" style="gap:10px">
          <div class="admin-grid">
            <div class="col-4"><label>Date</label><input class="input" id="proposalDate" type="date" value="${escapeHtml(defaultDate)}" required /></div>
            <div class="col-4"><label>Start time</label><input class="input" id="proposalTime" type="time" value="${escapeHtml(defaultTime)}" required /></div>
            <div class="col-4"><label>Estimated duration (min)</label><input class="input" id="proposalDuration" type="number" min="15" step="15" value="${escapeHtml(defaultDuration)}" required /></div>
            <div class="col-12"><label>Message / salon note</label><textarea id="proposalNote" rows="5" placeholder="Explain why this slot suits the service...">${escapeHtml(defaultNote)}</textarea></div>
          </div>
          <button class="btn" type="submit">Send proposal</button>
          <div class="status" id="proposalStatus" style="display:none"></div>
        </form>`
    );
    const f = $("#proposalForm");
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api(`/appointments/admin/${item._id}/propose-manual`, {
          method: "PUT",
          body: JSON.stringify({
            date: $("#proposalDate").value.trim(),
            time: $("#proposalTime").value.trim(),
            durationMin: Number($("#proposalDuration").value || 0),
            adminReviewNote: $("#proposalNote").value
          })
        });
        setStatus($("#proposalStatus"), "Proposal sent", "success");
        setTimeout(() => {
          hideModal();
          refreshFn();
        }, 350);
      } catch (err) {
        setStatus($("#proposalStatus"), err.message, "error");
      }
    });
  }

  function wireAppointmentActions(list, refreshFn) {
    content.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.getAttribute("data-act");
        const id = btn.getAttribute("data-id");
        const item = (list || []).find((x) => x._id === id);
        if (!item) return;

        try {
          if (act === "approve") {
            await api(`/appointments/admin/${id}`, { method: "PUT", body: JSON.stringify({ status: "approved" }) });
          } else if (act === "cancel") {
            await api(`/appointments/admin/${id}`, { method: "PUT", body: JSON.stringify({ status: "cancelled" }) });
          } else if (act === "delete") {
            const note = prompt(
              "Optional note for the customer. Press OK to remove this booking from the salon side while keeping a customer-visible record.",
              item.adminDeletionReason || item.adminReviewNote || ""
            );
            if (note === null) return;
            await api(`/appointments/admin/${id}`, { method: "DELETE", body: JSON.stringify({ reason: note }) });
          } else if (act === "note") {
            showModal(
              "Edit salon note",
              "This note is used for manual-review communication and internal review context.",
              `
                <form id="noteForm" class="grid" style="gap:10px">
                  <div>
                    <label>Salon note</label>
                    <textarea id="noteText" rows="5" placeholder="Add a note for this booking...">${escapeHtml(item.adminReviewNote || "")}</textarea>
                  </div>
                  <button class="btn" type="submit">Save</button>
                  <div class="status" id="noteStatus" style="display:none"></div>
                </form>`
            );
            const f = $("#noteForm");
            f.addEventListener("submit", async (e) => {
              e.preventDefault();
              try {
                await api(`/appointments/admin/${id}`, { method: "PUT", body: JSON.stringify({ adminReviewNote: $("#noteText").value }) });
                setStatus($("#noteStatus"), "Saved", "success");
                setTimeout(() => {
                  hideModal();
                  refreshFn();
                }, 350);
              } catch (err) {
                setStatus($("#noteStatus"), err.message, "error");
              }
            });
            return;
          } else if (act === "view") {
            showAppointmentDetailsModal(item);
            return;
          } else if (act === "payment") {
            showPaymentReviewModal(item, refreshFn);
            return;
          } else if (act === "propose") {
            showManualProposalModal(item, refreshFn);
            return;
          }
          await refreshFn();
        } catch (e) {
          alert(e.message);
        }
      });
    });
  }

  async function viewServices() {
    return crudView({
      title: "Services",
      hint: "Controls services, booking modes, and booking flow on the website",
      listPath: "/services/admin/all",
      createPath: "/services",
      updatePathFor: (i) => `/services/${i._id}`,
      deletePathFor: (i) => `/services/${i._id}`,
      columns: [
        { header: "Category", render: (s) => escapeHtml(s.category) },
        { header: "Name", render: (s) => `<b>${escapeHtml(s.name)}</b>` },
        {
          header: "Booking",
          render: (s) => {
            const mode = s.bookingMode === "manual-review" ? "Manual review" : (s.allowAnyTimeBooking ? "24/7 exact slot" : "Instant slot");
            const extra = s.requiresPhotoUpload ? " • photo upload" : "";
            return `${escapeHtml(mode)}${escapeHtml(extra)}`;
          }
        },
        { header: "Price", render: (s) => `LKR ${fmtMoney(s.priceLKR)}` },
        { header: "Active", render: (s) => pill(s.isActive ? "Yes" : "No", s.isActive ? "ok" : "bad") }
      ],
      form: (s) => `
        <form id="crudForm" class="grid" style="gap:10px">
          <div class="admin-grid">
            <div class="col-6"><label>Category</label><input class="input" name="category" value="${escapeHtml(s.category || "")}" placeholder="Hair" required /></div>
            <div class="col-6"><label>Name</label><input class="input" name="name" value="${escapeHtml(s.name || "")}" placeholder="Hair Cut" required /></div>
            <div class="col-3"><label>Price (LKR)</label><input class="input" name="priceLKR" value="${escapeHtml(s.priceLKR || "")}" required /></div>
            <div class="col-3"><label>Duration (min)</label><input class="input" name="durationMin" value="${escapeHtml(s.durationMin || "")}" /></div>
            <div class="col-3"><label>Booking mode</label>
              <select name="bookingMode">
                <option value="instant" ${s.bookingMode !== "manual-review" ? "selected" : ""}>Instant slot booking</option>
                <option value="manual-review" ${s.bookingMode === "manual-review" ? "selected" : ""}>Manual review request</option>
              </select>
            </div>
            <div class="col-3"><label>Active</label>
              <select name="isActive">
                <option value="true" ${s.isActive !== false ? "selected" : ""}>Yes</option>
                <option value="false" ${s.isActive === false ? "selected" : ""}>No</option>
              </select>
            </div>
            <div class="col-6"><label>Allow 24-hour exact booking</label>
              <select name="allowAnyTimeBooking">
                <option value="false" ${s.allowAnyTimeBooking ? "" : "selected"}>No</option>
                <option value="true" ${s.allowAnyTimeBooking ? "selected" : ""}>Yes</option>
              </select>
              <div class="muted" style="font-size:12px; margin-top:6px;">Use this for normal dressing / bridal dressing services that can start at any hour.</div>
            </div>
            <div class="col-6"><label>Require photo upload</label>
              <select name="requiresPhotoUpload">
                <option value="false" ${(s.requiresPhotoUpload || s.bookingMode !== "manual-review") ? "" : "selected"}>No</option>
                <option value="true" ${s.requiresPhotoUpload || s.bookingMode === "manual-review" ? "selected" : ""}>Yes</option>
              </select>
              <div class="muted" style="font-size:12px; margin-top:6px;">Recommended for straightening, rebonding, relaxing, keratin, and similar hair assessments.</div>
            </div>
            <div class="col-12"><label>Image URL</label><input class="input" name="imageUrl" value="${escapeHtml(s.imageUrl || "")}" placeholder="https://..." /></div>
          </div>
          <button class="btn" type="submit">Save</button>
          <div class="status" id="crudStatus" style="display:none"></div>
        </form>`,
      normalize: (fd) => ({
        category: fd.get("category"),
        name: fd.get("name"),
        priceLKR: Number(fd.get("priceLKR")),
        durationMin: fd.get("durationMin") ? Number(fd.get("durationMin")) : undefined,
        imageUrl: fd.get("imageUrl") || "",
        bookingMode: fd.get("bookingMode") === "manual-review" ? "manual-review" : "instant",
        allowAnyTimeBooking: fd.get("allowAnyTimeBooking") === "true",
        requiresPhotoUpload: fd.get("requiresPhotoUpload") === "true",
        isActive: fd.get("isActive") === "true"
      })
    });
  }

  async function viewPackages() {
    return crudView({
      title: "Packages",
      hint: "Controls Packages page + package details",
      listPath: "/packages/admin/all",
      createPath: "/packages",
      updatePathFor: (i) => `/packages/${i._id}`,
      deletePathFor: (i) => `/packages/${i._id}`,
      columns: [
        { header: "Title", render: (p) => `<b>${escapeHtml(p.title)}</b>` },
        { header: "Price", render: (p) => `LKR ${fmtMoney(p.priceLKR)}` },
        { header: "Active", render: (p) => pill(p.isActive ? "Yes" : "No", p.isActive ? "ok" : "bad") }
      ],
      form: (p) => `
        <form id="crudForm" class="grid" style="gap:10px">
          <div class="admin-grid">
            <div class="col-8"><label>Title</label><input class="input" name="title" value="${escapeHtml(p.title || "")}" required /></div>
            <div class="col-4"><label>Price (LKR)</label><input class="input" name="priceLKR" value="${escapeHtml(p.priceLKR || "")}" required /></div>
            <div class="col-12"><label>Description</label><textarea name="description" rows="4">${escapeHtml(p.description || "")}</textarea></div>
            <div class="col-12"><label>Image URL</label><input class="input" name="imageUrl" value="${escapeHtml(p.imageUrl || "")}" required /></div>
            <div class="col-4"><label>Active</label>
              <select name="isActive">
                <option value="true" ${p.isActive !== false ? "selected" : ""}>Yes</option>
                <option value="false" ${p.isActive === false ? "selected" : ""}>No</option>
              </select>
            </div>
          </div>
          <button class="btn" type="submit">Save</button>
          <div class="status" id="crudStatus" style="display:none"></div>
        </form>`,
      normalize: (fd) => ({
        title: fd.get("title"),
        description: fd.get("description") || "",
        priceLKR: Number(fd.get("priceLKR")),
        imageUrl: fd.get("imageUrl"),
        isActive: fd.get("isActive") === "true"
      })
    });
  }

  async function viewGallery() {
    return crudView({
      title: "Gallery",
      hint: "Controls Gallery page",
      listPath: "/gallery/admin/all",
      createPath: "/gallery",
      updatePathFor: (i) => `/gallery/${i._id}`,
      deletePathFor: (i) => `/gallery/${i._id}`,
      columns: [
        { header: "Title", render: (g) => escapeHtml(g.title || "") },
        { header: "Image", render: (g) => `<a href="${escapeHtml(g.imageUrl)}" target="_blank" rel="noreferrer">Open</a>` },
        { header: "Tags", render: (g) => (g.tags || []).map((t) => `<span class="pill">${escapeHtml(t)}</span>`).join(" ") || "—" }
      ],
      form: (g) => `
        <form id="crudForm" class="grid" style="gap:10px">
          <div class="admin-grid">
            <div class="col-12"><label>Title</label><input class="input" name="title" value="${escapeHtml(g.title || "")}" /></div>
            <div class="col-12"><label>Image URL</label><input class="input" name="imageUrl" value="${escapeHtml(g.imageUrl || "")}" required /></div>
            <div class="col-12"><label>Tags (comma separated)</label><input class="input" name="tags" value="${escapeHtml((g.tags || []).join(", "))}" placeholder="bridal, hair" /></div>
          </div>
          <button class="btn" type="submit">Save</button>
          <div class="status" id="crudStatus" style="display:none"></div>
        </form>`,
      normalize: (fd) => ({
        title: fd.get("title") || "",
        imageUrl: fd.get("imageUrl"),
        tags: String(fd.get("tags") || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      })
    });
  }

  async function viewShopProducts() {
    return crudView({
      title: "Shop Products",
      hint: "Online shop items (visible on Shop page)",
      listPath: "/products/admin/all",
      createPath: "/products",
      updatePathFor: (i) => `/products/${i._id}`,
      deletePathFor: (i) => `/products/${i._id}`,
      columns: [
        { header: "Category", render: (p) => escapeHtml(p.category || "") },
        { header: "Name", render: (p) => `<b>${escapeHtml(p.name || "")}</b>` },
        { header: "Price", render: (p) => `LKR ${fmtMoney(p.priceLKR)}` },
        { header: "Stock", render: (p) => (p.stockQty === null || p.stockQty === undefined ? "—" : escapeHtml(p.stockQty)) },
        { header: "Active", render: (p) => pill(p.isActive ? "Yes" : "No", p.isActive ? "ok" : "bad") }
      ],
      form: (p) => `
        <form id="crudForm" class="grid" style="gap:10px">
          <div class="admin-grid">
            <div class="col-8"><label>Name</label><input class="input" name="name" value="${escapeHtml(p.name || "")}" required /></div>
            <div class="col-4"><label>Category</label><input class="input" name="category" list="shopCategorySuggestions" value="${escapeHtml(p.category || "")}" placeholder="Hair Care / Styling / Tools" />
            <datalist id="shopCategorySuggestions">
              <option value="Hair Care"></option>
              <option value="Hair Treatment"></option>
              <option value="Hair Styling"></option>
              <option value="Hair Color"></option>
              <option value="Hair Tools"></option>
              <option value="Skin Care"></option>
              <option value="Nail Care"></option>
              <option value="Bridal Essentials"></option>
              <option value="Accessories"></option>
            </datalist></div>

            <div class="col-4"><label>Price (LKR)</label><input class="input" name="priceLKR" value="${escapeHtml(p.priceLKR ?? "")}" required /></div>
            <div class="col-4"><label>Stock Qty (leave blank = unlimited)</label><input class="input" name="stockQty" value="${escapeHtml(p.stockQty === null || p.stockQty === undefined ? "" : p.stockQty)}" /></div>
            <div class="col-4"><label>Sort Order</label><input class="input" name="sortOrder" value="${escapeHtml(p.sortOrder ?? 0)}" /></div>

            <div class="col-12"><label>Description</label><textarea name="description" rows="4">${escapeHtml(p.description || "")}</textarea></div>
            <div class="col-12"><label>Image URL</label><input class="input" name="imageUrl" value="${escapeHtml(p.imageUrl || "")}" placeholder="https://..." /></div>

            <div class="col-4"><label>Active</label>
              <select name="isActive">
                <option value="true" ${p.isActive !== false ? "selected" : ""}>Yes</option>
                <option value="false" ${p.isActive === false ? "selected" : ""}>No</option>
              </select>
            </div>
          </div>
          <button class="btn" type="submit">Save</button>
          <div class="status" id="crudStatus" style="display:none"></div>
        </form>`,
      normalize: (fd) => ({
        name: fd.get("name"),
        category: fd.get("category") || "General",
        description: fd.get("description") || "",
        priceLKR: Number(fd.get("priceLKR")),
        stockQty: fd.get("stockQty") === "" ? null : Number(fd.get("stockQty") || 0),
        sortOrder: Number(fd.get("sortOrder") || 0),
        imageUrl: fd.get("imageUrl") || "",
        isActive: fd.get("isActive") === "true"
      })
    });
  }

  async function viewShopOrders() {
    viewTitle.textContent = "Shop Orders";
    viewHint.textContent = "Approve orders, assign courier tracking, and handle delivery confirmations/issues";
    content.innerHTML = `
      <div class="card">
        <div class="card-body">
          <div class="muted" style="margin-bottom:12px;">Real-world flow: order comes in → salon approves → parcel is handed to courier with a tracking number → customer checks tracking in My Account → customer confirms received / not received → salon replies to delivery issues.</div>
          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end">
            <div style="min-width:180px">
              <label>Status</label>
              <select id="oStatus">
                <option value="">All</option>
                <option value="pending" selected>Pending approval</option>
                <option value="confirmed">Approved / packing</option>
                <option value="shipped">Handed to courier</option>
                <option value="out_for_delivery">Out for delivery</option>
                <option value="delivered">Delivered by courier</option>
                <option value="delivery_issue">Delivery issue</option>
                                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div style="min-width:300px; flex:1;">
              <label>Search</label>
              <input class="input" id="oSearch" placeholder="Order no / customer / phone / email / tracking no" />
            </div>
            <button class="btn" type="button" id="oLoad">Load</button>
          </div>
          <div style="margin-top:12px" id="ordersWrap" class="muted">Loading...</div>
        </div>
      </div>`;

    async function load() {
      const status = $("#oStatus").value.trim();
      const search = $("#oSearch").value.trim();
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      if (search) qs.set("search", search);

      $("#ordersWrap").textContent = "Loading...";
      try {
        const list = await api(`/orders/admin/all?${qs.toString()}`);
        $("#ordersWrap").innerHTML = renderOrdersTable(list);
        wireOrderActions(list, load);
      } catch (e) {
        $("#ordersWrap").innerHTML = `<div class="status error">${escapeHtml(e.message)}</div>`;
      }
    }

    $("#oLoad").addEventListener("click", load);
    $("#oSearch").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        load();
      }
    });
    await load();
  }

  // ---------------- Messages (customer ↔ admin inbox) ----------------
  async function viewMessages() {
    viewTitle.textContent = "Messages";
    viewHint.textContent = "Customer messages from Contact page + your replies";

    content.innerHTML = `
      <div class="admin-grid">
        <div class="card col-4" style="min-height:520px; overflow:hidden;">
          <div class="card-body" style="display:flex; flex-direction:column; gap:10px; height:100%">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px">
              <h3 style="margin:0">Inbox</h3>
              <button class="btn secondary" id="msgRefreshBtn" type="button">Refresh</button>
            </div>
            <input class="input" id="msgSearch" placeholder="Search by name / email / phone" />
            <div id="threadsWrap" style="display:flex; flex-direction:column; gap:8px; overflow:auto; padding-right:4px;"></div>
            <div id="threadsStatus" class="muted"></div>
          </div>
        </div>

        <div class="card col-8" style="min-height:520px; overflow:hidden;">
          <div class="card-body" style="display:flex; flex-direction:column; gap:10px; height:100%">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px">
              <div>
                <h3 style="margin:0" id="chatTitle">Select a conversation</h3>
                <div class="muted" id="chatSub"></div>
              </div>
              <div class="actions">
                <button class="btn secondary" id="markReadBtn" type="button" disabled>Mark read</button>
              </div>
            </div>

            <div id="chatWrap" style="flex:1; overflow:auto; padding:10px; border-radius:16px; border:1px solid rgba(255,255,255,0.10); background: rgba(0,0,0,0.10);"></div>

            <form id="replyForm" style="display:flex; gap:10px; align-items:flex-end;">
              <div style="flex:1">
                <label>Reply</label>
                <textarea class="input" id="replyText" rows="2" placeholder="Type your reply..." required></textarea>
              </div>
              <button class="btn" id="replyBtn" type="submit" disabled>Send</button>
            </form>
            <div class="status" id="msgStatus" style="display:none"></div>
          </div>
        </div>
      </div>
    `;

    const threadsWrap = document.getElementById("threadsWrap");
    const threadsStatus = document.getElementById("threadsStatus");
    const msgStatus = document.getElementById("msgStatus");
    const msgRefreshBtn = document.getElementById("msgRefreshBtn");
    const msgSearch = document.getElementById("msgSearch");
    const chatTitle = document.getElementById("chatTitle");
    const chatSub = document.getElementById("chatSub");
    const chatWrap = document.getElementById("chatWrap");
    const replyForm = document.getElementById("replyForm");
    const replyText = document.getElementById("replyText");
    const replyBtn = document.getElementById("replyBtn");
    const markReadBtn = document.getElementById("markReadBtn");

    let threads = [];
    let activeCustomerId = "";

    function bubble(m) {
      const isAdmin = m.sender === "admin";
      const align = isAdmin ? "flex-end" : "flex-start";
      const bg = isAdmin ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.20)";
      const border = "1px solid rgba(255,255,255,0.12)";
      const when = m.createdAt ? new Date(m.createdAt).toLocaleString() : "";
      return `
        <div style="display:flex; justify-content:${align}; margin:8px 0;">
          <div style="max-width:78%; padding:10px 12px; border-radius:14px; background:${bg}; border:${border};">
            <div style="font-size:13px; line-height:1.4; white-space:pre-wrap;">${escapeHtml(m.message || "")}</div>
            <div class="muted" style="margin-top:6px; font-size:11px;">${escapeHtml(isAdmin ? "Admin" : "Customer")} • ${escapeHtml(when)}</div>
          </div>
        </div>
      `;
    }

    function renderThreads(list) {
      const q = String(msgSearch.value || "").trim().toLowerCase();
      const filtered = (list || []).filter((t) => {
        if (!q) return true;
        return [t.customerName, t.customerEmail, t.customerPhone].some((x) => String(x || "").toLowerCase().includes(q));
      });

      if (!filtered.length) {
        threadsWrap.innerHTML = `<div class="muted">No messages yet.</div>`;
        return;
      }

      threadsWrap.innerHTML = filtered
        .map((t) => {
          const isActive = String(t.customerId) === String(activeCustomerId);
          const unread = Number(t.unreadFromCustomer || 0);
          return `
            <button class="nav-btn" data-thread="${escapeHtml(t.customerId)}" style="display:block; width:100%; ${isActive ? "background: rgba(255,255,255,0.12);" : ""}">
              <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px">
                <div style="text-align:left">
                  <div style="font-weight:800">${escapeHtml(t.customerName || "Customer")}</div>
                  <div class="muted" style="font-size:12px">${escapeHtml(t.customerEmail || "")}${t.customerPhone ? " • " + escapeHtml(t.customerPhone) : ""}</div>
                </div>
                ${unread ? `<span class="pill warn">${unread} new</span>` : `<span class="pill">—</span>`}
              </div>
              <div class="muted" style="margin-top:8px; font-size:12px; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${escapeHtml(t.lastSender === "admin" ? "You: " : "Customer: ")}${escapeHtml(t.lastMessage || "")}
              </div>
            </button>
          `;
        })
        .join("");

      threadsWrap.querySelectorAll("button[data-thread]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const cid = btn.getAttribute("data-thread");
          await openThread(cid);
        });
      });
    }

    async function loadThreads() {
      threadsStatus.textContent = "Loading...";
      try {
        threads = await api("/messages/admin/threads");
        threadsStatus.textContent = "";
        renderThreads(threads);
      } catch (e) {
        threadsStatus.textContent = "";
        setStatus(msgStatus, e.message, "error");
      }
    }

    async function openThread(customerId) {
      activeCustomerId = customerId;
      replyBtn.disabled = false;
      markReadBtn.disabled = false;
      chatWrap.innerHTML = `<div class="muted">Loading conversation...</div>`;
      try {
        const data = await api(`/messages/admin/thread/${customerId}`);
        const c = data.customer || {};
        chatTitle.textContent = c.name ? `Chat with ${c.name}` : "Chat";
        chatSub.textContent = `${c.email || ""}${c.phone ? " • " + c.phone : ""}`;

        const msgs = data.messages || [];
        chatWrap.innerHTML = msgs.length ? msgs.map(bubble).join("") : `<div class="muted">No messages in this thread.</div>`;
        chatWrap.scrollTop = chatWrap.scrollHeight;

        // Mark unread customer messages as read on open
        try {
          await api(`/messages/admin/thread/${customerId}/read`, { method: "PUT", body: JSON.stringify({}) });
        } catch {}

        await loadThreads();
      } catch (e) {
        setStatus(msgStatus, e.message, "error");
      }
    }

    msgRefreshBtn.addEventListener("click", async () => {
      setStatus(msgStatus, "", "");
      await loadThreads();
      if (activeCustomerId) await openThread(activeCustomerId);
    });

    msgSearch.addEventListener("input", () => renderThreads(threads));

    markReadBtn.addEventListener("click", async () => {
      if (!activeCustomerId) return;
      try {
        await api(`/messages/admin/thread/${activeCustomerId}/read`, { method: "PUT", body: JSON.stringify({}) });
        await loadThreads();
        setStatus(msgStatus, "Marked as read", "success");
      } catch (e) {
        setStatus(msgStatus, e.message, "error");
      }
    });

    replyForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!activeCustomerId) return;
      const text = String(replyText.value || "").trim();
      if (!text) return;
      setStatus(msgStatus, "Sending...", "");
      replyBtn.disabled = true;
      try {
        await api(`/messages/admin/thread/${activeCustomerId}/reply`, {
          method: "POST",
          body: JSON.stringify({ message: text })
        });
        replyText.value = "";
        setStatus(msgStatus, "Sent", "success");
        await openThread(activeCustomerId);
      } catch (err) {
        setStatus(msgStatus, err.message, "error");
      } finally {
        replyBtn.disabled = false;
      }
    });

    await loadThreads();
  }

  function shopOrderStatusLabel(status) {
    const map = {
      pending: "Pending approval",
      confirmed: "Approved / packing",
      shipped: "Handed to courier",
      out_for_delivery: "Out for delivery",
      delivered: "Delivered by courier",
      completed: "Customer received",
      delivery_issue: "Delivery issue",
      cancelled: "Cancelled"
    };
    return map[String(status || "").trim()] || String(status || "—");
  }

  function shopOrderStatusKind(status) {
    if (["completed"].includes(status)) return "ok";
    if (["cancelled", "delivery_issue"].includes(status)) return "bad";
    return "warn";
  }

  function shopOrderIssueLabel(state) {
    const map = {
      none: "No issue",
      open: "Waiting for salon reply",
      replied: "Salon replied",
      resolved: "Resolved"
    };
    return map[String(state || "").trim()] || String(state || "—");
  }

  function shopOrderCustomerConfirmLabel(state) {
    const map = {
      pending: "Awaiting customer",
      received: "Customer received",
      not_received: "Customer reported not received"
    };
    return map[String(state || "").trim()] || String(state || "—");
  }

  function shopOrderRef(item) {
    return item?.orderNumber || `ORD-${String(item?._id || "").slice(-6).toUpperCase()}`;
  }

  function shopOrderItemOrderedQty(item) {
    const qty = Number(item?.qty || 0);
    return Number.isFinite(qty) && qty > 0 ? Math.trunc(qty) : 0;
  }

  function shopOrderItemCancelledQty(item) {
    const ordered = shopOrderItemOrderedQty(item);
    const cancelled = Number(item?.cancelledQty || 0);
    if (!Number.isFinite(cancelled) || cancelled <= 0) return 0;
    return Math.min(ordered, Math.trunc(cancelled));
  }

  function shopOrderItemRemainingQty(item) {
    return Math.max(0, shopOrderItemOrderedQty(item) - shopOrderItemCancelledQty(item));
  }

  function shopOrderOriginalTotal(order) {
    const stored = Number(order?.originalTotalLKR);
    if (Number.isFinite(stored) && stored >= 0) return stored;
    return (order?.items || []).reduce((sum, item) => sum + (Number(item?.priceLKR || 0) * shopOrderItemOrderedQty(item)), 0);
  }

  function shopOrderCancelledTotal(order) {
    const stored = Number(order?.cancelledTotalLKR);
    if (Number.isFinite(stored) && stored >= 0) return stored;
    return (order?.items || []).reduce((sum, item) => sum + (Number(item?.priceLKR || 0) * shopOrderItemCancelledQty(item)), 0);
  }

  function shopOrderCurrentTotal(order) {
    const stored = Number(order?.totalLKR);
    if (Number.isFinite(stored) && stored >= 0) return stored;
    return Math.max(0, shopOrderOriginalTotal(order) - shopOrderCancelledTotal(order));
  }

  function shopOrderRemainingUnits(order) {
    return (order?.items || []).reduce((sum, item) => sum + shopOrderItemRemainingQty(item), 0);
  }

  function shopOrderOrderedUnits(order) {
    return (order?.items || []).reduce((sum, item) => sum + shopOrderItemOrderedQty(item), 0);
  }

  function renderShopOrderCancellationHistory(order) {
    const history = Array.isArray(order?.itemCancellationHistory) ? order.itemCancellationHistory : [];
    if (!history.length) return `<div class="muted">No item cancellations yet.</div>`;
    return history
      .slice()
      .reverse()
      .map((entry) => `
        <div style="padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,.10); background:rgba(194,24,91,.08); margin-top:8px;">
          <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
            <div><b>${escapeHtml(entry?.name || "Cancelled item")} x${escapeHtml(entry?.qty || 0)}</b></div>
            <div class="muted">${escapeHtml(shopDateTime(entry?.at))}</div>
          </div>
          <div class="muted" style="margin-top:6px;">By: ${escapeHtml(entry?.by || "customer")} • Value: LKR ${fmtMoney(entry?.amountLKR || 0)}</div>
          ${entry?.note ? `<div class="muted" style="margin-top:6px; white-space:pre-wrap;">${escapeHtml(entry.note)}</div>` : ""}
        </div>
      `)
      .join("");
  }

  function shopDateTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
  }

  function shopDateOnly(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function shopSafeUrl(value) {
    const url = String(value || "").trim();
    return /^https?:\/\//i.test(url) ? url : "";
  }

  function renderShopOrderCustomerUpdate(order) {
    const d = order?.delivery || {};
    const shouldShow = ["shipped", "out_for_delivery", "delivered", "completed", "delivery_issue"].includes(order?.status)
      || d.customerConfirmationStatus !== "pending"
      || d.issueStatus !== "none";
    if (!shouldShow) return `<div class="muted">No delivery feedback yet.</div>`;

    const confirm = shopOrderCustomerConfirmLabel(d.customerConfirmationStatus || "pending");
    const issue = shopOrderIssueLabel(d.issueStatus || "none");
    const note = d.customerConfirmationMessage ? `<div class="muted" style="margin-top:6px; white-space:pre-wrap;">${escapeHtml(d.customerConfirmationMessage)}</div>` : "";
    return `
      <div>${pill(confirm, d.customerConfirmationStatus === "received" ? "ok" : d.customerConfirmationStatus === "not_received" ? "bad" : "warn")}</div>
      <div class="muted" style="margin-top:6px;">Issue: ${escapeHtml(issue)}</div>
      <div class="muted" style="margin-top:6px;">Last reply: ${escapeHtml(shopDateTime(d.customerConfirmationAt))}</div>
      ${note}
    `;
  }

  function renderShopOrderTimeline(order) {
    const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
    if (!history.length) return `<div class="muted">No timeline events yet.</div>`;
    return history
      .slice()
      .reverse()
      .map((entry) => `
        <div style="padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,.10); background:rgba(255,255,255,.04); margin-top:8px;">
          <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
            <div><b>${escapeHtml(entry?.title || shopOrderStatusLabel(entry?.status))}</b></div>
            <div class="muted">${escapeHtml(shopDateTime(entry?.at))}</div>
          </div>
          <div class="muted" style="margin-top:6px;">By: ${escapeHtml(entry?.by || "system")}</div>
          ${entry?.note ? `<div class="muted" style="margin-top:6px; white-space:pre-wrap;">${escapeHtml(entry.note)}</div>` : ""}
        </div>
      `)
      .join("");
  }

  function renderShopOrderFeedbackThread(order) {
    const thread = Array.isArray(order?.delivery?.feedbackThread) ? order.delivery.feedbackThread : [];
    if (!thread.length) return `<div class="muted">No delivery conversation yet.</div>`;
    return thread
      .map((entry) => {
        const kind = entry?.sender === "admin" ? "rgba(255,255,255,.08)" : entry?.sender === "customer" ? "rgba(194,24,91,.10)" : "rgba(255,255,255,.04)";
        const label = entry?.sender === "admin" ? "Salon" : entry?.sender === "customer" ? "Customer" : "System";
        return `
          <div style="padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,.10); background:${kind}; margin-top:8px;">
            <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
              <div><b>${escapeHtml(label)}</b></div>
              <div class="muted">${escapeHtml(shopDateTime(entry?.at))}</div>
            </div>
            <div style="margin-top:6px; white-space:pre-wrap; line-height:1.45;">${escapeHtml(entry?.message || "—")}</div>
          </div>
        `;
      })
      .join("");
  }

  function renderShopOrderReview(order) {
    const review = order?.review || {};
    const rating = Number(review?.rating || 0);
    if (!(review?.isPublished && rating >= 1)) return `<div class="muted">No public review yet.</div>`;

    const chips = [];
    if (review?.productQualityRating) chips.push(`Product ${review.productQualityRating}/5`);
    if (review?.deliveryServiceRating) chips.push(`Delivery ${review.deliveryServiceRating}/5`);
    if (review?.salonSupportRating) chips.push(`Support ${review.salonSupportRating}/5`);
    if (review?.wouldRecommend === true) chips.push("Would recommend");
    if (review?.wouldRecommend === false) chips.push("Not recommended yet");

    const scoreKind = rating >= 4 ? "ok" : rating <= 2 ? "bad" : "warn";
    return `
      <div>${pill(`${rating}/5 verified review`, scoreKind)}</div>
      ${review?.title ? `<div style="margin-top:10px;"><b>${escapeHtml(review.title)}</b></div>` : ""}
      ${review?.comment ? `<div class="muted" style="margin-top:8px; white-space:pre-wrap;">${escapeHtml(review.comment)}</div>` : `<div class="muted" style="margin-top:8px;">Customer left a star rating without extra text.</div>`}
      <div class="muted" style="margin-top:8px;">Updated: ${escapeHtml(shopDateTime(review?.updatedAt || review?.submittedAt))}</div>
      ${chips.length ? `<div class="muted" style="margin-top:8px;">${escapeHtml(chips.join(" • "))}</div>` : ""}
    `;
  }

  function openShopOrderDetailsModal(order) {
    const items = (order.items || [])
      .map((it) => {
        const orderedQty = shopOrderItemOrderedQty(it);
        const cancelledQty = shopOrderItemCancelledQty(it);
        const remainingQty = shopOrderItemRemainingQty(it);
        const currentValue = Number(it?.priceLKR || 0) * remainingQty;
        const cancelledValue = Number(it?.priceLKR || 0) * cancelledQty;
        return `
          <div style="display:flex; justify-content:space-between; gap:10px; padding:10px 0; border-bottom:1px solid rgba(255,255,255,.08);">
            <div>
              <b>${escapeHtml(it.name)}</b>
              <div class="muted" style="margin-top:4px;">Ordered ${escapeHtml(orderedQty)} • Remaining ${escapeHtml(remainingQty)}${cancelledQty > 0 ? ` • Cancelled ${escapeHtml(cancelledQty)}` : ""}</div>
            </div>
            <div style="text-align:right;">
              <div><b>LKR ${fmtMoney(currentValue)}</b></div>
              <div class="muted" style="margin-top:4px;">Unit: LKR ${fmtMoney(it.priceLKR)}</div>
              ${cancelledQty > 0 ? `<div class="muted" style="margin-top:4px;">Cancelled value: LKR ${fmtMoney(cancelledValue)}</div>` : ""}
            </div>
          </div>`;
      })
      .join("");

    const currentTotal = shopOrderCurrentTotal(order);
    const originalTotal = shopOrderOriginalTotal(order);
    const cancelledTotal = shopOrderCancelledTotal(order);

    showModal(
      `Order ${shopOrderRef(order)}`,
      `Status: ${shopOrderStatusLabel(order.status)}`,
      `
        <div class="admin-grid">
          <div class="col-6">
            <div class="muted">Customer</div>
            <div style="margin-top:6px;"><b>${escapeHtml(order.customerSnapshot?.name || "")}</b></div>
            <div class="muted" style="margin-top:4px;">${escapeHtml(order.customerSnapshot?.phone || "")} ${order.customerSnapshot?.email ? `• ${escapeHtml(order.customerSnapshot.email)}` : ""}</div>
          </div>
          <div class="col-6">
            <div class="muted">Order summary</div>
            <div style="margin-top:6px;">Placed: ${escapeHtml(shopDateTime(order.createdAt))}</div>
            <div style="margin-top:4px;">Current total: <b>LKR ${fmtMoney(currentTotal)}</b></div>
            <div style="margin-top:4px;">Original total: LKR ${fmtMoney(originalTotal)}</div>
            <div style="margin-top:4px;">Cancelled value: LKR ${fmtMoney(cancelledTotal)}</div>
            <div style="margin-top:4px;">Units remaining: ${escapeHtml(shopOrderRemainingUnits(order))} / ${escapeHtml(shopOrderOrderedUnits(order))}</div>
            <div style="margin-top:4px;">Status: ${pill(shopOrderStatusLabel(order.status), shopOrderStatusKind(order.status))}</div>
          </div>

          <div class="col-6">
            <div class="muted">Delivery address</div>
            <div style="margin-top:6px; white-space:pre-wrap;">${escapeHtml(order.deliveryAddress || "—")}</div>
            <div class="muted" style="margin-top:10px;">Customer note</div>
            <div style="margin-top:6px; white-space:pre-wrap;">${escapeHtml(order.customerNote || "—")}</div>
          </div>
          <div class="col-6">
            <div class="muted">Courier details</div>
            <div style="margin-top:6px;">Courier: <b>${escapeHtml(order.delivery?.courierService || "—")}</b></div>
            <div style="margin-top:4px;">Tracking: <b>${escapeHtml(order.delivery?.trackingNumber || "—")}</b></div>
            <div style="margin-top:4px;">ETA: ${escapeHtml(shopDateOnly(order.delivery?.expectedDeliveryDate) || "—")}</div>
            <div style="margin-top:4px;">Tracking URL: ${shopSafeUrl(order.delivery?.trackingUrl) ? `<a href="${escapeHtml(shopSafeUrl(order.delivery?.trackingUrl))}" target="_blank" rel="noreferrer">Open</a>` : "—"}</div>
            <div style="margin-top:4px;">Shipped: ${escapeHtml(shopDateTime(order.delivery?.shippedAt))}</div>
            <div style="margin-top:4px;">Out for delivery: ${escapeHtml(shopDateTime(order.delivery?.outForDeliveryAt))}</div>
            <div style="margin-top:4px;">Delivered: ${escapeHtml(shopDateTime(order.delivery?.deliveredAt))}</div>
          </div>

          <div class="col-12">
            <div class="muted">Items</div>
            <div style="margin-top:6px;">${items || `<div class="muted">No items.</div>`}</div>
          </div>

          <div class="col-12">
            <div class="muted">Customer-visible note</div>
            <div style="margin-top:6px; white-space:pre-wrap;">${escapeHtml(order.adminNote || "—")}</div>
          </div>

          <div class="col-6">
            <div class="muted">Customer delivery update</div>
            <div style="margin-top:6px;">${renderShopOrderCustomerUpdate(order)}</div>
          </div>
          <div class="col-6">
            <div class="muted">Delivery conversation</div>
            <div style="margin-top:6px;">${renderShopOrderFeedbackThread(order)}</div>
          </div>

          <div class="col-12">
            <div class="muted">Item cancellation history</div>
            <div style="margin-top:6px;">${renderShopOrderCancellationHistory(order)}</div>
          </div>

          <div class="col-12">
            <div class="muted">Public customer review</div>
            <div style="margin-top:6px;">${renderShopOrderReview(order)}</div>
          </div>

          <div class="col-12">
            <div class="muted">Timeline</div>
            <div style="margin-top:6px;">${renderShopOrderTimeline(order)}</div>
          </div>
        </div>
      `,
      { size: "lg" }
    );
  }

  function openDispatchModal(order, refreshFn) {
    const existingDate = shopDateOnly(order.delivery?.expectedDeliveryDate);
    const willMarkShipped = ["pending", "confirmed"].includes(order.status);
    showModal(
      willMarkShipped ? "Hand to courier" : "Update courier details",
      willMarkShipped
        ? "Add courier service + tracking number, then mark this order as handed to the courier."
        : "Update courier details that the customer sees in My Account.",
      `
        <form id="dispatchForm" class="grid" style="gap:10px;">
          <div class="admin-grid">
            <div class="col-6"><label>Courier service</label><input class="input" name="courierService" value="${escapeHtml(order.delivery?.courierService || "")}" placeholder="Example: Pronto, Domex, DHL" required /></div>
            <div class="col-6"><label>Tracking number</label><input class="input" name="trackingNumber" value="${escapeHtml(order.delivery?.trackingNumber || "")}" placeholder="Courier tracking number" required /></div>
            <div class="col-12"><label>Tracking URL (optional)</label><input class="input" name="trackingUrl" value="${escapeHtml(order.delivery?.trackingUrl || "")}" placeholder="https://courier.example/track/..." /></div>
            <div class="col-6"><label>Expected delivery date (optional)</label><input class="input" type="date" name="expectedDeliveryDate" value="${escapeHtml(existingDate)}" /></div>
            <div class="col-12"><label>Customer-visible note (optional)</label><textarea name="adminNote" rows="4" placeholder="Example: Courier pickup completed. Delivery usually takes 1-2 working days.">${escapeHtml(order.adminNote || "")}</textarea></div>
          </div>
          <button class="btn" type="submit">${willMarkShipped ? "Save and mark handed to courier" : "Save courier details"}</button>
          <div class="status" id="dispatchStatus" style="display:none"></div>
        </form>`,
      { size: "md" }
    );

    const form = $("#dispatchForm");
    const statusEl = $("#dispatchStatus");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        courierService: fd.get("courierService") || "",
        trackingNumber: fd.get("trackingNumber") || "",
        trackingUrl: fd.get("trackingUrl") || "",
        expectedDeliveryDate: fd.get("expectedDeliveryDate") || "",
        adminNote: fd.get("adminNote") || ""
      };
      if (willMarkShipped) payload.status = "shipped";
      setStatus(statusEl, "Saving courier details...", "");
      try {
        await api(`/orders/admin/${order._id}`, { method: "PUT", body: JSON.stringify(payload) });
        setStatus(statusEl, "Saved", "success");
        setTimeout(() => {
          hideModal();
          refreshFn();
        }, 250);
      } catch (err) {
        setStatus(statusEl, err.message, "error");
      }
    });
  }

  function openShopOrderNoteModal(order, refreshFn) {
    showModal(
      "Customer-visible note",
      "This note is visible in the customer's My Account page.",
      `
        <form id="noteForm" class="grid" style="gap:10px">
          <div>
            <label>Note</label>
            <textarea id="noteText" rows="5" placeholder="Example: Courier pickup is scheduled for tomorrow morning.">${escapeHtml(order.adminNote || "")}</textarea>
          </div>
          <button class="btn" type="submit">Save</button>
          <div class="status" id="noteStatus" style="display:none"></div>
        </form>`
    );
    const form = $("#noteForm");
    const statusEl = $("#noteStatus");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api(`/orders/admin/${order._id}`, { method: "PUT", body: JSON.stringify({ adminNote: $("#noteText").value }) });
        setStatus(statusEl, "Saved", "success");
        setTimeout(() => {
          hideModal();
          refreshFn();
        }, 250);
      } catch (err) {
        setStatus(statusEl, err.message, "error");
      }
    });
  }

  function openIssueReplyModal(order, refreshFn) {
    showModal(
      `Reply to ${shopOrderRef(order)}`,
      "Send a delivery reply to the customer. This will appear in their My Account page and Messages area.",
      `
        <div class="muted" style="margin-bottom:12px;">Current customer update:</div>
        <div style="margin-bottom:12px;">${renderShopOrderCustomerUpdate(order)}</div>
        <div style="margin-bottom:12px;">${renderShopOrderFeedbackThread(order)}</div>
        <form id="issueReplyForm" class="grid" style="gap:10px; margin-top:12px;">
          <div>
            <label>Reply message</label>
            <textarea id="issueReplyText" rows="5" placeholder="Example: We checked with the courier. They will attempt redelivery tomorrow." required></textarea>
          </div>
          <div class="admin-grid">
            <div class="col-6">
              <label>Issue status</label>
              <select id="issueStatusSelect">
                <option value="open" ${order.delivery?.issueStatus === "open" ? "selected" : ""}>Open</option>
                <option value="replied" ${order.delivery?.issueStatus !== "resolved" ? "selected" : ""}>Replied</option>
                <option value="resolved" ${order.delivery?.issueStatus === "resolved" ? "selected" : ""}>Resolved</option>
              </select>
            </div>
            <div class="col-6">
              <label>Update order status (optional)</label>
              <select id="issueOrderStatusSelect">
                <option value="">Keep current status</option>
                <option value="delivery_issue" ${order.status === "delivery_issue" ? "selected" : ""}>Delivery issue</option>
                <option value="delivered">Delivered by courier</option>
                              </select>
            </div>
          </div>
          <button class="btn" type="submit">Send reply</button>
          <div class="status" id="issueReplyStatus" style="display:none"></div>
        </form>`,
      { size: "lg" }
    );

    const form = $("#issueReplyForm");
    const statusEl = $("#issueReplyStatus");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setStatus(statusEl, "Sending reply...", "");
      try {
        await api(`/orders/admin/${order._id}/delivery-reply`, {
          method: "POST",
          body: JSON.stringify({
            message: $("#issueReplyText").value,
            issueStatus: $("#issueStatusSelect").value,
            status: $("#issueOrderStatusSelect").value || undefined
          })
        });
        setStatus(statusEl, "Reply sent", "success");
        setTimeout(() => {
          hideModal();
          refreshFn();
        }, 250);
      } catch (err) {
        setStatus(statusEl, err.message, "error");
      }
    });
  }

  function renderOrdersTable(list) {
    if (!list || !list.length) return `<div class="muted">No orders found.</div>`;
    return `
      <table class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Order</th>
            <th>Customer</th>
            <th>Courier / Tracking</th>
            <th>ETA</th>
            <th>Customer update</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${list
            .map((o) => {
              const d = o.delivery || {};
              const c = o.customerSnapshot || {};
              const courierCell = d.courierService || d.trackingNumber
                ? `
                    <div><b>${escapeHtml(d.courierService || "Courier pending")}</b></div>
                    <div class="muted" style="margin-top:4px;">Tracking: ${escapeHtml(d.trackingNumber || "—")}</div>
                    ${shopSafeUrl(d.trackingUrl) ? `<div class="muted" style="margin-top:4px;"><a href="${escapeHtml(shopSafeUrl(d.trackingUrl))}" target="_blank" rel="noreferrer">Open tracking</a></div>` : ""}
                  `
                : `<div class="muted">Waiting for courier assignment</div>`;

              const actions = [];
              if (o.status === "pending") {
                actions.push(`<button class="btn" data-oact="confirm" data-id="${o._id}">Approve</button>`);
              }
              if (!["cancelled", "completed"].includes(o.status)) {
                actions.push(`<button class="btn" data-oact="dispatch" data-id="${o._id}">Courier</button>`);
              }
              if (["confirmed", "shipped", "delivery_issue"].includes(o.status)) {
                actions.push(`<button class="btn" data-oact="out" data-id="${o._id}">Out for delivery</button>`);
              }
              if (["shipped", "out_for_delivery", "delivery_issue"].includes(o.status)) {
                actions.push(`<button class="btn" data-oact="delivered" data-id="${o._id}">Delivered</button>`);
              }
              if (o.status === "delivery_issue" || ["open", "replied"].includes(String(d.issueStatus || "none"))) {
                actions.push(`<button class="btn secondary" data-oact="reply" data-id="${o._id}">Reply issue</button>`);
              }
              if (["pending", "confirmed"].includes(o.status)) {
                actions.push(`<button class="btn secondary" data-oact="cancel" data-id="${o._id}">Cancel</button>`);
              }
              actions.push(`<button class="btn secondary" data-oact="note" data-id="${o._id}">Customer note</button>`);
              actions.push(`<button class="btn secondary" data-oact="view" data-id="${o._id}">View</button>`);

              return `
                <tr>
                  <td>${escapeHtml(shopDateTime(o.createdAt))}</td>
                  <td>
                    <b>${escapeHtml(shopOrderRef(o))}</b>
                    <div class="muted" style="margin-top:4px;">${escapeHtml(shopOrderRemainingUnits(o))} active unit(s) / ${escapeHtml(shopOrderOrderedUnits(o))} ordered</div>
                    <div style="margin-top:4px;"><b>LKR ${fmtMoney(shopOrderCurrentTotal(o))}</b></div>
                    ${shopOrderCancelledTotal(o) > 0 ? `<div class="muted" style="margin-top:4px;">Cancelled value: LKR ${fmtMoney(shopOrderCancelledTotal(o))}</div>` : ""}
                  </td>
                  <td>
                    <b>${escapeHtml(c.name || "")}</b>
                    <div class="muted">${escapeHtml(c.phone || "")}</div>
                    <div class="muted">${escapeHtml(c.email || "")}</div>
                  </td>
                  <td>${courierCell}</td>
                  <td>${escapeHtml(shopDateOnly(d.expectedDeliveryDate) || "—")}</td>
                  <td>${renderShopOrderCustomerUpdate(o)}</td>
                  <td>${pill(shopOrderStatusLabel(o.status), shopOrderStatusKind(o.status))}</td>
                  <td><div class="actions">${actions.join("")}</div></td>
                </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;
  }

  function wireOrderActions(list, refreshFn) {
    content.querySelectorAll("button[data-oact]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.getAttribute("data-oact");
        const id = btn.getAttribute("data-id");
        const order = (list || []).find((x) => x._id === id);
        if (!order) return;

        try {
          if (act === "confirm") {
            await api(`/orders/admin/${id}`, { method: "PUT", body: JSON.stringify({ status: "confirmed" }) });
            await refreshFn();
            return;
          }
          if (act === "dispatch") {
            openDispatchModal(order, refreshFn);
            return;
          }
          if (act === "out") {
            await api(`/orders/admin/${id}`, { method: "PUT", body: JSON.stringify({ status: "out_for_delivery" }) });
            await refreshFn();
            return;
          }
          if (act === "delivered") {
            await api(`/orders/admin/${id}`, { method: "PUT", body: JSON.stringify({ status: "delivered" }) });
            await refreshFn();
            return;
          }
          if (act === "cancel") {
            if (!confirm("Cancel this order before courier handover?")) return;
            await api(`/orders/admin/${id}`, { method: "PUT", body: JSON.stringify({ status: "cancelled" }) });
            await refreshFn();
            return;
          }
          if (act === "note") {
            openShopOrderNoteModal(order, refreshFn);
            return;
          }
          if (act === "reply") {
            openIssueReplyModal(order, refreshFn);
            return;
          }
          if (act === "view") {
            openShopOrderDetailsModal(order);
            return;
          }
        } catch (e) {
          alert(e.message);
        }
      });
    });
  }

  async function viewStaff() {
    if (!window.MalkiStaffModule || typeof window.MalkiStaffModule.render !== "function") {
      viewTitle.textContent = "Staff Management";
      viewHint.textContent = "Staff module failed to load";
      content.innerHTML = `<div class="status error">staff-module.js was not loaded correctly.</div>`;
      return;
    }

    return window.MalkiStaffModule.render({
      api,
      content,
      viewTitle,
      viewHint,
      pill,
      escapeHtml,
      fmtMoney,
      showModal,
      hideModal,
      setStatus,
      currentUser
    });
  }

  async function viewSettings() {
    viewTitle.textContent = "Settings";
    viewHint.textContent = "Booking rules, contact details, and customer payment instructions";
    content.innerHTML = `
      <div class="card">
        <div class="card-body">
          <div class="muted" style="margin-bottom:12px">These settings drive the booking page, booking categories, and contact section.</div>
          <form id="settingsForm" class="grid" style="gap:10px">
            <div class="admin-grid">
              <div class="col-4"><label>Max appointments per staff per day</label><input class="input" name="maxAppointmentsPerDay" placeholder="4" /></div>
              <div class="col-8"><label>Legacy time slots (comma separated, optional)</label><input class="input" name="timeSlots" placeholder="09:00, 11:00, 13:00, 15:00" /></div>

              <div class="col-3"><label>Regular slot open time</label><input class="input" name="openTime" placeholder="08:00" /></div>
              <div class="col-3"><label>Regular slot close time</label><input class="input" name="closeTime" placeholder="17:00" /></div>
              <div class="col-3"><label>Manual request open</label><input class="input" name="manualRequestOpenTime" placeholder="08:00" /></div>
              <div class="col-3"><label>Manual request close</label><input class="input" name="manualRequestCloseTime" placeholder="17:00" /></div>

              <div class="col-3"><label>Slot interval (min)</label><input class="input" name="slotIntervalMin" placeholder="15" /></div>
              <div class="col-9"><div class="muted" style="margin-top:32px;">Regular instant bookings use open/close times. Manual hair requests collect a preferred date only, then the salon sends a real time proposal after review. Services marked as 24-hour exact booking ignore those limits.</div></div>

              <div class="col-6"><label>Site name</label><input class="input" name="siteName" /></div>
              <div class="col-6"><label>Phone</label><input class="input" name="phone" /></div>
              <div class="col-6"><label>Email</label><input class="input" name="email" /></div>
              <div class="col-6"><label>WhatsApp</label><input class="input" name="whatsapp" /></div>
              <div class="col-12"><label>Address</label><input class="input" name="address" /></div>
              <div class="col-6"><label>Facebook</label><input class="input" name="facebook" /></div>
              <div class="col-6"><label>Instagram</label><input class="input" name="instagram" /></div>
              <div class="col-12"><label>Google Maps Embed URL</label><input class="input" name="googleMapsEmbedUrl" placeholder="https://www.google.com/maps/embed?..." /></div>

              <div class="col-4">
                <label>Contact messaging</label>
                <select name="contactMessagingEnabled">
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
                <div class="muted" style="font-size:12px; margin-top:6px">Controls the Contact page “Send a message” form.</div>
              </div>

              <div class="col-12"><hr style="border:none; border-top:1px solid rgba(255,255,255,.12); margin:8px 0 0;" /></div>
              <div class="col-12"><h3 style="margin:0;">Advance payment settings</h3><div class="muted" style="margin-top:4px;">These details appear to customers after a booking is approved, so they can pay the required advance and upload a slip.</div></div>
              <div class="col-3"><label>Advance payment %</label><input class="input" name="advancePaymentPercent" placeholder="25" /></div>
              <div class="col-9"><label>General payment note</label><input class="input" name="paymentInstructionsNote" placeholder="Upload the transfer proof after sending the required advance payment." /></div>
              <div class="col-3"><label>Bank account name</label><input class="input" name="bankAccountName" /></div>
              <div class="col-3"><label>Bank name</label><input class="input" name="bankName" /></div>
              <div class="col-3"><label>Bank branch</label><input class="input" name="bankBranch" /></div>
              <div class="col-3"><label>Bank account number</label><input class="input" name="bankAccountNumber" /></div>
              <div class="col-6"><label>Bank transfer instructions</label><input class="input" name="bankTransferInstructions" placeholder="Use this text for over-the-counter bank deposits." /></div>
              <div class="col-6"><label>Online transfer instructions</label><input class="input" name="onlineTransferInstructions" placeholder="Use this text for mobile/online bank transfers." /></div>
              <div class="col-4"><label>Crypto wallet label</label><input class="input" name="cryptoWalletLabel" placeholder="USDT Wallet" /></div>
              <div class="col-4"><label>Crypto wallet address</label><input class="input" name="cryptoWalletAddress" /></div>
              <div class="col-4"><label>Crypto network</label><input class="input" name="cryptoNetwork" placeholder="TRC20" /></div>
              <div class="col-6"><label>Crypto instructions</label><input class="input" name="cryptoInstructions" placeholder="Add any wallet/exchange instructions for the customer." /></div>
              <div class="col-6">
                <label>Crypto QR code image (optional)</label>
                <input class="input" type="file" id="cryptoQrFile" accept="image/*" />
                <div class="actions" style="margin-top:10px;">
                  <button class="btn secondary" type="button" id="uploadCryptoQrBtn">Upload QR image</button>
                  <button class="btn secondary" type="button" id="removeCryptoQrBtn">Remove QR image</button>
                </div>
                <div class="muted" style="font-size:12px; margin-top:6px;">Upload a QR image generated from the same wallet address so customers can scan and pay faster.</div>
                <input type="hidden" name="cryptoWalletQrImageUrl" />
                <div id="cryptoQrPreview" style="margin-top:10px;"></div>
                <div class="status" id="cryptoQrStatus" style="display:none; margin-top:10px;"></div>
              </div>
              <div class="col-4"><label>Skrill email</label><input class="input" name="skrillEmail" /></div>
              <div class="col-8"><label>Skrill instructions</label><input class="input" name="skrillInstructions" placeholder="Add any Skrill-specific instructions." /></div>
            </div>
            <button class="btn" type="submit">Save settings</button>
            <div class="status" id="settingsStatus" style="display:none"></div>
          </form>
        </div>
      </div>`;

    const formEl = $("#settingsForm");
    const statusEl = $("#settingsStatus");
    const qrInputEl = $("#cryptoQrFile");
    const qrUploadBtn = $("#uploadCryptoQrBtn");
    const qrRemoveBtn = $("#removeCryptoQrBtn");
    const qrPreviewEl = $("#cryptoQrPreview");
    const qrStatusEl = $("#cryptoQrStatus");

    function renderCryptoQrPreview(url) {
      const safeUrl = String(url || "").trim();
      if (!qrPreviewEl) return;
      if (!safeUrl) {
        qrPreviewEl.innerHTML = `<div class="muted">No crypto QR image uploaded yet.</div>`;
        if (qrRemoveBtn) qrRemoveBtn.disabled = true;
        return;
      }
      qrPreviewEl.innerHTML = `
        <div class="admin-media-preview">
          <div class="muted" style="margin-bottom:8px;">Current crypto QR preview</div>
          <img src="${escapeHtml(imgUrl(safeUrl))}" alt="Crypto QR preview" />
        </div>`;
      if (qrRemoveBtn) qrRemoveBtn.disabled = false;
    }

    async function uploadCryptoQrImage(file) {
      const fd = new FormData();
      fd.append("qr", file);
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE}/uploads/crypto-qr`, {
        method: "POST",
        headers,
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "QR upload failed");
      return data.file || {};
    }

    try {
      const s = await api("/settings", { method: "GET" });
      formEl.maxAppointmentsPerDay.value = s.maxAppointmentsPerDay ?? 4;
      formEl.timeSlots.value = (s.timeSlots || []).join(", ");
      formEl.openTime.value = s.openTime || "08:00";
      formEl.closeTime.value = s.closeTime || "17:00";
      formEl.manualRequestOpenTime.value = s.manualRequestOpenTime || "08:00";
      formEl.manualRequestCloseTime.value = s.manualRequestCloseTime || "17:00";
      formEl.slotIntervalMin.value = s.slotIntervalMin ?? 15;
      formEl.siteName.value = s.siteName || "";
      formEl.phone.value = s.phone || "";
      formEl.email.value = s.email || "";
      formEl.whatsapp.value = s.whatsapp || "";
      formEl.address.value = s.address || "";
      formEl.facebook.value = s.facebook || "";
      formEl.instagram.value = s.instagram || "";
      formEl.googleMapsEmbedUrl.value = s.googleMapsEmbedUrl || "";
      formEl.contactMessagingEnabled.value = String(s.contactMessagingEnabled !== false);
      formEl.advancePaymentPercent.value = s.advancePaymentPercent ?? 25;
      formEl.paymentInstructionsNote.value = s.paymentInstructionsNote || "";
      formEl.bankAccountName.value = s.bankAccountName || "";
      formEl.bankName.value = s.bankName || "";
      formEl.bankBranch.value = s.bankBranch || "";
      formEl.bankAccountNumber.value = s.bankAccountNumber || "";
      formEl.bankTransferInstructions.value = s.bankTransferInstructions || "";
      formEl.onlineTransferInstructions.value = s.onlineTransferInstructions || "";
      formEl.cryptoWalletLabel.value = s.cryptoWalletLabel || "";
      formEl.cryptoWalletAddress.value = s.cryptoWalletAddress || "";
      formEl.cryptoNetwork.value = s.cryptoNetwork || "";
      formEl.cryptoInstructions.value = s.cryptoInstructions || "";
      formEl.cryptoWalletQrImageUrl.value = s.cryptoWalletQrImageUrl || "";
      formEl.skrillEmail.value = s.skrillEmail || "";
      formEl.skrillInstructions.value = s.skrillInstructions || "";
      renderCryptoQrPreview(formEl.cryptoWalletQrImageUrl.value);
    } catch (e) {
      setStatus(statusEl, e.message, "error");
    }

    renderCryptoQrPreview(formEl.cryptoWalletQrImageUrl?.value || "");

    qrUploadBtn?.addEventListener("click", async () => {
      const file = qrInputEl?.files?.[0] || null;
      if (!file) {
        setStatus(qrStatusEl, "Please choose a QR image file first.", "error");
        return;
      }
      setStatus(qrStatusEl, "Uploading QR image...", "");
      qrUploadBtn.disabled = true;
      try {
        const uploaded = await uploadCryptoQrImage(file);
        formEl.cryptoWalletQrImageUrl.value = uploaded.url || "";
        if (qrInputEl) qrInputEl.value = "";
        renderCryptoQrPreview(formEl.cryptoWalletQrImageUrl.value);
        setStatus(qrStatusEl, "QR image uploaded. Save settings to publish it to customers.", "success");
      } catch (err) {
        setStatus(qrStatusEl, err.message, "error");
      } finally {
        qrUploadBtn.disabled = false;
      }
    });

    qrRemoveBtn?.addEventListener("click", () => {
      formEl.cryptoWalletQrImageUrl.value = "";
      if (qrInputEl) qrInputEl.value = "";
      renderCryptoQrPreview("");
      setStatus(qrStatusEl, "QR image removed from this form. Save settings to apply the change.", "success");
    });

    formEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        maxAppointmentsPerDay: Number(formEl.maxAppointmentsPerDay.value || 4),
        timeSlots: String(formEl.timeSlots.value || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        openTime: String(formEl.openTime.value || "08:00").trim(),
        closeTime: String(formEl.closeTime.value || "17:00").trim(),
        manualRequestOpenTime: String(formEl.manualRequestOpenTime.value || "08:00").trim(),
        manualRequestCloseTime: String(formEl.manualRequestCloseTime.value || "17:00").trim(),
        slotIntervalMin: Number(formEl.slotIntervalMin.value || 15),
        siteName: formEl.siteName.value || "",
        phone: formEl.phone.value || "",
        email: formEl.email.value || "",
        whatsapp: formEl.whatsapp.value || "",
        address: formEl.address.value || "",
        facebook: formEl.facebook.value || "",
        instagram: formEl.instagram.value || "",
        googleMapsEmbedUrl: formEl.googleMapsEmbedUrl.value || "",
        contactMessagingEnabled: String(formEl.contactMessagingEnabled.value) !== "false",
        advancePaymentPercent: Number(formEl.advancePaymentPercent.value || 25),
        paymentInstructionsNote: formEl.paymentInstructionsNote.value || "",
        bankAccountName: formEl.bankAccountName.value || "",
        bankName: formEl.bankName.value || "",
        bankBranch: formEl.bankBranch.value || "",
        bankAccountNumber: formEl.bankAccountNumber.value || "",
        bankTransferInstructions: formEl.bankTransferInstructions.value || "",
        onlineTransferInstructions: formEl.onlineTransferInstructions.value || "",
        cryptoWalletLabel: formEl.cryptoWalletLabel.value || "",
        cryptoWalletAddress: formEl.cryptoWalletAddress.value || "",
        cryptoNetwork: formEl.cryptoNetwork.value || "",
        cryptoInstructions: formEl.cryptoInstructions.value || "",
        cryptoWalletQrImageUrl: formEl.cryptoWalletQrImageUrl.value || "",
        skrillEmail: formEl.skrillEmail.value || "",
        skrillInstructions: formEl.skrillInstructions.value || ""
      };
      setStatus(statusEl, "Saving...", "");
      try {
        await api("/settings", { method: "PUT", body: JSON.stringify(payload) });
        setStatus(statusEl, "Saved", "success");
      } catch (err) {
        setStatus(statusEl, err.message, "error");
      }
    });
  }

  async function loadMe() {
    const res = await api("/auth/me", { method: "GET" });
    const u = res.user || {};
    currentUser = u;
    const roleLabel = u.role === "staff_manager" ? "Staff Manager" : "Admin";
    const nameOrEmail = u.displayName || u.email || "Signed in";
    whoami.textContent = u.email ? `${roleLabel}: ${nameOrEmail}` : "Signed in";
    applyRoleNavigation();
  }

  function setActiveNav(view) {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  }

  async function render() {
    if (currentUser?.role === "staff_manager" && currentView !== "staff") currentView = "staff";
    setActiveNav(currentView);
    if (currentView === "dashboard") return viewDashboard();
    if (currentView === "appointments") return viewAppointments();
    if (currentView === "services") return viewServices();
    if (currentView === "packages") return viewPackages();
    if (currentView === "gallery") return viewGallery();
    if (currentView === "shopProducts") return viewShopProducts();
    if (currentView === "shopOrders") return viewShopOrders();
    if (currentView === "messages") return viewMessages();
    if (currentView === "staff") return viewStaff();
    if (currentView === "settings") return viewSettings();
    return viewDashboard();
  }

  async function safeRender() {
    try {
      await render();
    } catch (err) {
      viewHint.textContent = "";
      content.innerHTML = `<div class="card"><div class="card-body"><div class="status error">${escapeHtml(err.message || "This section could not be loaded.")}</div></div></div>`;
      console.error("Admin render failed", err);
    }
  }

  // -------- Auth wiring --------
  async function checkAuth() {
    if (!token) {
      currentUser = null;
      setLoginVisible(true);
      whoami.textContent = "Not signed in";
      applyRoleNavigation();
      return false;
    }
    try {
      await loadMe();
      setLoginVisible(false);
      return true;
    } catch {
      forceLogout();
      return false;
    }
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus(loginStatus, "Signing in...", "");
    const email = loginForm.email.value;
    const password = loginForm.password.value;
    try {
      const res = await api("/auth/login", { method: "POST", headers: { Authorization: "" }, body: JSON.stringify({ email, password }) });
      token = res.token;
      sessionStorage.setItem(TOK_KEY, token);
      await loadMe();
      setLoginVisible(false);
      setStatus(loginStatus, "", "");
      await safeRender();
    } catch (err) {
      setStatus(loginStatus, err.message, "error");
    }
  });

  logoutBtn.addEventListener("click", () => {
    forceLogout();
  });

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      currentView = btn.dataset.view;
      await safeRender();
    });
  });

  (async () => {
    const ok = await checkAuth();
    if (ok) await safeRender();
  })();
})();
