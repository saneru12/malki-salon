// Customer auth helpers (frontend)
const CUSTOMER_TOKEN_KEY = "malki_customer_token";
const CUSTOMER_KEY = "malki_customer";

function getCustomerToken() {
  return localStorage.getItem(CUSTOMER_TOKEN_KEY) || "";
}

function getCustomer() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOMER_KEY) || "null");
  } catch {
    return null;
  }
}

function setCustomerSession(token, customer) {
  localStorage.setItem(CUSTOMER_TOKEN_KEY, token);
  localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer || null));
}

function clearCustomerSession() {
  localStorage.removeItem(CUSTOMER_TOKEN_KEY);
  localStorage.removeItem(CUSTOMER_KEY);
}

function authHeaders(extra = {}) {
  const token = getCustomerToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

function requireCustomer() {
  const token = getCustomerToken();
  if (!token) {
    window.location.href = "customer-login.html?next=" + encodeURIComponent(location.pathname.split("/").pop());
    return false;
  }
  return true;
}
