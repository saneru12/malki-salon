(function () {
  const state = {
    page: 1,
    limit: 6,
    hasMore: false,
    loading: false
  };

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDate(value) {
    if (!value) return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
  }

  function clampRating(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(5, n));
  }

  function starFillPercent(rating, index) {
    const diff = clampRating(rating) - index;
    return Math.max(0, Math.min(100, diff * 100));
  }

  function renderTrustStrip(rating, small) {
    const sizeClass = small ? " small" : "";
    return `
      <div class="trust-strip${sizeClass}" aria-label="${escapeHtml(Number(rating || 0).toFixed(1))} out of 5 stars">
        ${Array.from({ length: 5 }, (_, index) => {
          const fill = starFillPercent(rating, index);
          return `
            <span class="trust-star-box">
              <span class="trust-star-fill" style="width:${fill}%"></span>
              <span class="trust-star-char">★</span>
            </span>
          `;
        }).join("")}
      </div>
    `;
  }

  function outcomeLabel(value) {
    if (value === "not_received") return "Delivery issue review";
    if (value === "received") return "Received order review";
    return "Verified order review";
  }

  function renderAspectChips(review) {
    const chips = [];
    if (review?.productQualityRating) chips.push(`Product ${escapeHtml(review.productQualityRating)}/5`);
    if (review?.deliveryServiceRating) chips.push(`Delivery ${escapeHtml(review.deliveryServiceRating)}/5`);
    if (review?.salonSupportRating) chips.push(`Support ${escapeHtml(review.salonSupportRating)}/5`);
    if (review?.wouldRecommend === true) chips.push("Would recommend");
    if (review?.wouldRecommend === false) chips.push("Needs improvement");
    return chips.length
      ? `<div class="review-chip-row">${chips.map((chip) => `<span class="review-chip">${escapeHtml(chip)}</span>`).join("")}</div>`
      : "";
  }

  function renderSummary(summary) {
    const average = Number(summary?.averageRating || 0);
    const totalReviews = Number(summary?.totalReviews || 0);
    const recommendationRate = Number(summary?.recommendationRate || 0);
    const breakdown = Array.isArray(summary?.breakdown) ? summary.breakdown : [];
    const cta = typeof isCustomerLoggedIn === "function" && isCustomerLoggedIn()
      ? `<a class="btn" href="customer-dashboard.html">Open My Account</a>`
      : `<a class="btn" href="customer-login.html?next=${encodeURIComponent("shop.html")}">Login to leave a review</a>`;

    if (!totalReviews) {
      return `
        <div class="shop-review-hero-card">
          <div>
            <div class="badge">Verified Shop Reviews</div>
            <h2 style="margin:6px 0 8px;">Public rating widget ready</h2>
            <p class="muted" style="margin:0;">When a delivered order is confirmed inside My Account, the customer can publish a verified review here. This section stays visible for every visitor, even without login.</p>
            <div style="margin-top:14px;">${cta}</div>
          </div>
          <div class="shop-review-empty-box">
            ${renderTrustStrip(0, false)}
            <div class="shop-review-score-line"><strong>0.0</strong> <span>(0 reviews)</span></div>
            <div class="muted" style="margin-top:8px;">Be the first verified buyer to rate the shop.</div>
          </div>
        </div>
      `;
    }

    return `
      <div class="shop-review-hero-card">
        <div>
          <div class="badge">Verified Shop Reviews</div>
          <h2 style="margin:6px 0 8px;">Real delivery feedback from verified buyers</h2>
          <p class="muted" style="margin:0;">Only customers who placed an order and confirmed delivery can publish a public rating from My Account.</p>
          <div class="shop-review-score-wrap">
            ${renderTrustStrip(average, false)}
            <div class="shop-review-score-line"><strong>${escapeHtml(average.toFixed(1))}</strong> <span>(${escapeHtml(totalReviews)} reviews)</span></div>
          </div>
          <div class="shop-review-subline">${escapeHtml(recommendationRate)}% of reviewers said they would recommend the shop.</div>
          <div style="margin-top:14px;">${cta}</div>
        </div>
        <div class="review-breakdown-card">
          ${breakdown.map((row) => `
            <div class="review-breakdown-row">
              <div class="review-breakdown-label">${escapeHtml(row.rating)} star</div>
              <div class="review-breakdown-track"><span style="width:${escapeHtml(row.percent)}%"></span></div>
              <div class="review-breakdown-count">${escapeHtml(row.count)}</div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderReviewCard(review) {
    const title = String(review?.title || "").trim();
    const comment = String(review?.comment || "").trim();
    const body = comment || "This customer left a verified star rating without additional text.";

    return `
      <article class="shop-review-card">
        <div class="shop-review-card-top">
          <div>
            <div class="shop-reviewer-name">${escapeHtml(review?.reviewerName || "Verified customer")}</div>
            <div class="shop-review-meta">${escapeHtml(outcomeLabel(review?.deliveryOutcome))} • ${escapeHtml(formatDate(review?.submittedAt))}</div>
          </div>
          <div>
            ${renderTrustStrip(Number(review?.rating || 0), true)}
          </div>
        </div>
        ${title ? `<h3>${escapeHtml(title)}</h3>` : ""}
        <p>${escapeHtml(body)}</p>
        ${renderAspectChips(review)}
        <div class="shop-review-footer">
          <span class="shop-review-verified">Verified order</span>
          <span class="shop-review-items">${escapeHtml(review?.purchasedItems || "Shop order")}</span>
        </div>
      </article>
    `;
  }

  async function loadShopReviews(append) {
    const hero = document.getElementById("shopReviewHero");
    const list = document.getElementById("shopReviewList");
    const moreBtn = document.getElementById("shopReviewMoreBtn");

    if (!hero || !list || !moreBtn || state.loading) return;
    state.loading = true;

    if (!append) {
      hero.innerHTML = `<div class="muted">Loading verified ratings...</div>`;
      list.innerHTML = `<div class="muted">Loading reviews...</div>`;
    }
    moreBtn.disabled = true;
    moreBtn.textContent = "Loading...";

    try {
      const res = await fetch(`${API_BASE}/reviews/shop?page=${state.page}&limit=${state.limit}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Could not load public reviews.");

      hero.innerHTML = renderSummary(data);

      const cards = Array.isArray(data?.reviews) ? data.reviews.map(renderReviewCard).join("") : "";
      if (append) {
        list.insertAdjacentHTML("beforeend", cards);
      } else {
        list.innerHTML = cards || `<div class="card" style="padding:14px;"><div class="muted">No verified reviews yet.</div></div>`;
      }

      state.hasMore = Boolean(data?.hasMore);
      moreBtn.hidden = !state.hasMore;
      moreBtn.disabled = false;
      moreBtn.textContent = state.hasMore ? "Show more verified reviews" : "All reviews loaded";
    } catch (error) {
      hero.innerHTML = `<div class="card" style="padding:14px;"><div class="badge">Reviews</div><div class="muted" style="margin-top:8px;">${escapeHtml(error.message || "Could not load reviews.")}</div></div>`;
      if (!append) {
        list.innerHTML = "";
      }
      moreBtn.hidden = true;
    } finally {
      state.loading = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const moreBtn = document.getElementById("shopReviewMoreBtn");
    if (!moreBtn) return;

    moreBtn.addEventListener("click", async () => {
      if (!state.hasMore || state.loading) return;
      state.page += 1;
      await loadShopReviews(true);
    });

    loadShopReviews(false);
  });
})();
