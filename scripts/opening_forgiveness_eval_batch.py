#!/usr/bin/env python3
"""Generate missing eval CSV files for opening-forgiveness manifest entries."""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.generate_sample_pgn_eval_csv import (
    evaluate_all_moves_with_local_stockfish,
    extract_moves_text,
    parse_san_moves,
    read_text,
    write_csv,
)


DEFAULT_MANIFEST = ROOT_DIR / "book" / "opening_forgiveness_manifest.csv"
DEFAULT_OUTPUT_DIR = ROOT_DIR / "book" / "opening_forgiveness_eval"


def read_manifest(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def write_manifest(path: Path, rows: list[dict[str, str]]) -> None:
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate missing eval CSV files for manifest rows.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--depth", type=int, default=14)
    parser.add_argument("--max-ply", type=int, default=30)
    parser.add_argument("--sleep-seconds", type=float, default=0.0)
    args = parser.parse_args()

    manifest_path = args.manifest.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    rows = read_manifest(manifest_path)
    if not rows:
        raise SystemExit(f"No manifest rows found in {manifest_path}")

    updated = False
    for row in rows:
        pgn_path_value = str(row.get("pgn_path") or "").strip()
        if not pgn_path_value:
            continue
        pgn_path = (manifest_path.parent / pgn_path_value).resolve()
        eval_csv_path_value = str(row.get("eval_csv_path") or "").strip()
        eval_csv_path = (manifest_path.parent / eval_csv_path_value).resolve() if eval_csv_path_value else None
        if eval_csv_path and eval_csv_path.exists():
            continue

        game_id = str(row.get("game_id") or pgn_path.stem).strip() or pgn_path.stem
        pgn_text = read_text(pgn_path)
        moves_text = extract_moves_text(pgn_text)
        san_moves = parse_san_moves(moves_text)[: args.max_ply]
        eval_rows = evaluate_all_moves_with_local_stockfish(
            san_moves=san_moves,
            pgn_text=pgn_text,
            opening_api_url="",
            depth=args.depth,
            sleep_seconds=args.sleep_seconds,
        )

        output_path = output_dir / f"{game_id}.csv"
        write_csv(output_path, eval_rows)
        row["eval_csv_path"] = str(output_path.relative_to(manifest_path.parent))
        notes = str(row.get("notes") or "").strip()
        suffix = f"eval generated locally for first {args.max_ply} ply"
        row["notes"] = f"{notes}; {suffix}" if notes else suffix
        updated = True

    if updated:
        write_manifest(manifest_path, rows)
        print(f"Updated manifest with generated eval paths: {manifest_path}")
    else:
        print("No missing eval files needed generation.")


if __name__ == "__main__":
    main()
