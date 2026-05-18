from __future__ import annotations

import re
from dataclasses import dataclass

import chess

from .game_state import BlindfoldGame
from .position_describer import describe_position, piece_locations
from .pgn_export import export_pgn


@dataclass(frozen=True)
class CommandResult:
    handled: bool
    message: str = ""
    action: str | None = None


def handle_command(text: str, game: BlindfoldGame) -> CommandResult:
    normalized = text.lower().strip()
    if not normalized:
        return CommandResult(False)

    if normalized in {"repeat last move", "what was the last move", "what was the last move?"}:
        if not game.history:
            return CommandResult(True, "No moves have been played yet.")
        last = game.history[-1]
        return CommandResult(True, f"Last move: {last.side} played {last.san}.")

    if "read move history" in normalized or normalized == "move history":
        if not game.history:
            return CommandResult(True, "No moves have been played yet.")
        moves = ", ".join(f"{move.side} {move.san}" for move in game.history)
        return CommandResult(True, moves)

    if "legal moves" in normalized:
        moves = [game.board.san(move) for move in list(game.board.legal_moves)[:20]]
        more = " More moves are available." if game.board.legal_moves.count() > len(moves) else ""
        return CommandResult(True, "Legal moves: " + ", ".join(moves) + "." + more)

    if "describe the position" in normalized or normalized == "position":
        return CommandResult(True, describe_position(game.board, game.history))

    if "where are my pieces" in normalized:
        return CommandResult(True, piece_locations(game.board, game.user_color_bool))

    piece_match = re.search(r"where (?:is|are) my (king|queen|rook|bishop|knight|night|pawn)s?", normalized)
    if piece_match:
        word = piece_match.group(1).replace("night", "knight")
        piece_type = {
            "king": chess.KING,
            "queen": chess.QUEEN,
            "rook": chess.ROOK,
            "bishop": chess.BISHOP,
            "knight": chess.KNIGHT,
            "pawn": chess.PAWN,
        }[word]
        return CommandResult(True, piece_locations(game.board, game.user_color_bool, piece_type))

    if "reveal board" in normalized:
        return CommandResult(True, "Revealing board.", "reveal_board")
    if "hide board" in normalized:
        return CommandResult(True, "Hiding board.", "hide_board")
    if normalized == "resign":
        game.game_over = True
        return CommandResult(True, "You resigned. Game over.", "resign")
    if "new game" in normalized:
        return CommandResult(True, "Use Start New Game to reset the game.", "new_game")
    if "export pgn" in normalized:
        return CommandResult(True, export_pgn(game), "export_pgn")

    return CommandResult(False)
