const SELECTED_PGN_BATCH_KEY = "selected_pgn_analysis_batch_v1";
const PGN_ANALYSIS_DRAFT_KEY = "pgn_analysis_draft_v1";

const summaryEl = document.getElementById("selected-pgn-summary");
const listEl = document.getElementById("selected-pgn-list");
const backRawLink = document.getElementById("selected-pgn-back-raw");

const t = (key, params) => (window.i18n ? window.i18n.t(key, params) : key);

function loadBatch() {
  const raw = sessionStorage.getItem(SELECTED_PGN_BATCH_KEY);
  if (!raw) return { games: [], sourceUrl: "" };
  try {
    const parsed = JSON.parse(raw);
    return {
      games: Array.isArray(parsed?.games) ? parsed.games : [],
      sourceUrl: typeof parsed?.source_url === "string" ? parsed.source_url : ""
    };
  } catch (_error) {
    return { games: [], sourceUrl: "" };
  }
}

function savePgnDraft(game) {
  sessionStorage.setItem(
    PGN_ANALYSIS_DRAFT_KEY,
    JSON.stringify({
      pgn_text: game.pgn_text,
      depth: 18,
      source: "raw_selected_game",
      saved_at_ms: Date.now()
    })
  );
}

function formatMeta(game) {
  const parts = [];
  if (game.username) parts.push(`${t("stats_username")}: ${game.username}`);
  if (game.white_username || game.black_username) {
    parts.push(`${game.white_username || "?"} vs ${game.black_username || "?"}`);
  }
  if (game.played_at_utc) parts.push(game.played_at_utc);
  if (game.game_type) parts.push(game.game_type);
  return parts.join(" | ");
}

function renderGames(games) {
  if (!summaryEl || !listEl) return;
  if (!games.length) {
    summaryEl.textContent = t("selected_pgn_empty");
    listEl.classList.add("hidden");
    return;
  }

  summaryEl.textContent = t("selected_pgn_ready", { count: games.length });
  listEl.classList.remove("hidden");
  listEl.innerHTML = "";

  games.forEach((game, index) => {
    const card = document.createElement("article");
    card.className = "selected-pgn-card";

    const title = document.createElement("h2");
    title.textContent = t("selected_pgn_card_title", { number: index + 1 });

    const meta = document.createElement("p");
    meta.className = "hint-inline";
    meta.textContent = formatMeta(game);

    const actions = document.createElement("div");
    actions.className = "selected-pgn-card-actions";

    const openButton = document.createElement("a");
    openButton.className = "button-link";
    openButton.href = "pgn-analysis.html";
    openButton.textContent = t("selected_pgn_open_analysis");
    if (!game.pgn_text) {
      openButton.setAttribute("aria-disabled", "true");
      openButton.classList.add("button-link-disabled");
    } else {
      openButton.addEventListener("click", (event) => {
        savePgnDraft(game);
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

    if (!game.pgn_text) {
      const note = document.createElement("p");
      note.className = "hint-inline";
      note.textContent = t("selected_pgn_missing_pgn");
      card.append(title, meta, note, actions);
    } else {
      card.append(title, meta, actions);
    }

    listEl.appendChild(card);
  });
}

const batch = loadBatch();
if (backRawLink && batch.sourceUrl) {
  backRawLink.href = batch.sourceUrl;
}
renderGames(batch.games);
