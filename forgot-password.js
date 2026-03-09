const resetRequestForm = document.getElementById("reset-request-form");
const resetConfirmForm = document.getElementById("reset-confirm-form");
const message = document.getElementById("auth-message");
const initialResetToken = new URLSearchParams(window.location.search).get("reset_token");
const requestButton = resetRequestForm.querySelector("button[type='submit']");
const REQUEST_COOLDOWN_SECONDS = 60;
let requestCooldownTimer = null;
const t = (key, params) => (window.i18n ? window.i18n.t(key, params) : key);

function setMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#b42318" : "#475467";
}

function showPasswordPolicyError(errorCode) {
  if (errorCode === "password_too_short") {
    setMessage(t("msg_password_too_short"), true);
  } else if (errorCode === "password_too_weak") {
    setMessage(t("msg_password_too_weak"), true);
  } else if (errorCode === "password_missing_uppercase") {
    setMessage(t("msg_password_missing_uppercase"), true);
  } else if (errorCode === "password_missing_lowercase") {
    setMessage(t("msg_password_missing_lowercase"), true);
  } else if (errorCode === "password_missing_number") {
    setMessage(t("msg_password_missing_number"), true);
  } else if (errorCode === "password_missing_symbol") {
    setMessage(t("msg_password_missing_symbol"), true);
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
  requestButton.textContent = `${t("forgot_request_button")} (${remaining}s)`;
  requestCooldownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(requestCooldownTimer);
      requestCooldownTimer = null;
      requestButton.disabled = false;
      requestButton.textContent = t("forgot_request_button");
      return;
    }
    requestButton.textContent = `${t("forgot_request_button")} (${remaining}s)`;
  }, 1000);
}

resetRequestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (requestButton && requestButton.disabled) {
    return;
  }
  setMessage(t("msg_requesting_reset_email"));

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
      setMessage(wait > 0 ? t("msg_rate_limited_wait", { wait }) : t("msg_rate_limited_later"), true);
      startRequestCooldown(Math.min(REQUEST_COOLDOWN_SECONDS, wait > 0 ? wait : REQUEST_COOLDOWN_SECONDS));
    } else {
      setMessage(t("msg_request_reset_failed"), true);
    }
    return;
  }

  const token = data.reset_token || "";
  const tokenInput = document.getElementById("reset-token");
  if (tokenInput && token) {
    tokenInput.value = token;
  }
  if (data.delivery_status === "service_not_configured") {
    setMessage(t("msg_reset_service_not_configured"), true);
  } else if (token) {
    setMessage(t("msg_reset_token_ready", { token }));
  } else {
    setMessage(t("msg_reset_email_sent_if_exists"));
  }
  startRequestCooldown(REQUEST_COOLDOWN_SECONDS);
});

resetConfirmForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(t("msg_resetting_password"));

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
      setMessage(wait > 0 ? t("msg_rate_limited_wait", { wait }) : t("msg_rate_limited_later"), true);
    } else if (data.error === "invalid_or_expired_token") {
      setMessage(t("msg_reset_token_invalid"), true);
    } else if (showPasswordPolicyError(data.error || "")) {
      return;
    } else {
      setMessage(t("msg_password_reset_failed"), true);
    }
    return;
  }

  setMessage(t("msg_password_reset_success_redirect"));
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
