(function () {
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const loginStatus = document.getElementById("loginStatus");
  const registerStatus = document.getElementById("registerStatus");

  const url = new URL(location.href);
  const next = url.searchParams.get("next") || "customer-dashboard.html";
  const registered = url.searchParams.get("registered") || "";
  const registeredEmail = url.searchParams.get("email") || "";

  // If already logged in, go straight to dashboard
  if (getCustomerToken()) {
    location.href = next;
    return;
  }

  // If user just registered, focus login panel
  if (registered && loginForm) {
    if (registeredEmail && loginForm.email) loginForm.email.value = registeredEmail;
    loginStatus.textContent = "✅ Account created. Please login to continue.";
    loginStatus.className = "status success";
    setTimeout(() => {
      try { loginForm.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {}
      try { if (loginForm.password) loginForm.password.focus(); } catch {}
    }, 50);
  }

  async function handle(res, statusEl) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      statusEl.textContent = data.message || "Error";
      statusEl.className = "status error";
      return null;
    }
    statusEl.textContent = "✅ Success!";
    statusEl.className = "status success";
    return data;
  }

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginStatus.textContent = "Signing in...";
    loginStatus.className = "muted";

    const payload = {
      email: loginForm.email.value.trim(),
      password: loginForm.password.value
    };

    const res = await fetch(`${API_BASE}/customers/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await handle(res, loginStatus);
    if (!data) return;

    setCustomerSession(data.token, data.customer);
    location.href = next;
  });

  registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    registerStatus.textContent = "Creating account...";
    registerStatus.className = "muted";

    const payload = {
      name: registerForm.name.value.trim(),
      phone: registerForm.phone.value.trim(),
      email: registerForm.email.value.trim(),
      password: registerForm.password.value
    };

    const res = await fetch(`${API_BASE}/customers/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await handle(res, registerStatus);
    if (!data) return;

    // IMPORTANT: Do NOT auto-login after register.
    // Redirect (same page) + show login panel.
    registerStatus.textContent = "✅ Account created! Please login.";
    registerStatus.className = "status success";

    const email = (payload.email || "").trim();
    const qs = new URLSearchParams(location.search);
    qs.set("registered", "1");
    if (email) qs.set("email", email);
    if (next) qs.set("next", next);
    location.href = `customer-login.html?${qs.toString()}`;
  });
})(); 
