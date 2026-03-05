const loginForm = document.getElementById("login-form");
const message = document.getElementById("auth-message");
const guestLoginButton = document.getElementById("guest-login-btn");

function setMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#b42318" : "#475467";
}

async function checkLoggedIn() {
  const res = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (res.ok) {
    window.location.href = "index.html";
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("Logging in...");

  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;

  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ username, password })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data.error === "account_locked") {
      const wait = Number(data.retry_after || 0);
      setMessage(wait > 0 ? `This account is temporarily locked. Try again in ${wait}s.` : "This account is temporarily locked. Please try again later.", true);
      return;
    }
    if (data.error === "rate_limited") {
      const wait = Number(data.retry_after || 0);
      setMessage(wait > 0 ? `Too many attempts. Try again in ${wait}s.` : "Too many attempts. Please try again later.", true);
      return;
    }
    if (data.error === "payload_too_large") {
      setMessage("Request too large. Please shorten input and retry.", true);
      return;
    }
    setMessage("Login failed. Check username/password.", true);
    return;
  }

  window.location.href = "index.html";
});

if (guestLoginButton) {
  guestLoginButton.addEventListener("click", async () => {
    setMessage("Logging in as guest...");
    const res = await fetch("/api/auth/guest", {
      method: "POST",
      credentials: "same-origin"
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const detail = data.error ? ` (${data.error})` : "";
      setMessage(`Guest login failed: ${res.status}${detail}`, true);
      return;
    }

    window.location.href = "index.html";
  });
}

checkLoggedIn();
