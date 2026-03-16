const ANALYSIS_DRAFT_KEY = "pgn_analysis_draft_v1";

const statusEl = document.getElementById("analysis-status");
const resultWrap = document.getElementById("analysis-result-wrap");
const resultTable = document.getElementById("analysis-result-table");
const resultHeadRow = document.getElementById("analysis-result-head-row");
const resultBody = document.getElementById("analysis-result-body");
const columnControls = document.getElementById("analysis-column-controls");
const backSelectedLink = document.getElementById("analysis-back-selected");
const downloadButton = document.getElementById("analysis-download-btn");
const summaryWrap = document.getElementById("analysis-summary-wrap");
const summaryPlayers = document.getElementById("summary-players");
const summaryAvgEvalLoss = document.getElementById("summary-avg-eval-loss");
const summaryBestMoveMisses = document.getElementById("summary-bestmove-misses");
const summaryBiggestMistake = document.getElementById("summary-biggest-mistake");

const modalEl = document.getElementById("analysis-progress-modal");
const progressFillEl = document.getElementById("analysis-progress-fill");
const progressMessageEl = document.getElementById("analysis-progress-message");
const etaEl = document.getElementById("analysis-eta");
const moveProgressEl = document.getElementById("analysis-move-progress");
const closeModalButton = document.getElementById("analysis-progress-close");
const cancelModalButton = document.getElementById("analysis-progress-cancel");

const t = (key, params) => (window.i18n ? window.i18n.t(key, params) : key);

let currentRows = [];
let currentAbortController = null;
let analysisCancelledByUser = false;
let analysisSlowHintShown = false;
let currentMoveDone = 0;
let currentMoveTotal = 0;
let visibleColumnKeys = new Set();
let currentPlayers = { white: "", black: "" };

const COLUMN_GROUPS = [
  { key: "core", labelKey: "pgn_columns_group_core" },
  { key: "engine", labelKey: "pgn_columns_group_engine" },
  { key: "opening", labelKey: "pgn_columns_group_opening" },
  { key: "clock", labelKey: "pgn_columns_group_clock" }
];

const COLUMN_DEFS = [
  { key: "move_number", labelKey: "pgn_eval_move_number", group: "core", sticky: 1 },
  { key: "side", labelKey: "pgn_eval_side", group: "core", sticky: 2 },
  { key: "move", labelKey: "pgn_eval_move", group: "core", sticky: 3 },
  { key: "eval_score", labelKey: "pgn_eval_score", group: "engine" },
  { key: "bestmove", labelKey: "pgn_eval_bestmove", group: "engine" },
  { key: "bestmove_eval", labelKey: "pgn_eval_bestmove_eval", group: "engine" },
  { key: "eval_gap", labelKey: "pgn_eval_eval_gap", group: "engine" },
  { key: "accuracy", labelKey: "pgn_eval_accuracy", group: "engine" },
  { key: "is_book_move", labelKey: "pgn_eval_is_book_move", group: "opening" },
  { key: "opening_eco", labelKey: "pgn_eval_opening_eco", group: "opening" },
  { key: "opening_name", labelKey: "pgn_eval_opening_name", group: "opening" },
  { key: "white_clock", labelKey: "pgn_eval_white_clock", group: "clock" },
  { key: "black_clock", labelKey: "pgn_eval_black_clock", group: "clock" }
];

const CORE_COLUMN_KEYS = new Set(
  COLUMN_DEFS.filter((column) => column.group === "core").map((column) => column.key)
);

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

function applyMetricTooltips() {
  document.querySelectorAll("[data-tooltip-i18n]").forEach((el) => {
    const key = el.getAttribute("data-tooltip-i18n");
    if (!key) return;
    const text = t(key);
    el.setAttribute("data-tooltip", text);
    el.setAttribute("aria-label", text);
  });
}

