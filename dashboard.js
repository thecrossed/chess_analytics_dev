const loadingEl = document.getElementById("dashboard-loading");
const contentEl = document.getElementById("dashboard-content");
const errorEl = document.getElementById("dashboard-error");
const summaryGridEl = document.getElementById("dashboard-summary-grid");
const latestNoteEl = document.getElementById("dashboard-latest-note");
const legendEl = document.getElementById("dashboard-legend");
const chartEl = document.getElementById("weekly-winrate-chart");
const chartNoteEl = document.getElementById("dashboard-chart-note");

const t = (key, params) => (window.i18n ? window.i18n.t(key, params) : key);

const SVG_NS = "http://www.w3.org/2000/svg";
const DATA_URL = "data/dashboard/top5_chesscom_weekly_winrate_3y.json";
let dashboardPayload = null;
let activePlayerUsername = null;
const DASHBOARD_COLORS = {
  background: "#f7f4ee",
  gridStrong: "#c5c9c1",
  gridSoft: "#dddcd4",
  axis: "#a8aea5",
  axisLabel: "#66706a",
  quarterGrid: "#ece8e0",
  lineHalo: "#f7f4ee",
  lineText: "#23302d"
};

function formatPercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "–";
  return `${(value * 100).toFixed(1)}%`;
}

function formatInteger(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "–";
  return new Intl.NumberFormat("en-US").format(value);
}

function formatWeekLabel(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

function clearChildren(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => {
    node.setAttribute(key, String(value));
  });
  return node;
}

function buildSummaryCard(label, value, detail) {
  const card = document.createElement("div");
  card.className = "dashboard-summary-card";

  const labelEl = document.createElement("p");
  labelEl.className = "dashboard-summary-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("p");
  valueEl.className = "dashboard-summary-value";
  valueEl.textContent = value;

  const detailEl = document.createElement("p");
  detailEl.className = "dashboard-summary-detail";
  detailEl.textContent = detail;

  card.append(labelEl, valueEl, detailEl);
  return card;
}

function getPointSeries(point, username) {
  return point?.series?.[username] || null;
}

function getNonEmptyWeeks(payload) {
  return payload.points.filter((point) =>
    payload.players.some((player) => (getPointSeries(point, player.username)?.games || 0) > 0)
  );
}

function getLatestWeekLeader(payload) {
  const latestWeek = [...getNonEmptyWeeks(payload)].reverse()[0];
  if (!latestWeek) return null;

  const ranked = payload.players
    .map((player) => {
      const series = getPointSeries(latestWeek, player.username);
      return { player, series };
    })
    .filter(({ series }) => series && series.games > 0 && typeof series.win_rate === "number")
    .sort((a, b) => {
      if (b.series.win_rate !== a.series.win_rate) return b.series.win_rate - a.series.win_rate;
      return b.series.games - a.series.games;
    });

  if (!ranked.length) return null;
  return { week: latestWeek.week_start, player: ranked[0].player, series: ranked[0].series };
}

function getLatestPointForPlayer(payload, username) {
  for (let index = payload.points.length - 1; index >= 0; index -= 1) {
    const point = payload.points[index];
    const series = getPointSeries(point, username);
    if (series && series.games > 0 && typeof series.win_rate === "number") {
      const player = payload.players.find((entry) => entry.username === username);
      if (!player) return null;
      return { week: point.week_start, player, series };
    }
  }
  return null;
}

function getOverallLeader(payload) {
  return [...payload.players]
    .filter((player) => typeof player.overall_win_rate === "number")
    .sort((a, b) => {
      if (b.overall_win_rate !== a.overall_win_rate) return b.overall_win_rate - a.overall_win_rate;
      return b.total_games - a.total_games;
    })[0] || null;
}

function getBestSingleWeek(payload) {
  const candidates = [];
  payload.points.forEach((point) => {
    payload.players.forEach((player) => {
      const series = getPointSeries(point, player.username);
      if (!series || series.games <= 0 || typeof series.win_rate !== "number") return;
      candidates.push({ week: point.week_start, player, series });
    });
  });

  return (
    candidates.sort((a, b) => {
      if (b.series.win_rate !== a.series.win_rate) return b.series.win_rate - a.series.win_rate;
      return b.series.games - a.series.games;
    })[0] || null
  );
}

function isPlayerHighlighted(username) {
  return !activePlayerUsername || activePlayerUsername === username;
}

function setActivePlayer(username) {
  activePlayerUsername = activePlayerUsername === username ? null : username;
  if (!dashboardPayload) return;
  renderLegend(dashboardPayload);
  renderLatestNote(dashboardPayload);
  renderChart(dashboardPayload);
}

