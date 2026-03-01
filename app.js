const form = document.getElementById("add-user-form");
const input = document.getElementById("username");
const userList = document.getElementById("user-list");
const buildPageButton = document.getElementById("build-page");
const platformSelect = document.getElementById("platform");
const uploadCsvButton = document.getElementById("upload-csv");
const csvFileInput = document.getElementById("csv-file");

const users = new Set();
const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;

function renderUsers() {
  userList.innerHTML = "";

  users.forEach((name) => {
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
    userList.appendChild(li);
  });
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

  const params = new URLSearchParams({
    users: Array.from(users).join(","),
    platform: platformSelect.value
  });

  window.location.href = `stats.html?${params.toString()}`;
});
