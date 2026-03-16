const SELECTED_PGN_BATCH_KEY = "selected_pgn_analysis_batch_v1";
const PGN_ANALYSIS_DRAFT_KEY = "pgn_analysis_draft_v1";
const ANALYSIS_RESULT_STORAGE_PREFIX = "pgn_analysis_result_v1:";

const summaryEl = document.getElementById("selected-pgn-summary");
const listEl = document.getElementById("selected-pgn-list");
const backRawLink = document.getElementById("selected-pgn-back-raw");
const batchPanelEl = document.getElementById("selected-pgn-batch-panel");
const batchSummaryEl = document.getElementById("selected-pgn-batch-summary");
const batchCurrentEl = document.getElementById("selected-pgn-batch-current");
const batchFillEl = document.getElementById("selected-pgn-batch-fill");
const runAllButton = document.getElementById("selected-pgn-run-all");

const t = (key, params) => (window.i18n ? window.i18n.t(key, params) : key);

let currentBatch = null;
let batchRunInProgress = false;
let batchProgressTimer = null;
let batchProgressTotalPlies = 0;
let batchProgressCompletedPlies = 0;
let batchProgressCurrentPlies = 0;
let batchProgressCurrentDone = 0;

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

function clampDepth(value) {
  const parsed = Number.parseInt(String(value ?? 18), 10);
  if (!Number.isFinite(parsed)) {
    return 18;
  }
  return Math.max(8, Math.min(20, parsed));
}

function estimatePlies(pgnText) {
  const movesText = String(pgnText || "")
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
  const baseline = plies * (0.12 + depth * 0.006);
  return Math.max(6, Math.min(180, Math.round(baseline)));
}

function normalizeGameStatus(game) {
  if (!game?.pgn_text) return "missing";
  if (game?.analysis_status === "running") return "pending";
  if (game?.analysis_status === "done" && game?.analysis_result_key) return "done";
  if (game?.analysis_status === "failed") return "failed";
  return "pending";
}

function ensureBatchShape(batch) {
  const batchId =
    typeof batch?.batch_id === "string" && batch.batch_id.trim()
      ? batch.batch_id.trim()
      : `batch-${Date.now()}`;
  const depth = clampDepth(batch?.depth);
  const games = Array.isArray(batch?.games)
    ? batch.games.map((game, index) => ({
        ...game,
        analysis_status: normalizeGameStatus(game),
        analysis_result_key: typeof game?.analysis_result_key === "string" ? game.analysis_result_key : "",
        analysis_error: typeof game?.analysis_error === "string" ? game.analysis_error : "",
        analysis_completed_at_ms: Number.isFinite(Number(game?.analysis_completed_at_ms))
          ? Number(game.analysis_completed_at_ms)
          : null,
        estimated_plies: typeof game?.pgn_text === "string" && game.pgn_text.trim() ? estimatePlies(game.pgn_text) : 0,
        original_index: Number.isFinite(Number(game?.original_index)) ? Number(game.original_index) : index
      }))
    : [];

  return {
    batch_id: batchId,
    games,
    sourceUrl: typeof batch?.source_url === "string" ? batch.source_url : "",
    depth,
    sourceKind: typeof batch?.source_kind === "string" ? batch.source_kind : ""
  };
}

function loadBatch() {
  const raw = sessionStorage.getItem(SELECTED_PGN_BATCH_KEY);
  if (!raw) return ensureBatchShape(null);
  try {
    return ensureBatchShape(JSON.parse(raw));
  } catch (_error) {
    return ensureBatchShape(null);
  }
}

function saveBatch() {
  if (!currentBatch) return;
  sessionStorage.setItem(
    SELECTED_PGN_BATCH_KEY,
    JSON.stringify({
      batch_id: currentBatch.batch_id,
      games: currentBatch.games,
      depth: currentBatch.depth,
      source_url: currentBatch.sourceUrl,
      source_kind: currentBatch.sourceKind
    })
  );
}

function buildResultStorageKey(batchId, gameIndex) {
  return `${ANALYSIS_RESULT_STORAGE_PREFIX}${batchId}:${gameIndex}`;
}

function buildResultUrl(resultKey) {
  return `pgn-analysis.html?result=${encodeURIComponent(resultKey)}`;
}

