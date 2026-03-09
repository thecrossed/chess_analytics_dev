const rawBody = document.getElementById("raw-body");
const rawSummary = document.getElementById("raw-summary");
const rawPrevPageButton = document.getElementById("raw-prev-page");
const rawNextPageButton = document.getElementById("raw-next-page");
const rawPageInfo = document.getElementById("raw-page-info");
const downloadRawCsvButton = document.getElementById("download-raw-csv");
const backStatsLink = document.getElementById("back-stats-link");
const authUser = document.getElementById("auth-user");
const logoutButton = document.getElementById("logout-btn");
const t = (key, params) => (window.i18n ? window.i18n.t(key, params) : key);

const params = new URLSearchParams(window.location.search);
const usersParam = params.get("users") || "";
const platformParam = params.get("platform") || "lichess";
const daysParam = params.get("days") || "30";
const fromParam = params.get("from") || "";
const toParam = params.get("to") || "";
const typesParam = params.get("types") || "bullet,blitz,rapid";
const usernames = usersParam
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

const RAW_PAGE_SIZE = 50;
let rawCurrentPage = 1;
const rawExportRows = [];

function normalizePlatform(raw) {
  return raw === "chesscom" ? "chesscom" : "lichess";
}

function normalizeDays(raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return 30;
  return Math.min(120, Math.max(1, value));
}

function parseDateParam(raw, isEnd = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const baseMs = Date.parse(`${raw}T00:00:00Z`);
  if (!Number.isFinite(baseMs)) return null;
  if (!isEnd) return baseMs;
  return baseMs + 24 * 60 * 60 * 1000 - 1;
}

function formatDateKey(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const platform = normalizePlatform(platformParam);
const fallbackDays = normalizeDays(daysParam);
const explicitFromMs = parseDateParam(fromParam, false);
const explicitToMs = parseDateParam(toParam, true);
const defaultToMs = Date.now();
const defaultFromMs = defaultToMs - (fallbackDays - 1) * 24 * 60 * 60 * 1000;
const MAX_RANGE_MS = (120 - 1) * 24 * 60 * 60 * 1000;
let rangeFromMs = explicitFromMs && explicitToMs && explicitFromMs <= explicitToMs ? explicitFromMs : defaultFromMs;
const rangeToMs = explicitFromMs && explicitToMs && explicitFromMs <= explicitToMs ? explicitToMs : defaultToMs;
if (rangeToMs - rangeFromMs > MAX_RANGE_MS) {
  rangeFromMs = rangeToMs - MAX_RANGE_MS;
}
const rangeFromSec = Math.floor(rangeFromMs / 1000);
const rangeToSec = Math.floor(rangeToMs / 1000);

const allowedTypes = new Set(["bullet", "blitz", "rapid"]);
const selectedTypes = Array.from(
  new Set(
    typesParam
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => allowedTypes.has(value))
  )
);
if (selectedTypes.length === 0) {
  selectedTypes.push("bullet", "blitz", "rapid");
}

