const ANALYSIS_DRAFT_KEY = "pgn_analysis_draft_v1";

const statusEl = document.getElementById("analysis-status");
const resultWrap = document.getElementById("analysis-result-wrap");
const resultBody = document.getElementById("analysis-result-body");
const downloadButton = document.getElementById("analysis-download-btn");
const summaryWrap = document.getElementById("analysis-summary-wrap");
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
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    [row.move_number, row.side, row.move, row.eval_score || "-", row.bestmove || "-", row.bestmove_eval || "-"].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value == null || value === "" ? "-" : String(value);
      tr.appendChild(td);
    });
    resultBody.appendChild(tr);
  });
  resultWrap.classList.toggle("hidden", rows.length === 0);
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
  if (!summaryWrap || !summaryAvgEvalLoss || !summaryBestMoveMisses || !summaryBiggestMistake) return;
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
    const evalScore = parseEvalNumber(row?.eval_score);
    const bestEval = parseEvalNumber(row?.bestmove_eval);
    if (evalScore == null || bestEval == null) {
      return;
    }
    // Eval convention: positive = white advantage, negative = black advantage.
    // White "miss" means actual eval is lower than best eval.
    // Black "miss" means actual eval is higher than best eval (less negative / more white-favored).
    const directionalLoss = sideKey === "white" ? (bestEval - evalScore) : (evalScore - bestEval);
    const loss = Math.max(0, directionalLoss);
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
    return t("pgn_summary_bestmove_misses_value", {
      misses: stats.misses,
      total: stats.comparedCount
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
  const header = ["move_number", "side", "move", "eval_score", "bestmove", "bestmove_eval"];
  const lines = [header.map(csvEscape).join(",")];
  rows.forEach((row) => {
    lines.push([row.move_number, row.side, row.move, row.eval_score || "", row.bestmove || "", row.bestmove_eval || ""].map(csvEscape).join(","));
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
  renderSummary(currentRows);
});

runAnalysis();