function dedupeRows(rows) {
  const seen = new Set();
  const output = [];
  rows.forEach((row) => {
    const key = `${row?.move_number ?? ""}|${row?.side ?? ""}|${row?.move ?? ""}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    output.push(row);
  });
  return output;
}

function getVisibleColumns() {
  return COLUMN_DEFS.filter((column) => visibleColumnKeys.has(column.key));
}

function formatCellValue(value) {
  return value == null || value === "" ? "-" : String(value);
}

function columnClassName(column) {
  return `col-${column.key.replace(/_/g, "-")}`;
}

function getDirectionalLoss(row) {
  const sideKey = String(row?.side || "").toLowerCase() === "black" ? "black" : "white";
  const evalScore = parseEvalNumber(row?.eval_score);
  const bestEval = parseEvalNumber(row?.bestmove_eval);
  if (evalScore == null || bestEval == null) {
    return null;
  }
  const directionalLoss = sideKey === "white" ? (bestEval - evalScore) : (evalScore - bestEval);
  return Math.max(0, directionalLoss);
}

function getMoveAnnotation(row) {
  if (row?.is_book_move) {
    return {
      symbol: "=",
      label: "Book",
      tone: "book"
    };
  }

  const loss = getDirectionalLoss(row);
  if (loss == null) return null;

  if (loss <= 0.5) {
    return null;
  }
  if (loss <= 1.0) {
    return { symbol: "?!", label: "Inaccuracy", tone: "inaccuracy" };
  }
  if (loss <= 2.0) {
    return { symbol: "?", label: "Mistake", tone: "mistake" };
  }
  return { symbol: "??", label: "Blunder", tone: "blunder" };
}

function renderMoveCell(td, row, column) {
  td.className = columnClassName(column);
  const wrap = document.createElement("div");
  wrap.className = "move-cell-content";

  const moveText = document.createElement("span");
  moveText.className = "move-cell-text";
  moveText.textContent = formatCellValue(row?.[column.key]);
  wrap.appendChild(moveText);

  const annotation = getMoveAnnotation(row);
  if (annotation && moveText.textContent !== "-") {
    const badge = document.createElement("span");
    badge.className = `move-annotation move-annotation-${annotation.tone}`;
    badge.textContent = annotation.symbol;
    badge.title = annotation.label;
    badge.setAttribute("aria-label", annotation.label);
    wrap.appendChild(badge);
  }

  td.appendChild(wrap);
}

function columnHasData(rows, columnKey) {
  return rows.some((row) => {
    const value = row?.[columnKey];
    return value != null && value !== "";
  });
}

function groupHasData(rows, groupKey) {
  if (groupKey === "core") return true;
  return COLUMN_DEFS.some((column) => column.group === groupKey && columnHasData(rows, column.key));
}

function resetVisibleColumns(rows) {
  const nextVisible = new Set(CORE_COLUMN_KEYS);
  COLUMN_DEFS.forEach((column) => {
    if (column.group === "engine" || column.group === "opening") {
      nextVisible.add(column.key);
    }
  });
  if (groupHasData(rows, "clock")) {
    COLUMN_DEFS.forEach((column) => {
      if (column.group === "clock") {
        nextVisible.add(column.key);
      }
    });
  }
  visibleColumnKeys = nextVisible;
}

function setGroupVisibility(groupKey, shouldShow) {
  COLUMN_DEFS.forEach((column) => {
    if (column.group !== groupKey || CORE_COLUMN_KEYS.has(column.key)) {
      return;
    }
    if (shouldShow) {
      visibleColumnKeys.add(column.key);
    } else {
      visibleColumnKeys.delete(column.key);
    }
  });
}

function renderTableHead() {
  if (!resultHeadRow) return;
  resultHeadRow.innerHTML = "";
  getVisibleColumns().forEach((column) => {
    const th = document.createElement("th");
    th.textContent = t(column.labelKey);
    th.className = columnClassName(column);
    if (column.sticky) {
      th.classList.add("sticky-col", `sticky-col-${column.sticky}`);
    }
    resultHeadRow.appendChild(th);
  });
}

function renderColumnControls(rows) {
  if (!columnControls) return;
  if (!rows.length) {
    columnControls.classList.add("hidden");
    columnControls.innerHTML = "";
    return;
  }

  columnControls.classList.remove("hidden");
  columnControls.innerHTML = "";

  const header = document.createElement("div");
  header.className = "analysis-columns-header";

  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = t("pgn_columns_title");
  const hint = document.createElement("p");
  hint.className = "hint-inline";
  hint.textContent = t("pgn_columns_hint");
  titleWrap.append(title, hint);

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "secondary-button";
  resetButton.textContent = t("pgn_columns_reset");
  resetButton.addEventListener("click", () => {
    resetVisibleColumns(rows);
    renderColumnControls(rows);
    renderTableHead();
    renderRows(rows);
  });

  header.append(titleWrap, resetButton);

  const groupToggles = document.createElement("div");
  groupToggles.className = "analysis-group-toggles";
  COLUMN_GROUPS.filter((group) => group.key !== "core").forEach((group) => {
    const groupColumns = COLUMN_DEFS.filter((column) => column.group === group.key);
    const visibleCount = groupColumns.filter((column) => visibleColumnKeys.has(column.key)).length;
    const hasData = groupHasData(rows, group.key);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "analysis-group-toggle";
    button.textContent = t(group.labelKey);
    button.disabled = !hasData;
    button.setAttribute("aria-pressed", visibleCount > 0 ? "true" : "false");
    if (visibleCount === groupColumns.length) {
      button.dataset.state = "on";
    } else if (visibleCount === 0) {
      button.dataset.state = "off";
    } else {
      button.dataset.state = "partial";
    }
    button.addEventListener("click", () => {
      setGroupVisibility(group.key, visibleCount !== groupColumns.length);
      renderColumnControls(rows);
      renderTableHead();
      renderRows(rows);
    });
    groupToggles.appendChild(button);
  });

  const details = document.createElement("details");
  details.className = "analysis-columns-details";
  const summary = document.createElement("summary");
  summary.textContent = t("pgn_columns_customize");
  details.appendChild(summary);

  const detailsGrid = document.createElement("div");
  detailsGrid.className = "analysis-columns-grid";

  COLUMN_GROUPS.forEach((group) => {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "analysis-columns-group";
    const legend = document.createElement("legend");
    legend.textContent = t(group.labelKey);
    fieldset.appendChild(legend);

    COLUMN_DEFS.filter((column) => column.group === group.key).forEach((column) => {
      const label = document.createElement("label");
      label.className = "analysis-columns-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = visibleColumnKeys.has(column.key);
      checkbox.disabled = CORE_COLUMN_KEYS.has(column.key);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          visibleColumnKeys.add(column.key);
        } else {
          visibleColumnKeys.delete(column.key);
        }
        renderColumnControls(rows);
        renderTableHead();
        renderRows(rows);
      });
      const text = document.createElement("span");
      text.textContent = t(column.labelKey);
      label.append(checkbox, text);
      fieldset.appendChild(label);
    });

    detailsGrid.appendChild(fieldset);
  });

  details.appendChild(detailsGrid);
  columnControls.append(header, groupToggles, details);
}

function setStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#b42318" : "#475467";
}

function showErrorPopup(message) {
  window.alert(message);
}

function setMoveProgress(done, total) {
  currentMoveDone = Math.max(0, Number(done) || 0);
  currentMoveTotal = Math.max(0, Number(total) || 0);
  if (!moveProgressEl) return;
  if (currentMoveTotal <= 0) {
    moveProgressEl.textContent = t("pgn_analysis_move_progress_idle");
    return;
  }
  moveProgressEl.textContent = t("pgn_analysis_move_progress", {
    done: Math.min(currentMoveDone, currentMoveTotal),
    total: currentMoveTotal
  });
}

function setProgress(percent) {
  if (!progressFillEl) return;
  const safe = Math.max(0, Math.min(100, percent));
  progressFillEl.style.width = `${safe}%`;
}

function showModal() {
  if (!modalEl) return;
  modalEl.classList.remove("hidden");
  if (closeModalButton) {
    closeModalButton.classList.add("hidden");
  }
  if (cancelModalButton) {
    cancelModalButton.classList.remove("hidden");
    cancelModalButton.disabled = false;
  }
}

function hideModal() {
  if (!modalEl) return;
  modalEl.classList.add("hidden");
}

function showCloseModalButton() {
  if (!closeModalButton) return;
  closeModalButton.classList.remove("hidden");
}

function hideCancelModalButton() {
  if (!cancelModalButton) return;
  cancelModalButton.classList.add("hidden");
}

function parseDraft() {
  const raw = sessionStorage.getItem(ANALYSIS_DRAFT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.pgn_text !== "string") {
      return null;
    }
    return {
      pgn_text: parsed.pgn_text.trim(),
      depth: clampDepth(parsed.depth),
      source: parsed.source || "unknown"
    };
  } catch (_error) {
    return null;
  }
}

function updateBackLinks(draft) {
  if (!backSelectedLink) return;
  const shouldShow = draft?.source === "raw_selected_game" || draft?.source === "uploaded_batch_game";
  backSelectedLink.classList.toggle("hidden", !shouldShow);
}

function extractPgnPlayers(pgnText) {
  const tags = { white: "", black: "" };
  String(pgnText || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const match = line.match(/^\[(White|Black)\s+"(.*)"\]$/);
      if (!match) return;
      const sideKey = match[1].toLowerCase();
      tags[sideKey] = match[2].trim();
    });
  return tags;
}

function clampDepth(value) {
  const parsed = Number.parseInt(String(value ?? 18), 10);
  if (!Number.isFinite(parsed)) {
    return 18;
  }
  return Math.max(8, Math.min(20, parsed));
}

function estimatePlies(pgnText) {
  const movesText = pgnText
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("["))
    .join(" ");

  const stripped = movesText
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\$\d+/g, " ");

  const resultTokens = new Set(["1-0", "0-1", "1/2-1/2", "*"]);
  const tokens = stripped.split(/\s+/).filter(Boolean);

  let plies = 0;
  for (let token of tokens) {
    if (resultTokens.has(token)) continue;
    if (/^\d+\.(\.\.)?$/.test(token)) continue;
    token = token.replace(/^\d+\.(\.\.)?/, "").trim();
    if (!token || resultTokens.has(token)) continue;
    plies += 1;
  }
  return Math.max(1, plies);
}

function estimateDurationSeconds(plies, depth) {
  // Local-engine-oriented estimate. Keep it closer to observed runtime on
  // Railway with bundled Stockfish while still conservative.
  const baseline = plies * (0.12 + depth * 0.006);
  return Math.max(6, Math.min(180, Math.round(baseline)));
}

function formatEtaSeconds(seconds) {
  const safe = Math.max(0, Math.round(seconds));
  return t("pgn_analysis_eta_seconds", { seconds: safe });
}

function renderRows(rows) {
  if (!resultBody || !resultWrap) return;
  resultBody.innerHTML = "";
  const visibleColumns = getVisibleColumns();
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    visibleColumns.forEach((column) => {
      const td = document.createElement("td");
      if (column.key === "move") {
        renderMoveCell(td, row, column);
      } else {
        td.textContent = formatCellValue(row?.[column.key]);
        td.className = columnClassName(column);
      }
      if (column.sticky) {
        td.classList.add("sticky-col", `sticky-col-${column.sticky}`);
      }
      tr.appendChild(td);
    });
    resultBody.appendChild(tr);
  });
  resultWrap.classList.toggle("hidden", rows.length === 0);
  if (resultTable) {
    resultTable.classList.toggle("has-hidden-columns", visibleColumns.length !== COLUMN_DEFS.length);
  }
}

function parseEvalNumber(raw) {
  const parsed = Number.parseFloat(String(raw ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function sideLabel(sideKey) {
  return sideKey === "black" ? t("pgn_side_black") : t("pgn_side_white");
}

function renderSidePair(targetEl, whiteText, blackText) {
  if (!targetEl) return;
  targetEl.innerHTML =
    `<span class="summary-side-line"><strong>${sideLabel("white")}:</strong> ${whiteText}</span>` +
    `<span class="summary-side-line"><strong>${sideLabel("black")}:</strong> ${blackText}</span>`;
}

function renderSummary(rows) {
  if (!summaryWrap || !summaryPlayers || !summaryAvgEvalLoss || !summaryBestMoveMisses || !summaryBiggestMistake) return;
  if (!rows.length) {
    summaryWrap.classList.add("hidden");
    return;
  }

  const sideStats = {
    white: { comparedCount: 0, totalLoss: 0, misses: 0, biggestLoss: -1, biggestRow: null },
    black: { comparedCount: 0, totalLoss: 0, misses: 0, biggestLoss: -1, biggestRow: null }
  };

  rows.forEach((row) => {
    const sideKey = String(row?.side || "").toLowerCase() === "black" ? "black" : "white";
    const stats = sideStats[sideKey];
    const loss = getDirectionalLoss(row);
    if (loss == null) {
      return;
    }
    stats.comparedCount += 1;
    stats.totalLoss += loss;
    if (loss >= 0.5) {
      stats.misses += 1;
    }
    if (loss > stats.biggestLoss) {
      stats.biggestLoss = loss;
      stats.biggestRow = row;
    }
  });

  const renderAvgLoss = (sideKey) => {
    const stats = sideStats[sideKey];
    if (stats.comparedCount === 0) return t("pgn_summary_not_enough_data");
    return (stats.totalLoss / stats.comparedCount).toFixed(2);
  };

  const renderMisses = (sideKey) => {
    const stats = sideStats[sideKey];
    if (stats.comparedCount === 0) return t("pgn_summary_not_enough_data");
    const percent = ((stats.misses / stats.comparedCount) * 100).toFixed(1);
    return t("pgn_summary_bestmove_misses_percent", {
      percent
    });
  };

  const renderBiggestMistake = (sideKey) => {
    const stats = sideStats[sideKey];
    if (!stats.biggestRow) return t("pgn_summary_not_enough_data");
    return t("pgn_summary_biggest_mistake_value", {
      move_number: stats.biggestRow.move_number ?? "-",
      side: stats.biggestRow.side ?? "-",
      move: stats.biggestRow.move ?? "-",
      loss: stats.biggestLoss.toFixed(2)
    });
  };

  renderSidePair(
    summaryPlayers,
    currentPlayers.white || "-",
    currentPlayers.black || "-"
  );
  renderSidePair(summaryAvgEvalLoss, renderAvgLoss("white"), renderAvgLoss("black"));
  renderSidePair(summaryBestMoveMisses, renderMisses("white"), renderMisses("black"));
  renderSidePair(summaryBiggestMistake, renderBiggestMistake("white"), renderBiggestMistake("black"));

  summaryWrap.classList.remove("hidden");
}

function csvEscape(value) {
  const raw = value == null ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function downloadCsv(rows) {
  if (!rows.length) return;
  const header = COLUMN_DEFS.map((column) => column.key);
  const lines = [header.map(csvEscape).join(",")];
  rows.forEach((row) => {
    lines.push(
      COLUMN_DEFS.map((column) => (row?.[column.key] == null ? "" : row[column.key]))
        .map(csvEscape)
        .join(",")
    );
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

async function runAnalysis() {
  const draft = parseDraft();
  updateBackLinks(draft);
  currentPlayers = extractPgnPlayers(draft?.pgn_text || "");
  if (summaryWrap) {
    summaryWrap.classList.add("hidden");
  }
  if (!draft || !draft.pgn_text) {
    trackFunnelEvent("funnel_pgn_analysis_missing_input");
    setStatus(t("pgn_analysis_missing_input"), true);
    if (progressMessageEl) {
      progressMessageEl.textContent = t("pgn_analysis_progress_missing");
    }
    hideModal();
    return;
  }

  showModal();
  setMoveProgress(0, 0);
  trackFunnelEvent("funnel_pgn_analysis_started", { depth: draft.depth });
  analysisCancelledByUser = false;
  setStatus(t("pgn_analysis_starting"));
  if (progressMessageEl) {
    progressMessageEl.textContent = t("pgn_analysis_progress_running");
  }
  setProgress(2);

  const plies = estimatePlies(draft.pgn_text);
  setMoveProgress(0, plies);
  const expectedSeconds = estimateDurationSeconds(plies, draft.depth);
  const startedAt = Date.now();

  let progressValue = 2;
  const progressTimer = window.setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const ratio = Math.min(1, elapsed / Math.max(1, expectedSeconds));
    if (ratio < 1) {
      progressValue = Math.min(92, 2 + Math.round(ratio * 90));
      const remaining = Math.max(1, Math.ceil(expectedSeconds - elapsed));
      if (etaEl) {
        etaEl.textContent = formatEtaSeconds(remaining);
      }
    } else {
      // Keep moving slowly while backend is still processing.
      progressValue = Math.min(98, progressValue + 1);
      if (etaEl) {
        etaEl.textContent = t("pgn_analysis_eta_finalizing");
      }
    }
    setProgress(progressValue);
    const estimatedDone = ratio < 1 ? Math.floor(ratio * plies) : Math.max(plies - 1, 0);
    setMoveProgress(estimatedDone, plies);
  }, 250);

  // Soft timeout only: show a hint when analysis is slower than expected,
  // but do not abort automatically.
  analysisSlowHintShown = false;
  const slowHintTimeoutMs = Math.max(20_000, expectedSeconds * 2_000);
  const slowHintTimer = window.setTimeout(() => {
    analysisSlowHintShown = true;
    if (progressMessageEl) {
      progressMessageEl.textContent = `${t("pgn_analysis_progress_running")} (${t("pgn_analysis_slow_hint")})`;
    }
  }, slowHintTimeoutMs);

  try {
    currentAbortController = new AbortController();
    const response = await fetch("/api/analysis/pgn-eval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pgn_text: draft.pgn_text, depth: draft.depth }),
      signal: currentAbortController.signal
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (data.error === "pgn_required") {
        trackFunnelEvent("funnel_pgn_analysis_failed", { reason: "pgn_required", status: response.status });
        setStatus(t("pgn_analysis_error_missing"), true);
      } else if (data.error === "invalid_pgn_format") {
        trackFunnelEvent("funnel_pgn_analysis_failed", { reason: "invalid_pgn_format", status: response.status });
        const message = t("pgn_analysis_error_invalid_format");
        setStatus(message, true);
        showErrorPopup(message);
      } else if (data.error === "pgn_too_large" || data.error === "payload_too_large") {
        trackFunnelEvent("funnel_pgn_analysis_failed", { reason: "pgn_too_large", status: response.status });
        setStatus(t("pgn_analysis_error_too_large"), true);
      } else if (data.error === "rate_limited") {
        trackFunnelEvent("funnel_pgn_analysis_failed", { reason: "rate_limited", status: response.status });
        setStatus(t("pgn_analysis_error_rate_limited"), true);
      } else {
        trackFunnelEvent("funnel_pgn_analysis_failed", {
          reason: data.error || "unknown_error",
          status: response.status
        });
        const detail = data.error ? ` (${data.error})` : "";
        setStatus(`${t("pgn_analysis_error_generic")} [${response.status}]${detail}`, true);
      }
      if (progressMessageEl) {
        progressMessageEl.textContent = t("pgn_analysis_error_generic");
      }
      if (etaEl) {
        etaEl.textContent = t("pgn_analysis_eta_done");
      }
      showCloseModalButton();
      return;
    }

    currentRows = dedupeRows(Array.isArray(data.rows) ? data.rows : []);
    resetVisibleColumns(currentRows);
    renderTableHead();
    renderColumnControls(currentRows);
    trackFunnelEvent("funnel_pgn_analysis_success", {
      rows: currentRows.length,
      failed_eval_count: Number(data.failed_eval_count || 0)
    });
    renderRows(currentRows);
    renderSummary(currentRows);
    if (downloadButton) {
      downloadButton.disabled = currentRows.length === 0;
    }

    setStatus(
      t("home_pgn_analysis_done", {
        count: currentRows.length,
        failed: Number(data.failed_eval_count || 0)
      })
    );
    if (progressMessageEl) {
      progressMessageEl.textContent = t("pgn_analysis_progress_done");
    }
    setProgress(100);
    setMoveProgress(plies, plies);
    if (etaEl) {
      etaEl.textContent = t("pgn_analysis_eta_done");
    }
    hideCancelModalButton();
    showCloseModalButton();
  } catch (error) {
    if (analysisCancelledByUser || (error && error.name === "AbortError")) {
      trackFunnelEvent("funnel_pgn_analysis_cancelled");
      setStatus(t("pgn_analysis_cancelled"), false);
      if (progressMessageEl) {
        progressMessageEl.textContent = t("pgn_analysis_cancelled");
      }
      if (etaEl) {
        etaEl.textContent = t("pgn_analysis_eta_done");
      }
      hideCancelModalButton();
      showCloseModalButton();
      return;
    }
    trackFunnelEvent("funnel_pgn_analysis_failed", { reason: "network_or_runtime_exception" });
    setStatus(t("pgn_analysis_error_generic"), true);
    if (progressMessageEl) {
      progressMessageEl.textContent = t("pgn_analysis_error_generic");
    }
    if (etaEl) {
      etaEl.textContent = t("pgn_analysis_eta_done");
    }
    hideCancelModalButton();
    showCloseModalButton();
  } finally {
    window.clearTimeout(slowHintTimer);
    window.clearInterval(progressTimer);
    currentAbortController = null;
  }
}

if (downloadButton) {
  downloadButton.addEventListener("click", () => {
    downloadCsv(currentRows);
  });
}

if (closeModalButton) {
  closeModalButton.addEventListener("click", () => {
    hideModal();
  });
}

if (cancelModalButton) {
  cancelModalButton.addEventListener("click", () => {
    trackFunnelEvent("funnel_pgn_analysis_cancel_clicked");
    analysisCancelledByUser = true;
    if (currentAbortController) {
      currentAbortController.abort();
    }
    hideModal();
    setStatus(t("pgn_analysis_cancelled"), false);
  });
}

window.addEventListener("languagechange", () => {
  if (etaEl && !modalEl.classList.contains("hidden")) {
    etaEl.textContent = t("pgn_analysis_eta");
  }
  if (progressMessageEl && !modalEl.classList.contains("hidden") && analysisSlowHintShown) {
    progressMessageEl.textContent = `${t("pgn_analysis_progress_running")} (${t("pgn_analysis_slow_hint")})`;
  }
  setMoveProgress(currentMoveDone, currentMoveTotal);
  renderTableHead();
  renderColumnControls(currentRows);
  renderRows(currentRows);
  renderSummary(currentRows);
  applyMetricTooltips();
});

renderTableHead();
applyMetricTooltips();
runAnalysis();
