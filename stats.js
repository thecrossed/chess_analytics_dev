const summary = document.getElementById("summary");
const body = document.getElementById("stats-body");
const loading = document.getElementById("loading");
const tableWrap = document.getElementById("stats-table-wrap");
const downloadCsvButton = document.getElementById("download-csv");
const downloadRawCsvButton = document.getElementById("download-raw-csv");
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

function normalizePlatform(raw) {
  return raw === "chesscom" ? "chesscom" : "lichess";
}

function normalizeDays(raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    return 30;
  }
  return Math.min(120, Math.max(1, value));
}

function parseDateParam(raw, isEnd = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }
  const baseMs = Date.parse(`${raw}T00:00:00Z`);
  if (!Number.isFinite(baseMs)) {
    return null;
  }
  if (!isEnd) {
    return baseMs;
  }
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
const rangeLabel = `${formatDateKey(rangeFromMs)} to ${formatDateKey(rangeToMs)}`;
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

const exportRows = [];
const rawExportRows = [];
const MAX_VISIBLE_ROWS_BEFORE_SCROLL = 20;
let renderedUsernameCount = 0;

async function ensureAuthenticated() {
  const res = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (!res.ok) {
    window.location.href = "login.html";
    throw new Error("not_authenticated");
  }
  const data = await res.json();
  if (authUser) {
    authUser.textContent = t("auth_signed_in_as", { username: data.username });
  }
}

function formatDuration(ms) {
  if (typeof ms !== "number") {
    return "-";
  }

  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatDate(timestampMs) {
  if (!timestampMs) {
    return "-";
  }

  return new Date(timestampMs).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit"
  });
}

function formatRatingChange(value) {
  if (value === null) {
    return "-";
  }
  if (value > 0) {
    return `+${value}`;
  }
  return String(value);
}

function normalizeGameType(value) {
  const normalized = (value || "").toLowerCase();
  if (allowedTypes.has(normalized)) {
    return normalized;
  }
  return null;
}

function formatTypeLabel(value) {
  if (value === "bullet") return t("home_bullet");
  if (value === "blitz") return t("home_blitz");
  if (value === "rapid") return t("home_rapid");
  return value[0].toUpperCase() + value.slice(1);
}

