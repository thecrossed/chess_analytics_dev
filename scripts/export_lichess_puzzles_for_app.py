#!/usr/bin/env python3
"""Export a frontend-friendly Lichess puzzle subset from local SQLite."""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

import chess


DEFAULT_DB = Path("data/lichess_puzzles/lichess_puzzles.sqlite")
DEFAULT_OUTPUT = Path("src/data/lichessPuzzles.ts")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--min-rating", type=int, default=800)
    parser.add_argument("--max-rating", type=int, default=2400)
    parser.add_argument("--min-popularity", type=int, default=80)
    parser.add_argument("--max-solution-moves", type=int, default=7)
    return parser.parse_args()


def convert_row(row: sqlite3.Row) -> dict[str, object] | None:
    board = chess.Board(row["fen"])
    first_move = chess.Move.from_uci(row["first_move_uci"])
    if first_move not in board.legal_moves:
        return None

    board.push(first_move)
    solution = row["solution_uci"].split()
    if not solution:
        return None

    validation_board = board.copy()
    for uci in solution:
        move = chess.Move.from_uci(uci)
        if move not in validation_board.legal_moves:
            return None
        validation_board.push(move)

    themes = [theme for theme in row["themes"].split() if theme]
    opening_tags = row["opening_tags"] or ""

    return {
        "id": f"lichess-{row['puzzle_id']}",
        "title": f"Lichess Puzzle {row['puzzle_id']}",
        "fen": board.fen(),
        "sideToMove": board.turn and "w" or "b",
        "themes": themes,
        "difficulty": row["rating"],
        "solutionUci": solution,
        "explanation": (
            f"Lichess PuzzleId: {row['puzzle_id']}. "
            f"GameUrl: {row['game_url']}. "
            f"OpeningTags: {opening_tags}."
        ),
    }


def export_puzzles(args: argparse.Namespace) -> int:
    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT
                puzzle_id, fen, first_move_uci, solution_uci, rating,
                popularity, themes, game_url, opening_tags
            FROM lichess_puzzles
            WHERE rating BETWEEN ? AND ?
              AND popularity >= ?
              AND length(solution_uci) > 0
              AND (
                length(solution_uci) - length(replace(solution_uci, ' ', '')) + 1
              ) <= ?
            ORDER BY rating, puzzle_id
            LIMIT ?
            """,
            (
                args.min_rating,
                args.max_rating,
                args.min_popularity,
                args.max_solution_moves,
                args.limit * 3,
            ),
        ).fetchall()
    finally:
        conn.close()

    puzzles = []
    for row in rows:
        puzzle = convert_row(row)
        if puzzle:
            puzzles.append(puzzle)
        if len(puzzles) >= args.limit:
            break

    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(puzzles, indent=2)
    args.output.write_text(
        "import type { Puzzle } from \"../types\";\n\n"
        "// Generated from data/lichess_puzzles/lichess_puzzles.sqlite.\n"
        "// Regenerate with: python3 scripts/export_lichess_puzzles_for_app.py\n"
        f"export const lichessPuzzles: Puzzle[] = {payload};\n",
        encoding="utf-8",
    )
    print(f"Exported {len(puzzles):,} puzzles to {args.output}")
    return len(puzzles)


def main() -> None:
    args = parse_args()
    if not args.db.exists():
        raise SystemExit(f"Database not found: {args.db}")
    export_puzzles(args)


if __name__ == "__main__":
    main()
