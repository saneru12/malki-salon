(function(){
  const el = document.getElementById("serviceDetail");
  if (!el) return;

  const params = new URLSearchParams(location.search);
  const id = params.get("id");

  if (!id) {
    el.innerHTML = `<div class="status error">Missing service id.</div>`;
    return;
  }

  const categoryExtras = {
    Hair: ["Professional wash & styling", "Premium products", "After-care tips"],
    Skin: ["Skin analysis", "Deep cleanse & care", "Glowing finish"],
    Makeup: ["Look consultation", "High-quality cosmetics", "Photo-ready finish"],
    Nails: ["Nail care & shaping", "Polish/gel options", "Long-lasting finish"]
  };

  function money(n){ return (Number(n)||0).toLocaleString("en-LK"); }

  async function run(){
    try{
      const res = await fetch(`${API_BASE}/services`);
      const list = await res.json();
      const s = list.find(x => x._id === id);

      if (!s){
        el.innerHTML = `<div class="status error">Service not found.</div>`;
        return;
      }

      const extras = categoryExtras[s.category] || ["Expert consultation", "Premium products", "Comfortable experience"];

      el.innerHTML = `
        <div class="card" style="overflow:hidden">
          <img src="${imgUrl(s.imageUrl) || "assets/img/service-hair.png"}" alt="${s.name}" style="height:320px">
          <div class="card-body">
            <div class="badge">${s.category}</div>
            <h1 style="margin:0 0 8px; font-size:34px; line-height:1.15">${s.name}</h1>
            <div class="muted" style="margin-bottom:10px">Duration: <b>${s.durationMin}</b> minutes</div>
            <div class="price" style="font-size:22px">LKR ${money(s.priceLKR)}</div>

            <div style="margin-top:14px">
              <h3 style="margin:0 0 8px">What’s included</h3>
              <ul style="margin:0; padding-left:18px" class="muted">
                ${extras.map(t=>`<li>${t}</li>`).join("")}
              </ul>
            </div>

            <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:16px">
              <a class="btn" href="booking.html?serviceId=${encodeURIComponent(s._id)}">Book this service</a>
              <a class="btn secondary" href="services.html">Back to Services</a>
            </div>
          </div>
        </div>
      `;
    }catch(e){
      el.innerHTML = `<div class="status error">Unable to load details. Please check backend is running.</div>`;
    }
  }

  run();
})();