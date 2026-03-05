const emailForm = document.getElementById("email-form");
const emailInput = document.getElementById("email");
const message = document.getElementById("account-message");

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
  setMessage("Saving email...");

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
      setMessage("Please enter a valid email address.", true);
    } else if (error === "email_exists") {
      setMessage("This email is already used by another account.", true);
    } else if (error === "rate_limited") {
      const wait = Number(data.retry_after || 0);
      setMessage(wait > 0 ? `Too many attempts. Try again in ${wait}s.` : "Too many attempts. Please try again later.", true);
    } else if (error === "not_authenticated") {
      window.location.href = "login.html";
    } else {
      setMessage(`Failed to save email (${error}).`, true);
    }
    return;
  }

  setMessage(`Email saved: ${data.email}`);
});

ensureAuthenticated().catch(() => {});
