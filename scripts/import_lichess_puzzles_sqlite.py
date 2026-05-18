#!/usr/bin/env python3
"""Import the official Lichess puzzle CSV.zst into a local SQLite database."""

from __future__ import annotations

import argparse
import csv
import io
import sqlite3
import time
from pathlib import Path

import zstandard as zstd


DEFAULT_SOURCE = Path("data/lichess_puzzles/lichess_db_puzzle.csv.zst")
DEFAULT_DB = Path("data/lichess_puzzles/lichess_puzzles.sqlite")
EXPECTED_HEADER = [
    "PuzzleId",
    "FEN",
    "Moves",
    "Rating",
    "RatingDeviation",
    "Popularity",
    "NbPlays",
    "Themes",
    "GameUrl",
    "OpeningTags",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--batch-size", type=int, default=25_000)
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Import only the first N rows. Useful for a quick smoke test.",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Remove the existing SQLite database before importing.",
    )
    return parser.parse_args()


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA temp_store = MEMORY;

        CREATE TABLE IF NOT EXISTS lichess_puzzles (
            puzzle_id TEXT PRIMARY KEY,
            fen TEXT NOT NULL,
            moves TEXT NOT NULL,
            first_move_uci TEXT NOT NULL,
            solution_uci TEXT NOT NULL,
            rating INTEGER NOT NULL,
            rating_deviation INTEGER NOT NULL,
            popularity INTEGER NOT NULL,
            nb_plays INTEGER NOT NULL,
            themes TEXT NOT NULL,
            game_url TEXT NOT NULL,
            opening_tags TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS import_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """
    )


def create_indexes(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_lichess_puzzles_rating
            ON lichess_puzzles (rating);
        CREATE INDEX IF NOT EXISTS idx_lichess_puzzles_popularity
            ON lichess_puzzles (popularity);
        CREATE INDEX IF NOT EXISTS idx_lichess_puzzles_nb_plays
            ON lichess_puzzles (nb_plays);
        CREATE INDEX IF NOT EXISTS idx_lichess_puzzles_opening_tags
            ON lichess_puzzles (opening_tags);
        """
    )


def row_to_record(row: list[str]) -> tuple[str, str, str, str, str, int, int, int, int, str, str, str]:
    puzzle_id, fen, moves, rating, rating_deviation, popularity, nb_plays, themes, game_url, opening_tags = row
    move_parts = moves.split()
    first_move = move_parts[0] if move_parts else ""
    solution = " ".join(move_parts[1:])
    return (
        puzzle_id,
        fen,
        moves,
        first_move,
        solution,
        int(rating),
        int(rating_deviation),
        int(popularity),
        int(nb_plays),
        themes,
        game_url,
        opening_tags,
    )


def import_puzzles(source: Path, db_path: Path, batch_size: int, limit: int) -> int:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    started = time.time()
    total = 0

    conn = sqlite3.connect(db_path)
    try:
        init_db(conn)
        conn.execute("DELETE FROM lichess_puzzles")
        conn.execute("DELETE FROM import_metadata")

        insert_sql = """
            INSERT INTO lichess_puzzles (
                puzzle_id, fen, moves, first_move_uci, solution_uci,
                rating, rating_deviation, popularity, nb_plays,
                themes, game_url, opening_tags
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        with source.open("rb") as compressed:
            dctx = zstd.ZstdDecompressor()
            with dctx.stream_reader(compressed) as reader:
                text_stream = io.TextIOWrapper(reader, encoding="utf-8", newline="")
                csv_reader = csv.reader(text_stream)
                header = next(csv_reader)
                if header != EXPECTED_HEADER:
                    raise ValueError(f"Unexpected CSV header: {header}")

                batch: list[tuple[str, str, str, str, str, int, int, int, int, str, str, str]] = []
                for row in csv_reader:
                    batch.append(row_to_record(row))
                    total += 1

                    if len(batch) >= batch_size:
                        conn.executemany(insert_sql, batch)
                        conn.commit()
                        batch.clear()
                        elapsed = max(time.time() - started, 0.001)
                        print(f"Imported {total:,} puzzles ({total / elapsed:,.0f}/s)", flush=True)

                    if limit and total >= limit:
                        break

                if batch:
                    conn.executemany(insert_sql, batch)
                    conn.commit()

        create_indexes(conn)
        conn.executemany(
            "INSERT INTO import_metadata (key, value) VALUES (?, ?)",
            [
                ("source_file", str(source)),
                ("imported_rows", str(total)),
                ("imported_at_unix", str(int(time.time()))),
            ],
        )
        conn.commit()
    finally:
        conn.close()

    elapsed = time.time() - started
    print(f"Done. Imported {total:,} puzzles into {db_path} in {elapsed:.1f}s.")
    return total


def main() -> None:
    args = parse_args()
    if not args.source.exists():
        raise SystemExit(f"Source file not found: {args.source}")
    if args.replace and args.db.exists():
        args.db.unlink()

    import_puzzles(args.source, args.db, args.batch_size, args.limit)


if __name__ == "__main__":
    main()
