#!/usr/bin/env python3
"""Extract a specific date/perf subset from a Lichess monthly PGN database."""

from __future__ import annotations

import argparse
import io
import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT_DIR = ROOT_DIR / "data" / "lichess_daily_subsets"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Stream a Lichess monthly PGN or PGN.zst file, extract games for a "
            "specific date and perf type, and save them as a standalone PGN."
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
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional output PGN path. Defaults to data/lichess_daily_subsets/.",
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


def default_output_path(input_path: Path, target_date: str, target_perf: str) -> Path:
    stem = input_path.name
    if stem.endswith(".pgn.zst"):
        stem = stem[: -len(".pgn.zst")]
    elif stem.endswith(".pgn"):
        stem = stem[: -len(".pgn")]
    return DEFAULT_OUTPUT_DIR / f"{stem}_{target_date}_{target_perf}.pgn"


def flush_game(
    output_handle: io.TextIOBase,
    headers: dict[str, str],
    game_lines: list[str],
    target_date: str,
    target_perf: str,
) -> int:
    if not headers or not game_lines:
        return 0
    if not game_matches(headers, target_date, target_perf):
        return 0
    output_handle.write("\n".join(game_lines).rstrip() + "\n\n")
    return 1


def extract_subset(input_path: Path, output_path: Path, target_date: str, target_perf: str) -> int:
    count = 0
    headers: dict[str, str] = {}
    game_lines: list[str] = []
    in_game = False

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open("w", encoding="utf-8") as output_handle:
        with open_text_stream(input_path) as input_handle:
            for raw_line in input_handle:
                line = raw_line.rstrip("\n")

                if not line.strip():
                    if in_game:
                        game_lines.append("")
                    continue

                tag = extract_tag(line.strip())
                if tag is not None:
                    tag_name, tag_value = tag
                    if tag_name == "Event" and in_game and headers:
                        count += flush_game(
                            output_handle,
                            headers,
                            game_lines,
                            target_date,
                            target_perf,
                        )
                        headers = {}
                        game_lines = []
                        in_game = False
                    headers[tag_name] = tag_value
                    game_lines.append(line)
                    continue

                in_game = True
                game_lines.append(line)

        count += flush_game(
            output_handle,
            headers,
            game_lines,
            target_date,
            target_perf,
        )

    return count


def main() -> int:
    args = parse_args()
    input_path = args.input_path.resolve()
    target_date = args.date.strip()
    target_perf = args.perf.strip().lower()
    output_path = (args.output.resolve() if args.output else default_output_path(input_path, target_date, target_perf))

    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 1
    if len(target_date) != 10 or target_date[4] != "-" or target_date[7] != "-":
        print("Date must be in YYYY-MM-DD format.", file=sys.stderr)
        return 1

    try:
        count = extract_subset(input_path, output_path, target_date, target_perf)
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
    print(f"output={output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
