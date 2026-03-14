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

const pgnFileInput = document.getElementById("pgn-upload");
const pgnTextInput = document.getElementById("pgn-text");
const pgnDepthInput = document.getElementById("analysis-depth");
const pgnAnalyzeButton = document.getElementById("pgn-analyze-btn");
const pgnStatus = document.getElementById("pgn-status");
const homeEntryChooser = document.getElementById("home-entry-chooser");
const chooseFetchEntryButton = document.getElementById("choose-fetch-entry");
const choosePgnEntryButton = document.getElementById("choose-pgn-entry");
const fetchEntrySection = document.getElementById("fetch-entry-section");
const pgnEntrySection = document.getElementById("pgn-entry-section");
const backToEntryFromFetch = document.getElementById("back-to-entry-from-fetch");
const backToEntryFromPgn = document.getElementById("back-to-entry-from-pgn");
const demoFetchUserButton = document.getElementById("demo-fetch-user");
const demoPgnLoadButton = document.getElementById("demo-pgn-load");

const t = (key, params) => (window.i18n ? window.i18n.t(key, params) : key);

const users = new Set();
const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
const DEFAULT_USERNAME = "MagnusCarlsen";
const MAX_VISIBLE_USERS = 20;
const MAX_RANGE_DAYS = 120;
const PGN_ANALYSIS_DRAFT_KEY = "pgn_analysis_draft_v1";

let pgnFileText = "";
const SAMPLE_PGN_TEXT = `1. e4 c5 2. Nf3 Nc6 3. Bb5 g6 4. O-O Bg7 5. d3 Nf6 6. h3 O-O 7. Bxc6 dxc6 8. Be3 Ne8 9. Qc1 b6 10. a4 a5 11. Bh6 Nc7 12. Na3 Ne6 13. Bxg7 Kxg7 14. Nc4 Ba6 15. b3 Nd4 16. Nxd4 cxd4 17. f4 Bxc4 18. bxc4 Qd6 19. Rb1 Rab8 20. e5 Qc5 21. Qe1 e6 22. Qh4 b5 23. f5 exf5 24. Qf6+ Kg8 25. Qd6 Qxd6 26. exd6 bxa4 27. c5 Rb4 28. Rfe1 Rfb8 29. Ra1 Kf8 30. Re7 R4b5 31. Rxa4 Rxc5 32. Rc4 Rxc4 33. dxc4 c5 34. Ra7 Rd8 35. Ra6 Ke8 36. Rxa5 Rxd6 37. Rxc5 d3 38. cxd3 Rxd3 39. Kf2 Rc3 40. Rc7 h5 41. h4 Kf8 42. c5 Kg7 43. c6 Kf6 44. Ke2 Ke6 45. Kd2 Rc5 46. Kd3 Kd6 47. Rxf7 Rxc6 48. Ke3 Ke5 49. Re7+ Re6 50. Ra7 Kf6+ 51. Kf3 Re4 52. g3 Rd4 53. Ra6+ Kg7 54. Ra7+ Kh6 55. Rb7 Rg4 56. Rf7 f4 57. Rxf4 Rxf4+ 58. gxf4 Kg7 59. Ke3 Kf6 60. Ke4 Ke6 61. Ke3 Kf5 62. Kf3 Kf6 63. Ke4 Ke6 64. Ke3 Kf5 65. Kf3 Kf6 66. Ke4 1/2-1/2`;

function canTrackAnalytics() {
  return (
    window.cookieConsent &&
    typeof window.cookieConsent.canUse === "function" &&
    window.cookieConsent.canUse("analytics")
  );
}

function trackInputEvent(eventType, payload) {
  if (!canTrackAnalytics()) return;
  fetch("/api/metrics/input-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      event_type: eventType,
      page_path: window.location.pathname || "/",
      ...payload
    })
  }).catch(() => {});
}

function trackFunnelEvent(eventType, meta = {}) {
  trackInputEvent(eventType, {
    value_text: eventType,
    meta
  });
}