function csvEscape(value) {
  const raw = value == null ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function downloadCsv() {
  const header = [
    t("stats_username"),
    t("stats_games"),
    t("stats_breakdown"),
    t("stats_win_rate"),
    t("stats_avg_duration"),
    t("stats_rating_change"),
    t("stats_last_played"),
    "Error"
  ];

  const lines = [header.map(csvEscape).join(",")];
  exportRows.forEach((row) => {
    lines.push(
      [
        row.username,
        row.games,
        row.breakdown,
        row.winRate,
        row.avgGameDuration,
        row.ratingChange,
        row.lastPlayed,
        row.error
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
  a.download = `game-stats-${safePlatform}-${formatDateKey(rangeFromMs)}-to-${formatDateKey(rangeToMs)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadRawCsv() {
  const header = ["Username", "Platform", "Game Type", "Result", "Played At (UTC)", "Duration Ms", "Rating Diff", "Rating"];
  const lines = [header.map(csvEscape).join(",")];
  rawExportRows.forEach((row) => {
    lines.push(
      [row.username, row.platform, row.gameType, row.result, row.playedAtUtc, row.durationMs, row.ratingDiff, row.rating]
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

function addRawRows(username, games) {
  games.forEach((g) => {
    rawExportRows.push({
      username,
      platform: platform === "chesscom" ? "Chess.com" : "Lichess",
      gameType: g.gameType || "",
      result: g.result || "",
      playedAtUtc: g.playedAt ? new Date(g.playedAt).toISOString() : "",
      durationMs: typeof g.durationMs === "number" ? String(g.durationMs) : "",
      ratingDiff: typeof g.ratingDiff === "number" ? String(g.ratingDiff) : "",
      rating: typeof g.rating === "number" ? String(g.rating) : ""
    });
  });
}

function updateTableScrollState() {
  if (!tableWrap || !body) {
    return;
  }
  const shouldScroll = Math.max(renderedUsernameCount, usernames.length) > MAX_VISIBLE_ROWS_BEFORE_SCROLL;
  tableWrap.classList.toggle("scrollable-rows", shouldScroll);
}

updateTableScrollState();

function getLichessUserPlayer(game, username) {
  const lower = username.toLowerCase();
  const whiteUser = game.players?.white?.user?.name?.toLowerCase();
  const blackUser = game.players?.black?.user?.name?.toLowerCase();

  if (whiteUser === lower) {
    return game.players?.white || null;
  }
  if (blackUser === lower) {
    return game.players?.black || null;
  }

  return null;
}

function getResultFromLichessGame(game, username) {
  const lower = username.toLowerCase();
  const whiteUser = game.players?.white?.user?.name?.toLowerCase();
  const blackUser = game.players?.black?.user?.name?.toLowerCase();

  if (game.winner) {
    const playerColor = whiteUser === lower ? "white" : blackUser === lower ? "black" : null;
    if (!playerColor) {
      return t("stats_result_unknown");
    }
    return game.winner === playerColor ? t("stats_result_win") : t("stats_result_loss");
  }

  return t("stats_result_draw");
}

function normalizeChessComResult(result) {
  if (result === "win") {
    return t("stats_result_win");
  }

  const drawResults = new Set([
    "agreed",
    "repetition",
    "stalemate",
    "insufficient",
    "50move",
    "timevsinsufficient"
  ]);

  if (drawResults.has(result)) {
    return t("stats_result_draw");
  }

  return t("stats_result_loss");
}

function parseChessComArchiveMonth(url) {
  const match = url.match(/\/(\d{4})\/(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (!year || !month || month < 1 || month > 12) {
    return null;
  }

  const monthStart = Date.UTC(year, month - 1, 1);
  const monthEnd = Date.UTC(year, month, 0, 23, 59, 59, 999);

  return {
    year,
    month,
    monthStart,
    monthEnd
  };
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

  const response = await fetch(url, {
    headers: {
      Accept: "application/x-ndjson"
    }
  });

  if (response.status === 404) {
    throw new Error("User not found on Lichess.");
  }

  if (!response.ok) {
    throw new Error(`Lichess request failed (${response.status})`);
  }

  const raw = await response.text();
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

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
        ratingDiff: typeof player?.ratingDiff === "number" ? player.ratingDiff : null,
        rating: null
      };
    })
    .filter((g) => g.playedAt > 0)
    .filter((g) => g.playedAt >= rangeFromMs && g.playedAt <= rangeToMs);
}

async function fetchChessComGamesForUser(username) {
  const normalizedUsername = username.toLowerCase();

  const archivesRes = await fetch(
    `/api/chesscom/player/${encodeURIComponent(normalizedUsername)}/games/archives`
  );
  if (archivesRes.status === 404) {
    throw new Error("User not found on Chess.com.");
  }
  if (!archivesRes.ok) {
    throw new Error(`Chess.com request failed (${archivesRes.status})`);
  }

  const archivesData = await archivesRes.json();
  const archives = Array.isArray(archivesData.archives) ? archivesData.archives : [];

  const selectedArchives = archives
    .map((url) => parseChessComArchiveMonth(url))
    .filter((archive) => archive && archive.monthEnd >= rangeFromMs && archive.monthStart <= rangeToMs);

  const archiveResponses = await Promise.all(
    selectedArchives.map(async (archive) => {
      const res = await fetch(
        `/api/chesscom/player/${encodeURIComponent(normalizedUsername)}/games/archive/${archive.year}/${String(
          archive.month
        ).padStart(2, "0")}`
      );
      if (!res.ok) {
        return [];
      }
      const data = await res.json();
      return Array.isArray(data.games) ? data.games : [];
    })
  );

  const allGames = archiveResponses.flat();

  return allGames
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

      if (!player) {
        return null;
      }

      const playedAt = (game.end_time || game.start_time || 0) * 1000;
      const durationMs =
        typeof game.start_time === "number" && typeof game.end_time === "number" && game.end_time >= game.start_time
          ? (game.end_time - game.start_time) * 1000
          : null;

      return {
        playedAt,
        gameType: normalizeGameType(game.time_class),
        durationMs,
        result: normalizeChessComResult(player.result),
        ratingDiff: null,
        rating: typeof player.rating === "number" ? player.rating : null
      };
    })
    .filter(Boolean);
}

async function fetchAndBuildGames(username) {
  if (platform === "chesscom") {
    return fetchChessComGamesForUser(username);
  }

  const lichessGames = await fetchLichessGamesForUser(username);
  return buildFromLichessGames(lichessGames, username);
}

function buildStats(games) {
  const totalGames = games.length;
  const wins = games.filter((g) => g.result === t("stats_result_win")).length;
  const winRate = totalGames === 0 ? 0 : (wins / totalGames) * 100;

  const durationValues = games.map((g) => g.durationMs).filter((ms) => typeof ms === "number");
  const avgDurationMs =
    durationValues.length === 0 ? null : Math.round(durationValues.reduce((sum, ms) => sum + ms, 0) / durationValues.length);

  const lastPlayedAt = totalGames === 0 ? 0 : games.reduce((latest, g) => Math.max(latest, g.playedAt || 0), 0);
  const typeBreakdown = {};
  selectedTypes.forEach((type) => {
    const typeGames = games.filter((g) => g.gameType === type);
    const typeWins = typeGames.filter((g) => g.result === t("stats_result_win")).length;
    const typeDurationValues = typeGames.map((g) => g.durationMs).filter((ms) => typeof ms === "number");
    const typeAvgDurationMs =
      typeDurationValues.length === 0
        ? null
        : Math.round(typeDurationValues.reduce((sum, ms) => sum + ms, 0) / typeDurationValues.length);
    const typeLastPlayedAt =
      typeGames.length === 0 ? 0 : typeGames.reduce((latest, g) => Math.max(latest, g.playedAt || 0), 0);

    let typeRatingChange = null;
    if (platform === "lichess") {
      const typeDiffs = typeGames.map((g) => g.ratingDiff).filter((value) => typeof value === "number");
      typeRatingChange = typeDiffs.length === 0 ? null : typeDiffs.reduce((sum, value) => sum + value, 0);
    } else {
      const typeRatingsByTime = typeGames
        .filter((g) => typeof g.rating === "number" && g.playedAt)
        .sort((a, b) => a.playedAt - b.playedAt);

      if (typeRatingsByTime.length >= 2) {
        const first = typeRatingsByTime[0].rating;
        const last = typeRatingsByTime[typeRatingsByTime.length - 1].rating;
        typeRatingChange = last - first;
      }
    }

    typeBreakdown[type] = {
      games: typeGames.length,
      winRate: typeGames.length === 0 ? 0 : (typeWins / typeGames.length) * 100,
      avgDurationMs: typeAvgDurationMs,
      ratingChange: typeRatingChange,
      lastPlayedAt: typeLastPlayedAt
    };
  });

  let ratingChangeInRange = null;
  if (platform === "lichess") {
    const diffs = games.map((g) => g.ratingDiff).filter((value) => typeof value === "number");
    ratingChangeInRange = diffs.length === 0 ? null : diffs.reduce((sum, value) => sum + value, 0);
  } else {
    const ratingsByTime = games
      .filter((g) => typeof g.rating === "number" && g.playedAt)
      .sort((a, b) => a.playedAt - b.playedAt);

    if (ratingsByTime.length >= 2) {
      const first = ratingsByTime[0].rating;
      const last = ratingsByTime[ratingsByTime.length - 1].rating;
      ratingChangeInRange = last - first;
    }
  }

  return {
    totalGames,
    winRate,
    avgDurationMs,
    typeBreakdown,
    ratingChangeInRange,
    lastPlayedAt
  };
}

function renderRow(username, stats, error = null) {
  if (error) {
    const tr = document.createElement("tr");
    const usernameTd = document.createElement("td");
    usernameTd.textContent = username;
    tr.appendChild(usernameTd);

    const errorTd = document.createElement("td");
    errorTd.colSpan = 6;
    const small = document.createElement("small");
    small.textContent = t("stats_load_failed", { error });
    errorTd.appendChild(small);
    tr.appendChild(errorTd);
    body.appendChild(tr);
    renderedUsernameCount += 1;
    updateTableScrollState();
    exportRows.push({
      username,
      games: "",
      breakdown: "",
      winRate: "",
      avgGameDuration: "",
      ratingChange: "",
      lastPlayed: "",
      error: `Load failed: ${error}`
    });
    return;
  }

  const rows = selectedTypes.map((type) => ({
      breakdown: formatTypeLabel(type),
      games: stats.typeBreakdown[type].games,
      winRate: stats.typeBreakdown[type].winRate,
      avgDurationMs: stats.typeBreakdown[type].avgDurationMs,
      ratingChange: stats.typeBreakdown[type].ratingChange,
      lastPlayedAt: stats.typeBreakdown[type].lastPlayedAt
    }));

  rows.forEach((row) => {
    const tr = document.createElement("tr");

    const usernameTd = document.createElement("td");
    usernameTd.textContent = username;
    tr.appendChild(usernameTd);

    const totalTd = document.createElement("td");
    totalTd.textContent = String(row.games);
    tr.appendChild(totalTd);

    const breakdownTd = document.createElement("td");
    breakdownTd.textContent = row.breakdown;
    tr.appendChild(breakdownTd);

    const winRateTd = document.createElement("td");
    winRateTd.textContent = `${row.winRate.toFixed(1)}%`;
    tr.appendChild(winRateTd);

    const avgTd = document.createElement("td");
    avgTd.textContent = formatDuration(row.avgDurationMs);
    tr.appendChild(avgTd);

    const ratingChangeTd = document.createElement("td");
    ratingChangeTd.textContent = formatRatingChange(row.ratingChange);
    tr.appendChild(ratingChangeTd);

    const lastPlayedTd = document.createElement("td");
    lastPlayedTd.textContent = formatDate(row.lastPlayedAt);
    tr.appendChild(lastPlayedTd);

    body.appendChild(tr);
    exportRows.push({
      username,
      games: String(row.games),
      breakdown: row.breakdown,
      winRate: `${row.winRate.toFixed(1)}%`,
      avgGameDuration: formatDuration(row.avgDurationMs),
      ratingChange: formatRatingChange(row.ratingChange),
      lastPlayed: formatDate(row.lastPlayedAt),
      error: ""
    });
  });
  renderedUsernameCount += 1;
  updateTableScrollState();
}

function setLoading(visible) {
  if (!loading) {
    return;
  }
  loading.classList.toggle("hidden", !visible);
}

if (downloadCsvButton) {
  downloadCsvButton.addEventListener("click", () => {
    if (exportRows.length === 0) {
      return;
    }
    downloadCsv();
  });
}

if (downloadRawCsvButton) {
  downloadRawCsvButton.addEventListener("click", () => {
    if (rawExportRows.length === 0) {
      return;
    }
    downloadRawCsv();
  });
}

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    window.location.href = "login.html";
  });
}

async function run() {
  if (usernames.length === 0) {
    setLoading(false);
    summary.textContent = t("stats_no_usernames");
    return;
  }

  const platformLabel = platform === "chesscom" ? "Chess.com" : "Lichess";
  const typeLabel = selectedTypes.map((value) => formatTypeLabel(value)).join(", ");

  setLoading(true);
  summary.textContent = t("stats_users_loading", { count: usernames.length, platform: platformLabel, types: typeLabel });

  let finished = 0;
  for (const username of usernames) {
    try {
      const games = await fetchAndBuildGames(username);
      addRawRows(username, games);
      const stats = buildStats(games);
      renderRow(username, stats);
    } catch (error) {
      renderRow(username, null, error.message || t("stats_unknown_error"));
    } finally {
      finished += 1;
      summary.textContent = t("stats_completed_progress", {
        finished,
        total: usernames.length,
        platform: platformLabel,
        types: typeLabel
      });
    }
  }

  setLoading(false);
  if (downloadCsvButton) {
    downloadCsvButton.disabled = exportRows.length === 0;
  }
  if (downloadRawCsvButton) {
    downloadRawCsvButton.disabled = rawExportRows.length === 0;
  }
  updateTableScrollState();
  summary.textContent = t("stats_completed_range", {
    finished,
    total: usernames.length,
    range: rangeLabel,
    platform: platformLabel,
    types: typeLabel
  });
}

ensureAuthenticated()
  .then(() => run())
  .catch(() => {});
