(function () {
  const REVIEW_VISIBLE_STATUSES = ["delivered", "completed", "delivery_issue"];
  const REVIEW_CONFIRMATION_STATUSES = ["received", "not_received"];
  const SCORE_LABELS = {
    1: "Very poor",
    2: "Needs improvement",
    3: "Good",
    4: "Very good",
    5: "Excellent"
  };

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDateTime(value) {
    if (!value) return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
  }

  function clampRating(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(5, Math.round(n)));
  }

  function canShow(order) {
    return REVIEW_VISIBLE_STATUSES.includes(String(order?.status || ""));
  }

  function canSubmit(order) {
    return REVIEW_CONFIRMATION_STATUSES.includes(String(order?.delivery?.customerConfirmationStatus || "pending"));
  }

  function renderStars(id, rating, disabled) {
    const current = clampRating(rating);
    return Array.from({ length: 5 }, (_, index) => {
      const value = index + 1;
      const active = value <= current ? "active" : "";
      return `<button class="review-star-btn ${active}" type="button" data-review-star="${escapeHtml(id)}" data-value="${value}" ${disabled ? "disabled" : ""} aria-label="${value} star${value > 1 ? "s" : ""}">★</button>`;
    }).join("");
  }

  function renderSelect(name, current, disabled, placeholder) {
    const selectedValue = clampRating(current);
    const options = ['<option value="">' + escapeHtml(placeholder) + '</option>'];
    for (let i = 5; i >= 1; i -= 1) {
      options.push(`<option value="${i}" ${selectedValue === i ? "selected" : ""}>${i} star${i > 1 ? "s" : ""}</option>`);
    }
    return `<select class="input" name="${escapeHtml(name)}" ${disabled ? "disabled" : ""}>${options.join("")}</select>`;
  }

  function renderRecommendSelect(current, disabled) {
    return `
      <select class="input" name="wouldRecommend" ${disabled ? "disabled" : ""}>
        <option value="">Optional</option>
        <option value="true" ${current === true ? "selected" : ""}>Yes, I would recommend it</option>
        <option value="false" ${current === false ? "selected" : ""}>No, not yet</option>
      </select>
    `;
  }

  function renderLockMessage(order) {
    const confirmation = String(order?.delivery?.customerConfirmationStatus || "pending");
    if (confirmation === "pending") {
      return "Admin already marked this order delivered. To publish a verified review, press Item received or Item not received first.";
    }
    return "This review will unlock after the delivery confirmation step is finished.";
  }

  function renderReviewSection(order) {
    if (!canShow(order)) return "";

    const id = String(order?._id || "");
    const review = order?.review || {};
    const locked = !canSubmit(order);
    const rating = clampRating(review.rating);
    const isPublished = review?.isPublished === true && rating > 0;
    const publishedAt = review?.updatedAt || review?.submittedAt;
    const deliveryOutcome = String(order?.delivery?.customerConfirmationStatus || "pending");
    const outcomeNote = deliveryOutcome === "not_received"
      ? "You can still rate the salon support and delivery handling even if the parcel was not received."
      : "Your verified rating will be shown publicly in the shop review summary.";

    return `
      <div class="order-review-panel" data-order-review-panel="${escapeHtml(id)}">
        <div class="order-review-head">
          <div>
            <div class="badge" style="margin-bottom:6px;">Verified Shop Review</div>
            <div class="order-review-title">Rate this delivered order</div>
            <div class="muted" style="margin-top:6px;">${escapeHtml(outcomeNote)}</div>
          </div>
          <div class="order-review-live ${isPublished ? "live" : "draft"}">
            ${isPublished ? `Live on shop • ${escapeHtml(formatDateTime(publishedAt))}` : "Not published yet"}
          </div>
        </div>

        ${locked ? `<div class="order-review-lock">${escapeHtml(renderLockMessage(order))}</div>` : ""}

        <form class="order-review-form" data-review-form="${escapeHtml(id)}">
          <input type="hidden" value="${rating}" data-review-rating-value="${escapeHtml(id)}" />

          <div class="order-review-main-rating">
            <label class="muted">Overall rating</label>
            <div class="review-stars-row">${renderStars(id, rating, locked)}</div>
            <div class="muted review-rating-caption" data-review-rating-label="${escapeHtml(id)}">${escapeHtml(rating ? `${rating}/5 • ${SCORE_LABELS[rating]}` : "Choose 1 to 5 stars")}</div>
          </div>

          <div class="order-review-grid">
            <div>
              <label class="muted">Product quality</label>
              ${renderSelect("productQualityRating", review.productQualityRating, locked, "Optional")}
            </div>
            <div>
              <label class="muted">Delivery handling</label>
              ${renderSelect("deliveryServiceRating", review.deliveryServiceRating, locked, "Optional")}
            </div>
            <div>
              <label class="muted">Salon support</label>
              ${renderSelect("salonSupportRating", review.salonSupportRating, locked, "Optional")}
            </div>
            <div>
              <label class="muted">Would recommend</label>
              ${renderRecommendSelect(typeof review.wouldRecommend === "boolean" ? review.wouldRecommend : null, locked)}
            </div>
          </div>

          <div>
            <label class="muted">Short title (optional)</label>
            <input class="input" name="title" maxlength="120" ${locked ? "disabled" : ""} value="${escapeHtml(review.title || "")}" placeholder="Example: Fast delivery and good quality" />
          </div>

          <div>
            <label class="muted">Your review (optional)</label>
            <textarea class="input" name="comment" rows="4" maxlength="2000" ${locked ? "disabled" : ""} placeholder="Tell future customers about your real experience.">${escapeHtml(review.comment || "")}</textarea>
          </div>

          <div class="actions" style="margin-top:12px;">
            <button class="btn" type="submit" ${locked ? "disabled" : ""}>${isPublished ? "Update review" : "Publish review"}</button>
          </div>
          <div class="muted" data-review-status="${escapeHtml(id)}" style="margin-top:8px;">${isPublished ? "Your verified review is currently visible on the shop page." : ""}</div>
        </form>
      </div>
    `;
  }

  function updateStarState(root, id, value) {
    const rating = clampRating(value);
    const input = root.querySelector(`[data-review-rating-value="${id}"]`);
    if (input) input.value = String(rating);

    root.querySelectorAll(`[data-review-star="${id}"]`).forEach((btn) => {
      const btnValue = clampRating(btn.getAttribute("data-value"));
      btn.classList.toggle("active", btnValue <= rating);
    });

    const label = root.querySelector(`[data-review-rating-label="${id}"]`);
    if (label) {
      label.textContent = rating ? `${rating}/5 • ${SCORE_LABELS[rating]}` : "Choose 1 to 5 stars";
    }
  }

  function bindReviewActions({ ordersWrap, loadOrders, API_BASE, authHeaders }) {
    if (!ordersWrap) return;

    ordersWrap.querySelectorAll("button[data-review-star]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-review-star");
        const value = btn.getAttribute("data-value");
        updateStarState(ordersWrap, id, value);
      });
    });

    ordersWrap.querySelectorAll("form[data-review-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const id = form.getAttribute("data-review-form");
        const statusEl = ordersWrap.querySelector(`[data-review-status="${id}"]`);
        const rating = clampRating(ordersWrap.querySelector(`[data-review-rating-value="${id}"]`)?.value || 0);

        if (!rating) {
          if (statusEl) statusEl.textContent = "Please choose an overall rating.";
          return;
        }

        const fd = new FormData(form);
        const payload = {
          rating,
          title: String(fd.get("title") || "").trim(),
          comment: String(fd.get("comment") || "").trim(),
          wouldRecommend: fd.get("wouldRecommend") || "",
          productQualityRating: fd.get("productQualityRating") || "",
          deliveryServiceRating: fd.get("deliveryServiceRating") || "",
          salonSupportRating: fd.get("salonSupportRating") || ""
        };

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        if (statusEl) statusEl.textContent = "Publishing your verified review...";

        try {
          const res = await fetch(`${API_BASE}/reviews/orders/${id}`, {
            method: "PUT",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify(payload)
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.message || "Could not save the review.");
          if (statusEl) statusEl.textContent = data?.message || "Review saved.";
          await loadOrders();
        } catch (error) {
          if (statusEl) statusEl.textContent = error.message || "Could not save the review.";
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    });
  }

  window.MalkiOrderReviewUI = {
    renderReviewSection,
    bindReviewActions
  };
})();
