(function(){
  const el = document.getElementById("packageDetail");
  if (!el) return;

  const params = new URLSearchParams(location.search);
  const id = params.get("id");

  if (!id) {
    el.innerHTML = `<div class="status error">Missing package id.</div>`;
    return;
  }

  function money(n){ return (Number(n)||0).toLocaleString("en-LK"); }

  async function run(){
    try{
      const res = await fetch(`${API_BASE}/packages`);
      const list = await res.json();
      const p = list.find(x => x._id === id);

      if (!p){
        el.innerHTML = `<div class="status error">Package not found.</div>`;
        return;
      }

      el.innerHTML = `
        <div class="card" style="overflow:hidden">
          <img src="${imgUrl(p.imageUrl) || "assets/img/package-newyear.png"}" alt="${p.title}" style="height:320px">
          <div class="card-body">
            <div class="badge">Package</div>
            <h1 style="margin:0 0 8px; font-size:34px; line-height:1.15">${p.title}</h1>
            <div class="price" style="font-size:22px">LKR ${money(p.priceLKR)}</div>

            <div style="margin-top:14px">
              <h3 style="margin:0 0 8px">Details</h3>
              <div class="muted" style="white-space:pre-line">${p.description || "Package details will be updated soon."}</div>
            </div>

            <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:16px">
              <a class="btn" href="booking.html">Book Appointment</a>
              <a class="btn secondary" href="packages.html">Back to Packages</a>
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