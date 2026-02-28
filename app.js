const form = document.getElementById("add-user-form");
const input = document.getElementById("username");
const userList = document.getElementById("user-list");
const buildPageButton = document.getElementById("build-page");

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

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const username = normalizeUsername(input.value);

  if (!username) {
    return;
  }

  if (!USERNAME_RE.test(username)) {
    alert("Invalid username format: 2-30 characters, letters/numbers/_/- only.");
    return;
  }

  users.add(username);
  input.value = "";
  renderUsers();
});

buildPageButton.addEventListener("click", () => {
  if (users.size === 0) {
    alert("Please add at least one username first.");
    return;
  }

  const params = new URLSearchParams({
    users: Array.from(users).join(",")
  });

  window.location.href = `stats.html?${params.toString()}`;
});