function saveAnalysisResult(game, rows, failedEvalCount) {
  const resultKey = buildResultStorageKey(currentBatch.batch_id, game.original_index);
  sessionStorage.setItem(
    resultKey,
    JSON.stringify({
      rows,
      failed_eval_count: Number(failedEvalCount || 0),
      pgn_text: game.pgn_text || "",
      source: currentBatch.sourceKind === "uploaded_pgn_batch" ? "uploaded_batch_game" : "raw_selected_game",
      depth: currentBatch.depth,
      saved_at_ms: Date.now()
    })
  );
  return resultKey;
}

function savePgnDraft(game, depth, sourceKind, resultKey = "") {
  sessionStorage.setItem(
    PGN_ANALYSIS_DRAFT_KEY,
    JSON.stringify({
      pgn_text: game.pgn_text,
      depth,
      source: sourceKind === "uploaded_pgn_batch" ? "uploaded_batch_game" : "raw_selected_game",
      result_key: resultKey || "",
      saved_at_ms: Date.now()
    })
  );
}

function formatMeta(game) {
  const parts = [];
  if (game.username) parts.push(`${t("stats_username")}: ${game.username}`);
  if (game.source_name) parts.push(game.source_name);
  if (game.game_type) parts.push(game.game_type);
  if (game.white_username || game.black_username) {
    parts.push(`${game.white_username || "?"} vs ${game.black_username || "?"}`);
  }
  if (game.played_at_utc) parts.push(game.played_at_utc);
  return parts.join(" | ");
}

function getStatusCopy(status) {
  switch (status) {
    case "running":
      return { label: t("selected_pgn_status_running"), tone: "running" };
    case "done":
      return { label: t("selected_pgn_status_done"), tone: "done" };
    case "failed":
      return { label: t("selected_pgn_status_failed"), tone: "failed" };
    case "missing":
      return { label: t("selected_pgn_status_missing"), tone: "missing" };
    default:
      return { label: t("selected_pgn_status_pending"), tone: "pending" };
  }
}

function getBatchCounters() {
  const counters = {
    total: currentBatch?.games.length || 0,
    analyzable: 0,
    rerunnable: 0,
    done: 0,
    failed: 0,
    missing: 0,
    pending: 0,
    running: 0
  };

  (currentBatch?.games || []).forEach((game) => {
    const status = normalizeGameStatus(game);
    if (status !== "missing") {
      counters.analyzable += 1;
    }
    if (status === "pending" || status === "failed") {
      counters.rerunnable += 1;
    }
    if (status === "done") counters.done += 1;
    if (status === "failed") counters.failed += 1;
    if (status === "missing") counters.missing += 1;
    if (status === "pending") counters.pending += 1;
    if (status === "running") counters.running += 1;
  });

  return counters;
}

function updateBatchProgress(currentLabel = "") {
  if (!batchPanelEl || !batchSummaryEl || !batchFillEl || !batchCurrentEl) return;
  const counters = getBatchCounters();
  if (!counters.total) {
    batchPanelEl.classList.add("hidden");
    return;
  }

  batchPanelEl.classList.remove("hidden");
  const completed = counters.done + counters.failed + counters.missing;
  const donePlies = Math.max(0, batchProgressCompletedPlies + batchProgressCurrentDone);
  const percent = batchProgressTotalPlies > 0
    ? Math.round((Math.min(donePlies, batchProgressTotalPlies) / batchProgressTotalPlies) * 100)
    : counters.total > 0
      ? Math.round((completed / counters.total) * 100)
      : 0;
  batchFillEl.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  batchSummaryEl.textContent = t("selected_pgn_batch_progress", {
    done: counters.done,
    total: counters.total,
    failed: counters.failed,
    missing: counters.missing
  });

  if (batchRunInProgress && currentLabel) {
    batchCurrentEl.textContent = t("selected_pgn_batch_current_moves", {
      game: currentLabel,
      done: Math.min(donePlies, batchProgressTotalPlies),
      total: batchProgressTotalPlies
    });
  } else if (batchRunInProgress) {
    batchCurrentEl.textContent = t("selected_pgn_batch_running");
  } else if (counters.done > 0 || counters.failed > 0 || counters.missing > 0) {
    batchCurrentEl.textContent = t("selected_pgn_batch_completed");
  } else {
    batchCurrentEl.textContent = t("selected_pgn_batch_waiting");
  }

  if (runAllButton) {
    runAllButton.disabled = batchRunInProgress || counters.analyzable === 0 || counters.rerunnable === 0;
  }
}

