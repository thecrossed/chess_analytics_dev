const ANALYSIS_DRAFT_KEY = "pgn_analysis_draft_v1";

const statusEl = document.getElementById("analysis-status");
const resultWrap = document.getElementById("analysis-result-wrap");
const resultBody = document.getElementById("analysis-result-body");
const downloadButton = document.getElementById("analysis-download-btn");

const modalEl = document.getElementById("analysis-progress-modal");
const progressFillEl = document.getElementById("analysis-progress-fill");
const progressMessageEl = document.getElementById("analysis-progress-message");
const etaEl = document.getElementById("analysis-eta");

const t = (key, params) => (window.i18n ? window.i18n.t(key, params) : key);

let currentRows = [];

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
}

function hideModal() {
  if (!modalEl) return;
  modalEl.classList.add("hidden");
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
  const parsed = Number.parseInt(String(value ?? 12), 10);
  if (!Number.isFinite(parsed)) {
    return 12;
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
  const baseline = plies * (0.22 + depth * 0.01);
  return Math.max(4, Math.min(180, Math.round(baseline)));
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
    [row.move_number, row.side, row.move, row.eval_score || "-"].forEach((value) => {
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
  const header = ["move_number", "side", "move", "eval_score"];
  const lines = [header.map(csvEscape).join(",")];
  rows.forEach((row) => {
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
    progressValue = Math.min(92, 2 + Math.round(ratio * 90));
    setProgress(progressValue);

    const remaining = Math.max(0, expectedSeconds - elapsed);
    if (etaEl) {
      etaEl.textContent = formatEtaSeconds(remaining);
    }
  }, 250);

  try {
    const response = await fetch("/api/analysis/pgn-eval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pgn_text: draft.pgn_text, depth: draft.depth })
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
      return;
    }

    currentRows = Array.isArray(data.rows) ? data.rows : [];
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
  } catch (_error) {
    setStatus(t("home_pgn_analyze_failed"), true);
  } finally {
    window.clearInterval(progressTimer);
    window.setTimeout(() => {
      hideModal();
    }, 320);
  }
}

if (downloadButton) {
  downloadButton.addEventListener("click", () => {
    downloadCsv(currentRows);
  });
}

window.addEventListener("languagechange", () => {
  if (etaEl && !modalEl.classList.contains("hidden")) {
    etaEl.textContent = t("pgn_analysis_eta");
  }
});

runAnalysis();
