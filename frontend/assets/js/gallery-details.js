(function(){
  const el = document.getElementById("galleryDetail");
  if (!el) return;

  const params = new URLSearchParams(location.search);
  const id = params.get("id");

  if (!id) {
    el.innerHTML = `<div class="status error">Missing gallery id.</div>`;
    return;
  }

  async function run(){
    try{
      const res = await fetch(`${API_BASE}/gallery`);
      const list = await res.json();
      const g = list.find(x => x._id === id);

      if (!g){
        el.innerHTML = `<div class="status error">Gallery item not found.</div>`;
        return;
      }

      const tags = (g.tags || []).map(t=>`<span class="badge" style="margin-right:6px; margin-bottom:6px; display:inline-flex">${t}</span>`).join("");

      el.innerHTML = `
        <div class="card" style="overflow:hidden">
          <img src="${imgUrl(g.imageUrl) || "assets/img/gallery-1.png"}" alt="${g.title || "Gallery"}" style="height:420px; object-fit:cover">
          <div class="card-body">
            <div class="badge">Gallery</div>
            <h1 style="margin:0 0 8px; font-size:34px; line-height:1.15">${g.title || "Salon Work"}</h1>
            <div style="margin-top:8px">${tags || `<span class="muted">No tags</span>`}</div>

            <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:16px">
              <a class="btn secondary" href="gallery.html">Back to Gallery</a>
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