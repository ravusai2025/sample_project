// Simple toast utility
function getToastContainer() {
    let c = document.getElementById("toast-container");
    if (!c) {
        c = document.createElement("div");
        c.id = "toast-container";
        document.body.appendChild(c);
    }
    return c;
}

function showToast(message, opts = {}) {
    const { duration = 3500, type = "info" } = opts;
    const container = getToastContainer();
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    // Trigger reflow for animation
    requestAnimationFrame(() => el.classList.add("visible"));

    const remove = () => {
        el.classList.remove("visible");
        setTimeout(() => {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 300);
    };

    setTimeout(remove, duration);
    // allow manual dismiss on click
    el.addEventListener("click", remove);
    return el;
}

// expose globally
window.showToast = showToast;
