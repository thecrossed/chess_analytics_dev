const registerForm = document.getElementById("register-form");
const message = document.getElementById("auth-message");
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

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(t("msg_creating_account"));

  const username = document.getElementById("register-username").value.trim();
  const email = document.getElementById("register-email").value.trim();
  const password = document.getElementById("register-password").value;

  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ username, email, password })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const error = data.error || "register_failed";
    if (error === "rate_limited") {
      const wait = Number(data.retry_after || 0);
      setMessage(wait > 0 ? t("msg_rate_limited_wait", { wait }) : t("msg_rate_limited_later"), true);
    } else if (error === "payload_too_large") {
      setMessage(t("msg_payload_too_large"), true);
    } else if (error === "username_exists") {
      setMessage(t("msg_username_exists"), true);
    } else if (error === "email_exists") {
      setMessage(t("msg_email_exists"), true);
    } else if (error === "email_required") {
      setMessage(t("msg_email_required"), true);
    } else if (error === "invalid_email") {
      setMessage(t("msg_invalid_email"), true);
    } else if (showPasswordPolicyError(error)) {
      return;
    } else if (error === "invalid_username") {
      setMessage(t("msg_invalid_username"), true);
    } else {
      setMessage(t("msg_register_failed"), true);
    }
    return;
  }

  setMessage(t("msg_account_created_redirect"));
  setTimeout(() => {
    window.location.href = "login.html";
  }, 900);
});
