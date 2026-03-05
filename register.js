const registerForm = document.getElementById("register-form");
const message = document.getElementById("auth-message");

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

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("Creating account...");

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
      setMessage(wait > 0 ? `Too many attempts. Try again in ${wait}s.` : "Too many attempts. Please try again later.", true);
    } else if (error === "payload_too_large") {
      setMessage("Request too large. Please shorten input and retry.", true);
    } else if (error === "username_exists") {
      setMessage("This username already exists.", true);
    } else if (error === "email_exists") {
      setMessage("This email is already registered.", true);
    } else if (error === "email_required") {
      setMessage("Email is required.", true);
    } else if (error === "invalid_email") {
      setMessage("Please enter a valid email address.", true);
    } else if (showPasswordPolicyError(error)) {
      return;
    } else if (error === "invalid_username") {
      setMessage("Username must be 3-32 chars: letters, numbers, _ or -.", true);
    } else {
      setMessage("Register failed.", true);
    }
    return;
  }

  setMessage("Account created. Redirecting to login...");
  setTimeout(() => {
    window.location.href = "login.html";
  }, 900);
});
