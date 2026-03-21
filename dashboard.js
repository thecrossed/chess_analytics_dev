const loadingEl = document.getElementById("dashboard-loading");
const contentEl = document.getElementById("dashboard-content");
const errorEl = document.getElementById("dashboard-error");
const summaryGridEl = document.getElementById("dashboard-summary-grid");
const latestNoteEl = document.getElementById("dashboard-latest-note");
const chartEl = document.getElementById("weekly-winrate-chart");
const chartNoteEl = document.getElementById("dashboard-chart-note");

const t = (key, params) => (window.i18n ? window.i18n.t(key, params) : key);

const SVG_NS = "http://www.w3.org/2000/svg";
const DATA_URL = "data/dashboard/magnus_chesscom_weekly_winrate_3y.json";
const DASHBOARD_COLORS = {
  background: "#f7f4ee",
  gridStrong: "#c5c9c1",
  gridSoft: "#dddcd4",
  axis: "#a8aea5",
  axisLabel: "#66706a",
  quarterGrid: "#ece8e0",
  line: "#355c52",
  lineSoft: "#52786e",
  lineText: "#23302d",
  lineHalo: "#f7f4ee"
};
let dashboardPayload = null;

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

function getNonEmptyPoints(payload) {
  return payload.points.filter((point) => point.games > 0 && typeof point.win_rate === "number");
}

function renderLatestNote(payload) {
  if (!latestNoteEl) return;
  const nonEmptyPoints = getNonEmptyPoints(payload);
  const latestPoint = nonEmptyPoints[nonEmptyPoints.length - 1];
  if (!latestPoint) {
    latestNoteEl.classList.add("hidden");
    latestNoteEl.innerHTML = "";
    return;
  }

  latestNoteEl.classList.remove("hidden");
  latestNoteEl.innerHTML = "";

  const kicker = document.createElement("p");
  kicker.className = "dashboard-latest-kicker";
  kicker.textContent = t("dashboard_latest_note_kicker");

  const body = document.createElement("p");
  body.className = "dashboard-latest-body";
  body.textContent = t("dashboard_latest_note_body", {
    week: formatWeekLabel(latestPoint.week_start),
    win_rate: formatPercent(latestPoint.win_rate),
    games: formatInteger(latestPoint.games)
  });

  latestNoteEl.append(kicker, body);
}

function renderSummary(payload) {
  if (!summaryGridEl) return;
  clearChildren(summaryGridEl);

  const nonEmptyPoints = getNonEmptyPoints(payload);
  const latestPoint = nonEmptyPoints[nonEmptyPoints.length - 1];
  const bestPoint = [...nonEmptyPoints].sort((a, b) => {
    if ((b.win_rate || 0) !== (a.win_rate || 0)) {
      return (b.win_rate || 0) - (a.win_rate || 0);
    }
    return (b.games || 0) - (a.games || 0);
  })[0];

  summaryGridEl.append(
    buildSummaryCard(t("dashboard_summary_window"), payload.window_label, t("dashboard_summary_window_detail")),
    buildSummaryCard(t("dashboard_summary_games"), formatInteger(payload.total_games), t("dashboard_summary_games_detail")),
    buildSummaryCard(t("dashboard_summary_overall"), formatPercent(payload.overall_win_rate), t("dashboard_summary_overall_detail")),
    buildSummaryCard(
      t("dashboard_summary_latest"),
      latestPoint ? formatPercent(latestPoint.win_rate) : "–",
      latestPoint ? `${formatWeekLabel(latestPoint.week_start)} • ${formatInteger(latestPoint.games)} ${t("dashboard_games_suffix")}` : t("dashboard_no_data")
    ),
    buildSummaryCard(
      t("dashboard_summary_best"),
      bestPoint ? formatPercent(bestPoint.win_rate) : "–",
      bestPoint ? `${formatWeekLabel(bestPoint.week_start)} • ${formatInteger(bestPoint.games)} ${t("dashboard_games_suffix")}` : t("dashboard_no_data")
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
      y: y + 4,
      fill: DASHBOARD_COLORS.axisLabel,
      "font-size": 12,
      "text-anchor": "end"
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
      y: height - margin.bottom + 22,
      fill: DASHBOARD_COLORS.axisLabel,
      "font-size": 12,
      "text-anchor": "middle"
    });
    label.textContent = week.toLocaleDateString("en-US", { year: "2-digit", month: "short", timeZone: "UTC" });
    chartEl.appendChild(label);
  });

  let path = "";
  points.forEach((point, index) => {
    if (typeof point.win_rate !== "number") return;
    const x = xForIndex(index);
    const y = yForValue(point.win_rate);
    path += path ? ` L ${x} ${y}` : `M ${x} ${y}`;
  });

  if (path) {
    chartEl.appendChild(
      svgEl("path", {
        d: path,
        fill: "none",
        stroke: DASHBOARD_COLORS.line,
        "stroke-width": 3,
        "stroke-linejoin": "round",
        "stroke-linecap": "round"
      })
    );
  }

  const lastIndex = [...points.keys()].reverse().find((index) => typeof points[index].win_rate === "number");
  if (typeof lastIndex === "number") {
    const point = points[lastIndex];
    const x = xForIndex(lastIndex);
    const y = yForValue(point.win_rate);
    chartEl.appendChild(
      svgEl("circle", {
        cx: x,
        cy: y,
        r: 5.5,
        fill: DASHBOARD_COLORS.line,
        stroke: DASHBOARD_COLORS.lineHalo,
        "stroke-width": 2
      })
    );

    const calloutLineY = Math.max(y - 42, margin.top + 18);
    chartEl.appendChild(svgEl("line", { x1: x, y1: y - 6, x2: x, y2: calloutLineY, stroke: DASHBOARD_COLORS.lineSoft, "stroke-width": 1.5 }));

    const latestLabel = svgEl("text", {
      x,
      y: calloutLineY - 8,
      fill: DASHBOARD_COLORS.lineText,
      "font-size": 12,
      "font-weight": 700,
      "text-anchor": "middle"
    });
    latestLabel.textContent = `${t("dashboard_latest_week")} ${formatPercent(point.win_rate)}`;
    chartEl.appendChild(latestLabel);
  }
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
    renderChart(payload);
    if (chartNoteEl) {
      chartNoteEl.textContent = t("dashboard_chart_caption", {
        source: "Chess.com PubAPI",
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
  renderChart(dashboardPayload);
  if (chartNoteEl) {
    chartNoteEl.textContent = t("dashboard_chart_caption", {
      source: "Chess.com PubAPI",
      range: dashboardPayload.window_label,
      games: formatInteger(dashboardPayload.total_games),
      games_suffix: t("dashboard_games_suffix")
    });
  }
});
