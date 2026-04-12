#!/usr/bin/env python3
"""Count Lichess monthly-database games for a specific date and perf type."""

from __future__ import annotations

import argparse
import io
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Stream a Lichess monthly PGN or PGN.zst file and count games for a "
            "specific UTC date and perf type."
        )
    )
    parser.add_argument(
        "input_path",
        type=Path,
        help="Path to a Lichess monthly PGN or .pgn.zst file.",
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
    return parser.parse_args()


def normalize_date(date_text: str) -> str:
    return date_text.strip().replace(".", "-")


def open_text_stream(path: Path) -> io.TextIOBase:
    if path.suffix != ".zst":
        return path.open("r", encoding="utf-8", errors="replace")

    process = subprocess.Popen(
        ["zstd", "-dc", str(path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
    )
    if process.stdout is None:
        raise RuntimeError("Failed to open zstd stdout stream.")
    return io.TextIOWrapper(process.stdout, encoding="utf-8", errors="replace")


def extract_tag(line: str) -> tuple[str, str] | None:
    if not line.startswith("[") or not line.endswith("]"):
        return None
    first_space = line.find(" ")
    if first_space <= 1:
        return None
    tag_name = line[1:first_space]
    first_quote = line.find('"', first_space)
    last_quote = line.rfind('"')
    if first_quote == -1 or last_quote <= first_quote:
        return None
    return tag_name, line[first_quote + 1:last_quote]


def game_matches(headers: dict[str, str], target_date: str, target_perf: str) -> bool:
    date_value = headers.get("UTCDate") or headers.get("Date") or ""
    event_value = (headers.get("Event") or "").strip().lower()
    return normalize_date(date_value) == target_date and target_perf in event_value


def count_games(path: Path, target_date: str, target_perf: str) -> int:
    count = 0
    headers: dict[str, str] = {}
    in_moves = False

    with open_text_stream(path) as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line:
                continue

            tag = extract_tag(line)
            if tag is not None:
                tag_name, tag_value = tag
                if tag_name == "Event" and headers and in_moves:
                    if game_matches(headers, target_date, target_perf):
                        count += 1
                    headers = {}
                    in_moves = False
                headers[tag_name] = tag_value
                continue

            in_moves = True

    if headers and game_matches(headers, target_date, target_perf):
        count += 1
    return count


def main() -> int:
    args = parse_args()
    input_path = args.input_path.resolve()
    target_date = args.date.strip()
    target_perf = args.perf.strip().lower()

    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 1

    if len(target_date) != 10 or target_date[4] != "-" or target_date[7] != "-":
        print("Date must be in YYYY-MM-DD format.", file=sys.stderr)
        return 1

    try:
        count = count_games(input_path, target_date, target_perf)
    except FileNotFoundError as exc:
        if exc.filename == "zstd":
            print(
                "This script needs the `zstd` command to read .zst files. "
                "Install zstd or provide an already decompressed .pgn file.",
                file=sys.stderr,
            )
            return 1
        raise

    print(f"date={target_date}")
    print(f"perf={target_perf}")
    print(f"count={count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
