const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
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
    setMessage("Login failed. Check username/password.", true);
    return;
  }

  window.location.href = "index.html";
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("Creating account...");

  const username = document.getElementById("register-username").value.trim();
  const password = document.getElementById("register-password").value;

  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ username, password })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const error = data.error || "register_failed";
    if (error === "username_exists") {
      setMessage("This username already exists.", true);
    } else if (error === "password_too_short") {
      setMessage("Password must be at least 8 characters.", true);
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
      setMessage("Guest login failed.", true);
      return;
    }

    window.location.href = "index.html";
  });
}

checkLoggedIn();
