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

function qs(id) {
    return document.getElementById(id);
}

// Check if user is already logged in on login/signup pages
function checkIfLoggedIn() {
    const username = getCurrentUsername();
    if (username) {
        // User is already logged in, redirect to home
        window.location.href = "/";
    }
}

// Run check when login/signup pages load
if (document.getElementById("login-form") || document.getElementById("signup-form")) {
    checkIfLoggedIn();
}

// Handle signup form
const signupForm = document.getElementById("signup-form");
if (signupForm) {
    // Pincode lookup: debounce and auto-fill address
    const pincodeInput = qs("signup-pincode");
    const addressInput = qs("signup-address");
    let _pincodeTimer = null;

    const pincodeLoader = qs("signup-pincode-loader");

    async function lookupPincode(pincode) {
        const statusEl = qs("signup-status");
        if (!pincode || pincode.trim().length === 0) {
            if (addressInput) addressInput.value = "";
            if (statusEl) { statusEl.textContent = ""; statusEl.className = "status"; }
            return;
        }
        try {
            // show loader and disable input while fetching
            if (pincodeLoader) pincodeLoader.classList.remove("hidden");
            if (pincodeInput) pincodeInput.disabled = true;
            if (pincodeBtn) pincodeBtn.disabled = true;

            const res = await fetch(`https://api.postalpincode.in/pincode/${encodeURIComponent(pincode.trim())}`);
            if (!res.ok) {
                throw new Error(`Postal API returned ${res.status}`);
            }
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) {
                if (statusEl) { statusEl.textContent = "PIN code not found."; statusEl.className = "status error"; }
                try { await requestJSON("/api/log_pincode", { method: "POST", body: JSON.stringify({ pincode: pincode, status: "not_found" }) }); } catch (e) {}
                return;
            }
            const first = data[0];
            if (!first || !Array.isArray(first.PostOffice) || first.PostOffice.length === 0) {
                if (statusEl) { statusEl.textContent = "PIN code not found."; statusEl.className = "status error"; }
                try { await requestJSON("/api/log_pincode", { method: "POST", body: JSON.stringify({ pincode: pincode, status: "not_found" }) }); } catch (e) {}
                return;
            }
            const po = first.PostOffice[0];
            if (!po) {
                if (statusEl) { statusEl.textContent = "PIN code not found."; statusEl.className = "status error"; }
                try { await requestJSON("/api/log_pincode", { method: "POST", body: JSON.stringify({ pincode: pincode, status: "not_found" }) }); } catch (e) {}
                return;
            }
            const parts = [po.Name, po.District, po.State, po.Country].filter(Boolean);
            if (addressInput) addressInput.value = parts.join(", ");
            if (statusEl) { statusEl.textContent = "Address filled from PIN code."; statusEl.className = "status"; }
            // Notify server so it can log this lookup into activity.log
            try {
                const meta = { result_count: Array.isArray(data) ? data.length : 0 };
                await requestJSON("/api/log_pincode", {
                    method: "POST",
                    body: JSON.stringify({ pincode: pincode, status: "success", meta: meta, first: po }),
                });
            } catch (e) {
                console.warn("Failed to send pincode log to server:", e);
            }
        } catch (err) {
            // show user-friendly error
            if (statusEl) { statusEl.textContent = `Lookup failed: ${err.message}`; statusEl.className = "status error"; }
            console.warn("Pincode lookup failed:", err);
        } finally {
            if (pincodeLoader) pincodeLoader.classList.add("hidden");
            if (pincodeInput) pincodeInput.disabled = false;
            if (pincodeBtn) pincodeBtn.disabled = false;
        }
    }

    const pincodeBtn = qs("signup-pincode-btn");
    if (pincodeInput) {
        // Keep input free for typing; do not call API on change anymore.
        // Optionally, we can restrict non-digit chars while typing.
        pincodeInput.addEventListener("input", (e) => {
            // strip nondigits in-place to help the user
            const v = e.target.value || "";
            const digits = v.replace(/\D/g, "");
            if (v !== digits) e.target.value = digits;
        });
        // keep blur as a no-op (no automatic lookup)
    }

    if (pincodeBtn) {
        pincodeBtn.addEventListener("click", (e) => {
            const statusEl = qs("signup-status");
            if (statusEl) { statusEl.textContent = ""; statusEl.className = "status"; }
            const code = pincodeInput ? (pincodeInput.value || "").trim() : "";
            if (!code) {
                if (statusEl) {
                    statusEl.textContent = "Please enter a 6-digit pincode before looking up.";
                    statusEl.className = "status error";
                }
                return;
            }
            // Only allow 6-digit lookup
            const digits = code.replace(/\D/g, "");
            if (digits.length !== 6) {
                if (statusEl) {
                    statusEl.textContent = "Please enter a 6-digit pincode before looking up.";
                    statusEl.className = "status error";
                }
                return;
            }
            // Call lookupPincode and show loader; the function handles loader state
            lookupPincode(digits);
        });
    }
    signupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const statusEl = qs("signup-status");
        statusEl.textContent = "";
        statusEl.className = "status";

        const username = qs("signup-username").value.trim();
        const email = qs("signup-email").value.trim();
        const password = qs("signup-password").value;
        const pincode = qs("signup-pincode") ? qs("signup-pincode").value.trim() : "";
        const address = qs("signup-address") ? qs("signup-address").value.trim() : "";

        if (!username || username.length < 3) {
            statusEl.textContent = "Username must be at least 3 characters.";
            statusEl.className = "status error";
            return;
        }

        if (!email) {
            statusEl.textContent = "Valid email is required.";
            statusEl.className = "status error";
            return;
        }

        if (!password || password.length < 6) {
            statusEl.textContent = "Password must be at least 6 characters.";
            statusEl.className = "status error";
            return;
        }

        if (!pincode) {
            statusEl.textContent = "Pincode is required.";
            statusEl.className = "status error";
            return;
        }

        if (!address) {
            statusEl.textContent = "Address could not be determined from the provided pincode.";
            statusEl.className = "status error";
            return;
        }

        const submitBtn = signupForm.querySelector('button[type="submit"]');
        try {
            // disable submit and show signing status
            if (submitBtn) submitBtn.disabled = true;
            statusEl.textContent = "Signing up...";
            statusEl.className = "status";

            const payload = { username, email, password, pincode, address };
            const user = await requestJSON("/api/signup", {
                method: "POST",
                body: JSON.stringify(payload),
            });
            statusEl.textContent = `Account created successfully! Redirecting to login...`;
            statusEl.className = "status success";
            if (window.showToast) showToast("Account created", { type: "success" });
            setTimeout(() => {
                window.location.href = "/login";
            }, 800);
        } catch (err) {
            statusEl.textContent = `Signup failed: ${err.message}`;
            statusEl.className = "status error";
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    });
}

// Handle login form
const loginForm = document.getElementById("login-form");
if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const statusEl = qs("login-status");
        statusEl.textContent = "";
        statusEl.className = "status";

        const username = qs("login-username").value.trim();
        const password = qs("login-password").value;

        if (!username || !password) {
            statusEl.textContent = "Username and password are required.";
            statusEl.className = "status error";
            return;
        }

        try {
            const payload = { username, password };
            const loginResponse = await requestJSON("/api/login", {
                method: "POST",
                body: JSON.stringify(payload),
            });
            if (loginResponse.success && loginResponse.user) {
                setCurrentUsername(loginResponse.user.username);
                statusEl.textContent = "Login successful! Redirecting...";
                statusEl.className = "status success";
                if (window.showToast) showToast("Login successful", { type: "success" });
                setTimeout(() => {
                    window.location.href = "/";
                }, 700);
            } else {
                statusEl.textContent = loginResponse.message || "Login failed";
                statusEl.className = "status error";
            }
        } catch (err) {
            statusEl.textContent = `Login failed: ${err.message}`;
            statusEl.className = "status error";
        }
    });
}

