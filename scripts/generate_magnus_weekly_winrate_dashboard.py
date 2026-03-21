#!/usr/bin/env python3
from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


API_ROOT = "https://api.chess.com/pub/player/{username}/games"
USER_AGENT = "chess-data-dashboard/1.0"
DRAW_RESULTS = {"agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"}
OUTCOME_BUCKETS = {"win": "wins", "draw": "draws", "loss": "losses"}
PLAYERS = [
    {
        "username": "MagnusCarlsen",
        "full_name": "Magnus Carlsen",
        "short_name": "Carlsen",
        "color": "#355c52",
    },
    {
        "username": "Hikaru",
        "full_name": "Hikaru Nakamura",
        "short_name": "Nakamura",
        "color": "#8f6c51",
    },
    {
        "username": "FabianoCaruana",
        "full_name": "Fabiano Caruana",
        "short_name": "Caruana",
        "color": "#4d6a87",
    },
    {
        "username": "VincentKeymer",
        "full_name": "Vincent Keymer",
        "short_name": "Keymer",
        "color": "#7a8f62",
    },
    {
        "username": "ChessWarrior7197",
        "full_name": "Nodirbek Abdusattorov",
        "short_name": "Abdusattorov",
        "color": "#7f5d78",
    },
]


@dataclass(frozen=True)
class Window:
    start: datetime
    end: datetime


def fetch_json(url: str) -> dict[str, Any]:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def parse_archive_sort_key(url: str) -> tuple[int, int]:
    parts = [part for part in urlparse(url).path.split("/") if part]
    return int(parts[-2]), int(parts[-1])


def latest_three_year_window(today_utc: date | None = None) -> Window:
    end_date = today_utc or datetime.now(UTC).date()
    try:
        start_date = end_date.replace(year=end_date.year - 3)
    except ValueError:
        start_date = end_date.replace(month=2, day=28, year=end_date.year - 3)
    start_dt = datetime.combine(start_date, time.min, UTC)
    end_dt = datetime.combine(end_date, time.max, UTC)
    return Window(start=start_dt, end=end_dt)


def fetch_archives_for_window(username: str, window: Window) -> list[str]:
    archives_url = f"{API_ROOT.format(username=username)}/archives"
    archives_payload = fetch_json(archives_url)
    archives = archives_payload.get("archives", [])
    selected: list[str] = []
    for archive_url in archives:
        year, month = parse_archive_sort_key(archive_url)
        month_start = datetime(year, month, 1, tzinfo=UTC)
        if month == 12:
            next_month = datetime(year + 1, 1, 1, tzinfo=UTC)
        else:
            next_month = datetime(year, month + 1, 1, tzinfo=UTC)
        month_end = next_month - timedelta(microseconds=1)
        if month_end < window.start or month_start > window.end:
            continue
        selected.append(archive_url)
    return sorted(selected, key=parse_archive_sort_key)


def classify_player_result(game: dict[str, Any], username: str) -> str | None:
    normalized = username.lower()
    white = (game.get("white") or {}).get("username", "").lower()
    black = (game.get("black") or {}).get("username", "").lower()
    if white == normalized:
        result = (game.get("white") or {}).get("result", "")
    elif black == normalized:
        result = (game.get("black") or {}).get("result", "")
    else:
        return None

    if result == "win":
        return "win"
    if result in DRAW_RESULTS:
        return "draw"
    return "loss"


def iso_week_start(dt: datetime) -> date:
    return (dt - timedelta(days=dt.weekday())).date()


def generate_week_starts(window: Window) -> list[date]:
    current = iso_week_start(window.start)
    last = iso_week_start(window.end)
    weeks: list[date] = []
    while current <= last:
        weeks.append(current)
        current += timedelta(days=7)
    return weeks


def fetch_games_for_window(username: str, window: Window) -> list[dict[str, Any]]:
    games: list[dict[str, Any]] = []
    for archive_url in fetch_archives_for_window(username, window):
        try:
            month_payload = fetch_json(archive_url)
        except HTTPError as exc:
            if exc.code == 404:
                print(f"Skipping missing archive for {username}: {archive_url}")
                continue
            raise
        games.extend(month_payload.get("games", []))
    return games


def build_payload(players: list[dict[str, str]], all_games: dict[str, list[dict[str, Any]]], window: Window) -> dict[str, Any]:
    weekly_by_player: dict[str, dict[date, dict[str, int]]] = {}
    player_summaries: list[dict[str, Any]] = []
    total_games = 0

    for player in players:
        username = player["username"]
        weekly: dict[date, dict[str, int]] = defaultdict(lambda: {"wins": 0, "draws": 0, "losses": 0, "games": 0})
        included_games = 0

        for game in all_games[username]:
            end_time = game.get("end_time")
            if not end_time:
                continue
            ended_at = datetime.fromtimestamp(int(end_time), UTC)
            if ended_at < window.start or ended_at > window.end:
                continue
            outcome = classify_player_result(game, username)
            if outcome is None:
                continue
            week_start = iso_week_start(ended_at)
            bucket = weekly[week_start]
            bucket[OUTCOME_BUCKETS[outcome]] += 1
            bucket["games"] += 1
            included_games += 1

        weekly_by_player[username] = weekly
        total_games += included_games
        total_wins = sum(bucket["wins"] for bucket in weekly.values())
        player_summaries.append(
            {
                **player,
                "total_games": included_games,
                "overall_win_rate": round(total_wins / included_games, 4) if included_games else None,
            }
        )

    points = []
    for week_start in generate_week_starts(window):
        week_series: dict[str, Any] = {}
        week_games = 0
        for player in players:
            username = player["username"]
            bucket = weekly_by_player[username][week_start]
            games_count = bucket["games"]
            week_games += games_count
            week_series[username] = {
                "games": games_count,
                "wins": bucket["wins"],
                "draws": bucket["draws"],
                "losses": bucket["losses"],
                "win_rate": round(bucket["wins"] / games_count, 4) if games_count else None,
            }
        points.append({"week_start": week_start.isoformat(), "total_games": week_games, "series": week_series})

    return {
        "source": "Chess.com PubAPI",
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "range_start_utc": window.start.isoformat(),
        "range_end_utc": window.end.isoformat(),
        "window_label": f"{window.start.date().isoformat()} to {window.end.date().isoformat()}",
        "metric": "weekly_win_rate",
        "total_games": total_games,
        "player_count": len(players),
        "players": player_summaries,
        "points": points,
    }


def main() -> int:
    window = latest_three_year_window()
    output_path = Path("data/dashboard/top5_chesscom_weekly_winrate_3y.json")
    all_games: dict[str, list[dict[str, Any]]] = {}

    try:
        for player in PLAYERS:
            all_games[player["username"]] = fetch_games_for_window(player["username"], window)
    except HTTPError as exc:
        print(f"HTTP error while fetching Chess.com API: {exc.code} {exc.reason}")
        return 1
    except URLError as exc:
        print(f"Network error while fetching Chess.com API: {exc.reason}")
        return 1

    payload = build_payload(PLAYERS, all_games, window)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {payload['total_games']} games across {payload['player_count']} players into {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
