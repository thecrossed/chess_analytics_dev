const resetRequestForm = document.getElementById("reset-request-form");
const resetConfirmForm = document.getElementById("reset-confirm-form");
const message = document.getElementById("auth-message");
const initialResetToken = new URLSearchParams(window.location.search).get("reset_token");
const requestButton = resetRequestForm.querySelector("button[type='submit']");
const REQUEST_COOLDOWN_SECONDS = 60;
let requestCooldownTimer = null;

function setMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#b42318" : "#475467";
}

function showPasswordPolicyError(errorCode) {
  if (errorCode === "password_too_short") {
    setMessage("Password must be at least 12 characters.", true);
  } else if (errorCode === "password_too_weak") {
    setMessage("Password is too common. Choose a stronger one.", true);
  } else if (errorCode === "password_missing_uppercase") {
    setMessage("Password must include at least one uppercase letter.", true);
  } else if (errorCode === "password_missing_lowercase") {
    setMessage("Password must include at least one lowercase letter.", true);
  } else if (errorCode === "password_missing_number") {
    setMessage("Password must include at least one number.", true);
  } else if (errorCode === "password_missing_symbol") {
    setMessage("Password must include at least one symbol.", true);
  } else {
    return false;
  }
  return true;
}

function startRequestCooldown(seconds) {
  if (!requestButton) {
    return;
  }
  if (requestCooldownTimer) {
    clearInterval(requestCooldownTimer);
    requestCooldownTimer = null;
  }
  let remaining = seconds;
  requestButton.disabled = true;
  requestButton.textContent = `Request Again (${remaining}s)`;
  requestCooldownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(requestCooldownTimer);
      requestCooldownTimer = null;
      requestButton.disabled = false;
      requestButton.textContent = "Request Reset Email";
      return;
    }
    requestButton.textContent = `Request Again (${remaining}s)`;
  }, 1000);
}

resetRequestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (requestButton && requestButton.disabled) {
    return;
  }
  setMessage("Requesting reset email...");

  const username = document.getElementById("reset-request-username").value.trim();
  const res = await fetch("/api/auth/password-reset/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ username })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.error === "rate_limited") {
      const wait = Number(data.retry_after || 0);
      setMessage(wait > 0 ? `Too many attempts. Try again in ${wait}s.` : "Too many attempts. Please try again later.", true);
      startRequestCooldown(Math.min(REQUEST_COOLDOWN_SECONDS, wait > 0 ? wait : REQUEST_COOLDOWN_SECONDS));
    } else {
      setMessage("Failed to request reset email.", true);
    }
    return;
  }

  const token = data.reset_token || "";
  const tokenInput = document.getElementById("reset-token");
  if (tokenInput && token) {
    tokenInput.value = token;
  }
  if (data.delivery_status === "service_not_configured") {
    setMessage("Reset email service is not configured yet. Please contact support.", true);
  } else if (token) {
    setMessage(`Reset token ready: ${token}. Now set a new password below.`);
  } else {
    setMessage("If the account exists, reset instructions have been sent to email.");
  }
  startRequestCooldown(REQUEST_COOLDOWN_SECONDS);
});

resetConfirmForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("Resetting password...");

  const token = document.getElementById("reset-token").value.trim();
  const newPassword = document.getElementById("reset-new-password").value;
  const res = await fetch("/api/auth/password-reset/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ token, new_password: newPassword })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.error === "rate_limited") {
      const wait = Number(data.retry_after || 0);
      setMessage(wait > 0 ? `Too many attempts. Try again in ${wait}s.` : "Too many attempts. Please try again later.", true);
    } else if (data.error === "invalid_or_expired_token") {
      setMessage("Reset token is invalid or expired.", true);
    } else if (showPasswordPolicyError(data.error || "")) {
      return;
    } else {
      setMessage("Password reset failed.", true);
    }
    return;
  }

  setMessage("Password reset successful. Redirecting to login...");
  setTimeout(() => {
    window.location.href = "login.html";
  }, 900);
});

if (initialResetToken) {
  const tokenInput = document.getElementById("reset-token");
  if (tokenInput) {
    tokenInput.value = initialResetToken;
  }
}
