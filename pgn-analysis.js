const ANALYSIS_DRAFT_KEY = "pgn_analysis_draft_v1";

const statusEl = document.getElementById("analysis-status");
const resultWrap = document.getElementById("analysis-result-wrap");
const resultBody = document.getElementById("analysis-result-body");
const downloadButton = document.getElementById("analysis-download-btn");

const modalEl = document.getElementById("analysis-progress-modal");
const progressFillEl = document.getElementById("analysis-progress-fill");
const progressMessageEl = document.getElementById("analysis-progress-message");
const etaEl = document.getElementById("analysis-eta");
const closeModalButton = document.getElementById("analysis-progress-close");
const cancelModalButton = document.getElementById("analysis-progress-cancel");

const t = (key, params) => (window.i18n ? window.i18n.t(key, params) : key);

let currentRows = [];
let currentAbortController = null;
let analysisCancelledByUser = false;
let analysisSlowHintShown = false;

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
  // Conservative estimate to reduce premature "0s remaining" on slower networks.
  const baseline = plies * (0.35 + depth * 0.02);
  return Math.max(8, Math.min(300, Math.round(baseline)));
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
  if (!draft || !draft.pgn_text) {
    setStatus(t("pgn_analysis_missing_input"), true);
    if (progressMessageEl) {
      progressMessageEl.textContent = t("pgn_analysis_progress_missing");
    }
    hideModal();
    return;
  }

  showModal();
  analysisCancelledByUser = false;
  setStatus(t("pgn_analysis_starting"));
  if (progressMessageEl) {
    progressMessageEl.textContent = t("pgn_analysis_progress_running");
  }
  setProgress(2);

  const plies = estimatePlies(draft.pgn_text);
  const expectedSeconds = estimateDurationSeconds(plies, draft.depth);
  const startedAt = Date.now();

  let progressValue = 2;
  const progressTimer = window.setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const ratio = Math.min(1, elapsed / Math.max(1, expectedSeconds));
    if (ratio < 1) {
      progressValue = Math.min(92, 2 + Math.round(ratio * 90));
    } else {
      // Keep moving slowly while backend is still processing.
      progressValue = Math.min(98, progressValue + 1);
    }
    setProgress(progressValue);

    const remaining = Math.max(1, Math.ceil(expectedSeconds - elapsed));
    if (etaEl) {
      etaEl.textContent = formatEtaSeconds(remaining);
    }
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
        setStatus(t("home_pgn_no_input"), true);
      } else if (data.error === "invalid_pgn_format") {
        const message = t("home_pgn_invalid_format");
        setStatus(message, true);
        showErrorPopup(message);
      } else if (data.error === "pgn_too_large" || data.error === "payload_too_large") {
        setStatus(t("home_pgn_too_large"), true);
      } else if (data.error === "rate_limited") {
        setStatus(t("home_pgn_rate_limited"), true);
      } else {
        const detail = data.error ? ` (${data.error})` : "";
        setStatus(`${t("home_pgn_analyze_failed")} [${response.status}]${detail}`, true);
      }
      if (progressMessageEl) {
        progressMessageEl.textContent = t("home_pgn_analyze_failed");
      }
      if (etaEl) {
        etaEl.textContent = t("pgn_analysis_eta_done");
      }
      showCloseModalButton();
      return;
    }

    currentRows = dedupeRows(Array.isArray(data.rows) ? data.rows : []);
    renderRows(currentRows);
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
    if (etaEl) {
      etaEl.textContent = t("pgn_analysis_eta_done");
    }
    hideCancelModalButton();
    showCloseModalButton();
  } catch (error) {
    if (analysisCancelledByUser || (error && error.name === "AbortError")) {
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
    setStatus(t("home_pgn_analyze_failed"), true);
    if (progressMessageEl) {
      progressMessageEl.textContent = t("home_pgn_analyze_failed");
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
});

runAnalysis();
