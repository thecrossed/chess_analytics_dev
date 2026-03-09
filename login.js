const loginForm = document.getElementById("login-form");
const message = document.getElementById("auth-message");
const guestLoginButton = document.getElementById("guest-login-btn");
const t = (key, params) => (window.i18n ? window.i18n.t(key, params) : key);

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
  setMessage(t("msg_logging_in"));

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
      setMessage(wait > 0 ? t("msg_account_locked_wait", { wait }) : t("msg_account_locked_later"), true);
      return;
    }
    if (data.error === "rate_limited") {
      const wait = Number(data.retry_after || 0);
      setMessage(wait > 0 ? t("msg_rate_limited_wait", { wait }) : t("msg_rate_limited_later"), true);
      return;
    }
    if (data.error === "payload_too_large") {
      setMessage(t("msg_payload_too_large"), true);
      return;
    }
    setMessage(t("msg_login_failed"), true);
    return;
  }

  window.location.href = "index.html";
});

if (guestLoginButton) {
  guestLoginButton.addEventListener("click", async () => {
    setMessage(t("msg_logging_guest"));
    const res = await fetch("/api/auth/guest", {
      method: "POST",
      credentials: "same-origin"
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const detail = data.error ? ` (${data.error})` : "";
      setMessage(t("msg_guest_login_failed", { status: res.status, detail }), true);
      return;
    }

    window.location.href = "index.html";
  });
}

checkLoggedIn();
