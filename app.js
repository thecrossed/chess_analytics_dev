const form = document.getElementById("add-user-form");
const input = document.getElementById("username");
const userList = document.getElementById("user-list");
const buildPageButton = document.getElementById("build-page");
const platformSelect = document.getElementById("platform");
const rangeDaysInput = document.getElementById("range-days");
const dateFromInput = document.getElementById("date-from");
const dateToInput = document.getElementById("date-to");
const uploadCsvButton = document.getElementById("upload-csv");
const csvFileInput = document.getElementById("csv-file");
const gameTypeInputs = Array.from(document.querySelectorAll('input[name="game-type"]'));
const pgnModeInputs = Array.from(document.querySelectorAll('input[name="pgn-input-mode"]'));
const pgnUploadRow = document.getElementById("pgn-upload-row");
const pgnPasteRow = document.getElementById("pgn-paste-row");
const pgnFileInput = document.getElementById("pgn-upload");
const pgnTextInput = document.getElementById("pgn-text");
const pgnDepthInput = document.getElementById("analysis-depth");
const pgnLoadButton = document.getElementById("pgn-load-btn");
const pgnAnalyzeButton = document.getElementById("pgn-analyze-btn");
const pgnDownloadButton = document.getElementById("pgn-download-btn");
const pgnStatus = document.getElementById("pgn-status");
const pgnResultWrap = document.getElementById("pgn-result-wrap");
const pgnEvalBody = document.getElementById("pgn-eval-body");
const t = (key, params) => (window.i18n ? window.i18n.t(key, params) : key);

const users = new Set();
const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
const DEFAULT_USERNAME = "MagnusCarlsen";
const MAX_VISIBLE_USERS = 20;
const MAX_RANGE_DAYS = 120;
let loadedPgnText = "";
let pgnEvalRows = [];

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
    remove.textContent = t("app_remove");
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
    summary.textContent = t("app_more_usernames", { count: hiddenUsers.length });

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

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeRangeDays(raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    return 30;
  }
  return Math.min(MAX_RANGE_DAYS, Math.max(1, value));
}

function parseRangeDaysStrict(raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}

function parseDateInputValue(raw) {
  if (!raw) {
    return null;
  }
  const ms = Date.parse(`${raw}T00:00:00Z`);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return ms;
}

function ensureDefaultDateRange() {
  if (rangeDaysInput && !rangeDaysInput.value) {
    rangeDaysInput.value = "30";
  }
}

function applyDateRangeFromDays(days) {
  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - (days - 1));
  if (dateFromInput) {
    dateFromInput.value = toDateInputValue(fromDate);
  }
  if (dateToInput) {
    dateToInput.value = toDateInputValue(today);
  }
}

function getSelectedGameTypes() {
  return gameTypeInputs.filter((inputEl) => inputEl.checked).map((inputEl) => inputEl.value);
}

function syncPgnInputMode() {
  const selected = pgnModeInputs.find((inputEl) => inputEl.checked)?.value || "upload";
  if (pgnUploadRow) {
    pgnUploadRow.classList.toggle("hidden", selected !== "upload");
  }
  if (pgnPasteRow) {
    pgnPasteRow.classList.toggle("hidden", selected !== "paste");
  }
}

function setPgnStatus(text, isError = false) {
  if (!pgnStatus) return;
  pgnStatus.textContent = text;
  pgnStatus.style.color = isError ? "#b42318" : "#475467";
}

function csvEscape(value) {
  const raw = value == null ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function getSelectedPgnMode() {
  return pgnModeInputs.find((inputEl) => inputEl.checked)?.value || "upload";
}

async function readPgnInputText() {
  const mode = getSelectedPgnMode();
  if (mode === "paste") {
    return (pgnTextInput?.value || "").trim();
  }
  const file = pgnFileInput?.files?.[0];
  if (!file) return "";
  return (await file.text()).trim();
}

function renderPgnRows(rows) {
  if (!pgnEvalBody || !pgnResultWrap) return;
  pgnEvalBody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    [row.move_number, row.side, row.move, row.eval_score || "-"].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value == null || value === "" ? "-" : String(value);
      tr.appendChild(td);
    });
    pgnEvalBody.appendChild(tr);
  });
  pgnResultWrap.classList.toggle("hidden", rows.length === 0);
}

function downloadPgnEvalCsv() {
  if (pgnEvalRows.length === 0) return;
  const header = ["move_number", "side", "move", "eval_score"];
  const lines = [header.map(csvEscape).join(",")];
  pgnEvalRows.forEach((row) => {
    lines.push([row.move_number, row.side, row.move, row.eval_score || ""].map(csvEscape).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pgn-eval.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
    alert(t("alert_invalid_username_format"));
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
      alert(t("alert_no_usernames_csv"));
    } else {
      alert(t("alert_csv_imported", { added: addedCount, invalid: invalidCount }));
    }
  } catch (error) {
    alert(t("alert_csv_read_failed", { error: error.message || "unknown error" }));
  } finally {
    csvFileInput.value = "";
  }
});

