(function () {
  const $ = (s) => document.querySelector(s);
  const content = $("#content");
  const loginBox = $("#loginBox");
  const loginForm = $("#loginForm");
  const loginStatus = $("#loginStatus");
  const whoami = $("#whoami");
  const logoutBtn = $("#logoutBtn");
  const viewTitle = $("#viewTitle");
  const viewHint = $("#viewHint");

  const TOK_KEY = "malki_staff_portal_token";
  let token = sessionStorage.getItem(TOK_KEY) || "";
  let currentUser = null;

  function setLoginVisible(visible) {
    loginBox.classList.toggle("hidden", !visible);
  }

  function setStatus(el, text, kind) {
    if (!el) return;
    el.style.display = text ? "block" : "none";
    el.textContent = text || "";
    el.className = "status " + (kind || "");
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function pill(text, kind) {
    return `<span class="pill ${kind || ""}">${escapeHtml(text)}</span>`;
  }

  function fmtMoney(n) {
    const v = Number(n || 0);
    return v.toLocaleString("en-LK");
  }

  function forceLogout() {
    token = "";
    currentUser = null;
    sessionStorage.removeItem(TOK_KEY);
    setLoginVisible(true);
    whoami.textContent = "Not signed in";
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.message || `Request failed: ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  const modal = document.createElement("div");
  modal.className = "modal hidden";
  modal.innerHTML = `
    <div class="card modal-card modal-card--md">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:12px">
          <div>
            <h2 id="mTitle" style="margin:0 0 4px"></h2>
            <div class="muted" id="mSub"></div>
          </div>
          <button class="btn secondary" id="mClose" type="button">Close</button>
        </div>
        <div id="mBody" style="margin-top:12px"></div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const modalCard = modal.querySelector(".modal-card");
  const mTitle = modal.querySelector("#mTitle");
  const mSub = modal.querySelector("#mSub");
  const mBody = modal.querySelector("#mBody");
  modal.querySelector("#mClose").addEventListener("click", () => hideModal());
  modal.addEventListener("click", (e) => {
    if (e.target === modal) hideModal();
  });

  function showModal(title, sub, bodyHtml, options = {}) {
    const size = typeof options === "string" ? options : options.size || "md";
    modalCard.className = `card modal-card modal-card--${size}`;
    mTitle.textContent = title || "";
    mSub.textContent = sub || "";
    mBody.innerHTML = bodyHtml || "";
    modal.classList.remove("hidden");
  }

  function hideModal() {
    modal.classList.add("hidden");
    modalCard.className = "card modal-card modal-card--md";
    mBody.innerHTML = "";
  }

  async function loadMe() {
    const res = await api("/auth/me", { method: "GET" });
    const u = res.user || {};
    currentUser = u;
    const roleLabel = u.role === "staff_manager" ? "Staff Manager" : "Admin";
    whoami.textContent = u.email ? `${roleLabel}: ${u.displayName || u.email}` : "Signed in";
  }

  async function renderStaff() {
    if (!window.MalkiStaffModule || typeof window.MalkiStaffModule.render !== "function") {
      viewTitle.textContent = "Staff Management";
      viewHint.textContent = "Staff module failed to load";
      content.innerHTML = `<div class="status error">staff-module.js was not loaded correctly.</div>`;
      return;
    }

    return window.MalkiStaffModule.render({
      api,
      content,
      viewTitle,
      viewHint,
      pill,
      escapeHtml,
      fmtMoney,
      showModal,
      hideModal,
      setStatus,
      currentUser
    });
  }

  async function safeRender() {
    try {
      await renderStaff();
    } catch (err) {
      content.innerHTML = `<div class="card"><div class="card-body"><div class="status error">${escapeHtml(err.message || "This section could not be loaded.")}</div></div></div>`;
      console.error("Staff portal render failed", err);
    }
  }

  async function checkAuth() {
    if (!token) {
      setLoginVisible(true);
      whoami.textContent = "Not signed in";
      return false;
    }
    try {
      await loadMe();
      if (!["admin", "staff_manager"].includes(String(currentUser?.role || ""))) {
        forceLogout();
        setStatus(loginStatus, "This account cannot use the staff portal.", "error");
        return false;
      }
      setLoginVisible(false);
      return true;
    } catch {
      forceLogout();
      return false;
    }
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus(loginStatus, "Signing in...", "");
    try {
      const res = await api("/auth/login", {
        method: "POST",
        headers: { Authorization: "" },
        body: JSON.stringify({
          email: loginForm.email.value,
          password: loginForm.password.value
        })
      });
      token = res.token;
      sessionStorage.setItem(TOK_KEY, token);
      await loadMe();
      if (!["admin", "staff_manager"].includes(String(currentUser?.role || ""))) {
        forceLogout();
        setStatus(loginStatus, "This account cannot use the staff portal.", "error");
        return;
      }
      setLoginVisible(false);
      setStatus(loginStatus, "", "");
      await safeRender();
    } catch (err) {
      setStatus(loginStatus, err.message, "error");
    }
  });

  logoutBtn.addEventListener("click", () => {
    forceLogout();
  });

  (async () => {
    const ok = await checkAuth();
    if (ok) await safeRender();
  })();
})();