function setHomeMode(mode) {
  const showFetch = mode === "fetch";
  const showPgn = mode === "pgn";
  if (homeEntryChooser) {
    homeEntryChooser.classList.toggle("hidden", showFetch || showPgn);
  }
  if (fetchEntrySection) {
    fetchEntrySection.classList.toggle("hidden", !showFetch);
  }
  if (pgnEntrySection) {
    pgnEntrySection.classList.toggle("hidden", !showPgn);
  }
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
  return csvText
    .split(/[\n\r,;]/)
    .map((token) => normalizeUsername(token))
    .filter(Boolean)
    .filter((token) => token.toLowerCase() !== "username");
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

function setPgnStatus(text, isError = false) {
  if (!pgnStatus) return;
  pgnStatus.textContent = text;
  pgnStatus.style.color = isError ? "#b42318" : "#475467";
}

function normalizePgnForCompare(value) {
  return (value || "").replace(/\r\n/g, "\n").trim();
}

function getPgnInputState() {
  const fileText = normalizePgnForCompare(pgnFileText);
  const pastedText = normalizePgnForCompare(pgnTextInput?.value || "");

  if (fileText && pastedText) {
    if (fileText !== pastedText) {
      return { conflict: true, text: "", source: "conflict", fileChars: fileText.length, pasteChars: pastedText.length };
    }
    return { conflict: false, text: fileText, source: "both", fileChars: fileText.length, pasteChars: pastedText.length };
  }

  if (fileText) {
    return { conflict: false, text: fileText, source: "file", fileChars: fileText.length, pasteChars: 0 };
  }

  if (pastedText) {
    return { conflict: false, text: pastedText, source: "paste", fileChars: 0, pasteChars: pastedText.length };
  }

  return { conflict: false, text: "", source: "none", fileChars: 0, pasteChars: 0 };
}

function refreshPgnAutoStatus() {
  const state = getPgnInputState();
  if (state.conflict) {
    setPgnStatus(t("home_pgn_conflict"), true);
    return;
  }
  if (state.source === "file") {
    setPgnStatus(t("home_pgn_ready_from_file", { chars: state.fileChars }));
    return;
  }
  if (state.source === "paste") {
    setPgnStatus(t("home_pgn_ready_from_paste", { chars: state.pasteChars }));
    return;
  }
  if (state.source === "both") {
    setPgnStatus(t("home_pgn_ready_from_both", { chars: state.fileChars }));
    return;
  }
  setPgnStatus(t("home_pgn_auto_load_hint"));
}

function clampAnalysisDepth(rawValue) {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) {
    return 18;
  }
  return Math.max(8, Math.min(20, parsed));
}

function isLikelySanToken(token) {
  const cleaned = String(token || "").replace(/[!?]+$/g, "");
  if (!cleaned) return false;
  const sanPattern = /^(O-O(?:-O)?[+#]?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?|[a-h][1-8](?:=[QRBN])?[+#]?)$/;
  return sanPattern.test(cleaned);
}

function hasValidPgnFormat(text) {
  const normalized = normalizePgnForCompare(text);
  if (!normalized) return false;

  const body = normalized
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("["))
    .join(" ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\$\d+/g, " ");

  if (!/\d+\./.test(body)) return false;

  const resultTokens = new Set(["1-0", "0-1", "1/2-1/2", "*"]);
  const tokens = body.split(/\s+/).filter(Boolean);
  let sanCount = 0;

  for (let token of tokens) {
    if (resultTokens.has(token)) continue;
    if (/^\d+\.(\.\.)?$/.test(token)) continue;
    token = token.replace(/^\d+\.(\.\.)?/, "").trim();
    if (!token || resultTokens.has(token)) continue;
    if (isLikelySanToken(token)) {
      sanCount += 1;
    }
  }

  return sanCount >= 2;
}

function savePgnAnalysisDraft(payload) {
  sessionStorage.setItem(PGN_ANALYSIS_DRAFT_KEY, JSON.stringify(payload));
}

async function handlePgnFileSelected() {
  const file = pgnFileInput?.files?.[0];
  if (!file) {
    pgnFileText = "";
    refreshPgnAutoStatus();
    return;
  }
  try {
    pgnFileText = (await file.text()) || "";
    refreshPgnAutoStatus();
  } catch (error) {
    pgnFileText = "";
    setPgnStatus(t("home_pgn_load_failed", { error: error?.message || "unknown error" }), true);
  }
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
    trackFunnelEvent("funnel_fetch_validation_error", { reason: "empty_username" });
    return;
  }

  if (!addUsername(username)) {
    trackFunnelEvent("funnel_fetch_validation_error", { reason: "invalid_username_format" });
    alert(t("alert_invalid_username_format"));
    return;
  }

  trackInputEvent("username_submitted", { value_text: username.toLowerCase(), meta: { source: "manual" } });

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
    const addedUsernames = [];

    usernames.forEach((name) => {
      const sizeBefore = users.size;
      if (addUsername(name)) {
        if (users.size > sizeBefore) {
          addedCount += 1;
          addedUsernames.push(name.toLowerCase());
        }
      } else {
        invalidCount += 1;
      }
    });

    if (addedUsernames.length > 0) {
      trackInputEvent("username_submitted", { values: addedUsernames, meta: { source: "csv" } });
    }

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
  trackFunnelEvent("funnel_fetch_submit_clicked");
  if (users.size === 0) {
    trackFunnelEvent("funnel_fetch_validation_error", { reason: "no_username" });
    alert(t("alert_add_user_first"));
    return;
  }

  const selectedTypes = getSelectedGameTypes();
  if (selectedTypes.length === 0) {
    trackFunnelEvent("funnel_fetch_validation_error", { reason: "no_game_type" });
    alert(t("alert_select_game_type"));
    return;
  }

  const rawRangeDays = rangeDaysInput?.value || "30";
  const strictRangeDays = parseRangeDaysStrict(rawRangeDays);
  if (!strictRangeDays || strictRangeDays < 1) {
    trackFunnelEvent("funnel_fetch_validation_error", { reason: "invalid_range_days" });
    alert(t("alert_invalid_date_selection"));
    return;
  }
  if (strictRangeDays > MAX_RANGE_DAYS) {
    trackFunnelEvent("funnel_fetch_validation_error", { reason: "range_days_exceeded", entered_days: strictRangeDays });
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
      trackFunnelEvent("funnel_fetch_validation_error", { reason: "missing_custom_dates" });
      alert(t("alert_select_both_dates_or_empty"));
      return;
    }
    const fromMs = parseDateInputValue(fromRaw);
    const toMs = parseDateInputValue(toRaw);
    if (!fromMs || !toMs) {
      trackFunnelEvent("funnel_fetch_validation_error", { reason: "invalid_custom_dates" });
      alert(t("alert_invalid_date_selection"));
      return;
    }
    if (fromMs > toMs) {
      trackFunnelEvent("funnel_fetch_validation_error", { reason: "from_after_to" });
      alert(t("alert_from_after_to"));
      return;
    }
    const customRangeDays = Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000)) + 1;
    if (customRangeDays > MAX_RANGE_DAYS) {
      trackFunnelEvent("funnel_fetch_validation_error", { reason: "custom_range_exceeded", entered_days: customRangeDays });
      alert(t("alert_max_120_days", { days: customRangeDays }));
      return;
    }
    params.set("from", fromRaw);
    params.set("to", toRaw);
  } else {
    applyDateRangeFromDays(rangeDays);
  }

  trackFunnelEvent("funnel_fetch_submit_success", {
    usernames: users.size,
    game_types: selectedTypes.length,
    platform: platformSelect.value
  });
  window.location.href = `stats.html?${params.toString()}`;
});

