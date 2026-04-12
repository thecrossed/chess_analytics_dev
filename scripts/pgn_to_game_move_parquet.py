#!/usr/bin/env python3
"""Stream a PGN file into game and move parquet datasets."""

from __future__ import annotations

import argparse
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import chess
import chess.pgn


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT_DIR = ROOT_DIR / "data" / "pgn_parquet"


@dataclass
class GameRow:
    game_id: str
    event: str
    site: str
    date: str
    utc_date: str
    utc_time: str
    white: str
    black: str
    result: str
    white_elo: int | None
    black_elo: int | None
    white_rating_diff: int | None
    black_rating_diff: int | None
    eco: str
    opening: str
    time_control: str
    termination: str
    moves_count: int
    pgn_headers_only: str


@dataclass
class MoveRow:
    game_id: str
    ply: int
    move_number: int
    color: str
    san: str
    uci: str
    from_square: str
    to_square: str
    piece: str
    is_capture: bool
    is_check: bool
    is_checkmate: bool
    promotion: str | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Convert a PGN file into two parquet datasets: one game-level table "
            "and one move-level table linked by game_id."
        )
    )
    parser.add_argument("input_pgn", type=Path, help="Path to the PGN input file.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory where parquet datasets will be written.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=10000,
        help="Number of games to buffer before flushing to parquet.",
    )
    parser.add_argument(
        "--limit-games",
        type=int,
        help="Optional maximum number of games to process.",
    )
    return parser.parse_args()


def load_arrow_dependencies() -> tuple[Any, Any]:
    try:
        import pyarrow as pa  # type: ignore
        import pyarrow.parquet as pq  # type: ignore
    except ModuleNotFoundError:
        print(
            (
                "Missing dependency: pyarrow.\n"
                f"Current python: {sys.executable}\n"
                "This usually means the script is being run with a different Python "
                "environment than the one where pyarrow was installed.\n"
                "Try one of these:\n"
                "  1. python3 -m pip install pyarrow\n"
                "  2. /opt/anaconda3/bin/python3 -m pip install pyarrow\n"
                "  3. /opt/anaconda3/bin/python3 scripts/pgn_to_game_move_parquet.py ...\n"
            ),
            file=sys.stderr,
        )
        raise
    return pa, pq


def safe_int(value: str) -> int | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def extract_game_id(headers: chess.pgn.Headers, fallback_index: int) -> str:
    site = str(headers.get("Site") or "").strip()
    if site:
        suffix = site.rstrip("/").rsplit("/", 1)[-1]
        if suffix and not suffix.startswith("http"):
            return suffix
    return f"game_{fallback_index}"


def build_headers_snapshot(headers: chess.pgn.Headers) -> str:
    keys = [
        "Event",
        "Site",
        "Date",
        "UTCDate",
        "UTCTime",
        "White",
        "Black",
        "Result",
        "WhiteElo",
        "BlackElo",
        "ECO",
        "Opening",
        "TimeControl",
        "Termination",
    ]
    return " | ".join(f"{key}={headers.get(key, '')}" for key in keys)


def piece_name(piece_type: chess.PieceType | None) -> str:
    lookup = {
        chess.PAWN: "pawn",
        chess.KNIGHT: "knight",
        chess.BISHOP: "bishop",
        chess.ROOK: "rook",
        chess.QUEEN: "queen",
        chess.KING: "king",
    }
    return lookup.get(piece_type, "")


def promotion_name(move: chess.Move) -> str | None:
    if move.promotion is None:
        return None
    return piece_name(move.promotion)


def build_rows(game: chess.pgn.Game, fallback_index: int) -> tuple[GameRow, list[MoveRow]]:
    headers = game.headers
    game_id = extract_game_id(headers, fallback_index)
    board = game.board()
    move_rows: list[MoveRow] = []
    ply = 0

    for move in game.mainline_moves():
        ply += 1
        san = board.san(move)
        piece = board.piece_at(move.from_square)
        move_rows.append(
            MoveRow(
                game_id=game_id,
                ply=ply,
                move_number=((ply + 1) // 2),
                color="white" if ply % 2 == 1 else "black",
                san=san,
                uci=move.uci(),
                from_square=chess.square_name(move.from_square),
                to_square=chess.square_name(move.to_square),
                piece=piece_name(piece.piece_type if piece else None),
                is_capture=board.is_capture(move),
                is_check=board.gives_check(move),
                is_checkmate=False,
                promotion=promotion_name(move),
            )
        )
        board.push(move)
        if board.is_checkmate():
            move_rows[-1].is_checkmate = True

    game_row = GameRow(
        game_id=game_id,
        event=str(headers.get("Event") or ""),
        site=str(headers.get("Site") or ""),
        date=str(headers.get("Date") or ""),
        utc_date=str(headers.get("UTCDate") or ""),
        utc_time=str(headers.get("UTCTime") or ""),
        white=str(headers.get("White") or ""),
        black=str(headers.get("Black") or ""),
        result=str(headers.get("Result") or ""),
        white_elo=safe_int(str(headers.get("WhiteElo") or "")),
        black_elo=safe_int(str(headers.get("BlackElo") or "")),
        white_rating_diff=safe_int(str(headers.get("WhiteRatingDiff") or "")),
        black_rating_diff=safe_int(str(headers.get("BlackRatingDiff") or "")),
        eco=str(headers.get("ECO") or ""),
        opening=str(headers.get("Opening") or ""),
        time_control=str(headers.get("TimeControl") or ""),
        termination=str(headers.get("Termination") or ""),
        moves_count=len(move_rows),
        pgn_headers_only=build_headers_snapshot(headers),
    )
    return game_row, move_rows


def write_batch(
    rows: list[dict[str, Any]],
    writer: Any | None,
    output_path: Path,
    pa: Any,
    pq: Any,
) -> Any:
    if not rows:
        return writer
    table = pa.Table.from_pylist(rows)
    if writer is None:
        writer = pq.ParquetWriter(output_path, table.schema)
    writer.write_table(table)
    return writer


def main() -> int:
    args = parse_args()
    input_pgn = args.input_pgn.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if not input_pgn.exists():
        print(f"Input PGN not found: {input_pgn}", file=sys.stderr)
        return 1

    pa, pq = load_arrow_dependencies()

    game_output = output_dir / "game.parquet"
    move_output = output_dir / "move.parquet"

    game_writer = None
    move_writer = None
    game_batch: list[dict[str, Any]] = []
    move_batch: list[dict[str, Any]] = []
    processed_games = 0

    with input_pgn.open("r", encoding="utf-8", errors="replace") as handle:
        while True:
            game = chess.pgn.read_game(handle)
            if game is None:
                break

            processed_games += 1
            game_row, move_rows = build_rows(game, processed_games)
            game_batch.append(asdict(game_row))
            move_batch.extend(asdict(move_row) for move_row in move_rows)

            if processed_games % args.batch_size == 0:
                game_writer = write_batch(game_batch, game_writer, game_output, pa, pq)
                move_writer = write_batch(move_batch, move_writer, move_output, pa, pq)
                game_batch.clear()
                move_batch.clear()
                print(f"Processed {processed_games} games...", file=sys.stderr)

            if args.limit_games and processed_games >= args.limit_games:
                break

    game_writer = write_batch(game_batch, game_writer, game_output, pa, pq)
    move_writer = write_batch(move_batch, move_writer, move_output, pa, pq)

    if game_writer is not None:
        game_writer.close()
    if move_writer is not None:
        move_writer.close()

    print(f"games_processed={processed_games}")
    print(f"game_output={game_output}")
    print(f"move_output={move_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
