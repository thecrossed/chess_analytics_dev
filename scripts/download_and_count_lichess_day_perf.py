#!/usr/bin/env python3
"""Download a Lichess monthly database file and count games for a given date/perf."""

from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

from count_lichess_month_day_perf import count_games


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DOWNLOAD_DIR = ROOT_DIR / "data" / "lichess_monthly"
USER_AGENT = "ChessAnalytics/1.0 (opening forgiveness research)"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Download a Lichess standard rated monthly PGN.zst file and count "
            "games for a target date and perf type."
        )
    )
    parser.add_argument(
        "--month",
        required=True,
        help="Month in YYYY-MM format, for example 2026-03.",
    )
    parser.add_argument(
        "--date",
        required=True,
        help="Target UTC date in YYYY-MM-DD format.",
    )
    parser.add_argument(
        "--perf",
        default="rapid",
        help="Target perf type such as rapid, blitz, bullet, or classical.",
    )
    parser.add_argument(
        "--download-dir",
        type=Path,
        default=DEFAULT_DOWNLOAD_DIR,
        help="Directory used to store downloaded monthly files.",
    )
    return parser.parse_args()


def build_monthly_url(month: str) -> str:
    return f"https://database.lichess.org/standard/lichess_db_standard_rated_{month}.pgn.zst"


def build_output_path(download_dir: Path, month: str) -> Path:
    return download_dir / f"lichess_db_standard_rated_{month}.pgn.zst"


def validate_month(month: str) -> bool:
    return len(month) == 7 and month[4] == "-" and month[:4].isdigit() and month[5:7].isdigit()


def validate_date(date_text: str) -> bool:
    return (
        len(date_text) == 10
        and date_text[4] == "-"
        and date_text[7] == "-"
        and date_text[:4].isdigit()
        and date_text[5:7].isdigit()
        and date_text[8:10].isdigit()
    )


def download_file(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT}, method="GET")
    with urllib.request.urlopen(request, timeout=300) as response:
        with destination.open("wb") as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)


def main() -> int:
    args = parse_args()
    month = args.month.strip()
    date_text = args.date.strip()
    perf = args.perf.strip().lower()
    download_dir = args.download_dir.resolve()

    if not validate_month(month):
        print("Month must be in YYYY-MM format.", file=sys.stderr)
        return 1
    if not validate_date(date_text):
        print("Date must be in YYYY-MM-DD format.", file=sys.stderr)
        return 1
    if not date_text.startswith(month):
        print("Date must belong to the requested month.", file=sys.stderr)
        return 1

    url = build_monthly_url(month)
    destination = build_output_path(download_dir, month)

    if destination.exists():
        print(f"Using existing file: {destination}")
    else:
        print(f"Downloading: {url}")
        download_file(url, destination)
        print(f"Saved to: {destination}")

    count = count_games(destination, date_text, perf)
    print(f"date={date_text}")
    print(f"perf={perf}")
    print(f"count={count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