function renderLegend(payload) {
  if (!legendEl) return;
  clearChildren(legendEl);
  payload.players.forEach((player) => {
    const item = document.createElement("button");
    const highlighted = isPlayerHighlighted(player.username);
    item.className = "dashboard-legend-item";
    item.type = "button";
    item.setAttribute("aria-pressed", activePlayerUsername === player.username ? "true" : "false");
    if (activePlayerUsername === player.username) {
      item.classList.add("is-active");
    } else if (!highlighted) {
      item.classList.add("is-dimmed");
    }
    item.addEventListener("click", () => {
      setActivePlayer(player.username);
    });

    const swatch = document.createElement("span");
    swatch.className = "dashboard-legend-swatch";
    swatch.style.backgroundColor = player.color;

    const name = document.createElement("span");
    name.className = "dashboard-legend-name";
    name.textContent = player.full_name;

    const meta = document.createElement("span");
    meta.className = "dashboard-legend-meta";
    meta.textContent = `${formatPercent(player.overall_win_rate)} • ${formatInteger(player.total_games)} ${t("dashboard_games_suffix")}`;

    const copy = document.createElement("div");
    copy.className = "dashboard-legend-copy";
    copy.append(name, meta);

    item.append(swatch, copy);
    legendEl.appendChild(item);
  });
}

function renderLatestNote(payload) {
  if (!latestNoteEl) return;
  const leader = activePlayerUsername ? getLatestPointForPlayer(payload, activePlayerUsername) : getLatestWeekLeader(payload);
  if (!leader) {
    latestNoteEl.classList.add("hidden");
    latestNoteEl.textContent = "";
    return;
  }

  latestNoteEl.classList.remove("hidden");
  latestNoteEl.innerHTML =
    `<p class="dashboard-latest-kicker">${t("dashboard_latest_note_kicker")}</p>` +
    `<p class="dashboard-latest-body">${t("dashboard_latest_note_body", {
      player: leader.player.full_name,
      week: formatWeekLabel(leader.week),
      win_rate: formatPercent(leader.series.win_rate),
      games: formatInteger(leader.series.games)
    })}</p>`;
}

function renderSummary(payload) {
  if (!summaryGridEl) return;
  clearChildren(summaryGridEl);

  const overallLeader = getOverallLeader(payload);
  const latestLeader = getLatestWeekLeader(payload);
  const bestSingleWeek = getBestSingleWeek(payload);

  summaryGridEl.append(
    buildSummaryCard(
      t("dashboard_summary_window"),
      payload.window_label,
      t("dashboard_summary_window_detail")
    ),
    buildSummaryCard(
      t("dashboard_summary_players"),
      formatInteger(payload.player_count),
      t("dashboard_summary_players_detail")
    ),
    buildSummaryCard(
      t("dashboard_summary_games"),
      formatInteger(payload.total_games),
      t("dashboard_summary_games_detail")
    ),
    buildSummaryCard(
      t("dashboard_summary_overall"),
      overallLeader ? overallLeader.short_name : "–",
      overallLeader ? `${formatPercent(overallLeader.overall_win_rate)} • ${formatInteger(overallLeader.total_games)} ${t("dashboard_games_suffix")}` : t("dashboard_no_data")
    ),
    buildSummaryCard(
      t("dashboard_summary_latest"),
      latestLeader ? latestLeader.player.short_name : "–",
      latestLeader ? `${formatPercent(latestLeader.series.win_rate)} • ${formatWeekLabel(latestLeader.week)}` : t("dashboard_no_data")
    ),
    buildSummaryCard(
      t("dashboard_summary_best"),
      bestSingleWeek ? bestSingleWeek.player.short_name : "–",
      bestSingleWeek ? `${formatPercent(bestSingleWeek.series.win_rate)} • ${formatWeekLabel(bestSingleWeek.week)}` : t("dashboard_no_data")
    )
  );
}

