from __future__ import annotations

from typing import Any, Callable

import chess
import chess.engine

from core.move_classifier import classify_move
from core.pgn_parser import ParsedGame
from core.stockfish_engine import open_engine


MATE_CP = 100000


def score_to_cp(score: chess.engine.PovScore, pov: chess.Color) -> tuple[int | None, bool]:
    pov_score = score.pov(pov)
    if pov_score.is_mate():
        mate_in = pov_score.mate()
        if mate_in is None:
            return None, True
        sign = 1 if mate_in > 0 else -1
        distance = min(abs(mate_in), 20)
        return sign * (MATE_CP - distance * 1000), True
    cp = pov_score.score()
    return (int(cp), False) if cp is not None else (None, True)


def pv_to_san(board: chess.Board, pv: list[chess.Move]) -> list[str]:
    temp = board.copy(stack=False)
    result: list[str] = []
    for move in pv[:5]:
        if move not in temp.legal_moves:
            break
        result.append(temp.san(move))
        temp.push(move)
    return result


def best_move_san(board: chess.Board, move: chess.Move | None) -> str | None:
    if move is None or move not in board.legal_moves:
        return None
    return board.san(move)


def analyze_game(
    parsed: ParsedGame,
    engine_path: str,
    depth: int = 12,
    progress_callback: Callable[[int, int], None] | None = None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    board = chess.Board(parsed.initial_fen)
    engine = open_engine(engine_path)

    try:
        total = len(parsed.moves)
        for index, move in enumerate(parsed.moves, start=1):
            if move not in board.legal_moves:
                raise ValueError(f"Illegal move at ply {index}: {move.uci()}")

            fen_before = board.fen()
            side_color = board.turn
            side = "White" if side_color == chess.WHITE else "Black"
            move_number = board.fullmove_number
            played_san = board.san(move)

            before_info = engine.analyse(board, chess.engine.Limit(depth=depth))
            best_move = before_info.get("pv", [None])[0] if before_info.get("pv") else None
            pv = pv_to_san(board, before_info.get("pv", []))
            eval_before, before_uncertain = score_to_cp(before_info["score"], side_color)
            best_san = best_move_san(board, best_move)
            best_uci = best_move.uci() if isinstance(best_move, chess.Move) else None

            board.push(move)
            fen_after = board.fen()
            after_info = engine.analyse(board, chess.engine.Limit(depth=depth))
            eval_after, after_uncertain = score_to_cp(after_info["score"], side_color)

            eval_loss = None
            if eval_before is not None and eval_after is not None:
                eval_loss = max(0, eval_before - eval_after)
            uncertain = before_uncertain or after_uncertain

            rows.append(
                {
                    "ply": index,
                    "move_number": move_number,
                    "side": side,
                    "played_san": played_san,
                    "played_uci": move.uci(),
                    "fen_before": fen_before,
                    "fen_after": fen_after,
                    "eval_before_cp": eval_before,
                    "eval_after_cp": eval_after,
                    "eval_loss_cp": eval_loss,
                    "best_move_uci": best_uci,
                    "best_move_san": best_san,
                    "pv": pv,
                    "classification": classify_move(eval_loss, uncertain=uncertain),
                    "score_uncertain": uncertain,
                }
            )

            if progress_callback:
                progress_callback(index, total)
    finally:
        engine.quit()

    return rows

