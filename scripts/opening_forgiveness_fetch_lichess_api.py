#!/usr/bin/env python3
"""Fetch small Lichess API batches and append them to the manifest."""

from __future__ import annotations

import argparse
import csv
import json
import re
import urllib.parse
import urllib.request
from urllib.error import HTTPError, URLError
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST = ROOT_DIR / "book" / "opening_forgiveness_manifest.csv"
DEFAULT_OUTPUT_DIR = ROOT_DIR / "book" / "opening_forgiveness_pgn"
USER_AGENT = "ChessAnalytics/1.0 (opening forgiveness MVP)"


def pgn_tags(pgn_text: str) -> dict[str, str]:
    tags: dict[str, str] = {}
    for match in re.finditer(r'^\[([A-Za-z0-9_]+)\s+"([^"]*)"\]\s*$', pgn_text, re.MULTILINE):
        tags[match.group(1)] = match.group(2)
    return tags


def opening_family_from_tag(tags: dict[str, str]) -> str:
    name = str(tags.get("Opening") or "").strip()
    if name:
        return name.split(":", 1)[0].strip()
    eco = str(tags.get("ECO") or "").strip()
    return eco or "Unknown Opening"


def normalize_month(date_text: str) -> str:
    text = (date_text or "").strip()
    if re.fullmatch(r"\d{4}\.\d{2}\.\d{2}", text):
        return text[:7].replace(".", "-")
    return text or "unknown"


def read_manifest(path: Path) -> tuple[list[dict[str, str]], list[str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        return list(reader), list(reader.fieldnames or [])


def write_manifest(path: Path, rows: list[dict[str, str]], fieldnames: list[str]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def fetch_games(username: str, max_games: int, since: str | None, until: str | None) -> list[str]:
    base_url = f"https://lichess.org/api/games/user/{urllib.parse.quote(username)}"
    params = {
        "max": str(max_games),
        "perfType": "blitz,rapid",
        "rated": "true",
        "pgnInJson": "true",
        "opening": "true",
        "moves": "true",
        "clocks": "false",
        "evals": "false",
    }
    if since:
        params["since"] = since
    if until:
        params["until"] = until
    url = f"{base_url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/x-ndjson",
            "User-Agent": USER_AGENT,
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read().decode("utf-8")
    except (HTTPError, URLError):
        return []
    games: list[str] = []
    for line in payload.splitlines():
        line = line.strip()
        if not line:
            continue
        data = json.loads(line)
        pgn = str(data.get("pgn") or "").strip()
        if pgn:
            games.append(pgn)
    return games


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch Lichess API PGNs and append them to the manifest.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--usernames", nargs="+", required=True)
    parser.add_argument("--max-games-per-user", type=int, default=20)
    parser.add_argument("--since")
    parser.add_argument("--until")
    args = parser.parse_args()

    manifest_path = args.manifest.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    rows, fieldnames = read_manifest(manifest_path)
    existing_ids = {str(row.get("game_id") or "").strip() for row in rows}
    added = 0
    attempted_users: list[str] = []
    successful_users: list[str] = []

    for username in args.usernames:
        attempted_users.append(username)
        fetched_games = fetch_games(
            username=username,
            max_games=args.max_games_per_user,
            since=args.since,
            until=args.until,
        )
        if fetched_games:
            successful_users.append(username)
        for pgn in fetched_games:
            tags = pgn_tags(pgn)
            game_id = str(tags.get("Site") or "").strip().rsplit("/", 1)[-1]
            if not game_id or game_id in existing_ids:
                continue

            opening_family = opening_family_from_tag(tags)
            month_label = normalize_month(str(tags.get("Date") or ""))
            output_path = output_dir / f"{game_id}.pgn"
            output_path.write_text(pgn.strip() + "\n", encoding="utf-8")
            rows.append(
                {
                    "game_id": game_id,
                    "pgn_path": str(output_path.relative_to(manifest_path.parent)),
                    "eval_csv_path": "",
                    "source": "lichess_api",
                    "source_date_or_month": month_label,
                    "opening_family": opening_family,
                    "notes": (
                        f"user={username}; rated=true; standard=true; perf=blitz,rapid; "
                        f"since={args.since or ''}; until={args.until or ''}"
                    ),
                }
            )
            existing_ids.add(game_id)
            added += 1

    if added:
        write_manifest(manifest_path, rows, fieldnames)
        print(f"Added {added} games to manifest: {manifest_path}")
    else:
        print("No new games were added to the manifest.")
    print(f"Attempted users: {', '.join(attempted_users)}")
    print(f"Successful users: {', '.join(successful_users) if successful_users else 'none'}")


if __name__ == "__main__":
    main()
