const summary = document.getElementById("summary");
const body = document.getElementById("stats-body");
const loading = document.getElementById("loading");
const downloadCsvButton = document.getElementById("download-csv");

const params = new URLSearchParams(window.location.search);
const usersParam = params.get("users") || "";
const platformParam = params.get("platform") || "lichess";
const daysParam = params.get("days") || "30";
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
  return Math.min(90, Math.max(1, value));
}

const platform = normalizePlatform(platformParam);
const rangeDays = normalizeDays(daysParam);
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
  return value[0].toUpperCase() + value.slice(1);
}

function csvEscape(value) {
  const raw = value == null ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function downloadCsv() {
  const header = [
    "Username",
    "Games",
    "Breakdown",
    "Win Rate",
    "Avg Game Duration",
    "Rating Change (Range)",
    "Last Played",
    "Move Clocks (Latest Game)",
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
        row.moveClocks,
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
  a.download = `game-stats-${safePlatform}-${rangeDays}d.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatClockMs(ms) {
  if (typeof ms !== "number") {
    return "-";
  }

  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseClockTextToMs(clockText) {
  const parts = (clockText || "").split(":").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return (minutes * 60 + seconds) * 1000;
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  return null;
}

function buildClockTimeline(clocksMs, moveLabels) {
  if (!Array.isArray(clocksMs) || clocksMs.length === 0) {
    return [];
  }

  const lines = [];
  let whiteClock = null;
  let blackClock = null;

  clocksMs.forEach((clockMs, index) => {
    const isWhiteMove = index % 2 === 0;
    if (isWhiteMove) {
      whiteClock = clockMs;
    } else {
      blackClock = clockMs;
    }

    const ply = index + 1;
    const moveLabel = moveLabels[index] || `Ply ${ply}`;
    lines.push(`${ply}. ${moveLabel} | W ${formatClockMs(whiteClock)} | B ${formatClockMs(blackClock)}`);
  });

  return lines;
}

function buildLichessClockTimeline(game) {
  const rawClocks = Array.isArray(game.clocks) ? game.clocks : [];
  if (rawClocks.length === 0) {
    return [];
  }

  const clocksMs = rawClocks
    .map((value) => (typeof value === "number" ? value * 10 : null))
    .filter((value) => typeof value === "number");
  const moveLabels = typeof game.moves === "string" ? game.moves.split(" ").filter(Boolean) : [];

  return buildClockTimeline(clocksMs, moveLabels);
}

function buildChessComClockTimeline(game) {
  const pgn = typeof game.pgn === "string" ? game.pgn : "";
  const clkMatches = [...pgn.matchAll(/\[%clk\s+([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)\]/g)];
  if (clkMatches.length === 0) {
    return [];
  }

  const clocksMs = clkMatches
    .map((match) => parseClockTextToMs(match[1]))
    .filter((value) => typeof value === "number");
  const moveLabels = clocksMs.map((_, index) => `Ply ${index + 1}`);

  return buildClockTimeline(clocksMs, moveLabels);
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
  const sinceMs = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
  const maxGames = 200;
  const normalizedUsername = username.toLowerCase();
  const perfTypeParam = selectedTypes.join(",");
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(
    normalizedUsername
  )}?since=${sinceMs}&max=${maxGames}&clocks=true&moves=true&opening=false&pgnInJson=false&perfType=${encodeURIComponent(
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
        clockTimeline: buildLichessClockTimeline(game),
        ratingDiff: typeof player?.ratingDiff === "number" ? player.ratingDiff : null,
        rating: null
      };
    })
    .filter((g) => g.playedAt > 0);
}

async function fetchChessComGamesForUser(username) {
  const sinceMs = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
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
        clockTimeline: buildChessComClockTimeline(game),
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
  const typeBreakdown = {};
  selectedTypes.forEach((type) => {
    const typeGames = games.filter((g) => g.gameType === type);
    const typeWins = typeGames.filter((g) => g.result === "Win").length;
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
      lastPlayedAt: typeLastPlayedAt,
      latestGameClockTimeline:
        typeGames.length === 0
          ? []
          : (typeGames.reduce((latest, current) => {
              if (!latest) {
                return current;
              }
              return (current.playedAt || 0) > (latest.playedAt || 0) ? current : latest;
            }, null)?.clockTimeline || [])
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

  const latestGame =
    totalGames === 0
      ? null
      : games.reduce((latest, current) => {
          if (!latest) {
            return current;
          }
          return (current.playedAt || 0) > (latest.playedAt || 0) ? current : latest;
        }, null);
  const latestGameClockTimeline = latestGame?.clockTimeline || [];

  return {
    totalGames,
    winRate,
    avgDurationMs,
    typeBreakdown,
    ratingChangeInRange,
    lastPlayedAt,
    latestGameClockTimeline
  };
}

function renderRow(username, stats, error = null) {
  if (error) {
    const tr = document.createElement("tr");
    const usernameTd = document.createElement("td");
    usernameTd.textContent = username;
    tr.appendChild(usernameTd);

    const errorTd = document.createElement("td");
    errorTd.colSpan = 7;
    const small = document.createElement("small");
    small.textContent = `Load failed: ${error}`;
    errorTd.appendChild(small);
    tr.appendChild(errorTd);
    body.appendChild(tr);
    exportRows.push({
      username,
      games: "",
      breakdown: "",
      winRate: "",
      avgGameDuration: "",
      ratingChange: "",
      lastPlayed: "",
      moveClocks: "",
      error: `Load failed: ${error}`
    });
    return;
  }

  const rows = [
    {
      breakdown: "Overall",
      games: stats.totalGames,
      winRate: stats.winRate,
      avgDurationMs: stats.avgDurationMs,
      ratingChange: stats.ratingChangeInRange,
      lastPlayedAt: stats.lastPlayedAt,
      latestGameClockTimeline: stats.latestGameClockTimeline
    }
  ].concat(
    selectedTypes.map((type) => ({
      breakdown: formatTypeLabel(type),
      games: stats.typeBreakdown[type].games,
      winRate: stats.typeBreakdown[type].winRate,
      avgDurationMs: stats.typeBreakdown[type].avgDurationMs,
      ratingChange: stats.typeBreakdown[type].ratingChange,
      lastPlayedAt: stats.typeBreakdown[type].lastPlayedAt,
      latestGameClockTimeline: stats.typeBreakdown[type].latestGameClockTimeline
    }))
  );

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

    const clocksTd = document.createElement("td");
    if (row.latestGameClockTimeline.length === 0) {
      clocksTd.textContent = "-";
    } else {
      const details = document.createElement("details");
      const detailsSummary = document.createElement("summary");
      detailsSummary.textContent = `Show ${row.latestGameClockTimeline.length} plies`;
      const small = document.createElement("small");
      row.latestGameClockTimeline.forEach((line, lineIndex) => {
        if (lineIndex > 0) {
          small.appendChild(document.createElement("br"));
        }
        small.appendChild(document.createTextNode(line));
      });
      details.appendChild(detailsSummary);
      details.appendChild(small);
      clocksTd.appendChild(details);
    }
    tr.appendChild(clocksTd);

    body.appendChild(tr);
    exportRows.push({
      username,
      games: String(row.games),
      breakdown: row.breakdown,
      winRate: `${row.winRate.toFixed(1)}%`,
      avgGameDuration: formatDuration(row.avgDurationMs),
      ratingChange: formatRatingChange(row.ratingChange),
      lastPlayed: formatDate(row.lastPlayedAt),
      moveClocks: row.latestGameClockTimeline.join(" | "),
      error: ""
    });
  });
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

async function run() {
  if (usernames.length === 0) {
    setLoading(false);
    summary.textContent = "No usernames received. Please go back to the home page and add accounts.";
    return;
  }

  const platformLabel = platform === "chesscom" ? "Chess.com" : "Lichess";
  const typeLabel = selectedTypes.map((value) => formatTypeLabel(value)).join(", ");

  setLoading(true);
  summary.textContent = `${usernames.length} users total on ${platformLabel} (${typeLabel}), loading...`;

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
      summary.textContent = `Completed ${finished}/${usernames.length} (${platformLabel}, ${typeLabel})`;
    }
  }

  setLoading(false);
  if (downloadCsvButton) {
    downloadCsvButton.disabled = exportRows.length === 0;
  }
  summary.textContent = `Completed ${finished}/${usernames.length}. Range: last ${rangeDays} days (${platformLabel}, ${typeLabel}).`;
}

run();
