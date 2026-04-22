(function(){
  const list = document.getElementById("offersList");
  if (!list) return;

  const offers = window.SALON_OFFERS || [];
  if (offers.length === 0){
    list.innerHTML = '<div class="status error">Currently there are no special offers. Please check back soon!</div>';
    return;
  }

  const today = new Date();
  list.innerHTML = offers.map(o => {
    const till = o.validTill ? new Date(o.validTill + "T00:00:00") : null;
    const expired = till && till < today;
    const badge = expired ? '<span class="pill">Expired</span>' : '<span class="pill brand">Active</span>';
    const tillText = o.validTill ? `<span class="pill">Valid till: ${o.validTill}</span>` : '';
    const tagText = o.tag ? `<span class="pill">${o.tag}</span>` : '';
    return `
      <div class="offer-card">
        <div class="pad">
          <h3 class="offer-title">${o.title}</h3>
          <p class="muted" style="margin:0">${o.description}</p>
          <div class="offer-meta">
            ${badge}
            ${tagText}
            ${tillText}
          </div>
          <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap">
            <a class="btn" href="booking.html">Book Now</a>
            <a class="btn secondary" href="contact.html">Ask on WhatsApp</a>
          </div>
        </div>
      </div>
    `;
  }).join("");
})();