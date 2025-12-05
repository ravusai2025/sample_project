// Authentication utilities
const USERNAME_KEY = "current_username";

function getCurrentUsername() {
    return localStorage.getItem(USERNAME_KEY);
}

function setCurrentUsername(username) {
    localStorage.setItem(USERNAME_KEY, username);
}

function removeCurrentUsername() {
    localStorage.removeItem(USERNAME_KEY);
}

function isAuthenticated() {
    return !!getCurrentUsername();
}

async function requestJSON(url, options = {}) {
    const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {}),
    };
    
    const res = await fetch(url, {
        headers,
        ...options,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
        const detail = data && data.detail ? data.detail : res.statusText;
        throw new Error(detail || `Request failed: ${res.status}`);
    }
    return data;
}

async function getCurrentUser() {
    try {
        const username = getCurrentUsername();
        if (!username) return null;
        return await requestJSON(`/api/me?username=${encodeURIComponent(username)}`);
    } catch (err) {
        removeCurrentUsername();
        return null;
    }
}

function logout() {
    removeCurrentUsername();
    if (window.showToast) showToast("Logged out", { type: "info", duration: 1200 });
    setTimeout(() => (window.location.href = "/login"), 600);
}

function qs(id) {
    return document.getElementById(id);
}

function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

window.addEventListener("DOMContentLoaded", async () => {
    // Check if user is logged in, redirect to login if not
    const username = getCurrentUsername();
    if (!username) {
        window.location.href = "/login";
        return;
    }

    // Update auth UI
    const authInfo = qs("auth-info");
    const user = await getCurrentUser();
    if (user && authInfo) {
        authInfo.innerHTML = `
            <span>Logged in as: <strong>${user.username}</strong></span>
            <button id="logout-btn" type="button">Logout</button>
        `;
        qs("logout-btn").addEventListener("click", logout);
    } else if (authInfo) {
        // If user data couldn't be fetched, redirect to login
        removeCurrentUsername();
        window.location.href = "/login";
        return;
    }

    const statusCreate = qs("create-item-status");
    const statusPurchase = qs("purchase-status");
    const itemsTableBody = qs("items-table").querySelector("tbody");
    const itemsEmpty = qs("items-empty");
    const purchaseSelect = qs("purchase-item-select");
    const purchasesTableBody = qs("purchases-table").querySelector("tbody");
    const purchasesEmpty = qs("purchases-empty");

    // Cache of items by id for quick lookups (to show item name in purchases)
    let itemsCache = {};

    const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
    const tabPanes = Array.from(document.querySelectorAll(".tab-pane"));

    function activateTab(name) {
        tabButtons.forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.tab === name);
        });
        tabPanes.forEach((pane) => {
            pane.classList.toggle("active", pane.dataset.tab === name);
        });
    }

    tabButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const name = btn.dataset.tab;
            activateTab(name);
        });
    });

    async function loadItems() {
        try {
            const items = await requestJSON("/api/items");
            clear(itemsTableBody);
            itemsCache = {};
            // Populate purchase dropdown
            if (purchaseSelect) {
                clear(purchaseSelect);
                const defaultOpt = document.createElement("option");
                defaultOpt.value = "";
                defaultOpt.textContent = "Select an item...";
                purchaseSelect.appendChild(defaultOpt);
            }
            if (!items.length) {
                itemsEmpty.style.display = "block";
                return;
            }
            itemsEmpty.style.display = "none";
            for (const item of items) {
                itemsCache[item.id] = item;
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${item.id}</td>
                    <td>${item.name}</td>
                    <td>${item.quantity}</td>
                    <td>₹${item.price.toFixed(2)}</td>
                    <td>${item.description || ""}</td>
                `;
                itemsTableBody.appendChild(tr);

                if (purchaseSelect) {
                    const opt = document.createElement("option");
                    opt.value = String(item.id);
                    opt.textContent = `${item.id} — ${item.name} (${item.quantity} available)`;
                    if (!item.quantity || item.quantity <= 0) {
                        opt.disabled = true;
                        opt.textContent = `${item.id} — ${item.name} (out of stock)`;
                    }
                    purchaseSelect.appendChild(opt);
                }
            }
        } catch (err) {
            itemsEmpty.style.display = "block";
            itemsEmpty.textContent = `Failed to load items: ${err.message}`;
        }
    }

    async function loadPurchases() {
        try {
            const username = getCurrentUsername();
            const url = username
                ? `/api/purchases?username=${encodeURIComponent(username)}`
                : "/api/purchases";
            const purchases = await requestJSON(url);
            clear(purchasesTableBody);
            if (!purchases.length) {
                purchasesEmpty.style.display = "block";
                return;
            }
            purchasesEmpty.style.display = "none";
            for (const p of purchases) {
                const tr = document.createElement("tr");
                const item = itemsCache[p.item_id];
                const itemName = item ? item.name : `Item #${p.item_id}`;
                tr.innerHTML = `
                    <td>${p.id}</td>
                    <td>${itemName}</td>
                    <td>${p.quantity}</td>
                    <td>${p.buyer}</td>
                    <td>₹${p.total_price.toFixed(2)}</td>
                `;
                purchasesTableBody.appendChild(tr);
            }
        } catch (err) {
            clear(purchasesTableBody);
            purchasesEmpty.style.display = "block";
            purchasesEmpty.textContent = `Failed to load purchases: ${err.message}`;
        }
    }

    qs("create-item").addEventListener("click", async () => {
        statusCreate.textContent = "";

        const username = getCurrentUsername();
        if (!username) {
            statusCreate.textContent = "Please login to create listings.";
            return;
        }

        const name = qs("item-name").value.trim();
        const quantity = Number(qs("item-quantity").value || 0);
        const price = Number(qs("item-price").value || 0);
        const description = qs("item-description").value.trim();

        if (!name) {
            statusCreate.textContent = "Please select a device.";
            statusCreate.className = "status error";
            return;
        }
        if (quantity < 0 || !Number.isFinite(quantity)) {
            statusCreate.textContent = "Quantity must be 0 or greater.";
            return;
        }
        if (price < 0 || !Number.isFinite(price)) {
            statusCreate.textContent = "Price must be 0 or greater.";
            return;
        }

        try {
            const payload = {
                name,
                quantity,
                price,
                description: description || null,
            };
            const item = await requestJSON(`/api/items?username=${encodeURIComponent(username)}`, {
                method: "POST",
                body: JSON.stringify(payload),
            });
            statusCreate.textContent = `Created listing #${item.id}.`;
            if (window.showToast) showToast(`Listing created: #${item.id} ${item.name}`, { type: "success" });
            await Promise.all([loadItems(), loadUserActivity()]);
        } catch (err) {
            statusCreate.textContent = `Failed to create listing: ${err.message}`;
        }
    });

    qs("refresh-items").addEventListener("click", loadItems);

    qs("purchase-item").addEventListener("click", async () => {
        statusPurchase.textContent = "";

        const username = getCurrentUsername();
        if (!username) {
            statusPurchase.textContent = "Please login to make purchases.";
            return;
        }

        const selected = purchaseSelect ? purchaseSelect.value : "";
        const itemId = Number(selected || 0);
        const quantity = Number(qs("purchase-quantity").value || 0);
        const buyer = qs("purchase-buyer").value.trim() || username;

        if (!selected) {
            statusPurchase.textContent = "Please select an item to purchase.";
            return;
        }
        if (!quantity || quantity < 1) {
            statusPurchase.textContent = "Quantity must be at least 1.";
            return;
        }

        try {
            const payload = { item_id: itemId, quantity, buyer };
            const purchase = await requestJSON(`/api/purchase?username=${encodeURIComponent(username)}`, {
                method: "POST",
                body: JSON.stringify(payload),
            });
                statusPurchase.textContent = `Purchase #${purchase.id} confirmed: ₹${purchase.total_price.toFixed(
                    2,
                )}.`;
            if (window.showToast) showToast(`Purchase confirmed: #${purchase.id} ₹${purchase.total_price.toFixed(2)}`, { type: "success" });
            await Promise.all([loadItems(), loadPurchases(), loadUserActivity()]);
        } catch (err) {
            statusPurchase.textContent = `Failed to purchase: ${err.message}`;
            if (window.showToast) showToast(`Purchase failed: ${err.message}`, { type: "error" });
        }
    });

    qs("refresh-purchases").addEventListener("click", () => {
        loadPurchases();
        loadUserActivity();
    });

    async function loadUserActivity() {
        const username = getCurrentUsername();
        const activityStats = qs("user-activity-stats");
        
        if (!username || !activityStats) {
            if (activityStats) {
                activityStats.innerHTML = "<p class='muted'>Please login to view your activity.</p>";
            }
            return;
        }

        try {
            const activity = await requestJSON(`/api/user/activity?username=${encodeURIComponent(username)}`);
            activityStats.innerHTML = `
                <h3>Your Activity Summary</h3>
                <div>
                    <div>
                        <strong>Listings Created</strong>
                        <div style="font-size: 1.5rem; color: #667eea; font-weight: 700; margin-top: 0.5rem;">${activity.listings_count}</div>
                        <small>Total items listed: ${activity.total_items_listed}</small>
                    </div>
                    <div>
                        <strong>Purchases Made</strong>
                        <div style="font-size: 1.5rem; color: #667eea; font-weight: 700; margin-top: 0.5rem;">${activity.purchases_count}</div>
                        <small>Total items purchased: ${activity.total_items_purchased}</small>
                    </div>
                    <div>
                        <strong>Total Spent</strong>
                        <div style="font-size: 1.5rem; color: #667eea; font-weight: 700; margin-top: 0.5rem;">₹${activity.total_spent.toFixed(2)}</div>
                        <small>All-time spending</small>
                    </div>
                </div>
            `;
        } catch (err) {
            activityStats.innerHTML = `<p class="muted">Failed to load activity: ${err.message}</p>`;
        }
    }

    // Initial load
    activateTab("create");
    loadItems();
    loadPurchases();
    loadUserActivity();
});
