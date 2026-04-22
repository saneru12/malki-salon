(function(){
  const offers = window.SALON_OFFERS || [];
  const hasOffers = offers.length > 0;

  if (hasOffers) {
    document.body.classList.add("has-offers");
  }

  // Home banner indicator
  const banner = document.querySelector(".offers-banner");
  if (banner){
    if (!hasOffers){
      banner.classList.add("hidden");
    } else {
      const countEl = banner.querySelector("[data-offers-count]");
      if (countEl) countEl.textContent = offers.length;
    }
  }
})();