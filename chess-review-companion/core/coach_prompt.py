from __future__ import annotations

import json
from typing import Any

import chess


SYSTEM_PROMPT = """You are a chess review coach.
Stockfish is the source of truth for chess analysis.
Do not invent tactics, evaluations, or lines that are not present in the provided engine data.
Do not claim that a move threatens, attacks, traps, wins, loses, or prepares something unless that idea is directly supported by the provided principal variation or surrounding moves.
Do not compare against alternative candidate moves unless they are explicitly present in the provided best move or principal variation.
Do not say the opponent has no better response unless opponent candidate responses and evaluations are explicitly provided.
If the played move is also the engine best move, say that clearly and do not explain it as a mistake.
For basic move facts, trust the provided move_fact field. Do not reinterpret the FEN and do not say a pawn becomes a bishop, knight, rook, queen, or king unless the move_fact says it was a promotion.
Explain the move using only:
- current FEN
- move_fact
- played move
- best move
- evaluation before
- evaluation after
- eval loss
- principal variation
- surrounding move context
If the data is insufficient, say so.
Explain in a practical way for a club player."""


def build_move_context(
    game_metadata: dict[str, str],
    selected_move: dict[str, Any],
    all_moves: list[dict[str, Any]],
    user_question: str,
    level: str = "club",
    language: str = "Chinese",
) -> dict[str, Any]:
    ply = int(selected_move.get("ply", 0))
    previous_moves = [
        f"{row.get('move_number')}. {row.get('played_san')}"
        for row in all_moves
        if max(1, ply - 3) <= int(row.get("ply", 0)) < ply
    ]
    next_moves = [
        f"{row.get('move_number')}. {row.get('played_san')}"
        for row in all_moves
        if ply < int(row.get("ply", 0)) <= ply + 3
    ]

    return {
        "game_metadata": game_metadata,
        "selected_move_number": selected_move.get("move_number"),
        "selected_ply": selected_move.get("ply"),
        "side_to_move": selected_move.get("side"),
        "fen_before": selected_move.get("fen_before"),
        "played_move": {
            "san": selected_move.get("played_san"),
            "uci": selected_move.get("played_uci"),
        },
        "move_fact": describe_move_fact(selected_move),
        "best_move": {
            "san": selected_move.get("best_move_san"),
            "uci": selected_move.get("best_move_uci"),
        },
        "eval_before_cp": selected_move.get("eval_before_cp"),
        "eval_after_cp": selected_move.get("eval_after_cp"),
        "eval_loss_cp": selected_move.get("eval_loss_cp"),
        "move_classification": selected_move.get("classification"),
        "principal_variation": selected_move.get("pv", []),
        "previous_3_moves": previous_moves,
        "next_3_moves": next_moves,
        "user_question": user_question,
        "explanation_level": level,
        "response_language": language,
    }


def describe_move_fact(selected_move: dict[str, Any]) -> str:
    try:
        board = chess.Board(str(selected_move.get("fen_before", "")))
        move = chess.Move.from_uci(str(selected_move.get("played_uci", "")))
    except Exception:
        return "Move fact unavailable from the provided FEN and UCI move."

    if move not in board.legal_moves:
        return "Move fact unavailable because the played move is not legal in the provided FEN."

    piece = board.piece_at(move.from_square)
    captured = board.piece_at(move.to_square)
    san = selected_move.get("played_san") or board.san(move)
    side = "White" if board.turn == chess.WHITE else "Black"
    piece_name = piece_name_for(piece) if piece else "piece"
    from_sq = chess.square_name(move.from_square)
    to_sq = chess.square_name(move.to_square)

    facts = [f"{side} played {san}: the {piece_name} moved from {from_sq} to {to_sq}."]
    if captured:
        facts.append(f"It captured a {piece_name_for(captured)} on {to_sq}.")
    if board.is_castling(move):
        facts.append("This move is castling.")
    if move.promotion:
        facts.append(f"It promoted to a {piece_name_for(chess.Piece(move.promotion, board.turn))}.")
    if board.gives_check(move):
        facts.append("It gives check.")
    return " ".join(facts)


def piece_name_for(piece: chess.Piece) -> str:
    color = "white" if piece.color == chess.WHITE else "black"
    names = {
        chess.PAWN: "pawn",
        chess.KNIGHT: "knight",
        chess.BISHOP: "bishop",
        chess.ROOK: "rook",
        chess.QUEEN: "queen",
        chess.KING: "king",
    }
    return f"{color} {names.get(piece.piece_type, 'piece')}"


def build_fast_context(context: dict[str, Any]) -> dict[str, Any]:
    pv = context.get("principal_variation") or []
    return {
        "selected_move_number": context.get("selected_move_number"),
        "selected_ply": context.get("selected_ply"),
        "side_to_move": context.get("side_to_move"),
        "fen_before": context.get("fen_before"),
        "played_move": context.get("played_move"),
        "move_fact": context.get("move_fact"),
        "best_move": context.get("best_move"),
        "eval_before_cp": context.get("eval_before_cp"),
        "eval_after_cp": context.get("eval_after_cp"),
        "eval_loss_cp": context.get("eval_loss_cp"),
        "move_classification": context.get("move_classification"),
        "principal_variation": pv[:5],
        "user_question": context.get("user_question"),
        "explanation_level": context.get("explanation_level"),
        "response_language": context.get("response_language"),
    }


def build_coach_prompt(context: dict[str, Any], fast_mode: bool = False) -> str:
    language = context.get("response_language", "Chinese")
    section_names = (
        "1. What changed?\n2. Why was the best move better?\n3. Practical lesson"
        if language == "English"
        else "1. 局面发生了什么变化？\n2. 为什么最佳着法更好？\n3. 实战经验"
    )
    if fast_mode:
        fast_context = build_fast_context(context)
        return (
            f"{SYSTEM_PROMPT}\n\n"
            "Fast mode: answer very briefly. Use exactly the three sections below. "
            "Write at most two short sentences per section. "
            "Every section must mention at least one concrete provided field such as played move, best move, eval loss, classification, or principal variation. "
            "If the provided context is too thin, say that the engine data only supports a limited explanation. "
            "Do not include hidden reasoning or long analysis.\n"
            f"{section_names}\n\n"
            "Structured context:\n"
            f"{json.dumps(fast_context, ensure_ascii=False, separators=(',', ':'))}"
        )

    return (
        f"{SYSTEM_PROMPT}\n\n"
        "Use the structured context below. Keep the answer concise. "
        "Use exactly these three sections:\n"
        f"{section_names}\n\n"
        "Structured context:\n"
        f"{json.dumps(context, ensure_ascii=False, indent=2)}"
    )
