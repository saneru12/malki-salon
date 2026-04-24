// Online Shop (backend-powered)
// - Products are loaded from API (/api/products)
// - Orders are created in DB (/api/orders)
// - Cart is kept in localStorage (per browser)

const LKR = (n) => `LKR ${Number(n || 0).toLocaleString("en-LK")}`;
const CART_KEY = "malki_cart_v2";

let PRODUCTS = [];
const SHOP_STATE = {
  category: "all",
  search: "",
  sort: "featured"
};

// Customer login requirement (uses customer-auth.js)
function isCustomerLoggedIn() {
  try {
    if (typeof getCustomerToken === "function") return !!getCustomerToken();
    return !!localStorage.getItem("malki_customer_token");
  } catch {
    return false;
  }
}

function requireLoginFor(actionText) {
  alert(`⚠️ ${actionText} කරන්න login වෙන්න ඕනේ.`);
  try {
    if (typeof requireCustomer === "function") return requireCustomer();
  } catch {}
  const next = encodeURIComponent("shop.html");
  location.href = `customer-login.html?next=${next}`;
  return false;
}

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || {};
  } catch {
    return {};
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart || {}));
}

function clearCart() {
  localStorage.removeItem(CART_KEY);
}

function productById(id) {
  return PRODUCTS.find((p) => String(p._id) === String(id));
}

function addToCart(id) {
  if (!isCustomerLoggedIn()) return requireLoginFor("Add to Cart");
  const cart = loadCart();
  cart[id] = (cart[id] || 0) + 1;
  saveCart(cart);
  renderCart();
}

function setQty(id, qty) {
  if (!isCustomerLoggedIn()) return requireLoginFor("Cart update");
  const cart = loadCart();
  if (qty <= 0) delete cart[id];
  else cart[id] = qty;
  saveCart(cart);
  renderCart();
}

function removeItem(id) {
  if (!isCustomerLoggedIn()) return requireLoginFor("Cart update");
  const cart = loadCart();
  delete cart[id];
  saveCart(cart);
  renderCart();
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getCategoryLabel(product) {
  const raw = String(product?.category || "").trim();
  return raw || "General";
}

function getCategoryKey(name) {
  const raw = String(name || "all").trim().toLowerCase();
  return raw ? raw.replace(/\s+/g, "-") : "general";
}

function deriveCategories() {
  const map = new Map();
  for (const product of PRODUCTS) {
    const label = getCategoryLabel(product);
    const key = getCategoryKey(label);
    if (!map.has(key)) map.set(key, { key, label, count: 0 });
    map.get(key).count += 1;
  }

  return Array.from(map.values()).sort((a, b) => {
    const countDelta = b.count - a.count;
    if (countDelta !== 0) return countDelta;
    return a.label.localeCompare(b.label, "en", { sensitivity: "base" });
  });
}

function getStockMeta(product) {
  if (product?.stockQty === null || product?.stockQty === undefined) {
    return { label: "Salon ready", className: "is-ready" };
  }

  const qty = Math.max(0, Number(product.stockQty) || 0);
  if (qty <= 0) return { label: "Out of stock", className: "is-empty" };
  if (qty <= 5) return { label: `Only ${qty} left`, className: "is-low" };
  return { label: `${qty} in stock`, className: "is-ready" };
}

function getSelectedCategoryLabel() {
  if (SHOP_STATE.category === "all") return "All Items";
  const match = deriveCategories().find((category) => category.key === SHOP_STATE.category);
  return match?.label || "Selected Category";
}

function getFilteredProducts() {
  let list = [...PRODUCTS];

  if (SHOP_STATE.category !== "all") {
    list = list.filter((product) => getCategoryKey(getCategoryLabel(product)) === SHOP_STATE.category);
  }

  const query = SHOP_STATE.search.trim().toLowerCase();
  if (query) {
    list = list.filter((product) => {
      const haystack = [product?.name, product?.description, product?.category]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  switch (SHOP_STATE.sort) {
    case "newest":
      list.sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0));
      break;
    case "name_asc":
      list.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), "en", { sensitivity: "base" }));
      break;
    case "price_low":
      list.sort((a, b) => Number(a?.priceLKR || 0) - Number(b?.priceLKR || 0));
      break;
    case "price_high":
      list.sort((a, b) => Number(b?.priceLKR || 0) - Number(a?.priceLKR || 0));
      break;
    default:
      // featured = preserve API order (sortOrder + createdAt from backend)
      break;
  }

  return list;
}

