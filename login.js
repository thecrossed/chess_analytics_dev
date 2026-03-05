const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const resetRequestForm = document.getElementById("reset-request-form");
const resetConfirmForm = document.getElementById("reset-confirm-form");
const message = document.getElementById("auth-message");
const guestLoginButton = document.getElementById("guest-login-btn");
const initialResetToken = new URLSearchParams(window.location.search).get("reset_token");

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
      if (wait > 0) {
        setMessage(`This account is temporarily locked. Try again in ${wait}s.`, true);
      } else {
        setMessage("This account is temporarily locked. Please try again later.", true);
      }
      return;
    }
    if (data.error === "rate_limited") {
      const wait = Number(data.retry_after || 0);
      if (wait > 0) {
        setMessage(`Too many attempts. Try again in ${wait}s.`, true);
      } else {
        setMessage("Too many attempts. Please try again later.", true);
      }
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
      if (wait > 0) {
        setMessage(`Too many attempts. Try again in ${wait}s.`, true);
      } else {
        setMessage("Too many attempts. Please try again later.", true);
      }
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

  setMessage("Account created. You can now log in.");
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

if (resetRequestForm) {
  resetRequestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
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
      } else {
        setMessage("Failed to request reset token.", true);
      }
      return;
    }

    const token = data.reset_token || "";
    const tokenInput = document.getElementById("reset-token");
    if (tokenInput && token) {
      tokenInput.value = token;
    }
    if (token) {
      setMessage(`Reset token ready: ${token}. Now set a new password below.`);
    } else {
      setMessage("If the account exists, reset instructions have been sent to email.");
    }
  });
}

if (resetConfirmForm) {
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

    setMessage("Password reset successful. You can now log in with your new password.");
  });
}

if (initialResetToken) {
  const tokenInput = document.getElementById("reset-token");
  if (tokenInput) {
    tokenInput.value = initialResetToken;
  }
}

checkLoggedIn();
