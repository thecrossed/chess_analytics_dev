#!/usr/bin/env python3
"""MVP openness metric v2 based on python-chess."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable

import chess


FILE_WEIGHTS = {
    0: 0.5,
    1: 0.8,
    2: 1.2,
    3: 1.6,
    4: 1.6,
    5: 1.2,
    6: 0.8,
    7: 0.5,
}

STRUCTURAL_WEIGHTS = {
    "open_files_score": 0.18,
    "semi_open_files_score": 0.15,
    "central_open_score": 0.20,
    "bishop_mobility_score": 0.15,
    "rook_mobility_score": 0.15,
    "diagonal_openness_score": 0.17,
}

PHASE_WEIGHTS = {
    chess.QUEEN: 4,
    chess.ROOK: 2,
    chess.BISHOP: 1,
    chess.KNIGHT: 1,
}

INITIAL_PHASE_POINTS = (
    2 * PHASE_WEIGHTS[chess.QUEEN]
    + 4 * PHASE_WEIGHTS[chess.ROOK]
    + 4 * PHASE_WEIGHTS[chess.BISHOP]
    + 4 * PHASE_WEIGHTS[chess.KNIGHT]
)

LONG_DIAGONALS = (
    ("a1", "h8"),
    ("h1", "a8"),
    ("b1", "h7"),
    ("a2", "g8"),
    ("g1", "a7"),
    ("h2", "b8"),
)

CENTER_SQUARES = [chess.D4, chess.E4, chess.D5, chess.E5]


@dataclass
class OpennessBreakdown:
    open_files_score: float
    semi_open_files_score: float
    central_open_score: float
    bishop_mobility_score: float
    rook_mobility_score: float
    diagonal_openness_score: float
    king_exposure_score: float
    king_activity_score: float
    king_factor_score: float
    phase: float
    total_score: float

    def to_dict(self) -> dict[str, float]:
        return asdict(self)


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def round_score(value: float) -> float:
    return round(value, 4)


def squares_on_file(file_index: int) -> list[chess.Square]:
    return [chess.square(file_index, rank_index) for rank_index in range(8)]


def count_pawns_on_file(board: chess.Board, file_index: int) -> tuple[int, int]:
    white_count = 0
    black_count = 0
    for square in squares_on_file(file_index):
        piece = board.piece_at(square)
        if piece and piece.piece_type == chess.PAWN:
            if piece.color == chess.WHITE:
                white_count += 1
            else:
                black_count += 1
    return white_count, black_count


def file_state(board: chess.Board, file_index: int) -> str:
    white_pawns, black_pawns = count_pawns_on_file(board, file_index)
    if white_pawns == 0 and black_pawns == 0:
        return "open"
    if white_pawns == 0 or black_pawns == 0:
        return "semi_open"
    return "closed"


def compute_open_file_score(board: chess.Board) -> float:
    open_files = sum(1 for file_index in range(8) if file_state(board, file_index) == "open")
    return clamp01(open_files / 8.0)


def compute_semi_open_file_score(board: chess.Board) -> float:
    semi_open_files = sum(1 for file_index in range(8) if file_state(board, file_index) == "semi_open")
    return clamp01(semi_open_files / 8.0)


def compute_central_open_score(board: chess.Board) -> float:
    weighted_sum = 0.0
    total_weight = 0.0
    for file_index, weight in FILE_WEIGHTS.items():
        state = file_state(board, file_index)
        if state == "open":
            openness = 1.0
        elif state == "semi_open":
            openness = 0.5
        else:
            openness = 0.0
        weighted_sum += weight * openness
        total_weight += weight
    return clamp01(weighted_sum / total_weight if total_weight else 0.0)


def count_piece_legal_moves(board: chess.Board, piece_type: chess.PieceType, color: chess.Color) -> int:
    probe = board.copy(stack=False)
    probe.turn = color
    return sum(
        1
        for move in probe.legal_moves
        if probe.piece_at(move.from_square)
        and probe.piece_at(move.from_square).piece_type == piece_type
        and probe.piece_at(move.from_square).color == color
    )


def compute_bishop_mobility_score(board: chess.Board) -> float:
    total_moves = 0
    total_bishops = 0
    for color in (chess.WHITE, chess.BLACK):
        total_moves += count_piece_legal_moves(board, chess.BISHOP, color)
        total_bishops += len(board.pieces(chess.BISHOP, color))
    max_reasonable_moves = max(1, total_bishops * 10)
    return clamp01(total_moves / max_reasonable_moves)


def compute_rook_mobility_score(board: chess.Board) -> float:
    total_moves = 0
    total_rooks = 0
    for color in (chess.WHITE, chess.BLACK):
        total_moves += count_piece_legal_moves(board, chess.ROOK, color)
        total_rooks += len(board.pieces(chess.ROOK, color))
    max_reasonable_moves = max(1, total_rooks * 14)
    return clamp01(total_moves / max_reasonable_moves)


def squares_between(start: chess.Square, end: chess.Square) -> list[chess.Square]:
    file_step = chess.square_file(end) - chess.square_file(start)
    rank_step = chess.square_rank(end) - chess.square_rank(start)

    if file_step == 0:
        file_dir = 0
    else:
        file_dir = 1 if file_step > 0 else -1

    if rank_step == 0:
        rank_dir = 0
    else:
        rank_dir = 1 if rank_step > 0 else -1

    length = max(abs(file_step), abs(rank_step)) + 1
    return [
        chess.square(
            chess.square_file(start) + file_dir * offset,
            chess.square_rank(start) + rank_dir * offset,
        )
        for offset in range(length)
    ]


def parse_square(name: str) -> chess.Square:
    return chess.parse_square(name)


def diagonal_squares() -> list[list[chess.Square]]:
    return [squares_between(parse_square(start), parse_square(end)) for start, end in LONG_DIAGONALS]


def compute_diagonal_openness_score(board: chess.Board) -> float:
    scores: list[float] = []
    for diagonal in diagonal_squares():
        pawn_count = 0
        for square in diagonal:
            piece = board.piece_at(square)
            if piece and piece.piece_type == chess.PAWN:
                pawn_count += 1
        scores.append(1.0 - (pawn_count / len(diagonal)))
    return clamp01(sum(scores) / len(scores) if scores else 0.0)


def king_ring_squares(king_square: chess.Square) -> list[chess.Square]:
    candidates: list[chess.Square] = []
    king_file = chess.square_file(king_square)
    king_rank = chess.square_rank(king_square)
    for file_delta in (-1, 0, 1):
        for rank_delta in (-1, 0, 1):
            if file_delta == 0 and rank_delta == 0:
                continue
            file_index = king_file + file_delta
            rank_index = king_rank + rank_delta
            if 0 <= file_index < 8 and 0 <= rank_index < 8:
                candidates.append(chess.square(file_index, rank_index))
    return candidates


def file_exposure_value(board: chess.Board, file_index: int) -> float:
    state = file_state(board, file_index)
    if state == "open":
        return 1.0
    if state == "semi_open":
        return 0.5
    return 0.0


def single_king_exposure(board: chess.Board, color: chess.Color) -> float:
    king_square = board.king(color)
    if king_square is None:
        return 0.0

    ring = king_ring_squares(king_square)
    opponent = not color
    attacked_squares = sum(1 for square in ring if board.is_attacked_by(opponent, square))
    attacked_density = attacked_squares / max(1, len(ring))
    file_exposure = file_exposure_value(board, chess.square_file(king_square))
    return clamp01(0.7 * attacked_density + 0.3 * file_exposure)


def compute_king_exposure_score(board: chess.Board) -> float:
    white_score = single_king_exposure(board, chess.WHITE)
    black_score = single_king_exposure(board, chess.BLACK)
    return clamp01((white_score + black_score) / 2.0)


def single_king_activity(board: chess.Board, color: chess.Color) -> float:
    king_square = board.king(color)
    if king_square is None:
        return 0.0

    probe = board.copy(stack=False)
    probe.turn = color
    king_moves = sum(
        1
        for move in probe.legal_moves
        if move.from_square == king_square
    )
    mobility_score = king_moves / 8.0

    min_center_distance = min(chess.square_distance(king_square, center) for center in CENTER_SQUARES)
    center_score = 1.0 - (min_center_distance / 4.0)
    return clamp01(0.6 * mobility_score + 0.4 * center_score)


def compute_king_activity_score(board: chess.Board) -> float:
    white_score = single_king_activity(board, chess.WHITE)
    black_score = single_king_activity(board, chess.BLACK)
    return clamp01((white_score + black_score) / 2.0)


def compute_phase(board: chess.Board) -> float:
    remaining_points = 0
    for piece_type, piece_weight in PHASE_WEIGHTS.items():
        remaining_points += piece_weight * (
            len(board.pieces(piece_type, chess.WHITE)) + len(board.pieces(piece_type, chess.BLACK))
        )
    return clamp01(remaining_points / INITIAL_PHASE_POINTS)


def compute_structural_score(component_scores: dict[str, float]) -> float:
    return clamp01(
        sum(component_scores[name] * weight for name, weight in STRUCTURAL_WEIGHTS.items())
    )


def evaluate_board(board: chess.Board) -> OpennessBreakdown:
    component_scores = {
        "open_files_score": compute_open_file_score(board),
        "semi_open_files_score": compute_semi_open_file_score(board),
        "central_open_score": compute_central_open_score(board),
        "bishop_mobility_score": compute_bishop_mobility_score(board),
        "rook_mobility_score": compute_rook_mobility_score(board),
        "diagonal_openness_score": compute_diagonal_openness_score(board),
    }
    king_exposure_score = compute_king_exposure_score(board)
    king_activity_score = compute_king_activity_score(board)
    phase = compute_phase(board)
    structural_score = compute_structural_score(component_scores)
    king_factor_score = clamp01((phase * king_exposure_score) + ((1.0 - phase) * king_activity_score))
    total_score = 100.0 * ((0.80 * structural_score) + (0.20 * king_factor_score))

    return OpennessBreakdown(
        open_files_score=round_score(component_scores["open_files_score"] * 100.0),
        semi_open_files_score=round_score(component_scores["semi_open_files_score"] * 100.0),
        central_open_score=round_score(component_scores["central_open_score"] * 100.0),
        bishop_mobility_score=round_score(component_scores["bishop_mobility_score"] * 100.0),
        rook_mobility_score=round_score(component_scores["rook_mobility_score"] * 100.0),
        diagonal_openness_score=round_score(component_scores["diagonal_openness_score"] * 100.0),
        king_exposure_score=round_score(king_exposure_score * 100.0),
        king_activity_score=round_score(king_activity_score * 100.0),
        king_factor_score=round_score(king_factor_score * 100.0),
        phase=round_score(phase),
        total_score=round_score(total_score),
    )


def evaluate_fen(fen: str) -> dict[str, float]:
    board = chess.Board(fen)
    return evaluate_board(board).to_dict()


def print_example_results(name: str, fen: str) -> None:
    print(f"\n{name}")
    print(f"FEN: {fen}")
    result = evaluate_fen(fen)
    for key, value in result.items():
        print(f"  {key}: {value}")


def example_positions() -> Iterable[tuple[str, str]]:
    return (
        ("Initial position", chess.STARTING_FEN),
        (
            "Semi-open middlegame",
            "r2q1rk1/pp2bppp/2n1pn2/2bp4/3P4/2PBPN2/PP3PPP/RNBQ1RK1 w - - 0 10",
        ),
        (
            "Open endgame",
            "8/2k5/8/3K4/8/8/8/8 w - - 0 1",
        ),
    )


if __name__ == "__main__":
    for label, fen in example_positions():
        print_example_results(label, fen)