function syncShopControls() {
  const searchInput = document.getElementById("shopSearchInput");
  const sortSelect = document.getElementById("shopSortSelect");
  if (searchInput && searchInput.value !== SHOP_STATE.search) searchInput.value = SHOP_STATE.search;
  if (sortSelect && sortSelect.value !== SHOP_STATE.sort) sortSelect.value = SHOP_STATE.sort;
}

function renderCategoryList() {
  const listEl = document.getElementById("categoryList");
  const categoryCountEl = document.getElementById("shopCategoryCount");
  const productCountEl = document.getElementById("shopProductCount");
  if (!listEl) return;

  const categories = deriveCategories();
  if (categoryCountEl) categoryCountEl.textContent = String(categories.length);
  if (productCountEl) productCountEl.textContent = String(PRODUCTS.length);

  if (!PRODUCTS.length) {
    listEl.innerHTML = `
      <div class="card" style="padding:14px; box-shadow:none;">
        <div class="muted">දැනට categories පෙන්වන්න product data නැහැ.</div>
      </div>
    `;
    return;
  }

  const buttons = [
    {
      key: "all",
      label: "All Items",
      subLabel: "Every product in the shop",
      count: PRODUCTS.length
    },
    ...categories.map((category) => ({
      key: category.key,
      label: category.label,
      subLabel: `${category.count} item${category.count === 1 ? "" : "s"}`,
      count: category.count
    }))
  ];

  listEl.innerHTML = buttons
    .map(
      (button) => `
        <button class="shop-category-btn ${SHOP_STATE.category === button.key ? "active" : ""}" type="button" data-shop-category="${escapeHtml(button.key)}">
          <span>
            ${escapeHtml(button.label)}
            <small>${escapeHtml(button.subLabel)}</small>
          </span>
          <strong>${button.count}</strong>
        </button>
      `
    )
    .join("");
}

