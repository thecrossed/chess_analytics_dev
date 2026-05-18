from __future__ import annotations

from collections import defaultdict

import chess

from .game_state import MoveRecord, side_name


PIECE_NAMES = {
    chess.PAWN: "pawns",
    chess.KNIGHT: "knights",
    chess.BISHOP: "bishops",
    chess.ROOK: "rooks",
    chess.QUEEN: "queens",
    chess.KING: "king",
}


def describe_position(board: chess.Board, history: list[MoveRecord] | None = None) -> str:
    lines = [f"{side_name(board.turn)} to move."]
    if board.is_checkmate():
        lines.append("The side to move is checkmated.")
    elif board.is_check():
        lines.append("The side to move is in check.")
    elif board.is_stalemate():
        lines.append("The position is stalemate.")
    else:
        lines.append("The side to move is not in check.")

    lines.append(f"Castling rights: {castling_rights(board)}.")
    if history:
        last = history[-1]
        lines.append(f"Last move: {last.side} played {last.san}.")

    lines.append(piece_summary(board, chess.WHITE))
    lines.append(piece_summary(board, chess.BLACK))
    lines.append(f"Legal move count: {board.legal_moves.count()}.")
    return " ".join(lines)


def piece_summary(board: chess.Board, color: bool) -> str:
    grouped: dict[int, list[str]] = defaultdict(list)
    for square, piece in board.piece_map().items():
        if piece.color == color:
            grouped[piece.piece_type].append(chess.square_name(square))

    side = "White" if color == chess.WHITE else "Black"
    parts = []
    for piece_type in [chess.KING, chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT, chess.PAWN]:
        squares = sorted(grouped.get(piece_type, []), key=chess.parse_square)
        if squares:
            parts.append(f"{PIECE_NAMES[piece_type]} on {', '.join(squares)}")
    return f"{side}: " + "; ".join(parts) + "."


def castling_rights(board: chess.Board) -> str:
    rights = []
    if board.has_kingside_castling_rights(chess.WHITE):
        rights.append("White kingside")
    if board.has_queenside_castling_rights(chess.WHITE):
        rights.append("White queenside")
    if board.has_kingside_castling_rights(chess.BLACK):
        rights.append("Black kingside")
    if board.has_queenside_castling_rights(chess.BLACK):
        rights.append("Black queenside")
    return ", ".join(rights) if rights else "none"


def piece_locations(board: chess.Board, color: bool, piece_type: int | None = None) -> str:
    matches = []
    for square, piece in board.piece_map().items():
        if piece.color == color and (piece_type is None or piece.piece_type == piece_type):
            matches.append(f"{piece.symbol().upper() if color else piece.symbol()} on {chess.square_name(square)}")
    return ", ".join(sorted(matches)) if matches else "No matching pieces found."