function csvEscape(value) {
  const raw = value == null ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function normalizeGameType(value) {
  const normalized = (value || "").toLowerCase();
  return allowedTypes.has(normalized) ? normalized : null;
}

function getLichessUserPlayer(game, username) {
  const lower = username.toLowerCase();
  const whiteUser = game.players?.white?.user?.name?.toLowerCase();
  const blackUser = game.players?.black?.user?.name?.toLowerCase();
  if (whiteUser === lower) return game.players?.white || null;
  if (blackUser === lower) return game.players?.black || null;
  return null;
}

function getResultFromLichessGame(game, username) {
  const lower = username.toLowerCase();
  const whiteUser = game.players?.white?.user?.name?.toLowerCase();
  const blackUser = game.players?.black?.user?.name?.toLowerCase();

  if (game.winner) {
    const playerColor = whiteUser === lower ? "white" : blackUser === lower ? "black" : null;
    if (!playerColor) return t("stats_result_unknown");
    return game.winner === playerColor ? t("stats_result_win") : t("stats_result_loss");
  }
  return t("stats_result_draw");
}

function normalizeChessComResult(result) {
  if (result === "win") return t("stats_result_win");
  const drawResults = new Set(["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"]);
  if (drawResults.has(result)) return t("stats_result_draw");
  return t("stats_result_loss");
}

function parseChessComArchiveMonth(url) {
  const match = url.match(/\/(\d{4})\/(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || !month || month < 1 || month > 12) return null;
  const monthStart = Date.UTC(year, month - 1, 1);
  const monthEnd = Date.UTC(year, month, 0, 23, 59, 59, 999);
  return { year, month, monthStart, monthEnd };
}

function assignSequentialRatingDiff(games) {
  const sorted = [...games].sort((a, b) => (a.playedAt || 0) - (b.playedAt || 0));
  let previousRating = null;
  sorted.forEach((game) => {
    const currentRating = typeof game.playerRating === "number" ? game.playerRating : null;
    if (currentRating === null || previousRating === null) {
      game.ratingDiff = null;
    } else {
      game.ratingDiff = currentRating - previousRating;
    }
    if (currentRating !== null) {
      previousRating = currentRating;
    }
  });
  return sorted;
}

function parseClockToSeconds(raw) {
  const match = String(raw || "").match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseFloat(match[3]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function parseTimeControl(timeControl) {
  const match = String(timeControl || "").trim().match(/^(\d+)(?:\+(\d+))?$/);
  if (!match) return null;
  const base = Number.parseInt(match[1], 10);
  const inc = Number.parseInt(match[2] || "0", 10);
  if (!Number.isFinite(base) || !Number.isFinite(inc)) return null;
  return { base, inc };
}

function estimateDurationFromChessComPgn(pgn, timeControl) {
  const tc = parseTimeControl(timeControl);
  if (!tc || typeof pgn !== "string" || pgn.length === 0) return null;

  const clocks = [];
  const re = /\[%clk\s+(\d+:\d{2}:\d{2}(?:\.\d+)?)\]/g;
  let match;
  while ((match = re.exec(pgn)) !== null) {
    const sec = parseClockToSeconds(match[1]);
    if (sec !== null) clocks.push(sec);
  }
  if (clocks.length === 0) return null;

  let totalSpent = 0;
  let prevWhite = tc.base;
  let prevBlack = tc.base;
  for (let i = 0; i < clocks.length; i += 1) {
    const isWhitePly = i % 2 === 0;
    const current = clocks[i];
    const prev = isWhitePly ? prevWhite : prevBlack;
    const spent = prev + tc.inc - current;
    if (Number.isFinite(spent) && spent >= 0 && spent <= tc.base * 2) {
      totalSpent += spent;
    }
    if (isWhitePly) prevWhite = current;
    else prevBlack = current;
  }

  return totalSpent > 0 ? Math.round(totalSpent * 1000) : null;
}

async function fetchLichessGamesForUser(username) {
  const maxGames = 200;
  const normalizedUsername = username.toLowerCase();
  const perfTypeParam = selectedTypes.join(",");
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(
    normalizedUsername
  )}?since=${rangeFromMs}&until=${rangeToMs}&max=${maxGames}&clocks=true&moves=false&opening=false&pgnInJson=false&perfType=${encodeURIComponent(
    perfTypeParam
  )}`;

  const response = await fetch(url, { headers: { Accept: "application/x-ndjson" } });
  if (response.status === 404) throw new Error("User not found on Lichess.");
  if (!response.ok) throw new Error(`Lichess request failed (${response.status})`);

  const raw = await response.text();
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

function buildFromLichessGames(games, username) {
  return games
    .map((game) => {
      const createdAt = game.createdAt || 0;
      const lastMoveAt = game.lastMoveAt || createdAt;
      const durationMs = Math.max(0, lastMoveAt - createdAt);
      const player = getLichessUserPlayer(game, username);
      return {
        playedAt: lastMoveAt || createdAt,
        gameType: normalizeGameType(game.speed || game.perf),
        durationMs,
        result: getResultFromLichessGame(game, username),
        whiteUsername: game.players?.white?.user?.name || "",
        whiteRating: typeof game.players?.white?.rating === "number" ? game.players.white.rating : null,
        blackUsername: game.players?.black?.user?.name || "",
        blackRating: typeof game.players?.black?.rating === "number" ? game.players.black.rating : null,
        ratingDiff: typeof player?.ratingDiff === "number" ? player.ratingDiff : null,
      };
    })
    .filter((g) => g.playedAt > 0)
    .filter((g) => g.playedAt >= rangeFromMs && g.playedAt <= rangeToMs);
}

async function fetchChessComGamesForUser(username) {
  const normalizedUsername = username.toLowerCase();
  const archivesRes = await fetch(`/api/chesscom/player/${encodeURIComponent(normalizedUsername)}/games/archives`);
  if (archivesRes.status === 404) throw new Error("User not found on Chess.com.");
  if (!archivesRes.ok) throw new Error(`Chess.com request failed (${archivesRes.status})`);

  const archivesData = await archivesRes.json();
  const archives = Array.isArray(archivesData.archives) ? archivesData.archives : [];
  const selectedArchives = archives
    .map((url) => parseChessComArchiveMonth(url))
    .filter((archive) => archive && archive.monthEnd >= rangeFromMs && archive.monthStart <= rangeToMs);

  const archiveResponses = await Promise.all(
    selectedArchives.map(async (archive) => {
      const res = await fetch(
        `/api/chesscom/player/${encodeURIComponent(normalizedUsername)}/games/archive/${archive.year}/${String(archive.month).padStart(2, "0")}`
      );
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.games) ? data.games : [];
    })
  );

  const allGames = archiveResponses.flat();
  const mapped = allGames
    .filter((game) => (game.end_time || 0) >= rangeFromSec)
    .filter((game) => (game.end_time || 0) <= rangeToSec)
    .filter((game) => selectedTypes.includes((game.time_class || "").toLowerCase()))
    .map((game) => {
      const whiteUser = game.white?.username?.toLowerCase();
      const blackUser = game.black?.username?.toLowerCase();
      const lower = username.toLowerCase();
      const isWhite = whiteUser === lower;
      const isBlack = blackUser === lower;
      const player = isWhite ? game.white : isBlack ? game.black : null;
      if (!player) return null;

      const playedAt = (game.end_time || game.start_time || 0) * 1000;
      const wallDurationMs =
        typeof game.start_time === "number" && typeof game.end_time === "number" && game.end_time >= game.start_time
          ? (game.end_time - game.start_time) * 1000
          : null;
      const durationMs = wallDurationMs ?? estimateDurationFromChessComPgn(game.pgn, game.time_control);

      return {
        playedAt,
        gameType: normalizeGameType(game.time_class),
        durationMs,
        result: normalizeChessComResult(player.result),
        whiteUsername: game.white?.username || "",
        whiteRating: typeof game.white?.rating === "number" ? game.white.rating : null,
        blackUsername: game.black?.username || "",
        blackRating: typeof game.black?.rating === "number" ? game.black.rating : null,
        playerRating: typeof player.rating === "number" ? player.rating : null,
        ratingDiff: null,
      };
    })
    .filter(Boolean);
  return assignSequentialRatingDiff(mapped);
}

async function fetchAndBuildGames(username) {
  if (platform === "chesscom") return fetchChessComGamesForUser(username);
  const lichessGames = await fetchLichessGamesForUser(username);
  return buildFromLichessGames(lichessGames, username);
}

function addRawRows(username, games) {
  games.forEach((g) => {
    rawExportRows.push({
      username,
      whiteUsername: g.whiteUsername || "",
      whiteRating: typeof g.whiteRating === "number" ? String(g.whiteRating) : "",
      blackUsername: g.blackUsername || "",
      blackRating: typeof g.blackRating === "number" ? String(g.blackRating) : "",
      gameType: g.gameType || "",
      result: g.result || "",
      playedAtUtc: g.playedAt ? new Date(g.playedAt).toISOString() : "",
      durationMs: typeof g.durationMs === "number" ? String(g.durationMs) : "",
      ratingDiff: typeof g.ratingDiff === "number" ? String(g.ratingDiff) : ""
    });
  });
}

function renderRawPreview() {
  if (!rawBody) return;
  rawBody.innerHTML = "";
  const totalPages = Math.max(1, Math.ceil(rawExportRows.length / RAW_PAGE_SIZE));
  if (rawCurrentPage > totalPages) rawCurrentPage = totalPages;
  const startIndex = (rawCurrentPage - 1) * RAW_PAGE_SIZE;
  const endIndex = startIndex + RAW_PAGE_SIZE;

  rawExportRows.slice(startIndex, endIndex).forEach((row) => {
    const tr = document.createElement("tr");
    [
      row.username,
      row.whiteUsername,
      row.whiteRating,
      row.blackUsername,
      row.blackRating,
      row.gameType,
      row.result,
      row.playedAtUtc,
      row.durationMs,
      row.ratingDiff
    ].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value || "-";
      tr.appendChild(td);
    });
    rawBody.appendChild(tr);
  });

  if (rawPrevPageButton) rawPrevPageButton.disabled = rawCurrentPage <= 1;
  if (rawNextPageButton) rawNextPageButton.disabled = rawCurrentPage >= totalPages;
  if (rawPageInfo) rawPageInfo.textContent = `Page ${rawCurrentPage}/${totalPages}`;
}

function downloadRawCsv() {
  const header = [
    "Username",
    "White Player",
    "White Rating",
    "Black Player",
    "Black Rating",
    "Game Type",
    "Result",
    "Played At (UTC)",
    "Duration Ms",
    "Rating Diff"
  ];
  const lines = [header.map(csvEscape).join(",")];
  rawExportRows.forEach((row) => {
    lines.push(
      [
        row.username,
        row.whiteUsername,
        row.whiteRating,
        row.blackUsername,
        row.blackRating,
        row.gameType,
        row.result,
        row.playedAtUtc,
        row.durationMs,
        row.ratingDiff
      ]
        .map(csvEscape)
        .join(",")
    );
  });

  const csvContent = lines.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safePlatform = platform === "chesscom" ? "chesscom" : "lichess";
  a.href = url;
  a.download = `raw-games-${safePlatform}-${formatDateKey(rangeFromMs)}-to-${formatDateKey(rangeToMs)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function ensureAuthenticated() {
  const res = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (!res.ok) {
    window.location.href = "login.html";
    throw new Error("not_authenticated");
  }
  const data = await res.json();
  if (authUser) authUser.textContent = t("auth_signed_in_as", { username: data.username });
}

if (downloadRawCsvButton) {
  downloadRawCsvButton.addEventListener("click", () => {
    if (rawExportRows.length === 0) return;
    downloadRawCsv();
  });
}

if (rawPrevPageButton) {
  rawPrevPageButton.addEventListener("click", () => {
    if (rawCurrentPage <= 1) return;
    rawCurrentPage -= 1;
    renderRawPreview();
  });
}

if (rawNextPageButton) {
  rawNextPageButton.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(rawExportRows.length / RAW_PAGE_SIZE));
    if (rawCurrentPage >= totalPages) return;
    rawCurrentPage += 1;
    renderRawPreview();
  });
}

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    window.location.href = "login.html";
  });
}

if (backStatsLink) {
  backStatsLink.href = `stats.html?${params.toString()}`;
}

async function run() {
  if (usernames.length === 0) {
    if (rawSummary) rawSummary.textContent = t("stats_no_usernames");
    return;
  }

  const platformLabel = platform === "chesscom" ? "Chess.com" : "Lichess";
  if (rawSummary) rawSummary.textContent = t("stats_users_loading", { count: usernames.length, platform: platformLabel, types: selectedTypes.join(", ") });

  let finished = 0;
  for (const username of usernames) {
    try {
      const games = await fetchAndBuildGames(username);
      addRawRows(username, games);
      renderRawPreview();
    } catch (_error) {
      // keep loading others
    } finally {
      finished += 1;
    }
  }

  renderRawPreview();
  if (downloadRawCsvButton) {
    downloadRawCsvButton.disabled = rawExportRows.length === 0;
  }
  if (rawSummary) {
    rawSummary.textContent = t("stats_completed_range", {
      finished,
      total: usernames.length,
      range: `${formatDateKey(rangeFromMs)} to ${formatDateKey(rangeToMs)}`,
      platform: platformLabel,
      types: selectedTypes.join(", ")
    });
  }
}

ensureAuthenticated().then(() => run()).catch(() => {});
