const API_ORIGIN = "http://localhost:5000";
const API_BASE = `${API_ORIGIN}/api`;

function imgUrl(path){
  if (!path) return "";
  if (/^https?:\/\//i.test(path) || String(path).startsWith("data:")) return path;
  if (String(path).startsWith("/")) return `${API_ORIGIN}${path}`;
  return String(path);
}

async function loadServicesToPage(listContainerId, selectId, limit=null) {
  const res = await fetch(`${API_BASE}/services`);
  const services = await res.json();

  const show = limit ? services.slice(0, limit) : services;

  // Services page cards
  if (listContainerId) {
    const wrap = document.getElementById(listContainerId);
    wrap.innerHTML = show.map(s => `
      <a class="card card-link" href="service-details.html?id=${s._id}">
        <img src="${imgUrl(s.imageUrl) || "assets/img/service-hair.png"}" alt="${s.name}">
        <div class="card-body">
          <div class="badge">${s.category}</div>
          <h3 style="margin:0 0 6px">${s.name}</h3>
          <div class="muted">Duration: ${s.durationMin} min</div>
          <div class="price" style="margin-top:8px">LKR ${s.priceLKR}</div>
        </div>
      </a>
    `).join("");
  }

  // Booking select options
  if (selectId) {
    const sel = document.getElementById(selectId);
    sel.innerHTML = `<option value="">-- Select a service --</option>` + services.map(s =>
      `<option value="${s._id}">${s.category} - ${s.name} (LKR ${s.priceLKR})</option>`
    ).join("");
  }

  return services;
}

async function loadPackages(containerId, limit=null){
  const res = await fetch(`${API_BASE}/packages`);
  const items = await res.json();
  const show = limit ? items.slice(0, limit) : items;

  if (containerId) {
    const wrap = document.getElementById(containerId);
    wrap.innerHTML = show.map(p => `
      <a class="card card-link" href="package-details.html?id=${p._id}">
        <img src="${imgUrl(p.imageUrl) || "assets/img/package-newyear.png"}" alt="${p.title}">
        <div class="card-body">
          <div class="badge">Package</div>
          <h3 style="margin:0 0 6px">${p.title}</h3>
          <div class="muted">${p.description || ""}</div>
          <div class="price" style="margin-top:8px">LKR ${p.priceLKR}</div>
        </div>
      </a>
    `).join("");
  }
  return items;
}

async function loadGallery(containerId, limit=null){
  const res = await fetch(`${API_BASE}/gallery`);
  const items = await res.json();
  const show = limit ? items.slice(0, limit) : items;

  if (containerId) {
    const wrap = document.getElementById(containerId);
    wrap.innerHTML = show.map(g => `
      <a class="card card-link" href="gallery-details.html?id=${g._id}">
        <img src="${imgUrl(g.imageUrl) || "assets/img/gallery-1.png"}" alt="${g.title || "Gallery"}">
        <div class="card-body">
          <div class="badge">Gallery</div>
          <h3 style="margin:0 0 6px">${g.title || "Salon Work"}</h3>
          <div class="muted">${(g.tags || []).join(" • ")}</div>
        </div>
      </a>
    `).join("");
  }
  return items;
}

async function submitBooking(formId, statusId) {
  const form = document.getElementById(formId);
  const status = document.getElementById(statusId);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.textContent = "Submitting...";
    status.className = "status";

    const payload = {
      customerName: form.customerName.value.trim(),
      phone: form.phone.value.trim(),
      email: form.email.value.trim(),
      serviceId: form.serviceId.value,
      date: form.date.value,
      time: form.time.value,
      notes: form.notes.value.trim()
    };

    try {
      const res = await fetch(`${API_BASE}/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        status.textContent = data.message || "Error";
        status.className = "status error";
        return;
      }

      status.textContent = "✅ Booking created successfully!";
      status.className = "status success";
      form.reset();
    } catch (err) {
      status.textContent = "Server not reachable. Check backend is running.";
      status.className = "status error";
    }
  });
}
