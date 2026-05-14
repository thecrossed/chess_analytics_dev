from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Any

import chess
import chess.pgn


@dataclass(frozen=True)
class ParsedGame:
    headers: dict[str, str]
    moves: list[chess.Move]
    san_moves: list[str]
    initial_fen: str


class PgnParseError(ValueError):
    pass


def parse_pgn(pgn_text: str) -> ParsedGame:
    text = (pgn_text or "").strip()
    if not text:
        raise PgnParseError("PGN is empty. Paste one complete game first.")

    game = chess.pgn.read_game(io.StringIO(text))
    if game is None:
        raise PgnParseError("Could not parse PGN. Check that the text contains a valid game.")

    board = game.board()
    moves: list[chess.Move] = []
    san_moves: list[str] = []
    for move in game.mainline_moves():
        try:
            san_moves.append(board.san(move))
        except Exception:
            san_moves.append(move.uci())
        moves.append(move)
        board.push(move)

    if not moves:
        raise PgnParseError("PGN parsed successfully, but it has no moves.")

    headers = {str(key): str(value) for key, value in game.headers.items()}
    return ParsedGame(headers=headers, moves=moves, san_moves=san_moves, initial_fen=game.board().fen())


def metadata_summary(headers: dict[str, str]) -> dict[str, Any]:
    keys = ["Event", "Site", "Date", "Round", "White", "Black", "Result"]
    return {key: headers.get(key, "") for key in keys if headers.get(key)}