function stopBatchProgressTimer() {
  if (batchProgressTimer) {
    window.clearInterval(batchProgressTimer);
    batchProgressTimer = null;
  }
}

function resetBatchProgressState() {
  stopBatchProgressTimer();
  batchProgressCurrentPlies = 0;
  batchProgressCurrentDone = 0;
  batchProgressTotalPlies = (currentBatch?.games || [])
    .filter((game) => Boolean(game?.pgn_text))
    .reduce((sum, game) => sum + Math.max(0, Number(game?.estimated_plies || 0)), 0);
  batchProgressCompletedPlies = (currentBatch?.games || [])
    .filter((game) => normalizeGameStatus(game) === "done")
    .reduce((sum, game) => sum + Math.max(0, Number(game?.estimated_plies || 0)), 0);
}

function startGameProgress(game, currentLabel) {
  stopBatchProgressTimer();
  batchProgressCurrentPlies = Math.max(1, Number(game?.estimated_plies || 1));
  batchProgressCurrentDone = 0;
  const expectedSeconds = estimateDurationSeconds(batchProgressCurrentPlies, currentBatch?.depth || 18);
  const startedAt = Date.now();

  batchProgressTimer = window.setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const ratio = Math.min(1, elapsed / Math.max(1, expectedSeconds));
    batchProgressCurrentDone = ratio < 1
      ? Math.floor(ratio * batchProgressCurrentPlies)
      : Math.max(batchProgressCurrentPlies - 1, 0);
    updateBatchProgress(currentLabel);
  }, 250);
}

function renderSummaryText() {
  if (!summaryEl) return;
  const total = currentBatch?.games.length || 0;
  if (!total) {
    summaryEl.textContent = t("selected_pgn_empty");
    return;
  }

  const counters = getBatchCounters();
  if (counters.done > 0 || counters.failed > 0 || counters.missing > 0) {
    summaryEl.textContent = t("selected_pgn_ready_with_progress", {
      count: total,
      done: counters.done,
      failed: counters.failed,
      missing: counters.missing
    });
    return;
  }
  summaryEl.textContent = t("selected_pgn_ready", { count: total });
}

function renderGames() {
  if (!listEl) return;
  const games = currentBatch?.games || [];
  if (!games.length) {
    listEl.classList.add("hidden");
    updateBatchProgress();
    return;
  }

  renderSummaryText();
  listEl.classList.remove("hidden");
  listEl.innerHTML = "";

  games.forEach((game, index) => {
    const card = document.createElement("article");
    card.className = "selected-pgn-card";

    const header = document.createElement("div");
    header.className = "selected-pgn-card-header";

    const title = document.createElement("h2");
    title.textContent = t("selected_pgn_card_title", { number: index + 1 });

    const status = getStatusCopy(normalizeGameStatus(game));
    const badge = document.createElement("span");
    badge.className = `selected-pgn-status selected-pgn-status-${status.tone}`;
    badge.textContent = status.label;

    header.append(title, badge);

    const meta = document.createElement("p");
    meta.className = "hint-inline";
    meta.textContent = formatMeta(game);

    const actions = document.createElement("div");
    actions.className = "selected-pgn-card-actions";

    const resultKey = typeof game.analysis_result_key === "string" ? game.analysis_result_key : "";
    const hasResult = normalizeGameStatus(game) === "done" && resultKey;

    const openButton = document.createElement("a");
    openButton.className = "button-link";
    openButton.textContent = hasResult ? t("selected_pgn_open_result") : t("selected_pgn_open_analysis");
    openButton.href = hasResult ? buildResultUrl(resultKey) : "pgn-analysis.html";
    if (!game.pgn_text) {
      openButton.setAttribute("aria-disabled", "true");
      openButton.classList.add("button-link-disabled");
    } else {
      openButton.addEventListener("click", () => {
        savePgnDraft(game, currentBatch.depth, currentBatch.sourceKind, resultKey);
      });
    }
    actions.appendChild(openButton);

    if (game.game_url) {
      const sourceLink = document.createElement("a");
      sourceLink.className = "button-link secondary-link";
      sourceLink.href = game.game_url;
      sourceLink.target = "_blank";
      sourceLink.rel = "noopener noreferrer";
      sourceLink.textContent = t("selected_pgn_open_source");
      actions.appendChild(sourceLink);
    }

    if (game.analysis_status === "failed" && game.analysis_error) {
      const note = document.createElement("p");
      note.className = "hint-inline selected-pgn-card-note selected-pgn-card-note-failed";
      note.textContent = t("selected_pgn_failed_reason", { error: game.analysis_error });
      card.append(header, meta, note, actions);
    } else if (!game.pgn_text) {
      const note = document.createElement("p");
      note.className = "hint-inline selected-pgn-card-note";
      note.textContent = t("selected_pgn_missing_pgn");
      card.append(header, meta, note, actions);
    } else {
      card.append(header, meta, actions);
    }

    listEl.appendChild(card);
  });

  updateBatchProgress();
}

