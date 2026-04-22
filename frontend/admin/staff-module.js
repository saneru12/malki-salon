(function () {
  function monthValue(date = new Date()) {
    const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 7);
  }

  function dateValue(date = new Date()) {
    const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 10);
  }

  function modeLabel(value) {
    if (value === "salary_only") return "Salary only";
    if (value === "commission_only") return "Commission only";
    return "Salary + commission";
  }

  function attendanceLabel(value) {
    return {
      present: "Present",
      half_day: "Half day",
      absent: "Absent",
      paid_leave: "Paid leave",
      unpaid_leave: "Unpaid leave"
    }[value] || value || "—";
  }

  function attendanceKind(value) {
    if (value === "present" || value === "paid_leave") return "ok";
    if (value === "half_day") return "warn";
    return "bad";
  }

  function adjustmentSignedAmount(item) {
    const amount = Number(item?.amountLKR || 0);
    return item?.type === "deduction" ? -amount : amount;
  }

  function isAutoOvertimeAdjustment(item) {
    return String(item?.sourceType || "") === "appointment_overtime" || item?.isSystemGenerated === true;
  }

  function hoursFromMinutes(value) {
    return Number(((Math.max(0, Number(value) || 0)) / 60).toFixed(2));
  }

  function rateSourceLabel(value) {
    if (value === "salary_hourly") return "Salary hourly";
    if (value === "commission_hourly") return "Commission hourly";
    if (value === "manual_staff_ot_hourly") return "Manual OT hourly";
    return "Rate pending";
  }

  function overtimePolicyMeta(compensation = {}) {
    if (compensation?.overtimeDisabled) {
      return {
        label: "No OT",
        description: "System OT is disabled for this staff member.",
        kind: "bad"
      };
    }

    const manualRate = Math.max(0, Number(compensation?.overtimeHourlyRateLKR || 0));
    if (manualRate > 0) {
      return {
        label: `Manual • LKR ${manualRate.toFixed(2)}/h`,
        description: "Manual OT hourly rate is active.",
        kind: "ok"
      };
    }

    return {
      label: "Auto",
      description: "Auto OT is calculated from salary/commission data.",
      kind: "warn"
    };
  }

  function summaryCardsHtml(cards, eh, money) {
    return `
      <div class="admin-grid" style="margin-bottom:12px;">
        ${cards
          .map(
            (card) => `
              <div class="card col-3">
                <div class="card-body">
                  <div class="muted">${eh(card.label)}</div>
                  <div style="font-size:28px; font-weight:800; margin-top:6px;">${card.isMoney ? `LKR ${money(card.value)}` : eh(String(card.value))}</div>
                </div>
              </div>`
          )
          .join("")}
      </div>`;
  }

  function getAssignments(staff) {
    return (Array.isArray(staff?.serviceAssignments) ? staff.serviceAssignments : []).filter(
      (item) => item && item.isActive !== false && (item.service || item.serviceId)
    );
  }

  function getStaffAssignment(staff, serviceRef) {
    const target = String(serviceRef || "");
    return getAssignments(staff).find((item) => String(item.service?._id || item.serviceId || "") === target) || null;
  }

  function getServicesForStaff(staff, services) {
    const allServices = Array.isArray(services) ? services.filter((item) => item.isActive !== false) : [];
    const assignments = getAssignments(staff);
    if (!assignments.length) return allServices;
    const allowed = new Set(assignments.map((item) => String(item.service?._id || item.serviceId || "")));
    return allServices.filter((service) => allowed.has(String(service._id)));
  }

  function buildStaffOptions(staffList, eh, selected = "", includeAll = true) {
    const top = includeAll ? `<option value="">All staff</option>` : `<option value="">Select staff</option>`;
    return (
      top +
      (staffList || [])
        .map((staff) => `<option value="${eh(String(staff._id))}" ${String(staff._id) === String(selected) ? "selected" : ""}>${eh(`${staff.name} (${staff.staffId})`)}</option>`)
        .join("")
    );
  }

  function buildServiceOptions(services, eh, selected = "", includeBlank = true) {
    const top = includeBlank ? `<option value="">No specific service</option>` : "";
    return (
      top +
      (services || [])
        .map(
          (service) =>
            `<option value="${eh(String(service._id))}" ${String(service._id) === String(selected) ? "selected" : ""}>${eh(`${service.category} - ${service.name}`)}</option>`
        )
        .join("")
    );
  }

  function attendanceStatusLocksTime(status) {
    return ["paid_leave", "unpaid_leave", "absent"].includes(String(status || ""));
  }

  window.MalkiStaffModule = {
    async render(ctx) {
      const eh = ctx.escapeHtml;
      const money = ctx.fmtMoney;
      const pill = ctx.pill;
      const currentRole = String(ctx.currentUser?.role || "");
      const canManageStaffManagerAccess = currentRole === "admin";
      const state = {
        tab: "profiles",
        month: monthValue(),
        staffRef: "",
        staffList: [],
        services: [],
        staffManagerUsers: []
      };

      ctx.viewTitle.textContent = "Staff Management";
      ctx.viewHint.textContent = "Profiles, service assignment, attendance, work logs, and payroll";

      async function loadBase() {
        const requests = [ctx.api("/staff/admin/all"), ctx.api("/services/admin/all")];
        if (canManageStaffManagerAccess) requests.push(ctx.api("/auth/staff-managers"));
        const [staffList, services, staffManagerUsers = []] = await Promise.all(requests);
        state.staffList = staffList || [];
        state.services = services || [];
        state.staffManagerUsers = canManageStaffManagerAccess ? (staffManagerUsers || []) : [];
      }

      function profileTableHtml() {
        if (!state.staffList.length) {
          return `<div class="muted">No staff members yet. Add your first staff profile.</div>`;
        }

        return `
          <table class="table">
            <thead>
              <tr>
                <th>Staff</th>
                <th>Contact</th>
                <th>Assigned services</th>
                <th>Payroll mode</th>
                <th>Base salary</th>
                <th>Default commission</th>
                <th>OT rule</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${state.staffList
                .map((staff) => {
                  const assignments = getAssignments(staff);
                  const preview = assignments
                    .slice(0, 2)
                    .map((item) => eh(item.service?.name || "Service"))
                    .join("<br>");
                  const compensation = staff.compensation || {};
                  return `
                    <tr>
                      <td>
                        <b>${eh(staff.name)}</b>
                        <div class="muted">${eh(staff.staffId)} • ${eh(staff.role || "")}</div>
                      </td>
                      <td>
                        <div>${eh(staff.phone || "—")}</div>
                        <div class="muted">${eh(staff.email || "")}</div>
                      </td>
                      <td>
                        <b>${eh(String(assignments.length))}</b>
                        <div class="muted">${preview || "All active services"}${assignments.length > 2 ? "<br>..." : ""}</div>
                      </td>
                      <td>${eh(modeLabel(compensation.payrollMode))}</td>
                      <td>LKR ${money(compensation.baseSalaryLKR || 0)}</td>
                      <td>${eh(String(compensation.defaultCommissionRatePct || 0))}%</td>
                      <td>${eh(overtimePolicyMeta(compensation).label)}</td>
                      <td>${pill(staff.isActive ? "Active" : "Inactive", staff.isActive ? "ok" : "bad")}</td>
                      <td>
                        <div class="actions">
                          <button class="btn" type="button" data-sm-act="edit-profile" data-id="${eh(String(staff._id))}">Edit</button>
                          <button class="btn secondary" type="button" data-sm-act="delete-profile" data-id="${eh(String(staff._id))}">Delete</button>
                        </div>
                      </td>
                    </tr>`;
                })
                .join("")}
            </tbody>
          </table>`;
      }

      async function attendanceHtml() {
        const qs = new URLSearchParams({ month: state.month });
        if (state.staffRef) qs.set("staffRef", state.staffRef);
        const data = await ctx.api(`/staff-management/attendance?${qs.toString()}`);
        const cards = summaryCardsHtml(
          [
            { label: "Present", value: data.summary.present || 0 },
            { label: "Half day", value: data.summary.halfDay || 0 },
            { label: "Absent", value: data.summary.absent || 0 },
            { label: "Paid units", value: Number(data.summary.paidUnits || 0).toFixed(1) }
          ],
          eh,
          money
        );
        const table = (data.records || []).length
          ? `
            <div class="staff-table-scroll staff-table-scroll--attendance">
              <table class="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Staff</th>
                    <th>Status</th>
                    <th>In / Out</th>
                    <th>Note</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${data.records
                    .map(
                      (row) => `
                      <tr>
                        <td>${eh(row.date)}</td>
                        <td><b>${eh(row.staffName)}</b><div class="muted">${eh(row.staffId)}</div></td>
                        <td>${pill(attendanceLabel(row.status), attendanceKind(row.status))}</td>
                        <td>${eh(row.inTime || "—")}<div class="muted">${eh(row.outTime || "—")}</div></td>
                        <td>${eh(row.note || "—")}</td>
                        <td>
                          <div class="actions">
                            <button class="btn" type="button" data-sm-act="edit-attendance" data-id="${eh(String(row._id))}">Edit</button>
                            <button class="btn secondary" type="button" data-sm-act="delete-attendance" data-id="${eh(String(row._id))}">Delete</button>
                          </div>
                        </td>
                      </tr>`
                    )
                    .join("")}
                </tbody>
              </table>
            </div>`
          : `<div class="muted">No attendance records for this month yet.</div>`;
        return cards + table;
      }

      async function workLogsHtml() {
        const qs = new URLSearchParams({ month: state.month });
        if (state.staffRef) qs.set("staffRef", state.staffRef);
        const data = await ctx.api(`/staff-management/work-logs?${qs.toString()}`);
        const cards = summaryCardsHtml(
          [
            { label: "Completed jobs", value: data.summary.jobsCount || 0 },
            { label: "Revenue", value: data.summary.grossRevenue || 0, isMoney: true },
            { label: "Commission", value: data.summary.commissionTotal || 0, isMoney: true },
            { label: "Cancelled logs", value: data.summary.cancelledCount || 0 }
          ],
          eh,
          money
        );
        const table = (data.records || []).length
          ? `
            <div class="staff-table-scroll staff-table-scroll--worklogs">
              <table class="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Staff / Customer</th>
                    <th>Service</th>
                    <th>Amount</th>
                    <th>Commission</th>
                    <th>Source</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${data.records
                    .map(
                      (row) => `
                        <tr>
                          <td>${eh(row.workDate)}</td>
                          <td><b>${eh(row.staffName)}</b><div class="muted">${eh(row.customerName || "Walk-in / Manual")}</div></td>
                          <td><b>${eh(row.serviceName || "General work")}</b><div class="muted">${eh(row.serviceCategory || row.note || "")}</div></td>
                          <td>LKR ${money(row.grossAmountLKR || 0)}<div class="muted">Qty ${eh(String(row.quantity || 1))} • Unit LKR ${money(row.unitPriceLKR || 0)}</div></td>
                          <td>${eh(String(row.commissionRatePct || 0))}%<div class="muted">LKR ${money(row.commissionAmountLKR || 0)}</div></td>
                          <td>${pill(row.source === "appointment" ? "Appointment" : row.source === "walk_in" ? "Walk-in" : "Manual", row.status === "cancelled" ? "bad" : "ok")}</td>
                          <td>
                            <div class="actions">
                              <button class="btn" type="button" data-sm-act="edit-worklog" data-id="${eh(String(row._id))}">Edit</button>
                              <button class="btn secondary" type="button" data-sm-act="delete-worklog" data-id="${eh(String(row._id))}">Delete</button>
                            </div>
                          </td>
                        </tr>`
                    )
                    .join("")}
                </tbody>
              </table>
            </div>`
          : `<div class="muted">No work logs in this month yet.</div>`;
        return cards + table;
      }

      async function payrollHtml() {
        const qs = new URLSearchParams({ month: state.month });
        if (state.staffRef) qs.set("staffRef", state.staffRef);
        const [payroll, adjustments] = await Promise.all([
          ctx.api(`/staff-management/payroll?${qs.toString()}`),
          ctx.api(`/staff-management/adjustments?${qs.toString()}`)
        ]);

        const overtimeAllowanceTotal = (payroll.summaries || []).reduce(
          (sum, row) => sum + Number(row.adjustments?.overtimeAllowance || 0),
          0
        );
        const otherAdjustmentsNetTotal = (payroll.totals.adjustmentsNet || 0) - overtimeAllowanceTotal;

        const cards = summaryCardsHtml(
          [
            { label: "Base salary payable", value: payroll.totals.baseSalaryPayable || 0, isMoney: true },
            { label: "Commission payable", value: payroll.totals.commissionPayable || 0, isMoney: true },
            { label: "OT allowances", value: overtimeAllowanceTotal, isMoney: true },
            { label: "Other adjustments net", value: otherAdjustmentsNetTotal, isMoney: true },
            { label: "Total payroll", value: payroll.totals.totalPayable || 0, isMoney: true }
          ],
          eh,
          money
        );

        const payrollTable = (payroll.summaries || []).length
          ? `
            <div class="staff-table-scroll staff-table-scroll--payroll">
              <table class="table">
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Attendance</th>
                    <th>Work summary</th>
                    <th>Pay breakdown</th>
                    <th>Total payable</th>
                  </tr>
                </thead>
                <tbody>
                  ${payroll.summaries
                    .map((row) => {
                      const overtimeAllowance = Number(row.adjustments?.overtimeAllowance || 0);
                      const otherAdjustmentsNet = Number(row.adjustments?.net || 0) - overtimeAllowance;
                      const overtimeHours = hoursFromMinutes(row.adjustments?.overtimeMinutes || 0);
                      return `
                        <tr>
                          <td><b>${eh(row.staffName)}</b><div class="muted">${eh(row.staffId)} • ${eh(row.role || "")}</div></td>
                          <td>
                            <div>Paid units: <b>${eh(Number(row.attendance?.paidUnits || 0).toFixed(1))}</b> / ${eh(String(row.compensation?.expectedWorkingDays || 26))}</div>
                            <div class="muted">Present ${eh(String(row.attendance?.present || 0))} • Half ${eh(String(row.attendance?.halfDay || 0))} • Absent ${eh(String(row.attendance?.absent || 0))}</div>
                          </td>
                          <td>
                            <div>Jobs: <b>${eh(String(row.work?.jobsCount || 0))}</b></div>
                            <div class="muted">Revenue LKR ${money(row.work?.grossRevenue || 0)} • Commission LKR ${money(row.work?.commissionTotal || 0)}</div>
                            <div class="muted">Outside-hours bookings: ${eh(String(row.adjustments?.overtimeCount || 0))} • OT hours ${eh(overtimeHours.toFixed(2))}</div>
                          </td>
                          <td>
                            <div>Base: LKR ${money(row.baseSalaryPayable || 0)}</div>
                            <div>Commission: LKR ${money(row.commissionPayable || 0)}</div>
                            <div class="muted">OT allowance: LKR ${money(overtimeAllowance)}</div>
                            <div class="muted">Other adjustments: LKR ${money(otherAdjustmentsNet)}</div>
                          </td>
                          <td><b>LKR ${money(row.totalPayable || 0)}</b></td>
                        </tr>`;
                    })
                    .join("")}
                </tbody>
              </table>
            </div>`
          : `<div class="muted">No payroll rows for the selected month.</div>`;

        const adjustmentTable = (adjustments.records || []).length
          ? `
            <div style="margin-top:16px">
              <h3 style="margin:0 0 10px">Payroll adjustments</h3>
              <div class="muted" style="margin-bottom:10px;">Approved 24/7 bookings that run outside normal salon hours are added here automatically as OT allowances. Use “Add manual adjustment” only for extra allowances or deductions.</div>
              <div class="staff-table-scroll staff-table-scroll--adjustments">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Staff</th>
                      <th>Month</th>
                      <th>Source</th>
                      <th>Details</th>
                      <th>Amount</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${adjustments.records
                      .map((item) => {
                        const autoOt = isAutoOvertimeAdjustment(item);
                        const signed = adjustmentSignedAmount(item);
                        const overtimeHours = hoursFromMinutes(item.overtimeMinutes || 0);
                        const amountText = `${signed < 0 ? "-" : "+"}LKR ${money(Math.abs(signed))}`;
                        const detailsHtml = autoOt
                          ? `
                            <b>${eh(item.label)}</b>
                            <div class="muted">${eh(item.appointmentDate || "")} ${eh(item.appointmentTime || "")}${item.appointmentEndTime ? `-${eh(item.appointmentEndTime)}` : ""} • ${eh(item.serviceName || "24/7 booking")}</div>
                            <div class="muted">Outside normal hours: ${eh(overtimeHours.toFixed(2))}h • Window ${eh(item.regularWindowStart || "08:00")}-${eh(item.regularWindowEnd || "17:00")}</div>
                            <div class="muted">${eh(rateSourceLabel(item.rateSource))}${Number(item.overtimeHourlyRateLKR || 0) > 0 ? ` • LKR ${money(item.overtimeHourlyRateLKR)}/h` : ""}</div>`
                          : `
                            <b>${eh(item.label)}</b>
                            <div class="muted">${eh(item.note || "Manual payroll adjustment")}</div>`;
                        const actionsHtml = autoOt
                          ? `<span class="muted">Auto-synced from the linked approved booking</span>`
                          : `
                            <div class="actions">
                              <button class="btn" type="button" data-sm-act="edit-adjustment" data-id="${eh(String(item._id))}">Edit</button>
                              <button class="btn secondary" type="button" data-sm-act="delete-adjustment" data-id="${eh(String(item._id))}">Delete</button>
                            </div>`;
                        return `
                          <tr>
                            <td><b>${eh(item.staffName)}</b><div class="muted">${eh(item.staffId)}</div></td>
                            <td>${eh(item.month)}</td>
                            <td>
                              <div class="actions">
                                ${pill(autoOt ? "Auto OT" : "Manual", autoOt ? "warn" : "ok")}
                                ${pill(item.type === "deduction" ? "Deduction" : "Allowance", item.type === "deduction" ? "bad" : "ok")}
                              </div>
                            </td>
                            <td>${detailsHtml}</td>
                            <td><b>${amountText}</b></td>
                            <td>${actionsHtml}</td>
                          </tr>`;
                      })
                      .join("")}
                  </tbody>
                </table>
              </div>
            </div>`
          : `<div style="margin-top:16px" class="muted">No payroll adjustments added for this month yet.</div>`;

        return cards + payrollTable + adjustmentTable;
      }

      function staffManagerAccessHtml() {
        if (!canManageStaffManagerAccess) return "";
        const rows = (state.staffManagerUsers || []).length
          ? `
            <table class="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${(state.staffManagerUsers || [])
                  .map(
                    (user) => `
                      <tr>
                        <td><b>${eh(user.displayName || "Staff Manager")}</b><div class="muted">Role: Staff manager</div></td>
                        <td>${eh(user.email || "")}</td>
                        <td>${pill(user.isActive !== false ? "Active" : "Inactive", user.isActive !== false ? "ok" : "bad")}</td>
                        <td>${eh(user.createdAt ? new Date(user.createdAt).toLocaleString() : "—")}</td>
                        <td>
                          <div class="actions">
                            <button class="btn" type="button" data-sm-act="edit-staff-manager" data-id="${eh(String(user._id))}">Edit</button>
                            <button class="btn secondary" type="button" data-sm-act="delete-staff-manager" data-id="${eh(String(user._id))}">Delete</button>
                          </div>
                        </td>
                      </tr>`
                  )
                  .join("")}
              </tbody>
            </table>`
          : `<div class="muted">No separate staff manager login has been created yet.</div>`;

        return `
          <div class="card" style="margin-bottom:12px; border:1px solid rgba(255,255,255,0.08);">
            <div class="card-body">
              <div style="display:flex; justify-content:space-between; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:12px;">
                <div>
                  <h3 style="margin:0 0 4px;">Staff manager access</h3>
                  <div class="muted">Create a separate login for the person who controls the Staff section. They can sign in directly from <code>staff-management.html</code> without using the full admin panel.</div>
                </div>
                <button class="btn" type="button" id="smAccessAddBtn">Add staff manager login</button>
              </div>
              ${rows}
            </div>
          </div>`;
      }

      function actionButtonsHtml() {
        if (state.tab === "profiles") {
          return `<button class="btn" type="button" id="smAddBtn">Add staff member</button>`;
        }
        if (state.tab === "attendance") {
          return `<button class="btn" type="button" id="smAddBtn">Mark attendance</button>`;
        }
        if (state.tab === "worklogs") {
          return `
            <div class="actions">
              <button class="btn" type="button" id="smAddBtn">Add work log</button>
              <button class="btn secondary" type="button" id="smConvertBtn">From appointment</button>
            </div>`;
        }
        return `<button class="btn" type="button" id="smAddBtn">Add manual adjustment</button>`;
      }

      async function bodyHtml() {
        if (state.tab === "profiles") return profileTableHtml();
        if (state.tab === "attendance") return attendanceHtml();
        if (state.tab === "worklogs") return workLogsHtml();
        return payrollHtml();
      }

      function getStaffByRef(staffRef) {
        return state.staffList.find((item) => String(item._id) === String(staffRef)) || null;
      }

      function getServiceByRef(serviceRef) {
        return state.services.find((item) => String(item._id) === String(serviceRef)) || null;
      }

      async function openStaffManagerForm(user) {
        ctx.showModal(
          user ? "Edit staff manager login" : "Add staff manager login",
          user ? "Update the external staff portal credentials." : "Create a separate login for the staff section.",
          `
            <form id="smAccessForm" class="grid" style="gap:12px;">
              <div class="admin-grid">
                <div class="col-6">
                  <label>Display name</label>
                  <input class="input" name="displayName" value="${eh(user?.displayName || "")}" required />
                </div>
                <div class="col-6">
                  <label>Status</label>
                  <select name="isActive">
                    <option value="true" ${user?.isActive !== false ? "selected" : ""}>Active</option>
                    <option value="false" ${user?.isActive === false ? "selected" : ""}>Inactive</option>
                  </select>
                </div>
                <div class="col-12">
                  <label>Email</label>
                  <input class="input" name="email" type="email" value="${eh(user?.email || "")}" required />
                </div>
                <div class="col-12">
                  <label>${user ? "Password (leave blank to keep current password)" : "Password"}</label>
                  <input class="input" name="password" type="password" ${user ? "" : "required"} minlength="6" />
                </div>
              </div>
              <div class="muted">Direct portal URL: <code>staff-management.html</code></div>
              <div class="actions" style="justify-content:flex-end;">
                <button class="btn" type="submit">${user ? "Save changes" : "Create login"}</button>
              </div>
              <div class="status" id="smAccessStatus" style="display:none"></div>
            </form>
          `,
          { size: "md" }
        );

        const form = document.getElementById("smAccessForm");
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          try {
            ctx.setStatus(document.getElementById("smAccessStatus"), user ? "Saving..." : "Creating...", "");
            const payload = {
              displayName: form.displayName.value.trim(),
              email: form.email.value.trim(),
              isActive: String(form.isActive.value) !== "false"
            };
            if (form.password.value) payload.password = form.password.value;
            await ctx.api(user ? `/auth/staff-managers/${user._id}` : "/auth/staff-managers", {
              method: user ? "PUT" : "POST",
              body: JSON.stringify(payload)
            });
            ctx.setStatus(document.getElementById("smAccessStatus"), user ? "Saved" : "Created", "success");
            setTimeout(async () => {
              ctx.hideModal();
              await loadBase();
              await draw();
            }, 250);
          } catch (err) {
            ctx.setStatus(document.getElementById("smAccessStatus"), err.message, "error");
          }
        });
      }

      function buildProfileFormHtml(staff) {
        const compensation = staff?.compensation || {};
        const activeServices = state.services.filter((item) => item.isActive !== false);
        const rows = activeServices
          .map((service) => {
            const assignment = getStaffAssignment(staff, service._id);
            const enabled = Boolean(assignment);
            return `
              <div class="staff-service-card">
                <div style="display:flex; justify-content:space-between; gap:12px; align-items:start;">
                  <label style="margin:0; display:flex; gap:10px; align-items:start; cursor:pointer;">
                    <input type="checkbox" data-assign-toggle="${eh(String(service._id))}" ${enabled ? "checked" : ""} />
                    <span>
                      <b>${eh(`${service.category} - ${service.name}`)}</b>
                      <div class="muted">Default: LKR ${money(service.priceLKR || 0)} • ${eh(String(service.durationMin || 0))} min</div>
                    </span>
                  </label>
                  <span class="pill">${eh(service.bookingMode || "instant")}</span>
                </div>
                <div class="admin-grid" style="margin-top:10px;">
                  <div class="col-4">
                    <label>Custom price</label>
                    <input class="input" data-assign-field="price" data-service-id="${eh(String(service._id))}" value="${eh(String(assignment?.customPriceLKR ?? ""))}" ${enabled ? "" : "disabled"} />
                  </div>
                  <div class="col-4">
                    <label>Custom duration (min)</label>
                    <input class="input" data-assign-field="duration" data-service-id="${eh(String(service._id))}" value="${eh(String(assignment?.customDurationMin ?? ""))}" ${enabled ? "" : "disabled"} />
                  </div>
                  <div class="col-4">
                    <label>Commission %</label>
                    <input class="input" data-assign-field="commission" data-service-id="${eh(String(service._id))}" value="${eh(String(assignment?.commissionRatePct ?? ""))}" ${enabled ? "" : "disabled"} />
                  </div>
                </div>
              </div>`;
          })
          .join("");

        return `
          <form id="smProfileForm" class="grid" style="gap:12px;">
            <div class="admin-grid">
              <div class="col-4"><label>Staff ID</label><input class="input" name="staffId" value="${eh(staff?.staffId || "")}" required /></div>
              <div class="col-8"><label>Name</label><input class="input" name="name" value="${eh(staff?.name || "")}" required /></div>
              <div class="col-6"><label>Role</label><input class="input" name="role" value="${eh(staff?.role || "")}" /></div>
              <div class="col-3"><label>Phone</label><input class="input" name="phone" value="${eh(staff?.phone || "")}" /></div>
              <div class="col-3"><label>Email</label><input class="input" name="email" value="${eh(staff?.email || "")}" /></div>
              <div class="col-3"><label>Joined date</label><input class="input" type="date" name="joinedDate" value="${eh(staff?.joinedDate || "")}" /></div>
              <div class="col-3"><label>Sort order</label><input class="input" name="sortOrder" value="${eh(String(staff?.sortOrder ?? 0))}" /></div>
              <div class="col-6"><label>Image URL</label><input class="input" name="imgUrl" value="${eh(staff?.imgUrl || "")}" placeholder="assets/img/staff1.svg" /></div>
              <div class="col-6"><label>Status</label>
                <select name="isActive">
                  <option value="true" ${staff?.isActive !== false ? "selected" : ""}>Active</option>
                  <option value="false" ${staff?.isActive === false ? "selected" : ""}>Inactive</option>
                </select>
              </div>
              <div class="col-12"><label>Description</label><textarea name="desc" rows="4">${eh(staff?.desc || "")}</textarea></div>
            </div>

            <div class="card"><div class="card-body">
              <h3 style="margin:0 0 10px;">Compensation settings</h3>
              <div class="admin-grid">
                <div class="col-4"><label>Payroll mode</label>
                  <select name="payrollMode">
                    <option value="salary_plus_commission" ${String(compensation.payrollMode || "salary_plus_commission") === "salary_plus_commission" ? "selected" : ""}>Salary + commission</option>
                    <option value="salary_only" ${String(compensation.payrollMode || "") === "salary_only" ? "selected" : ""}>Salary only</option>
                    <option value="commission_only" ${String(compensation.payrollMode || "") === "commission_only" ? "selected" : ""}>Commission only</option>
                  </select>
                </div>
                <div class="col-4"><label>Base salary (LKR)</label><input class="input" name="baseSalaryLKR" value="${eh(String(compensation.baseSalaryLKR || 0))}" /></div>
                <div class="col-4"><label>Default commission %</label><input class="input" name="defaultCommissionRatePct" value="${eh(String(compensation.defaultCommissionRatePct || 0))}" /></div>
                <div class="col-4"><label>Expected working days / month</label><input class="input" name="expectedWorkingDays" value="${eh(String(compensation.expectedWorkingDays || 26))}" /></div>
                <div class="col-4">
                  <label style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
                    <span>OT hourly rate (LKR)</span>
                    <span style="display:inline-flex; align-items:center; gap:8px; font-size:13px; opacity:1;">
                      <input type="checkbox" name="overtimeDisabled" ${compensation.overtimeDisabled ? "checked" : ""} />
                      <span>Not OT</span>
                    </span>
                  </label>
                  <input class="input" type="number" min="0" step="0.01" name="overtimeHourlyRateLKR" value="${eh(String(compensation.overtimeHourlyRateLKR || 0))}" ${compensation.overtimeDisabled ? "disabled" : ""} />
                  <div class="muted" id="smOtPolicyHint" style="margin-top:6px;">${eh(overtimePolicyMeta(compensation).description)} Uncheck “Not OT” to enter a manual rate, or keep 0 for Auto OT.</div>
                </div>
              </div>
            </div></div>

            <div class="card"><div class="card-body">
              <h3 style="margin:0 0 10px;">Service assignment</h3>
              <div class="muted" style="margin-bottom:12px;">Assign only the services this staff member can do. Optional price, duration, and commission overrides are real-world salon patterns for senior/junior staff.</div>
              <div class="staff-service-grid">${rows || `<div class="muted">No active services found. Add services first.</div>`}</div>
            </div></div>

            <button class="btn" type="submit">Save staff profile</button>
            <div class="status" id="smProfileStatus" style="display:none"></div>
          </form>`;
      }

      function collectAssignmentsFromForm(form) {
        return state.services
          .filter((service) => service.isActive !== false)
          .map((service) => {
            const serviceId = String(service._id);
            const checked = form.querySelector(`[data-assign-toggle="${serviceId}"]`)?.checked;
            if (!checked) return null;
            return {
              serviceId,
              customPriceLKR: form.querySelector(`[data-assign-field="price"][data-service-id="${serviceId}"]`)?.value || "",
              customDurationMin: form.querySelector(`[data-assign-field="duration"][data-service-id="${serviceId}"]`)?.value || "",
              commissionRatePct: form.querySelector(`[data-assign-field="commission"][data-service-id="${serviceId}"]`)?.value || ""
            };
          })
          .filter(Boolean);
      }

      function openProfileForm(staff) {
        ctx.showModal(staff ? "Edit staff member" : "Add staff member", "Profile, services, and compensation", buildProfileFormHtml(staff), { size: "xl" });
        const form = document.getElementById("smProfileForm");
        form.querySelectorAll("[data-assign-toggle]").forEach((checkbox) => {
          const serviceId = checkbox.getAttribute("data-assign-toggle");
          const update = () => {
            form.querySelectorAll(`[data-service-id="${serviceId}"]`).forEach((input) => {
              input.disabled = !checkbox.checked;
            });
          };
          checkbox.addEventListener("change", update);
          update();
        });
        const overtimeDisabledInput = form.querySelector('[name="overtimeDisabled"]');
        const overtimeRateInput = form.querySelector('[name="overtimeHourlyRateLKR"]');
        const overtimeHint = document.getElementById("smOtPolicyHint");
        const updateOtControls = () => {
          const overtimeDisabled = overtimeDisabledInput?.checked === true;
          if (overtimeRateInput) overtimeRateInput.disabled = overtimeDisabled;
          if (!overtimeHint) return;
          if (overtimeDisabled) {
            overtimeHint.textContent = "System OT is disabled for this staff member. Outside-hours bookings will not create OT payroll rows.";
            return;
          }
          const manualRate = Math.max(0, Number(overtimeRateInput?.value || 0));
          overtimeHint.textContent = manualRate > 0
            ? `Manual OT hourly rate is active at LKR ${manualRate.toFixed(2)}/h.`
            : "Auto OT is active. The system will derive OT from salary or commission data until you enter a manual OT rate.";
        };
        overtimeDisabledInput?.addEventListener("change", updateOtControls);
        overtimeRateInput?.addEventListener("input", updateOtControls);
        updateOtControls();
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const payload = {
            staffId: form.staffId.value,
            name: form.name.value,
            role: form.role.value,
            phone: form.phone.value,
            email: form.email.value,
            joinedDate: form.joinedDate.value,
            desc: form.desc.value,
            imgUrl: form.imgUrl.value,
            sortOrder: Number(form.sortOrder.value || 0),
            isActive: form.isActive.value === "true",
            serviceAssignments: collectAssignmentsFromForm(form),
            compensation: {
              payrollMode: form.payrollMode.value,
              baseSalaryLKR: Number(form.baseSalaryLKR.value || 0),
              defaultCommissionRatePct: Number(form.defaultCommissionRatePct.value || 0),
              expectedWorkingDays: Number(form.expectedWorkingDays.value || 26),
              overtimeDisabled: form.overtimeDisabled.checked,
              overtimeHourlyRateLKR: Number(form.overtimeHourlyRateLKR.value || 0)
            }
          };
          try {
            await ctx.api(staff ? `/staff/admin/${staff._id}` : "/staff/admin", {
              method: staff ? "PUT" : "POST",
              body: JSON.stringify(payload)
            });
            ctx.setStatus(document.getElementById("smProfileStatus"), "Saved", "success");
            await loadBase();
            setTimeout(async () => {
              ctx.hideModal();
              await draw();
            }, 250);
          } catch (err) {
            ctx.setStatus(document.getElementById("smProfileStatus"), err.message, "error");
          }
        });
      }

      function openAttendanceForm(record) {
        ctx.showModal(
          record ? "Edit attendance" : "Mark attendance",
          "Manual daily attendance tracking for payroll",
          `
            <form id="smAttendanceForm" class="grid" style="gap:10px;">
              <div class="admin-grid">
                <div class="col-6"><label>Staff member</label><select name="staffRef">${buildStaffOptions(state.staffList, eh, record?.staffRef || state.staffRef, false)}</select></div>
                <div class="col-3"><label>Date</label><input class="input" type="date" name="date" value="${eh(record?.date || `${state.month}-01`)}" required /></div>
                <div class="col-3"><label>Status</label>
                  <select name="status">
                    <option value="present" ${record?.status === "present" || !record ? "selected" : ""}>Present</option>
                    <option value="half_day" ${record?.status === "half_day" ? "selected" : ""}>Half day</option>
                    <option value="paid_leave" ${record?.status === "paid_leave" ? "selected" : ""}>Paid leave</option>
                    <option value="unpaid_leave" ${record?.status === "unpaid_leave" ? "selected" : ""}>Unpaid leave</option>
                    <option value="absent" ${record?.status === "absent" ? "selected" : ""}>Absent</option>
                  </select>
                </div>
                <div class="col-3"><label>In time</label><input class="input" type="time" name="inTime" value="${eh(record?.inTime || "")}" /></div>
                <div class="col-3"><label>Out time</label><input class="input" type="time" name="outTime" value="${eh(record?.outTime || "")}" /></div>
                <div class="col-6"><label>Note</label><textarea name="note" rows="4">${eh(record?.note || "")}</textarea></div>
                <div class="col-12"><div class="muted">In time and out time are locked automatically for paid leave, unpaid leave, and absent statuses.</div></div>
              </div>
              <button class="btn" type="submit">Save attendance</button>
              <div class="status" id="smAttendanceStatus" style="display:none"></div>
            </form>`,
          { size: "lg" }
        );
        const form = document.getElementById("smAttendanceForm");
        const syncAttendanceTimeLock = () => {
          const locked = attendanceStatusLocksTime(form.status.value);
          [form.inTime, form.outTime].forEach((input) => {
            input.disabled = locked;
            if (locked) input.value = "";
          });
        };
        form.status.addEventListener("change", syncAttendanceTimeLock);
        syncAttendanceTimeLock();
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const payload = {
            staffRef: form.staffRef.value,
            date: form.date.value,
            status: form.status.value,
            inTime: form.inTime.value,
            outTime: form.outTime.value,
            note: form.note.value
          };
          try {
            await ctx.api(record ? `/staff-management/attendance/${record._id}` : "/staff-management/attendance", {
              method: record ? "PUT" : "POST",
              body: JSON.stringify(payload)
            });
            ctx.setStatus(document.getElementById("smAttendanceStatus"), "Saved", "success");
            setTimeout(async () => {
              ctx.hideModal();
              await draw();
            }, 250);
          } catch (err) {
            ctx.setStatus(document.getElementById("smAttendanceStatus"), err.message, "error");
          }
        });
      }

      function openWorkLogForm(record) {
        const selectedStaff = getStaffByRef(record?.staffRef || state.staffRef) || null;
        const allowedServices = selectedStaff ? getServicesForStaff(selectedStaff, state.services) : state.services.filter((item) => item.isActive !== false);
        ctx.showModal(
          record ? "Edit work log" : "Add work log",
          "Track completed jobs for monthly commission and salary calculation",
          `
            <form id="smWorkLogForm" class="grid" style="gap:10px;">
              <div class="admin-grid">
                <div class="col-6"><label>Staff member</label><select name="staffRef">${buildStaffOptions(state.staffList, eh, record?.staffRef || state.staffRef, false)}</select></div>
                <div class="col-3"><label>Work date</label><input class="input" type="date" name="workDate" value="${eh(record?.workDate || dateValue())}" required /></div>
                <div class="col-3"><label>Source</label>
                  <select name="source">
                    <option value="manual" ${!record || record?.source === "manual" ? "selected" : ""}>Manual</option>
                    <option value="walk_in" ${record?.source === "walk_in" ? "selected" : ""}>Walk-in</option>
                    <option value="appointment" ${record?.source === "appointment" ? "selected" : ""}>Appointment</option>
                  </select>
                </div>
                <div class="col-6"><label>Customer name</label><input class="input" name="customerName" value="${eh(record?.customerName || "")}" /></div>
                <div class="col-6"><label>Service</label><select name="serviceRef">${buildServiceOptions(allowedServices, eh, record?.serviceRef || "", true)}</select></div>
                <div class="col-3"><label>Quantity</label><input class="input" name="quantity" value="${eh(String(record?.quantity || 1))}" /></div>
                <div class="col-3"><label>Unit price (LKR)</label><input class="input" name="unitPriceLKR" value="${eh(String(record?.unitPriceLKR ?? ""))}" /></div>
                <div class="col-3"><label>Commission %</label><input class="input" name="commissionRatePct" value="${eh(String(record?.commissionRatePct ?? ""))}" /></div>
                <div class="col-3"><label>Status</label>
                  <select name="status">
                    <option value="completed" ${record?.status !== "cancelled" ? "selected" : ""}>Completed</option>
                    <option value="cancelled" ${record?.status === "cancelled" ? "selected" : ""}>Cancelled</option>
                  </select>
                </div>
                <div class="col-12"><label>Note</label><textarea name="note" rows="4">${eh(record?.note || "")}</textarea></div>
              </div>
              <button class="btn" type="submit">Save work log</button>
              <div class="status" id="smWorkLogStatus" style="display:none"></div>
            </form>`,
          { size: "lg" }
        );

        const form = document.getElementById("smWorkLogForm");
        const staffSelect = form.staffRef;
        const serviceSelect = form.serviceRef;
        function refillServiceOptions(options = {}) {
          const staff = getStaffByRef(staffSelect.value);
          const services = staff ? getServicesForStaff(staff, state.services) : state.services.filter((item) => item.isActive !== false);
          const previous = serviceSelect.value;
          serviceSelect.innerHTML = buildServiceOptions(services, eh, previous, true);
          if (previous && !services.some((item) => String(item._id) === String(previous))) {
            serviceSelect.value = "";
          }
          applySuggestedValues(options);
        }
        function applySuggestedValues(options = {}) {
          const { forcePrice = false, forceCommission = false } = options;
          const staff = getStaffByRef(staffSelect.value);
          const service = getServiceByRef(serviceSelect.value);
          const assignment = staff && service ? getStaffAssignment(staff, service._id) : null;
          const suggestedPrice = service ? assignment?.customPriceLKR ?? service.priceLKR ?? 0 : "";
          const suggestedCommission = staff
            ? service
              ? assignment?.commissionRatePct ?? staff.compensation?.defaultCommissionRatePct ?? 0
              : staff.compensation?.defaultCommissionRatePct ?? 0
            : "";

          if (forcePrice || !form.unitPriceLKR.value) {
            form.unitPriceLKR.value = service ? String(suggestedPrice) : "";
          }
          if (forceCommission || !form.commissionRatePct.value) {
            form.commissionRatePct.value = staff ? String(suggestedCommission) : "";
          }
        }
        staffSelect.addEventListener("change", () => refillServiceOptions({ forcePrice: true, forceCommission: true }));
        serviceSelect.addEventListener("change", () => applySuggestedValues({ forcePrice: true, forceCommission: true }));
        applySuggestedValues();
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const payload = {
            staffRef: form.staffRef.value,
            serviceRef: form.serviceRef.value,
            workDate: form.workDate.value,
            customerName: form.customerName.value,
            source: form.source.value,
            quantity: Number(form.quantity.value || 1),
            unitPriceLKR: form.unitPriceLKR.value,
            commissionRatePct: form.commissionRatePct.value,
            note: form.note.value,
            status: form.status.value
          };
          try {
            await ctx.api(record ? `/staff-management/work-logs/${record._id}` : "/staff-management/work-logs", {
              method: record ? "PUT" : "POST",
              body: JSON.stringify(payload)
            });
            ctx.setStatus(document.getElementById("smWorkLogStatus"), "Saved", "success");
            setTimeout(async () => {
              ctx.hideModal();
              await draw();
            }, 250);
          } catch (err) {
            ctx.setStatus(document.getElementById("smWorkLogStatus"), err.message, "error");
          }
        });
      }

      async function openAppointmentConvertForm() {
        const qs = new URLSearchParams({ month: state.month });
        if (state.staffRef) qs.set("staffRef", state.staffRef);
        const data = await ctx.api(`/staff-management/appointment-candidates?${qs.toString()}`);
        if (!(data.records || []).length) {
          ctx.showModal("No appointment candidates", "Work logs can be created from approved appointments.", `<div class="muted">There are no approved appointments without work logs in the selected month.</div>`);
          return;
        }
        ctx.showModal(
          "Convert appointment to work log",
          "Approved appointments only",
          `
            <form id="smConvertForm" class="grid" style="gap:10px;">
              <div>
                <label>Appointment</label>
                <select name="appointmentId">
                  ${(data.records || [])
                    .map(
                      (item) =>
                        `<option value="${eh(String(item._id))}">${eh(`${item.date} ${item.time || ""} • ${item.staffName} • ${item.customerName} • ${item.serviceName}`)}</option>`
                    )
                    .join("")}
                </select>
              </div>
              <button class="btn" type="submit">Create work log</button>
              <div class="status" id="smConvertStatus" style="display:none"></div>
            </form>`
        );
        document.getElementById("smConvertForm").addEventListener("submit", async (e) => {
          e.preventDefault();
          try {
            await ctx.api("/staff-management/work-logs/from-appointment", {
              method: "POST",
              body: JSON.stringify({ appointmentId: e.target.appointmentId.value })
            });
            ctx.setStatus(document.getElementById("smConvertStatus"), "Work log created", "success");
            setTimeout(async () => {
              ctx.hideModal();
              await draw();
            }, 250);
          } catch (err) {
            ctx.setStatus(document.getElementById("smConvertStatus"), err.message, "error");
          }
        });
      }

      function openAdjustmentForm(record) {
        if (isAutoOvertimeAdjustment(record)) {
          alert("This OT row is system-generated. Edit the linked approved appointment instead.");
          return;
        }

        ctx.showModal(
          record ? "Edit manual adjustment" : "Add manual payroll adjustment",
          "Manual allowances and deductions are applied on top of base salary + commission. OT from approved 24/7 bookings appears here automatically.",
          `
            <form id="smAdjustmentForm" class="grid" style="gap:10px;">
              <div class="admin-grid">
                <div class="col-6"><label>Staff member</label><select name="staffRef">${buildStaffOptions(state.staffList, eh, record?.staffRef || state.staffRef, false)}</select></div>
                <div class="col-3"><label>Month</label><input class="input" type="month" name="month" value="${eh(record?.month || state.month)}" required /></div>
                <div class="col-3"><label>Type</label>
                  <select name="type">
                    <option value="allowance" ${record?.type !== "deduction" ? "selected" : ""}>Allowance</option>
                    <option value="deduction" ${record?.type === "deduction" ? "selected" : ""}>Deduction</option>
                  </select>
                </div>
                <div class="col-6"><label>Label</label><input class="input" name="label" value="${eh(record?.label || "")}" required /></div>
                <div class="col-3"><label>Amount (LKR)</label><input class="input" name="amountLKR" value="${eh(String(record?.amountLKR || ""))}" required /></div>
                <div class="col-12"><label>Note</label><textarea name="note" rows="4">${eh(record?.note || "")}</textarea></div>
              </div>
              <button class="btn" type="submit">Save adjustment</button>
              <div class="status" id="smAdjustmentStatus" style="display:none"></div>
            </form>`
        );
        document.getElementById("smAdjustmentForm").addEventListener("submit", async (e) => {
          e.preventDefault();
          const form = e.target;
          try {
            await ctx.api(record ? `/staff-management/adjustments/${record._id}` : "/staff-management/adjustments", {
              method: record ? "PUT" : "POST",
              body: JSON.stringify({
                staffRef: form.staffRef.value,
                month: form.month.value,
                type: form.type.value,
                label: form.label.value,
                amountLKR: Number(form.amountLKR.value || 0),
                note: form.note.value
              })
            });
            ctx.setStatus(document.getElementById("smAdjustmentStatus"), "Saved", "success");
            setTimeout(async () => {
              ctx.hideModal();
              await draw();
            }, 250);
          } catch (err) {
            ctx.setStatus(document.getElementById("smAdjustmentStatus"), err.message, "error");
          }
        });
      }

      async function deleteByPath(path, message) {
        if (!confirm(message)) return;
        await ctx.api(path, { method: "DELETE" });
        await draw();
      }

      async function draw() {
        const body = await bodyHtml();
        ctx.content.innerHTML = `
          <div class="card">
            <div class="card-body">
              <div class="muted" style="margin-bottom:12px;">This module is designed around real salon workflows: assign services per staff member, mark attendance, record completed work, and calculate month-end payroll.</div>
              ${canManageStaffManagerAccess && state.tab === "profiles" ? staffManagerAccessHtml() : ""}
              <div class="staff-module-tabs">
                <button class="nav-btn ${state.tab === "profiles" ? "active" : ""}" type="button" data-sm-tab="profiles">Profiles</button>
                <button class="nav-btn ${state.tab === "attendance" ? "active" : ""}" type="button" data-sm-tab="attendance">Attendance</button>
                <button class="nav-btn ${state.tab === "worklogs" ? "active" : ""}" type="button" data-sm-tab="worklogs">Work Logs</button>
                <button class="nav-btn ${state.tab === "payroll" ? "active" : ""}" type="button" data-sm-tab="payroll">Payroll</button>
              </div>

              <div class="staff-module-toolbar">
                <div style="min-width:170px;">
                  <label>Month</label>
                  <input class="input" type="month" id="smMonth" value="${eh(state.month)}" />
                </div>
                <div style="min-width:220px;">
                  <label>Staff filter</label>
                  <select id="smStaffFilter">${buildStaffOptions(state.staffList, eh, state.staffRef, true)}</select>
                </div>
                <div class="actions" style="margin-left:auto; align-items:end;">
                  <button class="btn secondary" type="button" id="smRefreshBtn">Refresh</button>
                  ${actionButtonsHtml()}
                </div>
              </div>

              <div id="smBody">${body}</div>
            </div>
          </div>`;

        ctx.content.querySelectorAll("[data-sm-tab]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            state.tab = btn.getAttribute("data-sm-tab");
            await draw();
          });
        });
        document.getElementById("smMonth").addEventListener("change", async (e) => {
          state.month = e.target.value || monthValue();
          await draw();
        });
        document.getElementById("smStaffFilter").addEventListener("change", async (e) => {
          state.staffRef = e.target.value || "";
          await draw();
        });
        document.getElementById("smRefreshBtn").addEventListener("click", async () => {
          await loadBase();
          await draw();
        });

        const accessAddBtn = document.getElementById("smAccessAddBtn");
        if (accessAddBtn) {
          accessAddBtn.addEventListener("click", async () => {
            await openStaffManagerForm(null);
          });
        }

        const addBtn = document.getElementById("smAddBtn");
        if (addBtn) {
          addBtn.addEventListener("click", async () => {
            if (state.tab === "profiles") return openProfileForm(null);
            if (state.tab === "attendance") return openAttendanceForm(null);
            if (state.tab === "worklogs") return openWorkLogForm(null);
            return openAdjustmentForm(null);
          });
        }

        const convertBtn = document.getElementById("smConvertBtn");
        if (convertBtn) {
          convertBtn.addEventListener("click", async () => {
            try {
              await openAppointmentConvertForm();
            } catch (err) {
              alert(err.message);
            }
          });
        }

        ctx.content.querySelectorAll("button[data-sm-act]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            try {
              const act = btn.getAttribute("data-sm-act");
              const id = btn.getAttribute("data-id");
              const staff = state.staffList.find((item) => String(item._id) === String(id));
              const staffManagerUser = (state.staffManagerUsers || []).find((item) => String(item._id) === String(id));
              if (act === "edit-staff-manager") return openStaffManagerForm(staffManagerUser);
              if (act === "delete-staff-manager") return deleteByPath(`/auth/staff-managers/${id}`, "Delete this staff manager login?");
              if (act === "edit-profile") return openProfileForm(staff);
              if (act === "delete-profile") return deleteByPath(`/staff/admin/${id}`, "Delete this staff member? History-linked profiles can only be made inactive.");

              if (act === "edit-attendance") {
                const data = await ctx.api(`/staff-management/attendance?month=${encodeURIComponent(state.month)}${state.staffRef ? `&staffRef=${encodeURIComponent(state.staffRef)}` : ""}`);
                const record = (data.records || []).find((item) => String(item._id) === String(id));
                return openAttendanceForm(record);
              }
              if (act === "delete-attendance") return deleteByPath(`/staff-management/attendance/${id}`, "Delete this attendance record?");

              if (act === "edit-worklog") {
                const data = await ctx.api(`/staff-management/work-logs?month=${encodeURIComponent(state.month)}${state.staffRef ? `&staffRef=${encodeURIComponent(state.staffRef)}` : ""}`);
                const record = (data.records || []).find((item) => String(item._id) === String(id));
                return openWorkLogForm(record);
              }
              if (act === "delete-worklog") return deleteByPath(`/staff-management/work-logs/${id}`, "Delete this work log?");

              if (act === "edit-adjustment") {
                const data = await ctx.api(`/staff-management/adjustments?month=${encodeURIComponent(state.month)}${state.staffRef ? `&staffRef=${encodeURIComponent(state.staffRef)}` : ""}`);
                const record = (data.records || []).find((item) => String(item._id) === String(id));
                if (isAutoOvertimeAdjustment(record)) {
                  alert("This OT row is system-generated. Edit the linked approved appointment instead.");
                  return;
                }
                return openAdjustmentForm(record);
              }
              if (act === "delete-adjustment") {
                const data = await ctx.api(`/staff-management/adjustments?month=${encodeURIComponent(state.month)}${state.staffRef ? `&staffRef=${encodeURIComponent(state.staffRef)}` : ""}`);
                const record = (data.records || []).find((item) => String(item._id) === String(id));
                if (isAutoOvertimeAdjustment(record)) {
                  alert("This OT row is removed automatically from the linked appointment.");
                  return;
                }
                return deleteByPath(`/staff-management/adjustments/${id}`, "Delete this adjustment?");
              }
            } catch (err) {
              alert(err.message || "Something went wrong.");
            }
          });
        });
      }

      await loadBase();
      await draw();
    }
  };
})();