function renderProducts() {
  const grid = document.getElementById("productGrid");
  const resultsMeta = document.getElementById("shopResultsMeta");
  if (!grid) return;

  const loggedIn = isCustomerLoggedIn();

  if (!PRODUCTS.length) {
    grid.innerHTML = `
      <div class="shop-empty-state">
        <div class="badge">No products</div>
        <h3>දැනට shop items නැහැ.</h3>
        <p class="muted">Admin Panel එකෙන් products add කරලා මේ section එක automatic category layout එකෙන් පෙන්වයි.</p>
      </div>
    `;
    if (resultsMeta) resultsMeta.textContent = "No products available right now.";
    return;
  }

  const filtered = getFilteredProducts();
  const selectedLabel = getSelectedCategoryLabel();
  const searchText = SHOP_STATE.search.trim();
  const baseMeta = `Showing ${filtered.length} of ${PRODUCTS.length} items`;
  const categoryMeta = SHOP_STATE.category !== "all" ? ` in ${selectedLabel}` : "";
  const searchMeta = searchText ? ` for “${searchText}”` : "";
  if (resultsMeta) resultsMeta.textContent = `${baseMeta}${categoryMeta}${searchMeta}`;

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="shop-empty-state">
        <div class="badge">No match found</div>
        <h3>Search/filter එකට match වෙන item එකක් නැහැ.</h3>
        <p class="muted">වෙන category එකක් select කරන්න, search text වෙනස් කරන්න, නැත්තම් clear filters කරන්න.</p>
        <button class="btn secondary" type="button" onclick="window.__clearShopFilters()">Clear Filters</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered
    .map((product) => {
      const stock = getStockMeta(product);
      const isOutOfStock = stock.className === "is-empty";
      return `
        <div class="card product-card shop-product-card">
          <div class="shop-product-media">
            <img src="${imgUrl(product.imageUrl) || "assets/img/gallery-1.png"}" alt="${escapeHtml(product.name)}">
          </div>
          <div class="pad">
            <div class="shop-product-top">
              <span class="shop-product-chip">${escapeHtml(getCategoryLabel(product))}</span>
              <span class="shop-stock-chip ${stock.className}">${escapeHtml(stock.label)}</span>
            </div>

            <div>
              <h3>${escapeHtml(product.name)}</h3>
              <p class="muted shop-product-desc">${escapeHtml(product.description || "Professional salon quality item for your routine.")}</p>
            </div>

            <div class="shop-product-meta">
              <div class="price">${LKR(product.priceLKR)}</div>
              <div class="muted">${product.stockQty === null || product.stockQty === undefined ? "Stock not limited" : `Available qty: ${Math.max(0, Number(product.stockQty) || 0)}`}</div>
            </div>

            <div class="shop-product-action">
              <div class="muted">${loggedIn ? "Ready to order" : "Login required"}</div>
              <button class="btn" type="button" ${isOutOfStock ? "disabled" : ""} onclick="window.__addToCart('${product._id}')">
                ${loggedIn ? (isOutOfStock ? "Out of Stock" : "Add to Cart") : "Login to Add"}
              </button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderCatalog() {
  syncShopControls();
  renderCategoryList();
  renderProducts();
}

function clearShopFilters() {
  SHOP_STATE.category = "all";
  SHOP_STATE.search = "";
  SHOP_STATE.sort = "featured";
  renderCatalog();
}

function initShopControls() {
  const categoryList = document.getElementById("categoryList");
  if (categoryList && !categoryList.dataset.bound) {
    categoryList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-shop-category]");
      if (!button) return;
      SHOP_STATE.category = button.getAttribute("data-shop-category") || "all";
      renderCatalog();
    });
    categoryList.dataset.bound = "true";
  }

  const searchInput = document.getElementById("shopSearchInput");
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.addEventListener("input", (event) => {
      SHOP_STATE.search = String(event.target.value || "").trimStart();
      renderProducts();
    });
    searchInput.dataset.bound = "true";
  }

  const sortSelect = document.getElementById("shopSortSelect");
  if (sortSelect && !sortSelect.dataset.bound) {
    sortSelect.addEventListener("change", (event) => {
      SHOP_STATE.sort = String(event.target.value || "featured");
      renderProducts();
    });
    sortSelect.dataset.bound = "true";
  }

  const clearBtn = document.getElementById("shopClearFiltersBtn");
  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.addEventListener("click", clearShopFilters);
    clearBtn.dataset.bound = "true";
  }
}

function renderCart() {
  const cart = loadCart();
  const body = document.getElementById("cartBody");
  const entries = Object.entries(cart);

  if (!body) return;

  if (!entries.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted">Cart එක හිස්යි. Product එකක් Add කරන්න.</td></tr>`;
    document.getElementById("cartTotal").textContent = LKR(0);
    return;
  }

  let total = 0;
  const rows = [];

  for (const [id, qty0] of entries) {
    const product = productById(id);
    if (!product) continue;
    const qty = Math.max(1, Number(qty0) || 1);
    const subtotal = Number(product.priceLKR || 0) * qty;
    total += subtotal;
    rows.push(`
      <tr>
        <td>
          <div style="font-weight:900">${escapeHtml(product.name)}</div>
          <div class="muted" style="font-size:12px">${escapeHtml(getCategoryLabel(product))}</div>
        </td>
        <td>
          <div class="qty">
            <button class="qty-btn" type="button" onclick="window.__setQty('${id}', ${qty - 1})">-</button>
            <div style="min-width:26px;text-align:center;font-weight:900">${qty}</div>
            <button class="qty-btn" type="button" onclick="window.__setQty('${id}', ${qty + 1})">+</button>
          </div>
        </td>
        <td>${LKR(product.priceLKR)}</td>
        <td style="font-weight:900">${LKR(subtotal)}</td>
        <td><button class="qty-btn" type="button" onclick="window.__removeItem('${id}')">Remove</button></td>
      </tr>
    `);
  }

  body.innerHTML = rows.length
    ? rows.join("")
    : `<tr><td colspan="5" class="muted">Cart එක හිස්යි. Product එකක් Add කරන්න.</td></tr>`;
  document.getElementById("cartTotal").textContent = LKR(total);
}

async function loadProducts() {
  const grid = document.getElementById("productGrid");
  const categoryList = document.getElementById("categoryList");
  const resultsMeta = document.getElementById("shopResultsMeta");
  if (grid) grid.innerHTML = `<div class="card" style="grid-column:1/-1;padding:14px;"><div class="muted">Loading products...</div></div>`;
  if (categoryList) categoryList.innerHTML = `<div class="card" style="padding:14px; box-shadow:none;"><div class="muted">Loading categories...</div></div>`;
  if (resultsMeta) resultsMeta.textContent = "Loading products...";

  try {
    const res = await fetch(`${API_BASE}/products`);
    const list = await res.json().catch(() => []);
    if (!res.ok) throw new Error(list?.message || "Could not load products");
    PRODUCTS = Array.isArray(list) ? list : [];
  } catch (e) {
    PRODUCTS = [];
    if (grid) {
      grid.innerHTML = `
        <div class="shop-empty-state">
          <div class="badge">Error</div>
          <h3>Products load කරන්න බැරි වුණා.</h3>
          <p class="muted">Backend server එක start කරලා නැති වගේ. (API) ${escapeHtml(e.message)}</p>
        </div>
      `;
    }
    if (categoryList) {
      categoryList.innerHTML = `<div class="card" style="padding:14px; box-shadow:none;"><div class="muted">Category list එක load කරන්න බැරි වුණා.</div></div>`;
    }
    if (resultsMeta) resultsMeta.textContent = "Could not load products.";
    return;
  }

  renderCatalog();
  renderCart();
}

function setOrderStatus(text, kind = "") {
  const el = document.getElementById("orderStatus");
  if (!el) return;
  el.textContent = text || "";
  el.className = kind ? `status ${kind}` : "muted";
}

async function placeOrder() {
  if (!isCustomerLoggedIn()) return requireLoginFor("Order");

  const cart = loadCart();
  const items = Object.entries(cart)
    .map(([productId, qty]) => ({ productId, qty: Number(qty) || 0 }))
    .filter((x) => x.productId && x.qty > 0);

  if (!items.length) {
    alert("Cart එක හිස්යි. Product එකක් Add කරන්න.");
    return;
  }

  const deliveryAddress = (document.getElementById("deliveryAddress")?.value || "").trim();
  const customerNote = (document.getElementById("orderNote")?.value || "").trim();

  if (!deliveryAddress) {
    setOrderStatus("Please enter the delivery address.", "error");
    document.getElementById("deliveryAddress")?.focus();
    return;
  }

  setOrderStatus("Placing order...", "");

  try {
    const res = await fetch(`${API_BASE}/orders`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ items, deliveryAddress, customerNote })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || "Order failed");

    clearCart();
    renderCart();
    setOrderStatus("✅ Order placed! Salon approval, courier tracking, and delivery updates My Account page එකෙන් බලන්න.", "success");
    setTimeout(() => {
      try {
        location.href = "customer-dashboard.html";
      } catch {}
    }, 700);
  } catch (e) {
    setOrderStatus(`❌ ${e.message}`, "error");
  }
}

// expose for inline onclick
window.__addToCart = addToCart;
window.__setQty = setQty;
window.__removeItem = removeItem;
window.__clearShopFilters = clearShopFilters;

document.addEventListener("DOMContentLoaded", () => {
  initShopControls();

  const btn = document.getElementById("checkoutBtn");
  if (btn) {
    btn.addEventListener("click", () => {
      if (!isCustomerLoggedIn()) return requireLoginFor("Order");
      placeOrder();
    });
    if (!isCustomerLoggedIn()) btn.textContent = "Login to Order";
  }

  loadProducts();
});
