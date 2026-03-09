const form = document.getElementById("add-user-form");
const input = document.getElementById("username");
const userList = document.getElementById("user-list");
const buildPageButton = document.getElementById("build-page");
const platformSelect = document.getElementById("platform");
const rangeDaysInput = document.getElementById("range-days");
const uploadCsvButton = document.getElementById("upload-csv");
const csvFileInput = document.getElementById("csv-file");
const gameTypeInputs = Array.from(document.querySelectorAll('input[name="game-type"]'));
const authUser = document.getElementById("auth-user");
const logoutButton = document.getElementById("logout-btn");

const users = new Set();
const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
const DEFAULT_USERNAME = "MagnusCarlsen";
const MAX_VISIBLE_USERS = 20;

async function ensureAuthenticated() {
  const res = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (!res.ok) {
    window.location.href = "login.html";
    throw new Error("not_authenticated");
  }
  const data = await res.json();
  if (authUser) {
    authUser.textContent = `Signed in as ${data.username}`;
  }
}

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    window.location.href = "login.html";
  });
}

function renderUsers() {
  userList.innerHTML = "";

  const allUsers = Array.from(users);
  const visibleUsers = allUsers.slice(0, MAX_VISIBLE_USERS);
  const hiddenUsers = allUsers.slice(MAX_VISIBLE_USERS);

  const createUserChip = (name) => {
    const li = document.createElement("li");
    li.className = "user-chip";

    const text = document.createElement("span");
    text.textContent = name;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      users.delete(name);
      renderUsers();
    });

    li.append(text, remove);
    return li;
  };

  visibleUsers.forEach((name) => {
    userList.appendChild(createUserChip(name));
  });

  if (hiddenUsers.length > 0) {
    const overflowLi = document.createElement("li");
    overflowLi.className = "user-overflow";

    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `+${hiddenUsers.length} more usernames`;

    const hiddenList = document.createElement("ul");
    hiddenList.className = "user-list overflow-list";
    hiddenUsers.forEach((name) => {
      hiddenList.appendChild(createUserChip(name));
    });

    details.append(summary, hiddenList);
    overflowLi.appendChild(details);
    userList.appendChild(overflowLi);
  }
}

function normalizeUsername(raw) {
  return raw.trim();
}

function addUsername(username) {
  if (!USERNAME_RE.test(username)) {
    return false;
  }

  users.add(username);
  return true;
}

function parseCsvUsernames(csvText) {
  const tokens = csvText
    .split(/[\n\r,;]/)
    .map((token) => normalizeUsername(token))
    .filter(Boolean)
    .filter((token) => token.toLowerCase() !== "username");

  return tokens;
}

function normalizeRangeDays(raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    return 30;
  }
  return Math.min(120, Math.max(1, value));
}

function getSelectedGameTypes() {
  return gameTypeInputs.filter((inputEl) => inputEl.checked).map((inputEl) => inputEl.value);
}

function autofillDefaultUsername() {
  if (!input.value.trim()) {
    input.value = DEFAULT_USERNAME;
  }
}

input.addEventListener("focus", autofillDefaultUsername);
input.addEventListener("click", autofillDefaultUsername);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const username = normalizeUsername(input.value);

  if (!username) {
    return;
  }

  if (!addUsername(username)) {
    alert("Invalid username format: 2-30 characters, letters/numbers/_/- only.");
    return;
  }

  input.value = "";
  renderUsers();
});

uploadCsvButton.addEventListener("click", () => {
  csvFileInput.click();
});

csvFileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const csvText = await file.text();
    const usernames = parseCsvUsernames(csvText);
    let addedCount = 0;
    let invalidCount = 0;

    usernames.forEach((name) => {
      const sizeBefore = users.size;
      if (addUsername(name)) {
        if (users.size > sizeBefore) {
          addedCount += 1;
        }
      } else {
        invalidCount += 1;
      }
    });

    renderUsers();

    if (addedCount === 0 && invalidCount === 0) {
      alert("No usernames found in CSV.");
    } else {
      alert(`CSV imported: ${addedCount} added, ${invalidCount} invalid.`);
    }
  } catch (error) {
    alert(`Failed to read CSV: ${error.message || "unknown error"}`);
  } finally {
    csvFileInput.value = "";
  }
});

buildPageButton.addEventListener("click", () => {
  if (users.size === 0) {
    alert("Please add at least one username first.");
    return;
  }

  const selectedTypes = getSelectedGameTypes();
  if (selectedTypes.length === 0) {
    alert("Please select at least one game type (Bullet/Blitz/Rapid).");
    return;
  }

  const params = new URLSearchParams({
    users: Array.from(users).join(","),
    platform: platformSelect.value,
    days: String(normalizeRangeDays(rangeDaysInput.value)),
    types: selectedTypes.join(",")
  });

  window.location.href = `stats.html?${params.toString()}`;
});

ensureAuthenticated().catch(() => {});