if (pgnFileInput) {
  pgnFileInput.addEventListener("change", () => {
    handlePgnFileSelected();
  });
}

if (pgnTextInput) {
  pgnTextInput.addEventListener("input", () => {
    refreshPgnAutoStatus();
  });
}

if (pgnAnalyzeButton) {
  pgnAnalyzeButton.addEventListener("click", async () => {
    trackFunnelEvent("funnel_pgn_submit_clicked");
    const depth = clampAnalysisDepth(pgnDepthInput?.value || "18");
    if (pgnDepthInput) {
      pgnDepthInput.value = String(depth);
    }

    if (pgnFileInput?.files?.[0] && !pgnFileText) {
      await handlePgnFileSelected();
    }

    const state = getPgnInputState();
    if (state.conflict) {
      trackFunnelEvent("funnel_pgn_validation_error", { reason: "input_conflict" });
      setPgnStatus(t("home_pgn_conflict"), true);
      return;
    }
    if (!state.text) {
      trackFunnelEvent("funnel_pgn_validation_error", { reason: "empty_pgn" });
      setPgnStatus(t("home_pgn_no_input"), true);
      return;
    }
    if (!hasValidPgnFormat(state.text)) {
      trackFunnelEvent("funnel_pgn_validation_error", { reason: "invalid_pgn_format" });
      const message = t("home_pgn_invalid_format");
      setPgnStatus(message, true);
      window.alert(message);
      return;
    }

    savePgnAnalysisDraft({
      pgn_text: state.text,
      depth,
      source: state.source,
      saved_at_ms: Date.now()
    });
    trackFunnelEvent("funnel_pgn_submit_success", {
      source: state.source,
      depth
    });
    window.location.href = "pgn-analysis.html";
  });
}

ensureDefaultDateRange();
refreshPgnAutoStatus();
setHomeMode("none");

if (chooseFetchEntryButton) {
  chooseFetchEntryButton.addEventListener("click", () => {
    trackFunnelEvent("funnel_open_fetch_entry");
    setHomeMode("fetch");
  });
}

if (choosePgnEntryButton) {
  choosePgnEntryButton.addEventListener("click", () => {
    trackFunnelEvent("funnel_open_pgn_entry");
    setHomeMode("pgn");
  });
}

if (backToEntryFromFetch) {
  backToEntryFromFetch.addEventListener("click", () => {
    setHomeMode("none");
  });
}

if (backToEntryFromPgn) {
  backToEntryFromPgn.addEventListener("click", () => {
    setHomeMode("none");
  });
}

if (demoFetchUserButton) {
  demoFetchUserButton.addEventListener("click", () => {
    if (!users.has("MagnusCarlsen")) {
      users.add("MagnusCarlsen");
    }
    renderUsers();
    setHomeMode("fetch");
    trackFunnelEvent("funnel_demo_fetch_used");
  });
}

if (demoPgnLoadButton) {
  demoPgnLoadButton.addEventListener("click", () => {
    if (pgnTextInput) {
      pgnTextInput.value = SAMPLE_PGN_TEXT;
    }
    pgnFileText = "";
    refreshPgnAutoStatus();
    setHomeMode("pgn");
    trackFunnelEvent("funnel_demo_pgn_used");
  });
}

window.addEventListener("languagechange", () => {
  renderUsers();
  refreshPgnAutoStatus();
});
