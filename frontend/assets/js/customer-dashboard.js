(function () {
  if (!requireCustomer()) return;

  const welcomeLine = document.getElementById("welcomeLine");
  const logoutBtn = document.getElementById("logoutBtn");
  const profileForm = document.getElementById("profileForm");
  const profileStatus = document.getElementById("profileStatus");
  const bookingsWrap = document.getElementById("bookingsWrap");
  const ordersWrap = document.getElementById("ordersWrap");
  const messagesWrap = document.getElementById("messagesWrap");
  const messageForm = document.getElementById("messageForm");
  const messageStatus = document.getElementById("messageStatus");

  let messagingEnabled = true;
  let siteSettings = null;

  logoutBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    clearCustomerSession();
    location.href = "customer-login.html";
  });

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function statusLabel(status) {
    const map = {
      pending: "Pending",
      pending_review: "Under review",
      proposal_sent: "Awaiting your reply",
      customer_reschedule_requested: "Waiting for new proposal",
      approved: "Confirmed",
      cancelled: "Cancelled"
    };
    return map[String(status || "").trim()] || String(status || "—");
  }

  function statusKind(status) {
    if (status === "approved") return "ok";
    if (status === "cancelled") return "danger";
    return "warn";
  }

  function money(value) {
    return Number(value || 0).toLocaleString("en-LK");
  }

  function paymentStatusLabel(status) {
    const map = {
      not_due: "Not due yet",
      pending_customer_payment: "Advance payment required",
      submitted: "Slip sent - waiting for review",
      confirmed: "Advance payment confirmed",
      rejected: "Slip rejected - upload again"
    };
    return map[String(status || "").trim()] || String(status || "—");
  }

  function paymentStatusKind(status) {
    if (status === "confirmed") return "ok";
    if (status === "rejected") return "danger";
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

  function shouldShowPaymentPanel(a) {
    const status = String(a?.payment?.status || "").trim();
    return a?.status === "approved" || ["pending_customer_payment", "submitted", "confirmed", "rejected"].includes(status);
  }

  function proofIsImage(proof) {
    const mime = String(proof?.mimeType || "").toLowerCase();
    const url = String(proof?.url || "").toLowerCase();
    return mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(url);
  }

  function renderCopyButton(value, label) {
    const rawValue = String(value || "").trim();
    if (!rawValue || rawValue === "—" || rawValue === "Not configured yet") return "";
    return `<button class="btn secondary payment-copy-btn" type="button" data-copy-value="${escapeHtml(rawValue)}">${escapeHtml(label || "Copy")}</button>`;
  }

  function renderPaymentDetailRow(label, value, options = {}) {
    const displayValue = String(value || "").trim() || "—";
    const mainValue = options.code
      ? `<code class="payment-code">${escapeHtml(displayValue)}</code>`
      : `<strong>${escapeHtml(displayValue)}</strong>`;
    const copyBtn = options.copy ? renderCopyButton(displayValue, options.copyLabel || "Copy") : "";
    return `
      <div class="payment-detail-row">
        <span>${escapeHtml(label)}</span>
        <div class="payment-detail-value">
          ${mainValue}
          ${copyBtn}
        </div>
      </div>`;
  }

  function renderPaymentInstructionFields(method) {
    const s = siteSettings || {};
    const baseNote = s.paymentInstructionsNote
      ? `<div class="payment-note">${escapeHtml(s.paymentInstructionsNote)}</div>`
      : "";

    if (method === "crypto") {
      const walletName = s.cryptoWalletLabel || "Crypto wallet";
      const walletAddress = s.cryptoWalletAddress || "Not configured yet";
      const network = s.cryptoNetwork || "—";
      const qrUrl = s.cryptoWalletQrImageUrl ? imgUrl(s.cryptoWalletQrImageUrl) : "";
      const extra = s.cryptoInstructions || "Upload the exchange or wallet transfer screenshot here after sending the exact advance amount.";
      const qrHtml = qrUrl
        ? `<div class="payment-qr-box"><div class="payment-qr-title">Scan crypto QR</div><img src="${escapeHtml(qrUrl)}" alt="Crypto wallet QR code" /></div>`
        : `<div class="payment-qr-box payment-qr-box--empty"><div class="payment-qr-title">Crypto QR code</div><div class="muted">Admin has not uploaded a wallet QR image yet. Use the wallet address shown here.</div></div>`;
      return `
        ${baseNote}
        <div class="payment-instruction-card">
          <div class="payment-method-title">Crypto payment destination</div>
          <div class="payment-instruction-grid">
            <div class="payment-detail-list">
              ${renderPaymentDetailRow("Wallet", walletName)}
              ${renderPaymentDetailRow("Wallet address", walletAddress, { code: true, copy: Boolean(s.cryptoWalletAddress), copyLabel: "Copy address" })}
              ${renderPaymentDetailRow("Network", network)}
              <div class="payment-helper-text">${escapeHtml(extra)}</div>
            </div>
            ${qrHtml}
          </div>
        </div>`;
    }

    if (method === "skrill") {
      const skrillEmail = s.skrillEmail || "Not configured yet";
      const extra = s.skrillInstructions || "Send the advance payment to the Skrill email above, then upload the screenshot receipt here.";
      return `
        ${baseNote}
        <div class="payment-instruction-card">
          <div class="payment-method-title">Skrill payment destination</div>
          <div class="payment-detail-list">
            ${renderPaymentDetailRow("Skrill payee", skrillEmail, { copy: Boolean(s.skrillEmail), copyLabel: "Copy email" })}
            <div class="payment-helper-text">${escapeHtml(extra)}</div>
          </div>
        </div>`;
    }

    const bankAccountName = s.bankAccountName || "Not configured yet";
    const bankName = s.bankName || "—";
    const bankBranch = s.bankBranch || "—";
    const bankAccountNumber = s.bankAccountNumber || "—";
    const extra = method === "online_transfer"
      ? (s.onlineTransferInstructions || "Use your banking app or online banking portal, then upload the screenshot or PDF slip here.")
      : (s.bankTransferInstructions || "Deposit the advance amount and upload the bank slip here.");
    return `
      ${baseNote}
      <div class="payment-instruction-card">
        <div class="payment-method-title">${escapeHtml(method === "online_transfer" ? "Online transfer destination" : "Bank transfer destination")}</div>
        <div class="payment-detail-list">
          ${renderPaymentDetailRow("Account name", bankAccountName)}
          ${renderPaymentDetailRow("Bank", bankName)}
          ${renderPaymentDetailRow("Branch", bankBranch)}
          ${renderPaymentDetailRow("Account no", bankAccountNumber, { copy: Boolean(s.bankAccountNumber), copyLabel: "Copy number" })}
          <div class="payment-helper-text">${escapeHtml(extra)}</div>
        </div>
      </div>`;
  }

  function renderProofPreview(proof) {
    if (!proof?.url) return "";
    const link = `<a href="${escapeHtml(imgUrl(proof.url))}" target="_blank" rel="noreferrer">${escapeHtml(proof.originalName || proof.filename || "Open uploaded slip")}</a>`;
    const uploadedAt = proof.uploadedAt ? `<div class="muted" style="margin-top:6px;">Uploaded: ${escapeHtml(new Date(proof.uploadedAt).toLocaleString())}</div>` : "";
    const image = proofIsImage(proof)
      ? `<div style="margin-top:10px;"><img src="${escapeHtml(imgUrl(proof.url))}" alt="Payment slip" style="max-width:220px; width:100%; border-radius:14px; border:1px solid rgba(29,27,31,.16); box-shadow:0 10px 24px rgba(0,0,0,.06);" /></div>`
      : "";
    return `
      <div style="margin-top:10px;">
        <div><b>Uploaded proof:</b> ${link}</div>
        ${uploadedAt}
        ${image}
      </div>`;
  }

  function renderPaymentPanel(a) {
    if (!shouldShowPaymentPanel(a)) return "";
    const payment = a.payment || {};
    const method = payment.method || "bank_transfer";
    const canUpload = a.status === "approved" && payment.status !== "confirmed";
    const actionText = payment.status === "submitted"
      ? "Replace uploaded proof"
      : payment.status === "rejected"
        ? "Re-upload proof"
        : "Upload 25% payment slip";
    const adminNote = payment.adminNote
      ? `<div class="muted" style="margin-top:8px;">Admin note: ${escapeHtml(payment.adminNote)}</div>`
      : "";
    const customerMeta = [
      payment.method ? `Method: ${paymentMethodLabel(payment.method)}` : "",
      payment.customerReference ? `Reference: ${escapeHtml(payment.customerReference)}` : "",
      payment.customerNote ? `Your note: ${escapeHtml(payment.customerNote)}` : ""
    ].filter(Boolean).join(" • ");

    return `
      <div class="payment-panel">
        <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
          <div>
            <div style="font-weight:900;">Advance payment</div>
            <div class="muted" style="margin-top:4px;">Once the booking is approved, you must upload the required ${escapeHtml(String(payment.depositPercent || 25))}% advance payment proof here.</div>
          </div>
          <div class="chip ${paymentStatusKind(payment.status)}">${escapeHtml(paymentStatusLabel(payment.status))}</div>
        </div>

        <div style="margin-top:10px; line-height:1.6;">
          <div><span class="muted">Total booking amount:</span> <b>LKR ${money(payment.totalAmountLKR)}</b></div>
          <div><span class="muted">Required advance (${escapeHtml(String(payment.depositPercent || 25))}%):</span> <b>LKR ${money(payment.depositAmountLKR)}</b></div>
          <div><span class="muted">Remaining balance for salon visit:</span> LKR ${money(payment.balanceAmountLKR)}</div>
          ${customerMeta ? `<div class="muted" style="margin-top:6px;">${customerMeta}</div>` : ""}
          ${adminNote}
          ${renderProofPreview(payment.proof)}
        </div>

        ${canUpload ? `
          <form data-payment-form="${a._id}" style="margin-top:14px; display:grid; gap:10px;">
            <div>
              <label class="muted">Payment method</label>
              <select class="input" name="method" data-payment-method="${a._id}">
                <option value="bank_transfer" ${method === "bank_transfer" ? "selected" : ""}>Bank transfer</option>
                <option value="online_transfer" ${method === "online_transfer" ? "selected" : ""}>Online transfer</option>
                <option value="crypto" ${method === "crypto" ? "selected" : ""}>Crypto</option>
                <option value="skrill" ${method === "skrill" ? "selected" : ""}>Skrill</option>
              </select>
            </div>
            <div data-payment-instructions-box="${a._id}">${renderPaymentInstructionFields(method)}</div>
            <div>
              <label class="muted">Transfer reference / transaction ID (optional)</label>
              <input class="input" name="customerReference" placeholder="Example: TXN-45812" value="${escapeHtml(payment.customerReference || "")}" />
            </div>
            <div>
              <label class="muted">Note for admin (optional)</label>
              <textarea class="input" name="customerNote" rows="3" placeholder="Example: Sent from Sampath Bank mobile app.">${escapeHtml(payment.customerNote || "")}</textarea>
            </div>
            <div>
              <label class="muted">Upload slip / proof</label>
              <input class="input" type="file" name="slip" accept="image/*,application/pdf" required />
            </div>
            <button class="btn" type="submit">${actionText}</button>
            <div class="muted" data-payment-status="${a._id}"></div>
          </form>`
          : `<div class="muted" style="margin-top:12px;">${escapeHtml(payment.status === "confirmed" ? "Your advance payment has already been confirmed by admin." : "Payment upload will open after the booking is approved.")}</div>`}
      </div>`;
  }

  function canCancelBooking(status) {
    return ["pending", "approved", "pending_review", "proposal_sent", "customer_reschedule_requested"].includes(status);
  }

  function hasPendingProposal(a) {
    return Boolean(a?.pendingProposal?.date && a?.pendingProposal?.time && a?.status === "proposal_sent");
  }

  function formatRange(date, time, endTime) {
    const parts = [date || ""].filter(Boolean);
    if (time) parts.push(endTime ? `${time} - ${endTime}` : time);
    return parts.join(" • ") || "—";
  }

  function formatProposalResponseLabel(response) {
    const map = {
      accepted: "Accepted",
      rejected: "Requested another slot",
      expired: "Unavailable when accepted",
      superseded: "Replaced by salon",
      cancelled: "Cancelled"
    };
    return map[String(response || "").trim()] || String(response || "pending");
  }

  async function loadMe() {
    const res = await fetch(`${API_BASE}/customers/me`, { headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      clearCustomerSession();
      location.href = "customer-login.html";
      return null;
    }
    const c = data.customer;
    setCustomerSession(getCustomerToken(), { id: c._id || c.id, name: c.name, email: c.email, phone: c.phone });
    return c;
  }

  function renderProposalHistory(a) {
    const history = Array.isArray(a?.proposalHistory) ? a.proposalHistory : [];
    if (!history.length) return "";

    const items = history
      .slice()
      .reverse()
      .map((entry) => {
        const when = formatRange(entry.date, entry.time, entry.endTime);
        const note = entry.note ? `<div class="muted" style="margin-top:6px;">Salon note: ${escapeHtml(entry.note)}</div>` : "";
        const responseNote = entry.customerResponseNote
          ? `<div class="muted" style="margin-top:6px;">Customer response: ${escapeHtml(entry.customerResponseNote)}</div>`
          : "";
        return `
          <div class="history-card">
            <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
              <div><b>Round ${escapeHtml(entry.proposalRound || "—")}</b></div>
              <div class="chip ${statusKind(entry.customerResponse === "accepted" ? "approved" : entry.customerResponse === "cancelled" ? "cancelled" : "pending_review")}">${escapeHtml(formatProposalResponseLabel(entry.customerResponse))}</div>
            </div>
            <div class="muted" style="margin-top:6px;">${escapeHtml(when)}</div>
            ${note}
            ${responseNote}
          </div>
        `;
      })
      .join("");

    return `
      <details style="margin-top:10px;">
        <summary style="cursor:pointer;">Proposal history (${history.length})</summary>
        <div style="margin-top:8px; display:grid; gap:8px;">${items}</div>
      </details>
    `;
  }

  function renderBookingTiming(a) {
    if (a.bookingMode !== "manual-review") {
      return `
        <div><span class="muted">Appointment:</span> ${escapeHtml(formatRange(a.date, a.time, a.endTime))}</div>
      `;
    }

    const preferredDate = a.preferredDate || a.date || "";
    const confirmedText = a.status === "approved" ? formatRange(a.date, a.time, a.endTime) : "";
    const proposedText = hasPendingProposal(a)
      ? formatRange(a.pendingProposal.date, a.pendingProposal.time, a.pendingProposal.endTime)
      : "";

    let extra = `<div class="muted" style="margin-top:6px;">Preferred date: ${escapeHtml(preferredDate || "—")}</div>`;
    if (a.status === "approved") {
      extra += `<div style="margin-top:6px;"><span class="muted">Confirmed slot:</span> ${escapeHtml(confirmedText)}</div>`;
    } else if (hasPendingProposal(a)) {
      extra += `<div style="margin-top:6px;"><span class="muted">Salon proposal:</span> ${escapeHtml(proposedText)}</div>`;
    } else if (a.status === "customer_reschedule_requested") {
      extra += `<div class="muted" style="margin-top:6px;">You asked for another option. The salon needs to send a new proposal.</div>`;
    } else {
      extra += `<div class="muted" style="margin-top:6px;">The salon is reviewing your photos and notes before sending an exact date/time.</div>`;
    }
    return extra;
  }

  function renderBookingDetails(a) {
    const photoCount = Array.isArray(a.referencePhotos) ? a.referencePhotos.length : 0;
    const mode = a.bookingMode === "manual-review" ? "Manual review booking" : (a.allowAnyTimeBooking ? "24/7 exact slot booking" : "Instant slot booking");
    const salonNote = hasPendingProposal(a) ? (a.pendingProposal.note || a.adminReviewNote || "") : (a.adminReviewNote || "");
    const responseNote = a.customerResponseNote ? `<div class="muted" style="margin-top:6px;">Your last reply: ${escapeHtml(a.customerResponseNote)}</div>` : "";
    return `
      <div class="muted">${escapeHtml(mode)}${photoCount ? ` • ${photoCount} photo(s)` : ""}</div>
      ${a.notes ? `<div class="muted" style="margin-top:6px;">Your notes: ${escapeHtml(a.notes)}</div>` : ""}
      ${salonNote ? `<div class="muted" style="margin-top:6px;">Salon note: ${escapeHtml(salonNote)}</div>` : ""}
      ${responseNote}
    `;
  }

  function renderProposalActionBox(a) {
    if (!hasPendingProposal(a)) return "";
    return `
      <div style="margin-top:12px; padding:12px; border-radius:14px; background:rgba(194,24,91,.07); border:1px solid rgba(194,24,91,.18);">
        <div style="font-weight:800;">Salon proposed a slot</div>
        <div class="muted" style="margin-top:6px;">${escapeHtml(formatRange(a.pendingProposal.date, a.pendingProposal.time, a.pendingProposal.endTime))}</div>
        ${a.pendingProposal.note ? `<div class="muted" style="margin-top:6px;">${escapeHtml(a.pendingProposal.note)}</div>` : ""}
        <div class="muted" style="margin-top:6px;">This proposal stays tentative until you accept it.</div>
        <div class="actions" style="margin-top:12px;">
          <button class="btn" data-accept="${a._id}">OK - Confirm this slot</button>
          <button class="btn secondary" data-show-reject="${a._id}">Need another date/time</button>
        </div>
        <div data-reject-box="${a._id}" style="display:none; margin-top:12px;">
          <label class="muted">Tell the salon what does not work</label>
          <textarea class="input" data-reject-note="${a._id}" rows="3" placeholder="Example: I can do Friday afternoon only."></textarea>
          <div class="actions" style="margin-top:10px;">
            <button class="btn" data-reject-submit="${a._id}">Send request for another option</button>
            <button class="btn secondary" type="button" data-hide-reject="${a._id}">Close</button>
          </div>
          <div class="muted" data-reject-status="${a._id}" style="margin-top:8px;"></div>
        </div>
      </div>
    `;
  }

  function renderBookingCard(a) {
    const cancelButton = canCancelBooking(a.status)
      ? `<button class="btn secondary" data-cancel="${a._id}">Cancel booking</button>`
      : "";
    return `
      <div class="card" style="padding:16px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
          <div>
            <div style="font-size:18px; font-weight:900;">${escapeHtml(a.serviceName)}</div>
            <div class="muted" style="margin-top:4px;">Staff: ${escapeHtml(a.staffName)}</div>
          </div>
          <div class="chip ${statusKind(a.status)}">${escapeHtml(statusLabel(a.status))}</div>
        </div>

        <div style="margin-top:12px; line-height:1.5;">
          ${renderBookingTiming(a)}
        </div>

        <div style="margin-top:10px; line-height:1.5;">
          ${renderBookingDetails(a)}
        </div>

        ${renderProposalActionBox(a)}
        ${renderProposalHistory(a)}
        ${renderPaymentPanel(a)}

        ${cancelButton ? `<div class="actions" style="margin-top:12px;">${cancelButton}</div>` : ""}
      </div>
    `;
  }

  function wireCopyButtons(root = bookingsWrap) {
    (root || document).querySelectorAll("button[data-copy-value]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const value = String(btn.getAttribute("data-copy-value") || "").trim();
        if (!value) return;
        const original = btn.textContent;
        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            await navigator.clipboard.writeText(value);
          } else {
            const ta = document.createElement("textarea");
            ta.value = value;
            ta.setAttribute("readonly", "readonly");
            ta.style.position = "absolute";
            ta.style.left = "-9999px";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
          }
          btn.textContent = "Copied";
        } catch {
          btn.textContent = "Copy failed";
        }
        setTimeout(() => {
          btn.textContent = original;
        }, 1400);
      });
    });
  }

  function bindBookingActions() {
    bookingsWrap.querySelectorAll("button[data-cancel]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-cancel");
        if (!confirm("Cancel this booking?")) return;
        btn.disabled = true;
        const res = await fetch(`${API_BASE}/appointments/me/${id}/cancel`, {
          method: "PUT",
          headers: authHeaders({ "Content-Type": "application/json" })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) alert(data.message || "Error");
        await loadBookings();
      });
    });

    bookingsWrap.querySelectorAll("button[data-accept]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-accept");
        if (!confirm("Confirm this proposed slot?")) return;
        btn.disabled = true;
        const res = await fetch(`${API_BASE}/appointments/me/${id}/respond-manual`, {
          method: "PUT",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ action: "accept" })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) alert(data.message || "Could not confirm the slot.");
        await loadBookings();
      });
    });

    bookingsWrap.querySelectorAll("button[data-show-reject]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-show-reject");
        const box = bookingsWrap.querySelector(`[data-reject-box="${id}"]`);
        if (box) box.style.display = box.style.display === "none" ? "block" : "none";
      });
    });

    bookingsWrap.querySelectorAll("button[data-hide-reject]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-hide-reject");
        const box = bookingsWrap.querySelector(`[data-reject-box="${id}"]`);
        if (box) box.style.display = "none";
      });
    });

    bookingsWrap.querySelectorAll("button[data-reject-submit]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-reject-submit");
        const noteEl = bookingsWrap.querySelector(`[data-reject-note="${id}"]`);
        const statusEl = bookingsWrap.querySelector(`[data-reject-status="${id}"]`);
        const note = String(noteEl?.value || "").trim();
        btn.disabled = true;
        if (statusEl) statusEl.textContent = "Sending...";
        const res = await fetch(`${API_BASE}/appointments/me/${id}/respond-manual`, {
          method: "PUT",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ action: "reject", note })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          btn.disabled = false;
          if (statusEl) statusEl.textContent = data.message || "Could not send your request.";
          return;
        }
        await loadBookings();
      });
    });

    bookingsWrap.querySelectorAll("select[data-payment-method]").forEach((select) => {
      select.addEventListener("change", () => {
        const id = select.getAttribute("data-payment-method");
        const box = bookingsWrap.querySelector(`[data-payment-instructions-box="${id}"]`);
        if (box) {
          box.innerHTML = renderPaymentInstructionFields(select.value);
          wireCopyButtons(box);
        }
      });
    });

    bookingsWrap.querySelectorAll("form[data-payment-form]").forEach((form) => {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = form.getAttribute("data-payment-form");
        const method = form.querySelector('select[name="method"]')?.value || "";
        const reference = String(form.querySelector('input[name="customerReference"]')?.value || "").trim();
        const note = String(form.querySelector('textarea[name="customerNote"]')?.value || "").trim();
        const fileInput = form.querySelector('input[name="slip"]');
        const statusEl = form.querySelector(`[data-payment-status="${id}"]`);
        const file = fileInput?.files?.[0] || null;

        if (!file) {
          if (statusEl) statusEl.textContent = "Please choose a slip image or PDF file first.";
          return;
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        if (statusEl) statusEl.textContent = "Uploading slip...";

        try {
          const fd = new FormData();
          fd.append("slip", file);
          const uploadRes = await fetch(`${API_BASE}/uploads/payment-slip`, {
            method: "POST",
            headers: authHeaders(),
            body: fd
          });
          const uploadData = await uploadRes.json().catch(() => ({}));
          if (!uploadRes.ok) throw new Error(uploadData.message || "Slip upload failed");

          if (statusEl) statusEl.textContent = "Submitting proof to admin...";
          const res = await fetch(`${API_BASE}/appointments/me/${id}/payment-proof`, {
            method: "PUT",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
              method,
              customerReference: reference,
              customerNote: note,
              proofFile: uploadData.file || null
            })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.message || "Could not submit payment proof.");
          await loadBookings();
        } catch (err) {
          if (statusEl) statusEl.textContent = err.message || "Could not upload payment proof.";
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    });
  }

  function renderBookings(list) {
    const cards = (list || []).map(renderBookingCard).join("");
    bookingsWrap.innerHTML = cards || `<div class="muted">No bookings yet.</div>`;
    bindBookingActions();
    wireCopyButtons(bookingsWrap);
  }

  async function loadBookings() {
    bookingsWrap.innerHTML = `<div class="muted">Loading...</div>`;
    const res = await fetch(`${API_BASE}/appointments/me`, { headers: authHeaders() });
    const list = await res.json().catch(() => []);
    if (!res.ok) {
      bookingsWrap.innerHTML = `<div class="muted">Could not load bookings.</div>`;
      return;
    }
    renderBookings(list);
  }

  function orderStatusLabel(status) {
    const map = {
      pending: "Pending review",
      confirmed: "Approved / packing",
      shipped: "Handed to courier",
      out_for_delivery: "Out for delivery",
      delivered: "Delivered by courier",
      completed: "Received",
      delivery_issue: "Delivery issue",
      cancelled: "Cancelled"
    };
    return map[String(status || "").trim()] || String(status || "—");
  }

  function orderStatusKind(status) {
    if (["completed"].includes(status)) return "ok";
    if (["cancelled", "delivery_issue"].includes(status)) return "danger";
    return "warn";
  }

  function orderStatusPill(status) {
    const kind = orderStatusKind(status);
    const theme = kind === "ok"
      ? { bg: "rgba(46,204,113,.12)", border: "rgba(46,204,113,.35)", color: "#166534" }
      : kind === "danger"
        ? { bg: "rgba(231,76,60,.10)", border: "rgba(231,76,60,.30)", color: "#991b1b" }
        : { bg: "rgba(245,158,11,.12)", border: "rgba(245,158,11,.28)", color: "#92400e" };
    return `<span style="display:inline-flex; align-items:center; gap:8px; padding:8px 12px; border-radius:999px; border:1px solid ${theme.border}; background:${theme.bg}; color:${theme.color}; font-size:13px; font-weight:800;">${escapeHtml(orderStatusLabel(status))}</span>`;
  }

  function deliveryIssueLabel(state) {
    const map = {
      none: "No issue",
      open: "Waiting for salon reply",
      replied: "Salon replied",
      resolved: "Resolved"
    };
    return map[String(state || "").trim()] || String(state || "—");
  }

  function customerConfirmationLabel(state) {
    const map = {
      pending: "Awaiting your confirmation",
      received: "You confirmed it was received",
      not_received: "You reported it not received"
    };
    return map[String(state || "").trim()] || String(state || "—");
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
  }

  function formatDateOnly(value) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
  }

  function orderRef(o) {
    return o?.orderNumber || `ORD-${String(o?._id || "").slice(-6).toUpperCase()}`;
  }

  function itemOrderedQty(item) {
    const qty = Number(item?.qty || 0);
    return Number.isFinite(qty) && qty > 0 ? Math.trunc(qty) : 0;
  }

  function itemCancelledQty(item) {
    const ordered = itemOrderedQty(item);
    const cancelled = Number(item?.cancelledQty || 0);
    if (!Number.isFinite(cancelled) || cancelled <= 0) return 0;
    return Math.min(ordered, Math.trunc(cancelled));
  }

  function itemRemainingQty(item) {
    return Math.max(0, itemOrderedQty(item) - itemCancelledQty(item));
  }

  function orderOriginalTotal(order) {
    const stored = Number(order?.originalTotalLKR);
    if (Number.isFinite(stored) && stored >= 0) return stored;
    return (order?.items || []).reduce((sum, item) => sum + (Number(item?.priceLKR || 0) * itemOrderedQty(item)), 0);
  }

  function orderCancelledTotal(order) {
    const stored = Number(order?.cancelledTotalLKR);
    if (Number.isFinite(stored) && stored >= 0) return stored;
    return (order?.items || []).reduce((sum, item) => sum + (Number(item?.priceLKR || 0) * itemCancelledQty(item)), 0);
  }

  function orderCurrentTotal(order) {
    const stored = Number(order?.totalLKR);
    if (Number.isFinite(stored) && stored >= 0) return stored;
    return Math.max(0, orderOriginalTotal(order) - orderCancelledTotal(order));
  }

  function formatOrderMoney(value) {
    return `LKR ${Number(value || 0).toLocaleString("en-LK")}`;
  }

  function canCustomerCancelOrder(order) {
    return ["pending", "confirmed"].includes(order?.status) && (order?.items || []).some((item) => itemRemainingQty(item) > 0);
  }

  function canCustomerConfirmDelivery(order) {
    return ["shipped", "out_for_delivery", "delivered", "delivery_issue"].includes(order?.status);
  }

  function canSendDeliveryFollowup(order) {
    return ["open", "replied"].includes(String(order?.delivery?.issueStatus || "none"));
  }

  function renderOrderTimeline(order) {
    const history = Array.isArray(order?.statusHistory)
      ? order.statusHistory.filter((entry) => entry?.visibleToCustomer !== false)
      : [];
    if (!history.length) return "";

    const rows = history
      .slice()
      .reverse()
      .map((entry) => {
        const title = entry?.title || orderStatusLabel(entry?.status);
        return `
          <div style="padding:10px 12px; border-radius:14px; border:1px solid rgba(0,0,0,.08); background:rgba(255,255,255,.7); margin-top:8px;">
            <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
              <div style="font-weight:800;">${escapeHtml(title)}</div>
              <div class="muted">${escapeHtml(formatDateTime(entry?.at))}</div>
            </div>
            ${entry?.note ? `<div class="muted" style="margin-top:6px; white-space:pre-wrap;">${escapeHtml(entry.note)}</div>` : ""}
          </div>
        `;
      })
      .join("");

    return `
      <details style="margin-top:12px;">
        <summary style="cursor:pointer; font-weight:800;">Order timeline (${history.length})</summary>
        <div style="margin-top:8px;">${rows}</div>
      </details>
    `;
  }

  function renderDeliveryThread(order) {
    const thread = Array.isArray(order?.delivery?.feedbackThread) ? order.delivery.feedbackThread : [];
    if (!thread.length) return "";

    const rows = thread
      .map((entry) => {
        const isAdmin = entry?.sender === "admin";
        const bg = isAdmin ? "rgba(0,0,0,.06)" : "rgba(194,24,91,.08)";
        const label = isAdmin ? "Salon" : entry?.sender === "system" ? "System" : "You";
        return `
          <div style="margin-top:8px; padding:10px 12px; border-radius:14px; border:1px solid rgba(0,0,0,.08); background:${bg};">
            <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
              <div style="font-weight:800;">${escapeHtml(label)}</div>
              <div class="muted">${escapeHtml(formatDateTime(entry?.at))}</div>
            </div>
            <div style="margin-top:6px; white-space:pre-wrap; line-height:1.45;">${escapeHtml(entry?.message || "—")}</div>
          </div>
        `;
      })
      .join("");

    return `
      <details style="margin-top:12px;">
        <summary style="cursor:pointer; font-weight:800;">Delivery conversation (${thread.length})</summary>
        <div style="margin-top:8px;">${rows}</div>
      </details>
    `;
  }

  function renderItemCancellationHistory(order) {
    const history = Array.isArray(order?.itemCancellationHistory) ? order.itemCancellationHistory : [];
    if (!history.length) return "";

    const rows = history
      .slice()
      .reverse()
      .map((entry) => {
        const amount = Number(entry?.amountLKR || 0);
        const byLabel = entry?.by === "admin" ? "Salon" : entry?.by === "system" ? "System" : "You";
        return `
          <div style="margin-top:8px; padding:10px 12px; border-radius:14px; border:1px solid rgba(0,0,0,.08); background:rgba(255,248,240,.9);">
            <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
              <div style="font-weight:800;">${escapeHtml(entry?.name || "Cancelled item")} x${escapeHtml(entry?.qty || 0)}</div>
              <div class="muted">${escapeHtml(formatDateTime(entry?.at))}</div>
            </div>
            <div class="muted" style="margin-top:6px;">Cancelled by: ${escapeHtml(byLabel)} • Value returned to order: ${escapeHtml(formatOrderMoney(amount))}</div>
            ${entry?.note ? `<div class="muted" style="margin-top:6px; white-space:pre-wrap;">${escapeHtml(entry.note)}</div>` : ""}
          </div>
        `;
      })
      .join("");

    return `
      <details style="margin-top:12px;">
        <summary style="cursor:pointer; font-weight:800;">Cancelled item history (${history.length})</summary>
        <div style="margin-top:8px;">${rows}</div>
      </details>
    `;
  }

  function renderTrackingBox(order) {
    const d = order?.delivery || {};
    const trackingUrl = String(d?.trackingUrl || "").trim();
    const safeTrackingUrl = /^https?:\/\//i.test(trackingUrl) ? trackingUrl : "";

    if (!d?.courierService && !d?.trackingNumber) {
      return `
        <div style="font-weight:800;">Courier details</div>
        <div class="muted" style="margin-top:8px;">After the salon approves your order and gives the parcel to a courier, the tracking number will appear here automatically.</div>
      `;
    }

    return `
      <div style="font-weight:800;">Courier details</div>
      <div style="margin-top:8px;"><span class="muted">Courier:</span> <b>${escapeHtml(d?.courierService || "—")}</b></div>
      <div style="margin-top:6px;"><span class="muted">Tracking No:</span> <b>${escapeHtml(d?.trackingNumber || "—")}</b></div>
      <div style="margin-top:6px;"><span class="muted">Expected date:</span> ${escapeHtml(formatDateOnly(d?.expectedDeliveryDate))}</div>
      <div style="margin-top:6px;"><span class="muted">Dispatched:</span> ${escapeHtml(formatDateTime(d?.shippedAt))}</div>
      <div style="margin-top:6px;"><span class="muted">Out for delivery:</span> ${escapeHtml(formatDateTime(d?.outForDeliveryAt))}</div>
      <div style="margin-top:6px;"><span class="muted">Courier delivered:</span> ${escapeHtml(formatDateTime(d?.deliveredAt))}</div>
      ${safeTrackingUrl ? `<div style="margin-top:10px;"><a href="${escapeHtml(safeTrackingUrl)}" target="_blank" rel="noreferrer">Open courier tracking page</a></div>` : ""}
    `;
  }

  function renderCustomerDeliveryState(order) {
    const d = order?.delivery || {};
    const shouldShow = ["shipped", "out_for_delivery", "delivered", "completed", "delivery_issue"].includes(order?.status)
      || d?.customerConfirmationStatus !== "pending"
      || d?.issueStatus !== "none";
    if (!shouldShow) return "";

    const message = d?.customerConfirmationMessage
      ? `<div class="muted" style="margin-top:6px; white-space:pre-wrap;">${escapeHtml(d.customerConfirmationMessage)}</div>`
      : "";

    return `
      <div style="padding:12px; border-radius:14px; border:1px solid rgba(0,0,0,.08); background:rgba(0,0,0,.02); margin-top:12px;">
        <div style="font-weight:800;">Delivery confirmation</div>
        <div class="muted" style="margin-top:6px;">${escapeHtml(customerConfirmationLabel(d?.customerConfirmationStatus || "pending"))}</div>
        <div class="muted" style="margin-top:6px;">Issue status: ${escapeHtml(deliveryIssueLabel(d?.issueStatus || "none"))}</div>
        <div class="muted" style="margin-top:6px;">Last updated: ${escapeHtml(formatDateTime(d?.customerConfirmationAt))}</div>
        ${message}
      </div>
    `;
  }

  function renderDeliveryActionBox(order) {
    if (!canCustomerConfirmDelivery(order)) return "";
    return `
      <div style="margin-top:12px; padding:12px; border-radius:14px; border:1px solid rgba(194,24,91,.16); background:rgba(194,24,91,.05);">
        <div style="font-weight:800;">Tell the salon what happened with delivery</div>
        <div class="muted" style="margin-top:6px;">When the courier updates arrive or the parcel reaches you, use the buttons below to confirm whether the item was received.</div>
        <label class="muted" style="margin-top:10px; display:block;">Message (optional)</label>
        <textarea class="input" data-delivery-note="${escapeHtml(order._id)}" rows="3" placeholder="Example: Parcel arrived in good condition."></textarea>
        <div class="actions" style="margin-top:10px;">
          <button class="btn" type="button" data-delivery-action="received" data-id="${escapeHtml(order._id)}">Item received</button>
          <button class="btn secondary" type="button" data-delivery-action="not_received" data-id="${escapeHtml(order._id)}">Item not received</button>
        </div>
        <div class="muted" data-delivery-status="${escapeHtml(order._id)}" style="margin-top:8px;"></div>
      </div>
    `;
  }

  function renderFollowupBox(order) {
    if (!canSendDeliveryFollowup(order)) return "";
    return `
      <div style="margin-top:12px; padding:12px; border-radius:14px; border:1px solid rgba(0,0,0,.08); background:rgba(255,255,255,.75);">
        <div style="font-weight:800;">Send a follow-up to the salon</div>
        <div class="muted" style="margin-top:6px;">Use this if the parcel is still missing or if you need to add more details for the salon.</div>
        <label class="muted" style="margin-top:10px; display:block;">Follow-up message</label>
        <textarea class="input" data-followup-note="${escapeHtml(order._id)}" rows="3" placeholder="Example: Courier said delivered, but no parcel was received at the address."></textarea>
        <div class="actions" style="margin-top:10px;">
          <button class="btn secondary" type="button" data-followup-send="${escapeHtml(order._id)}">Send follow-up</button>
        </div>
        <div class="muted" data-followup-status="${escapeHtml(order._id)}" style="margin-top:8px;"></div>
      </div>
    `;
  }

  function renderItemCancellationControls(order) {
    if (!canCustomerCancelOrder(order)) return "";
    return `
      <div style="margin-top:12px; padding:12px; border-radius:14px; border:1px solid rgba(194,24,91,.16); background:rgba(194,24,91,.05);">
        <div style="font-weight:800;">Cancel selected items</div>
        <div class="muted" style="margin-top:6px;">Choose a cancellation quantity for any order line below. You can cancel one unit from the same item, several units, different item types together, or the full remaining order before courier handover.</div>
        <label class="muted" style="margin-top:10px; display:block;">Cancellation note (optional)</label>
        <textarea class="input" data-item-cancel-note="${escapeHtml(order._id)}" rows="3" placeholder="Example: Please remove two lipsticks from this order."></textarea>
        <div class="actions" style="margin-top:10px;">
          <button class="btn secondary" type="button" data-item-cancel-submit="${escapeHtml(order._id)}">Cancel selected items</button>
          <button class="btn secondary" type="button" data-ocancel="${escapeHtml(order._id)}">Cancel all remaining items</button>
        </div>
        <div class="muted" data-item-cancel-status="${escapeHtml(order._id)}" style="margin-top:8px;"></div>
      </div>
    `;
  }

  function renderOrders(list) {
    const cards = (list || []).map((o) => {
      const canCancel = canCustomerCancelOrder(o);
      const originalTotal = orderOriginalTotal(o);
      const cancelledTotal = orderCancelledTotal(o);
      const currentTotal = orderCurrentTotal(o);

      const itemsHtml = (o.items || [])
        .map((it) => {
          const orderedQty = itemOrderedQty(it);
          const cancelledQty = itemCancelledQty(it);
          const remainingQty = itemRemainingQty(it);
          const lineTotal = Number(it.priceLKR || 0) * orderedQty;
          const lineCurrentTotal = Number(it.priceLKR || 0) * remainingQty;
          const lineCancelledTotal = Number(it.priceLKR || 0) * cancelledQty;
          const rowBorder = cancelledQty > 0 ? "rgba(194,24,91,.18)" : "rgba(0,0,0,.08)";
          const rowBg = cancelledQty > 0 ? "rgba(194,24,91,.04)" : "rgba(255,255,255,.75)";
          return `
            <div style="padding:12px; border-radius:14px; border:1px solid ${rowBorder}; background:${rowBg}; margin-top:10px;">
              <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
                <div>
                  <div style="font-weight:800;">${escapeHtml(it.name || "Item")}</div>
                  <div class="muted" style="margin-top:4px;">Ordered: ${escapeHtml(orderedQty)} • Remaining: ${escapeHtml(remainingQty)}${cancelledQty > 0 ? ` • Cancelled: ${escapeHtml(cancelledQty)}` : ""}</div>
                </div>
                <div style="text-align:right;">
                  <div style="font-weight:800;">${escapeHtml(formatOrderMoney(lineCurrentTotal))}</div>
                  <div class="muted" style="margin-top:4px;">Unit price: ${escapeHtml(formatOrderMoney(it.priceLKR || 0))}</div>
                  ${cancelledQty > 0 ? `<div class="muted" style="margin-top:4px;">Cancelled value: ${escapeHtml(formatOrderMoney(lineCancelledTotal))}</div>` : `<div class="muted" style="margin-top:4px;">Ordered value: ${escapeHtml(formatOrderMoney(lineTotal))}</div>`}
                </div>
              </div>
              ${canCancel && remainingQty > 0 ? `
                <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:10px;">
                  <label class="muted" for="cancel-${escapeHtml(o._id)}-${escapeHtml(it.lineId || "line")}">Cancel qty</label>
                  <input
                    id="cancel-${escapeHtml(o._id)}-${escapeHtml(it.lineId || "line")}" 
                    class="input"
                    type="number"
                    min="0"
                    max="${escapeHtml(remainingQty)}"
                    value="0"
                    data-cancel-order="${escapeHtml(o._id)}"
                    data-line-id="${escapeHtml(it.lineId || "")}" 
                    style="max-width:120px;"
                  />
                  <div class="muted">Max ${escapeHtml(remainingQty)}</div>
                </div>` : ""}
            </div>
          `;
        })
        .join("");

      const adminNote = o.adminNote
        ? `
          <div style="margin-top:12px; padding:12px; border-radius:14px; border:1px solid rgba(0,0,0,.08); background:rgba(0,0,0,.02);">
            <div style="font-weight:800;">Salon note</div>
            <div class="muted" style="margin-top:6px; white-space:pre-wrap;">${escapeHtml(o.adminNote)}</div>
          </div>
        `
        : "";

      const totalSummary = cancelledTotal > 0
        ? `
          <div style="margin-top:6px;"><span class="muted">Current total:</span> <b>${escapeHtml(formatOrderMoney(currentTotal))}</b></div>
          <div class="muted" style="margin-top:6px;">Original total: ${escapeHtml(formatOrderMoney(originalTotal))}</div>
          <div class="muted" style="margin-top:4px;">Cancelled value: ${escapeHtml(formatOrderMoney(cancelledTotal))}</div>
        `
        : `<div style="margin-top:6px;"><span class="muted">Total:</span> <b>${escapeHtml(formatOrderMoney(currentTotal))}</b></div>`;

      return `
        <div class="card" style="padding:16px; margin-bottom:14px;">
          <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
            <div>
              <div style="font-size:18px; font-weight:900;">Order ${escapeHtml(orderRef(o))}</div>
              <div class="muted" style="margin-top:4px;">Placed: ${escapeHtml(formatDateTime(o.createdAt))}</div>
            </div>
            ${orderStatusPill(o.status)}
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px; margin-top:12px;">
            <div style="padding:12px; border-radius:14px; border:1px solid rgba(0,0,0,.08);">
              <div style="font-weight:800; margin-bottom:8px;">Items</div>
              ${itemsHtml || `<div class="muted">No items.</div>`}
              <div style="margin-top:10px;"><span class="muted">Delivery address:</span> ${escapeHtml(o.deliveryAddress || "—")}</div>
              <div style="margin-top:6px;"><span class="muted">Customer note:</span> ${escapeHtml(o.customerNote || "—")}</div>
              ${totalSummary}
            </div>
            <div style="padding:12px; border-radius:14px; border:1px solid rgba(0,0,0,.08); background:rgba(194,24,91,.03);">
              ${renderTrackingBox(o)}
            </div>
          </div>

          ${renderCustomerDeliveryState(o)}
          ${adminNote}
          ${renderDeliveryActionBox(o)}
          ${renderFollowupBox(o)}
          ${renderItemCancellationControls(o)}
          ${window.MalkiOrderReviewUI ? window.MalkiOrderReviewUI.renderReviewSection(o) : ""}

          ${renderItemCancellationHistory(o)}
          ${renderDeliveryThread(o)}
          ${renderOrderTimeline(o)}
        </div>
      `;
    }).join("");

    ordersWrap.innerHTML = cards || `<div class="muted">No orders yet.</div>`;

    ordersWrap.querySelectorAll("input[data-cancel-order]").forEach((input) => {
      input.addEventListener("input", () => {
        const max = Number(input.getAttribute("max") || 0);
        let value = Number(input.value || 0);
        if (!Number.isFinite(value) || value < 0) value = 0;
        value = Math.floor(value);
        if (max > 0 && value > max) value = max;
        input.value = String(value);
      });
    });

    ordersWrap.querySelectorAll("button[data-item-cancel-submit]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-item-cancel-submit");
        const statusEl = ordersWrap.querySelector(`[data-item-cancel-status="${id}"]`);
        const noteEl = ordersWrap.querySelector(`[data-item-cancel-note="${id}"]`);
        const items = Array.from(ordersWrap.querySelectorAll(`input[data-cancel-order="${id}"]`))
          .map((input) => ({
            lineId: input.getAttribute("data-line-id") || "",
            qty: Number(input.value || 0)
          }))
          .filter((entry) => entry.lineId && Number.isFinite(entry.qty) && entry.qty > 0)
          .map((entry) => ({ ...entry, qty: Math.floor(entry.qty) }));

        if (!items.length) {
          if (statusEl) statusEl.textContent = "Enter a cancel quantity for at least one item.";
          return;
        }
        if (!confirm("Cancel the selected item quantities from this order?")) return;

        btn.disabled = true;
        if (statusEl) statusEl.textContent = "Cancelling selected items...";
        const res = await fetch(`${API_BASE}/orders/me/${id}/cancel-items`, {
          method: "PUT",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ items, note: String(noteEl?.value || "").trim() })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (statusEl) statusEl.textContent = data.message || "Could not cancel the selected items.";
          btn.disabled = false;
          return;
        }
        await loadOrders();
      });
    });

    ordersWrap.querySelectorAll("button[data-ocancel]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-ocancel");
        if (!confirm("Cancel all remaining items in this order before courier handover?")) return;
        btn.disabled = true;
        const res = await fetch(`${API_BASE}/orders/me/${id}/cancel`, {
          method: "PUT",
          headers: authHeaders({ "Content-Type": "application/json" })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) alert(data.message || "Error");
        await loadOrders();
      });
    });

    ordersWrap.querySelectorAll("button[data-delivery-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const action = btn.getAttribute("data-delivery-action");
        const noteEl = ordersWrap.querySelector(`[data-delivery-note="${id}"]`);
        const statusEl = ordersWrap.querySelector(`[data-delivery-status="${id}"]`);
        const message = String(noteEl?.value || "").trim();
        btn.disabled = true;
        if (statusEl) statusEl.textContent = "Sending...";
        const res = await fetch(`${API_BASE}/orders/me/${id}/delivery-feedback`, {
          method: "PUT",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ action, message })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (statusEl) statusEl.textContent = data.message || "Could not update delivery feedback.";
          btn.disabled = false;
          return;
        }
        await loadOrders();
      });
    });

    ordersWrap.querySelectorAll("button[data-followup-send]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-followup-send");
        const noteEl = ordersWrap.querySelector(`[data-followup-note="${id}"]`);
        const statusEl = ordersWrap.querySelector(`[data-followup-status="${id}"]`);
        const message = String(noteEl?.value || "").trim();
        if (!message) {
          if (statusEl) statusEl.textContent = "Please enter a follow-up message.";
          return;
        }
        btn.disabled = true;
        if (statusEl) statusEl.textContent = "Sending...";
        const res = await fetch(`${API_BASE}/orders/me/${id}/delivery-followup`, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ message })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (statusEl) statusEl.textContent = data.message || "Could not send the follow-up message.";
          btn.disabled = false;
          return;
        }
        await loadOrders();
      });
    });

    if (window.MalkiOrderReviewUI && typeof window.MalkiOrderReviewUI.bindReviewActions === "function") {
      window.MalkiOrderReviewUI.bindReviewActions({
        ordersWrap,
        loadOrders,
        API_BASE,
        authHeaders
      });
    }
  }

  async function loadOrders() {
    if (!ordersWrap) return;
    ordersWrap.innerHTML = `<div class="muted">Loading...</div>`;
    const res = await fetch(`${API_BASE}/orders/me`, { headers: authHeaders() });
    const list = await res.json().catch(() => []);
    if (!res.ok) {
      ordersWrap.innerHTML = `<div class="muted">Could not load orders.</div>`;
      return;
    }
    renderOrders(list);
  }

  function renderMessages(list) {
    if (!messagesWrap) return;
    const msgs = list || [];

    if (!messagingEnabled) {
      messagesWrap.innerHTML = `<div class="muted">Messaging is currently disabled by admin.</div>`;
      return;
    }

    if (!msgs.length) {
      messagesWrap.innerHTML = `<div class="muted">No messages yet. Use the box below to send one.</div>`;
      return;
    }

    messagesWrap.innerHTML = msgs.map((m) => {
      const isAdmin = m.sender === "admin";
      const align = isAdmin ? "flex-start" : "flex-end";
      const bg = isAdmin ? "#fff2f7" : "#f3f0ff";
      const border = isAdmin ? "rgba(194,24,91,.20)" : "rgba(123,31,162,.20)";
      const when = m.createdAt ? new Date(m.createdAt).toLocaleString() : "";
      return `
        <div style="display:flex; justify-content:${align}; margin:8px 0;">
          <div style="max-width:80%; padding:10px 12px; border-radius:14px; background:${bg}; border:1px solid ${border}; box-shadow:0 10px 24px rgba(0,0,0,.04);">
            <div style="white-space:pre-wrap; line-height:1.4;">${escapeHtml(m.message || "")}</div>
            <div class="muted" style="margin-top:6px; font-size:11px;">${escapeHtml(isAdmin ? "Admin" : "You")} • ${escapeHtml(when)}</div>
          </div>
        </div>
      `;
    }).join("");

    messagesWrap.scrollTop = messagesWrap.scrollHeight;
  }

  async function loadSettings() {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      const s = await res.json().catch(() => ({}));
      if (res.ok) {
        siteSettings = s || {};
        messagingEnabled = s.contactMessagingEnabled !== false;
      }
    } catch {}
  }

  async function loadMessages() {
    if (!messagesWrap) return;
    messagesWrap.innerHTML = `<div class="muted">Loading...</div>`;

    if (!messagingEnabled) {
      renderMessages([]);
      if (messageForm) messageForm.querySelectorAll("textarea, button").forEach((x) => (x.disabled = true));
      if (messageStatus) messageStatus.textContent = "Messaging is disabled";
      return;
    }

    const res = await fetch(`${API_BASE}/messages/me`, { headers: authHeaders() });
    const list = await res.json().catch(() => []);
    if (!res.ok) {
      messagesWrap.innerHTML = `<div class="muted">Could not load messages.</div>`;
      return;
    }
    renderMessages(list);

    try {
      await fetch(`${API_BASE}/messages/me/read`, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" })
      });
    } catch {}
  }

  profileForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    profileStatus.textContent = "Saving...";
    profileStatus.className = "muted";

    const payload = {
      name: profileForm.name.value.trim(),
      phone: profileForm.phone.value.trim()
    };
    const pwd = profileForm.password.value;
    if (pwd) payload.password = pwd;

    const res = await fetch(`${API_BASE}/customers/me`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      profileStatus.textContent = data.message || "Error";
      profileStatus.className = "status error";
      return;
    }
    setCustomerSession(data.token, data.customer);
    profileStatus.textContent = "Saved";
    profileStatus.className = "status success";
    profileForm.password.value = "";
    await loadBookings();
  });

  (async function init() {
    const c = await loadMe();
    if (!c) return;
    welcomeLine.textContent = `Hi ${c.name}! Here you can manage your profile, booking proposals, messages, and bookings.`;
    profileForm.name.value = c.name || "";
    profileForm.phone.value = c.phone || "";
    profileForm.email.value = c.email || "";
    await loadSettings();
    await loadBookings();
    await loadOrders();
    await loadMessages();
  })();

  messageForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!messagingEnabled) {
      messageStatus.textContent = "Messaging is disabled";
      return;
    }
    messageStatus.textContent = "Sending...";
    const msg = String(messageForm.message.value || "").trim();
    if (!msg) {
      messageStatus.textContent = "Message is required";
      return;
    }

    const res = await fetch(`${API_BASE}/messages/me`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ message: msg })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      messageStatus.textContent = data.message || "Error";
      return;
    }
    messageForm.message.value = "";
    messageStatus.textContent = "Sent";
    await loadMessages();
  });
})();
