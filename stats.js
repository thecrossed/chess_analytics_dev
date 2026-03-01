const summary = document.getElementById("summary");
const body = document.getElementById("stats-body");
const loading = document.getElementById("loading");

const params = new URLSearchParams(window.location.search);
const usersParam = params.get("users") || "";
const platformParam = params.get("platform") || "lichess";
const usernames = usersParam
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

function normalizePlatform(raw) {
  return raw === "chesscom" ? "chesscom" : "lichess";
}

const platform = normalizePlatform(platformParam);

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
      return "Unknown";
    }
    return game.winner === playerColor ? "Win" : "Loss";
  }

  return "Draw";
}

function normalizeChessComResult(result) {
  if (result === "win") {
    return "Win";
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
    return "Draw";
  }

  return "Loss";
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
  const sinceMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const maxGames = 200;
  const normalizedUsername = username.toLowerCase();
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(
    normalizedUsername
  )}?since=${sinceMs}&max=${maxGames}&clocks=true&moves=false&opening=false&pgnInJson=false`;

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
        durationMs,
        result: getResultFromLichessGame(game, username),
        ratingDiff: typeof player?.ratingDiff === "number" ? player.ratingDiff : null,
        rating: null
      };
    })
    .filter((g) => g.playedAt > 0);
}

async function fetchChessComGamesForUser(username) {
  const sinceMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const sinceSec = Math.floor(sinceMs / 1000);
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
    .filter((archive) => archive && archive.monthEnd >= sinceMs);

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
    .filter((game) => (game.end_time || 0) >= sinceSec)
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
  const wins = games.filter((g) => g.result === "Win").length;
  const winRate = totalGames === 0 ? 0 : (wins / totalGames) * 100;

  const durationValues = games.map((g) => g.durationMs).filter((ms) => typeof ms === "number");
  const avgDurationMs =
    durationValues.length === 0 ? null : Math.round(durationValues.reduce((sum, ms) => sum + ms, 0) / durationValues.length);

  const lastPlayedAt = totalGames === 0 ? 0 : games.reduce((latest, g) => Math.max(latest, g.playedAt || 0), 0);

  let ratingChange30d = null;
  if (platform === "lichess") {
    const diffs = games.map((g) => g.ratingDiff).filter((value) => typeof value === "number");
    ratingChange30d = diffs.length === 0 ? null : diffs.reduce((sum, value) => sum + value, 0);
  } else {
    const ratingsByTime = games
      .filter((g) => typeof g.rating === "number" && g.playedAt)
      .sort((a, b) => a.playedAt - b.playedAt);

    if (ratingsByTime.length >= 2) {
      const first = ratingsByTime[0].rating;
      const last = ratingsByTime[ratingsByTime.length - 1].rating;
      ratingChange30d = last - first;
    }
  }

  return {
    totalGames,
    winRate,
    avgDurationMs,
    ratingChange30d,
    lastPlayedAt
  };
}

function renderRow(username, stats, error = null) {
  const tr = document.createElement("tr");
  const usernameTd = document.createElement("td");
  usernameTd.textContent = username;
  tr.appendChild(usernameTd);

  if (error) {
    const errorTd = document.createElement("td");
    errorTd.colSpan = 5;
    const small = document.createElement("small");
    small.textContent = `Load failed: ${error}`;
    errorTd.appendChild(small);
    tr.appendChild(errorTd);
    body.appendChild(tr);
    return;
  }

  const totalTd = document.createElement("td");
  totalTd.textContent = String(stats.totalGames);
  tr.appendChild(totalTd);

  const winRateTd = document.createElement("td");
  winRateTd.textContent = `${stats.winRate.toFixed(1)}%`;
  tr.appendChild(winRateTd);

  const avgTd = document.createElement("td");
  avgTd.textContent = formatDuration(stats.avgDurationMs);
  tr.appendChild(avgTd);

  const ratingChangeTd = document.createElement("td");
  ratingChangeTd.textContent = formatRatingChange(stats.ratingChange30d);
  tr.appendChild(ratingChangeTd);

  const lastPlayedTd = document.createElement("td");
  lastPlayedTd.textContent = formatDate(stats.lastPlayedAt);
  tr.appendChild(lastPlayedTd);

  body.appendChild(tr);
}

function setLoading(visible) {
  if (!loading) {
    return;
  }
  loading.classList.toggle("hidden", !visible);
}

async function run() {
  if (usernames.length === 0) {
    setLoading(false);
    summary.textContent = "No usernames received. Please go back to the home page and add accounts.";
    return;
  }

  const platformLabel = platform === "chesscom" ? "Chess.com" : "Lichess";

  setLoading(true);
  summary.textContent = `${usernames.length} users total on ${platformLabel}, loading...`;

  let finished = 0;
  for (const username of usernames) {
    try {
      const games = await fetchAndBuildGames(username);
      const stats = buildStats(games);
      renderRow(username, stats);
    } catch (error) {
      renderRow(username, null, error.message || "Unknown error");
    } finally {
      finished += 1;
      summary.textContent = `Completed ${finished}/${usernames.length} (${platformLabel})`;
    }
  }

  setLoading(false);
  summary.textContent = `Completed ${finished}/${usernames.length}. Range: last 30 days (${platformLabel}).`;
}

run();
