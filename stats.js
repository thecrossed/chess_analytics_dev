const summary = document.getElementById("summary");
const body = document.getElementById("stats-body");

const params = new URLSearchParams(window.location.search);
const usersParam = params.get("users") || "";
const usernames = usersParam
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

function formatDuration(ms) {
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

function getResultFromGame(game, username) {
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

async function fetchGamesForUser(username) {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const maxGames = 200;
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(
    username
  )}?since=${thirtyDaysAgo}&max=${maxGames}&clocks=true&moves=false&opening=false&pgnInJson=false`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/x-ndjson"
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }

  const raw = await response.text();
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => JSON.parse(line));
}

function buildStats(games, username) {
  const withDuration = games
    .map((game) => {
      const createdAt = game.createdAt || 0;
      const lastMoveAt = game.lastMoveAt || createdAt;
      const durationMs = Math.max(0, lastMoveAt - createdAt);

      return {
        id: game.id,
        durationMs,
        result: getResultFromGame(game, username)
      };
    })
    .filter((g) => g.durationMs >= 0);

  const totalGames = withDuration.length;
  const wins = withDuration.filter((g) => g.result === "Win").length;
  const winRate = totalGames === 0 ? 0 : (wins / totalGames) * 100;

  const totalDuration = withDuration.reduce((acc, g) => acc + g.durationMs, 0);
  const avgDurationMs = totalGames === 0 ? 0 : Math.round(totalDuration / totalGames);

  const gameDurations = withDuration.map((g, index) => {
    return `${index + 1}. ${formatDuration(g.durationMs)}（${g.result}）`;
  });

  return {
    totalGames,
    winRate,
    avgDurationMs,
    gameDurations
  };
}

function renderRow(username, stats, error = null) {
  const tr = document.createElement("tr");
  const usernameTd = document.createElement("td");
  usernameTd.textContent = username;
  tr.appendChild(usernameTd);

  if (error) {
    const errorTd = document.createElement("td");
    errorTd.colSpan = 4;
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

  const durationsTd = document.createElement("td");
  if (stats.gameDurations.length === 0) {
    const small = document.createElement("small");
    small.textContent = "No games";
    durationsTd.appendChild(small);
  } else {
    const details = document.createElement("details");
    const detailsSummary = document.createElement("summary");
    detailsSummary.textContent = `Expand to view ${stats.gameDurations.length} games`;

    const pre = document.createElement("pre");
    pre.textContent = stats.gameDurations.join("\n");

    details.append(detailsSummary, pre);
    durationsTd.appendChild(details);
  }
  tr.appendChild(durationsTd);

  body.appendChild(tr);
}

async function run() {
  if (usernames.length === 0) {
    summary.textContent = "No usernames received. Please go back to the home page and add accounts.";
    return;
  }

  summary.textContent = `${usernames.length} users total, loading...`;

  let finished = 0;
  for (const username of usernames) {
    try {
      const games = await fetchGamesForUser(username);
      const stats = buildStats(games, username);
      renderRow(username, stats);
    } catch (error) {
      renderRow(username, null, error.message || "Unknown error");
    } finally {
      finished += 1;
      summary.textContent = `Completed ${finished}/${usernames.length}`;
    }
  }

  summary.textContent = `Completed ${finished}/${usernames.length}. Range: last 30 days (up to 200 games per user).`;
}

run();