async function analyzeGame(game) {
  const response = await fetch("/api/analysis/pgn-eval", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pgn_text: game.pgn_text, depth: currentBatch.depth })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorKey = data?.error || "analysis_failed";
    const errorMessage =
      data?.error === "invalid_pgn_format"
        ? t("pgn_analysis_error_invalid_format")
        : data?.error === "pgn_too_large" || data?.error === "payload_too_large"
          ? t("pgn_analysis_error_too_large")
          : data?.error === "rate_limited"
            ? t("pgn_analysis_error_rate_limited")
            : t("pgn_analysis_error_generic");
    const error = new Error(errorMessage);
    error.code = errorKey;
    throw error;
  }

  const rows = Array.isArray(data.rows) ? data.rows : [];
  return {
    rows,
    failedEvalCount: Number(data.failed_eval_count || 0)
  };
}

async function runBatchAnalysis() {
  if (!currentBatch || batchRunInProgress) return;
  batchRunInProgress = true;
  resetBatchProgressState();
  trackFunnelEvent("funnel_selected_pgn_batch_started", {
    games: currentBatch.games.length,
    depth: currentBatch.depth
  });
  updateBatchProgress();
  renderGames();

  for (let index = 0; index < currentBatch.games.length; index += 1) {
    const game = currentBatch.games[index];
    const currentLabel = t("selected_pgn_card_title", { number: index + 1 });
    const status = normalizeGameStatus(game);

    if (!game.pgn_text) {
      game.analysis_status = "missing";
      continue;
    }
    if (status === "done") {
      updateBatchProgress(currentLabel);
      continue;
    }

    game.analysis_status = "running";
    game.analysis_error = "";
    startGameProgress(game, currentLabel);
    updateBatchProgress(currentLabel);
    renderGames();
    saveBatch();

    try {
      const result = await analyzeGame(game);
      const resultKey = saveAnalysisResult(game, result.rows, result.failedEvalCount);
      game.analysis_status = "done";
      game.analysis_result_key = resultKey;
      game.analysis_error = "";
      game.analysis_completed_at_ms = Date.now();
    } catch (error) {
      game.analysis_status = "failed";
      game.analysis_result_key = "";
      game.analysis_error = error?.message || t("pgn_analysis_error_generic");
    }

    stopBatchProgressTimer();
    batchProgressCompletedPlies += Math.max(0, Number(game?.estimated_plies || 0));
    batchProgressCurrentDone = 0;
    batchProgressCurrentPlies = 0;
    saveBatch();
    renderGames();
  }

  stopBatchProgressTimer();
  batchProgressCurrentDone = 0;
  batchProgressCurrentPlies = 0;
  batchRunInProgress = false;
  saveBatch();
  renderGames();
  const counters = getBatchCounters();
  trackFunnelEvent("funnel_selected_pgn_batch_finished", {
    done: counters.done,
    failed: counters.failed,
    missing: counters.missing
  });
}

currentBatch = loadBatch();

if (backRawLink && currentBatch.sourceUrl) {
  backRawLink.href = currentBatch.sourceUrl;
  if (currentBatch.sourceKind === "uploaded_pgn_batch") {
    backRawLink.classList.add("hidden");
  }
}

if (runAllButton) {
  runAllButton.addEventListener("click", () => {
    runBatchAnalysis();
  });
}

window.addEventListener("languagechange", () => {
  renderGames();
});

renderGames();