function renderChart(payload) {
  if (!chartEl) return;
  clearChildren(chartEl);

  const width = 960;
  const height = 440;
  const margin = { top: 34, right: 28, bottom: 56, left: 58 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const points = payload.points;
  const xDenominator = Math.max(points.length - 1, 1);

  const xForIndex = (index) => margin.left + (index / xDenominator) * innerWidth;
  const yForValue = (value) => margin.top + (1 - value) * innerHeight;

  chartEl.appendChild(svgEl("rect", { x: 0, y: 0, width, height, fill: DASHBOARD_COLORS.background }));

  [0, 0.25, 0.5, 0.75, 1].forEach((tick) => {
    const y = yForValue(tick);
    chartEl.appendChild(
      svgEl("line", {
        x1: margin.left,
        y1: y,
        x2: width - margin.right,
        y2: y,
        stroke: tick === 0.5 ? DASHBOARD_COLORS.gridStrong : DASHBOARD_COLORS.gridSoft,
        "stroke-width": 1
      })
    );

    const label = svgEl("text", {
      x: margin.left - 10,
      y,
      fill: DASHBOARD_COLORS.axisLabel,
      "font-size": 12,
      "text-anchor": "end",
      "dominant-baseline": "middle"
    });
    label.textContent = `${Math.round(tick * 100)}%`;
    chartEl.appendChild(label);
  });

  const xAxisY = height - margin.bottom;
  chartEl.appendChild(
    svgEl("line", {
      x1: margin.left,
      y1: xAxisY,
      x2: width - margin.right,
      y2: xAxisY,
      stroke: DASHBOARD_COLORS.axis,
      "stroke-width": 1
    })
  );

  points.forEach((point, index) => {
    const week = new Date(`${point.week_start}T00:00:00Z`);
    if (week.getUTCMonth() % 3 !== 0 || week.getUTCDate() > 7) {
      return;
    }
    const x = xForIndex(index);
    chartEl.appendChild(svgEl("line", { x1: x, y1: margin.top, x2: x, y2: xAxisY, stroke: DASHBOARD_COLORS.quarterGrid, "stroke-width": 1 }));
    const label = svgEl("text", {
      x,
      y: height - margin.bottom + 16,
      fill: DASHBOARD_COLORS.axisLabel,
      "font-size": 12,
      "text-anchor": "middle",
      "dominant-baseline": "hanging"
    });
    label.textContent = week.toLocaleDateString("en-US", { year: "2-digit", month: "short", timeZone: "UTC" });
    chartEl.appendChild(label);
  });

  payload.players.forEach((player) => {
    let path = "";
    const highlighted = isPlayerHighlighted(player.username);
    points.forEach((point, index) => {
      const series = getPointSeries(point, player.username);
      if (!series || typeof series.win_rate !== "number") return;
      const x = xForIndex(index);
      const y = yForValue(series.win_rate);
      path += path ? ` L ${x} ${y}` : `M ${x} ${y}`;
    });

    if (!path) return;
    chartEl.appendChild(
      svgEl("path", {
        d: path,
        fill: "none",
        stroke: player.color,
        "stroke-width": highlighted ? 4 : 2.5,
        "stroke-opacity": highlighted ? 1 : 0.18,
        "stroke-linejoin": "round",
        "stroke-linecap": "round"
      })
    );
  });

  const latestLeader = activePlayerUsername ? getLatestPointForPlayer(payload, activePlayerUsername) : getLatestWeekLeader(payload);
  if (!latestLeader) return;
  const pointIndex = points.findIndex((point) => point.week_start === latestLeader.week);
  if (pointIndex === -1) return;
  const x = xForIndex(pointIndex);
  const y = yForValue(latestLeader.series.win_rate);

  chartEl.appendChild(
    svgEl("circle", {
      cx: x,
      cy: y,
      r: 5.5,
      fill: latestLeader.player.color,
      stroke: DASHBOARD_COLORS.lineHalo,
      "stroke-width": 2
    })
  );

  const calloutLineY = Math.max(y - 52, margin.top + 20);
  chartEl.appendChild(svgEl("line", { x1: x, y1: y - 6, x2: x, y2: calloutLineY, stroke: latestLeader.player.color, "stroke-width": 1.5 }));

  const latestLabelAnchor =
    x > width - margin.right - 120 ? "end" :
    x < margin.left + 120 ? "start" :
    "middle";
  const latestLabelX =
    latestLabelAnchor === "end" ? x - 14 :
    latestLabelAnchor === "start" ? x + 14 :
    x;

  const latestLabel = svgEl("text", {
    x: latestLabelX,
    y: calloutLineY - 12,
    fill: DASHBOARD_COLORS.lineText,
    "font-size": 12,
    "font-weight": 700,
    "text-anchor": latestLabelAnchor
  });
  latestLabel.textContent = `${latestLeader.player.short_name} ${formatPercent(latestLeader.series.win_rate)}`;
  chartEl.appendChild(latestLabel);
}

async function loadDashboard() {
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    dashboardPayload = payload;
    renderSummary(payload);
    renderLatestNote(payload);
    renderLegend(payload);
    renderChart(payload);
    if (chartNoteEl) {
      chartNoteEl.textContent = t("dashboard_chart_caption", {
        source: payload.source,
        range: payload.window_label,
        games: formatInteger(payload.total_games),
        games_suffix: t("dashboard_games_suffix")
      });
    }
    loadingEl?.classList.add("hidden");
    contentEl?.classList.remove("hidden");
  } catch (_error) {
    loadingEl?.classList.add("hidden");
    errorEl?.classList.remove("hidden");
  }
}

loadDashboard();

window.addEventListener("languagechange", () => {
  if (!dashboardPayload) return;
  renderSummary(dashboardPayload);
  renderLatestNote(dashboardPayload);
  renderLegend(dashboardPayload);
  renderChart(dashboardPayload);
  if (chartNoteEl) {
    chartNoteEl.textContent = t("dashboard_chart_caption", {
      source: dashboardPayload.source,
      range: dashboardPayload.window_label,
      games: formatInteger(dashboardPayload.total_games),
      games_suffix: t("dashboard_games_suffix")
    });
  }
});
