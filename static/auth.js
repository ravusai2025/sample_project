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
    signupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const statusEl = qs("signup-status");
        statusEl.textContent = "";
        statusEl.className = "status";

        const username = qs("signup-username").value.trim();
        const email = qs("signup-email").value.trim();
        const password = qs("signup-password").value;

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

        try {
            const payload = { username, email, password };
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

