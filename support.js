const authUser = document.getElementById("auth-user");
const logoutButton = document.getElementById("logout-btn");
const supportForm = document.getElementById("support-form");
const supportText = document.getElementById("support-text");
const supportCounter = document.getElementById("support-counter");
const supportMessage = document.getElementById("support-message");
const sendButton = document.getElementById("support-send-btn");
const MAX_SUPPORT_CHARS = 200;
const t = (key, params) => (window.i18n ? window.i18n.t(key, params) : key);

function setMessage(text, isError = false) {
  supportMessage.textContent = text;
  supportMessage.style.color = isError ? "#b42318" : "#475467";
}

function updateCounter() {
  const length = supportText.value.length;
  supportCounter.textContent = `${length}/${MAX_SUPPORT_CHARS}`;
}

async function loadAuthStatus() {
  const res = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (!res.ok) {
    if (authUser) authUser.textContent = t("support_guest_label");
    if (logoutButton) logoutButton.style.display = "none";
    return;
  }
  const data = await res.json();
  if (authUser) authUser.textContent = t("auth_signed_in_as", { username: data.username });
}

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    window.location.href = "login.html";
  });
}

supportText.addEventListener("input", updateCounter);
updateCounter();

supportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = supportText.value.trim();
  if (!message) {
    setMessage(t("support_message_required"), true);
    return;
  }
  if (message.length > MAX_SUPPORT_CHARS) {
    setMessage(t("support_message_too_long", { max: MAX_SUPPORT_CHARS }), true);
    return;
  }

  sendButton.disabled = true;
  setMessage(t("support_sending"));
  try {
    const res = await fetch("/api/support/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ message })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.error === "email_service_not_configured") {
        setMessage(t("support_email_service_not_configured"), true);
      } else if (data.error === "message_too_long") {
        setMessage(t("support_message_too_long", { max: MAX_SUPPORT_CHARS }), true);
      } else if (data.error === "message_required") {
        setMessage(t("support_message_required"), true);
      } else {
        setMessage(t("support_send_failed"), true);
      }
      return;
    }

    supportForm.reset();
    updateCounter();
    setMessage(t("support_send_success"), false);
  } catch (_error) {
    setMessage(t("support_send_failed"), true);
  } finally {
    sendButton.disabled = false;
  }
});

loadAuthStatus();