buildPageButton.addEventListener("click", () => {
  if (users.size === 0) {
    alert(t("alert_add_user_first"));
    return;
  }

  const selectedTypes = getSelectedGameTypes();
  if (selectedTypes.length === 0) {
    alert(t("alert_select_game_type"));
    return;
  }

  const rawRangeDays = rangeDaysInput?.value || "30";
  const strictRangeDays = parseRangeDaysStrict(rawRangeDays);
  if (!strictRangeDays || strictRangeDays < 1) {
    alert(t("alert_invalid_date_selection"));
    return;
  }
  if (strictRangeDays > MAX_RANGE_DAYS) {
    alert(t("alert_max_120_days", { days: strictRangeDays }));
    return;
  }
  const rangeDays = normalizeRangeDays(rawRangeDays);
  const fromRaw = dateFromInput?.value || "";
  const toRaw = dateToInput?.value || "";
  const hasFrom = Boolean(fromRaw);
  const hasTo = Boolean(toRaw);
  const usingCustomDates = hasFrom || hasTo;

  const params = new URLSearchParams({
    users: Array.from(users).join(","),
    platform: platformSelect.value,
    days: String(rangeDays),
    types: selectedTypes.join(",")
  });

  if (usingCustomDates) {
    if (!hasFrom || !hasTo) {
      alert(t("alert_select_both_dates_or_empty"));
      return;
    }
    const fromMs = parseDateInputValue(fromRaw);
    const toMs = parseDateInputValue(toRaw);
    if (!fromMs || !toMs) {
      alert(t("alert_invalid_date_selection"));
      return;
    }
    if (fromMs > toMs) {
      alert(t("alert_from_after_to"));
      return;
    }
    const customRangeDays = Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000)) + 1;
    if (customRangeDays > MAX_RANGE_DAYS) {
      alert(t("alert_max_120_days", { days: customRangeDays }));
      return;
    }
    params.set("from", fromRaw);
    params.set("to", toRaw);
  } else {
    applyDateRangeFromDays(rangeDays);
  }

  window.location.href = `stats.html?${params.toString()}`;
});

ensureDefaultDateRange();
if (pgnModeInputs.length > 0) {
  pgnModeInputs.forEach((inputEl) => {
    inputEl.addEventListener("change", syncPgnInputMode);
  });
  syncPgnInputMode();
}

if (pgnLoadButton) {
  pgnLoadButton.addEventListener("click", async () => {
    try {
      const text = await readPgnInputText();
      if (!text) {
        setPgnStatus(t("home_pgn_no_input"), true);
        return;
      }
      loadedPgnText = text;
      setPgnStatus(t("home_pgn_loaded", { chars: loadedPgnText.length }));
    } catch (error) {
      setPgnStatus(t("home_pgn_load_failed", { error: error.message || "unknown error" }), true);
    }
  });
}

if (pgnAnalyzeButton) {
  pgnAnalyzeButton.addEventListener("click", async () => {
    try {
      const fallbackText = await readPgnInputText();
      const pgnText = (loadedPgnText || fallbackText || "").trim();
      if (!pgnText) {
        setPgnStatus(t("home_pgn_no_input"), true);
        return;
      }

      const depthRaw = Number.parseInt(pgnDepthInput?.value || "12", 10);
      const depth = Number.isFinite(depthRaw) ? Math.max(8, Math.min(20, depthRaw)) : 12;

      pgnAnalyzeButton.disabled = true;
      setPgnStatus(t("home_pgn_analyzing"));

      const res = await fetch("/api/analysis/pgn-eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pgn_text: pgnText, depth })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "pgn_required") {
          setPgnStatus(t("home_pgn_no_input"), true);
        } else if (data.error === "pgn_too_large") {
          setPgnStatus(t("home_pgn_too_large"), true);
        } else if (data.error === "payload_too_large") {
          setPgnStatus(t("home_pgn_too_large"), true);
        } else if (data.error === "rate_limited") {
          setPgnStatus(t("home_pgn_rate_limited"), true);
        } else {
          const detail = data.error ? ` (${data.error})` : "";
          setPgnStatus(`${t("home_pgn_analyze_failed")} [${res.status}]${detail}`, true);
        }
        return;
      }

      pgnEvalRows = Array.isArray(data.rows) ? data.rows : [];
      renderPgnRows(pgnEvalRows);
      if (pgnDownloadButton) pgnDownloadButton.disabled = pgnEvalRows.length === 0;
      setPgnStatus(
        t("home_pgn_analysis_done", {
          count: pgnEvalRows.length,
          failed: Number(data.failed_eval_count || 0)
        })
      );
    } catch (_error) {
      setPgnStatus(t("home_pgn_analyze_failed"), true);
    } finally {
      pgnAnalyzeButton.disabled = false;
    }
  });
}

if (pgnDownloadButton) {
  pgnDownloadButton.addEventListener("click", () => {
    downloadPgnEvalCsv();
  });
}

window.addEventListener("languagechange", () => {
  renderUsers();
});
