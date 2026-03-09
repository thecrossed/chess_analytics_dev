const emailForm = document.getElementById("email-form");
const emailInput = document.getElementById("email");
const message = document.getElementById("account-message");
const t = (key, params) => (window.i18n ? window.i18n.t(key, params) : key);

function setMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#b42318" : "#475467";
}

async function ensureAuthenticated() {
  const res = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (!res.ok) {
    window.location.href = "login.html";
    throw new Error("not_authenticated");
  }
}

emailForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(t("msg_saving_email"));

  const email = emailInput.value.trim();
  const res = await fetch("/api/auth/profile/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ email })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = data.error || "unknown_error";
    if (error === "invalid_email") {
      setMessage(t("msg_invalid_email"), true);
    } else if (error === "email_exists") {
      setMessage(t("msg_email_in_use"), true);
    } else if (error === "rate_limited") {
      const wait = Number(data.retry_after || 0);
      setMessage(wait > 0 ? t("msg_rate_limited_wait", { wait }) : t("msg_rate_limited_later"), true);
    } else if (error === "not_authenticated") {
      window.location.href = "login.html";
    } else {
      setMessage(t("msg_save_email_failed", { error }), true);
    }
    return;
  }

  setMessage(t("msg_email_saved", { email: data.email }));
});

ensureAuthenticated().catch(() => {});
