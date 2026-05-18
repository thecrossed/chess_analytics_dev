from __future__ import annotations

import chess.pgn

from .game_state import BlindfoldGame


def export_pgn(game: BlindfoldGame) -> str:
    pgn_game = chess.pgn.Game()
    pgn_game.headers["Event"] = "Blindfold Chess Voice MVP"
    pgn_game.headers["White"] = "Human" if game.user_color == "White" else "Stockfish"
    pgn_game.headers["Black"] = "Stockfish" if game.user_color == "White" else "Human"
    pgn_game.headers["Result"] = game.board.result() if game.board.is_game_over() else "*"

    node = pgn_game
    board = chess.Board()
    for record in game.history:
        move = chess.Move.from_uci(record.uci)
        node = node.add_variation(move)
        board.push(move)
    return str(pgn_game)
