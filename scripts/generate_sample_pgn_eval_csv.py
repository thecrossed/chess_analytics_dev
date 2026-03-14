#!/usr/bin/env python3
"""Generate per-move Stockfish evaluations from sample-pgn.md into CSV.

This script uses the Stockfish-backed API at https://chess-api.com/v1.
It evaluates the position after each ply by sending progressively longer
move-text prefixes.
"""

from __future__ import annotations

import csv
import json
import math
import os
import re
import shutil
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    import chess  # type: ignore
    import chess.engine  # type: ignore
except Exception:
    chess = None  # type: ignore

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from opening_index import classify_book_moves


DEFAULT_INPUT = Path("sample-pgn.md")
DEFAULT_OUTPUT = Path("sample-pgn-eval.csv")
DEFAULT_API_URL = "https://chess-api.com/v1"
DEFAULT_OPENING_API_URL = "https://explorer.lichess.ovh/lichess"
DEFAULT_DEPTH = 18
DEFAULT_SLEEP_SECONDS = 0.2
USER_AGENT = "ChessAnalytics/1.0 (contact: chessalwaysfun@gmail.com)"
STARTPOS_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
PGN_ENGINE_MODE = os.environ.get("PGN_ENGINE_MODE", "auto").strip().lower() or "auto"
LOCAL_STOCKFISH_PATH = os.environ.get("LOCAL_STOCKFISH_PATH", "stockfish").strip() or "stockfish"
try:
    LOCAL_STOCKFISH_THREADS = max(1, int(os.environ.get("LOCAL_STOCKFISH_THREADS", "2")))
except Exception:
    LOCAL_STOCKFISH_THREADS = 2
try:
    LOCAL_STOCKFISH_HASH_MB = max(16, int(os.environ.get("LOCAL_STOCKFISH_HASH_MB", "128")))
except Exception:
    LOCAL_STOCKFISH_HASH_MB = 128

RESULT_TOKENS = {"1-0", "0-1", "1/2-1/2", "*"}


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def extract_moves_text(pgn_text: str) -> str:
    lines = [line.strip() for line in pgn_text.splitlines()]
    move_lines = [line for line in lines if line and not line.startswith("[")]
    return " ".join(move_lines).strip()


def parse_san_moves(moves_text: str) -> List[str]:
    # Remove comments/variations/NAGs first.
    text = re.sub(r"\{[^}]*\}", " ", moves_text)
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"\$\d+", " ", text)
    tokens = re.split(r"\s+", text.strip())

    moves: List[str] = []
    for token in tokens:
        token = token.strip()
        if not token:
            continue
        if token in RESULT_TOKENS:
            continue
        if re.fullmatch(r"\d+\.(\.\.)?", token):
            continue
        if re.fullmatch(r"\d+\.", token):
            continue
        # Remove move-number prefixes like "34...Qh4" / "12.Nf3".
        token = re.sub(r"^\d+\.(\.\.)?", "", token)
        token = token.strip()
        if not token or token in RESULT_TOKENS:
            continue
        moves.append(token)
    return moves


def extract_start_fen(pgn_text: str) -> str:
    match = re.search(r'^\[FEN\s+"([^"]+)"\]\s*$', pgn_text, re.MULTILINE)
    if match and match.group(1).strip():
        return match.group(1).strip()
    return STARTPOS_FEN


def compute_local_pre_move_fens(san_moves: List[str], start_fen: str) -> List[str]:
    # Best-effort local FEN reconstruction for each ply.
    if chess is None:
        return [start_fen for _ in san_moves]
    try:
        board = chess.Board(start_fen)
    except Exception:
        board = chess.Board(STARTPOS_FEN)

    fens: List[str] = []
    for san in san_moves:
        fens.append(board.fen())
        try:
            board.push_san(san)
        except Exception:
            # Keep list length stable; fallback to current board FEN for remaining plies.
            pass
    return fens


def build_pgn_prefix(moves: List[str]) -> str:
    parts: List[str] = []
    move_no = 1
    for i in range(0, len(moves), 2):
        white = moves[i]
        black = moves[i + 1] if i + 1 < len(moves) else None
        if black:
            parts.append(f"{move_no}. {white} {black}")
        else:
            parts.append(f"{move_no}. {white}")
        move_no += 1
    return " ".join(parts)


def call_stockfish_api(api_url: str, input_text: str, depth: int) -> Dict:
    payload = {"input": input_text, "depth": depth}
    req = Request(
        api_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    with urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def can_use_local_stockfish() -> bool:
    if PGN_ENGINE_MODE == "api":
        return False
    if chess is None:
        return False
    if os.path.isabs(LOCAL_STOCKFISH_PATH):
        return os.path.exists(LOCAL_STOCKFISH_PATH)
    return shutil.which(LOCAL_STOCKFISH_PATH) is not None


def score_to_eval_string(score_obj) -> str:
    if not score_obj or chess is None:
        return ""
    white_score = score_obj.white()
    mate = white_score.mate()
    if isinstance(mate, int):
        return f"mate {mate}"
    cp = white_score.score()
    if isinstance(cp, int):
        return f"{cp / 100:.2f}"
    return ""


def normalize_san_token(value: str) -> str:
    token = (value or "").strip()
    token = re.sub(r"[!?]+$", "", token)
    token = token.rstrip("+#")
    return token


def fetch_opening_san_moves(opening_api_url: str, fen: str) -> List[str] | None:
    query = {
        "fen": fen,
        "moves": 50,
        "topGames": 0,
        "recentGames": 0,
        "variant": "standard",
    }
    url = f"{opening_api_url}?{urlencode(query)}"
    req = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=15) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception:
        return None
    moves = data.get("moves")
    if not isinstance(moves, list):
        return None
    result: List[str] = []
    for move in moves:
        if not isinstance(move, dict):
            continue
        san = move.get("san")
        if isinstance(san, str) and san.strip():
            result.append(san.strip())
    return result


def normalize_eval_score(data: Dict) -> str:
    eval_value = data.get("eval")
    centipawns = data.get("centipawns")
    mate = data.get("mate")
    if isinstance(eval_value, (int, float)):
        return str(eval_value)
    if isinstance(centipawns, int):
        return f"{centipawns / 100:.2f}"
    if isinstance(mate, int):
        return f"mate {mate}"
    return ""


def extract_bestmove_eval_score(data: Dict) -> str:
    for key in ("bestmove_eval", "bestMoveEval", "best_move_eval", "best_eval"):
        value = data.get(key)
        if isinstance(value, (int, float)):
            return str(value)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return normalize_eval_score(data)


def compute_eval_gap(eval_score: str, bestmove_eval: str) -> str:
    try:
        actual = float(str(eval_score).strip())
        best = float(str(bestmove_eval).strip())
    except Exception:
        return ""
    return f"{abs(actual - best):.2f}"


def compute_accuracy(side: str, eval_score: str, bestmove_eval: str) -> str:
    try:
        actual = float(str(eval_score).strip())
        best = float(str(bestmove_eval).strip())
    except Exception:
        return ""
    loss = (best - actual) if side == "white" else (actual - best)
    loss = max(0.0, loss)
    return f"{100.0 * math.exp(-0.9 * loss):.1f}"


def extract_bestmove(data: Dict) -> str:
    def normalize_token(token: str) -> str:
        return token.strip() if isinstance(token, str) else ""

    def first_move_from_text(text: str) -> str:
        cleaned = (text or "").strip()
        if not cleaned:
            return ""
        tokens = parse_san_moves(cleaned)
        if tokens:
            return tokens[0]
        parts = re.split(r"\s+", cleaned)
        for part in parts:
            token = part.strip()
            if not token:
                continue
            if re.fullmatch(r"\d+\.(\.\.)?", token):
                continue
            if token in {"1-0", "0-1", "1/2-1/2", "*"}:
                continue
            return token
        return ""

    def extract_from_move_object(obj: Dict) -> str:
        if not isinstance(obj, dict):
            return ""
        for key in (
            "san",
            "move",
            "uci",
            "bestmove",
            "bestMove",
            "best_move",
            "bestmove_uci",
            "bestMoveUci",
            "best_move_uci",
        ):
            value = obj.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        src = obj.get("from")
        dst = obj.get("to")
        promo = obj.get("promotion")
        if isinstance(src, str) and isinstance(dst, str) and len(src) >= 2 and len(dst) >= 2:
            uci = f"{src.strip()}{dst.strip()}"
            if isinstance(promo, str) and promo.strip():
                uci += promo.strip().lower()[:1]
            return uci
        return ""

    for key in (
        "continuation",
        "pv",
        "principal_variation",
        "line",
        "continuationArr",
        "continuation_arr",
        "moves",
        "bestmove_san",
        "bestMoveSan",
        "best_move_san",
        "bestmove_uci",
        "bestMoveUci",
        "best_move_uci",
        "uci",
        "bestmove",
        "bestMove",
        "best_move",
    ):
        value = data.get(key)
        if isinstance(value, str):
            first = first_move_from_text(value)
            if first:
                return first
        if isinstance(value, list):
            for item in value:
                if isinstance(item, str):
                    token = first_move_from_text(item)
                    if token:
                        return token
                elif isinstance(item, dict):
                    token = extract_from_move_object(item)
                    if token:
                        return token
        if isinstance(value, dict):
            token = extract_from_move_object(value)
            if token:
                return token

    for compound in ("bestmove", "bestMove", "best_move", "move", "best"):
        obj = data.get(compound)
        if isinstance(obj, dict):
            token = extract_from_move_object(obj)
            if token:
                return token

    src = normalize_token(data.get("from"))  # type: ignore[arg-type]
    dst = normalize_token(data.get("to"))  # type: ignore[arg-type]
    promo = normalize_token(data.get("promotion"))  # type: ignore[arg-type]
    if src and dst:
        return f"{src}{dst}{promo[:1].lower() if promo else ''}"
    return ""


def evaluate_all_moves(
    san_moves: List[str],
    pgn_text: str,
    api_url: str,
    opening_api_url: str,
    depth: int,
    sleep_seconds: float,
) -> List[Dict[str, str]]:
    if can_use_local_stockfish():
        try:
            return evaluate_all_moves_with_local_stockfish(
                san_moves=san_moves,
                pgn_text=pgn_text,
                opening_api_url=opening_api_url,
                depth=depth,
                sleep_seconds=sleep_seconds,
            )
        except Exception:
            pass

    rows: List[Dict[str, str]] = []
    progressive: List[str] = []
    initial_position_data = None
    try:
        initial_position_data = call_stockfish_api(
            api_url=api_url,
            input_text="",
            depth=depth,
        )
    except Exception:
        try:
            initial_position_data = call_stockfish_api(
                api_url=api_url,
                input_text=STARTPOS_FEN,
                depth=depth,
            )
        except Exception:
            initial_position_data = None
    if not initial_position_data or not extract_bestmove(initial_position_data):
        try:
            initial_position_data = call_stockfish_api(
                api_url=api_url,
                input_text=STARTPOS_FEN,
                depth=depth,
            )
        except Exception:
            pass
    previous_played_data = None
    start_fen = extract_start_fen(pgn_text)
    local_pre_move_fens = compute_local_pre_move_fens(san_moves, start_fen)
    local_book_rows = classify_book_moves(san_moves, start_fen)
    forced_first_bestmove = extract_bestmove(initial_position_data or {})
    forced_first_bestmove_eval = extract_bestmove_eval_score(initial_position_data or {})

    for ply, san in enumerate(san_moves, start=1):
        move_number = (ply + 1) // 2
        side = "white" if ply % 2 == 1 else "black"

        row: Dict[str, str] = {
            "move_number": str(move_number),
            "side": side,
            "move": san,
            "eval_score": "",
            "bestmove": "",
            "bestmove_eval": "",
            "eval_gap": "",
            "accuracy": "",
            "fen_before_move": "",
            "is_book_move": "unknown",
            "opening_eco": "",
            "opening_name": "",
        }

        pre_move_data = previous_played_data if previous_played_data is not None else initial_position_data
        if isinstance(pre_move_data, dict):
            row["bestmove"] = extract_bestmove(pre_move_data)
            row["bestmove_eval"] = extract_bestmove_eval_score(pre_move_data)

        pre_fen = local_pre_move_fens[ply - 1] if ply - 1 < len(local_pre_move_fens) else start_fen
        if isinstance(pre_move_data, dict):
            fen_value = pre_move_data.get("fen")
            if isinstance(fen_value, str) and fen_value.strip():
                pre_fen = fen_value.strip()
        row["fen_before_move"] = pre_fen
        if ply - 1 < len(local_book_rows):
            row["is_book_move"] = local_book_rows[ply - 1].is_book_move
            row["opening_eco"] = local_book_rows[ply - 1].opening_eco
            row["opening_name"] = local_book_rows[ply - 1].opening_name

        # Hard rule: first move bestmove/bestmove_eval always comes from start position.
        if ply == 1:
            if forced_first_bestmove:
                row["bestmove"] = forced_first_bestmove
            if forced_first_bestmove_eval:
                row["bestmove_eval"] = forced_first_bestmove_eval

        progressive.append(san)
        pgn_prefix = build_pgn_prefix(progressive)
        try:
            data = call_stockfish_api(api_url, pgn_prefix, depth)
            row["eval_score"] = normalize_eval_score(data)
            previous_played_data = data
        except (HTTPError, URLError, Exception):
            row["eval_score"] = ""
            previous_played_data = None
        row["eval_gap"] = compute_eval_gap(row["eval_score"], row["bestmove_eval"])
        row["accuracy"] = compute_accuracy(row["side"], row["eval_score"], row["bestmove_eval"])

        rows.append(row)
        if sleep_seconds > 0:
            time.sleep(sleep_seconds)
    return rows


def evaluate_all_moves_with_local_stockfish(
    san_moves: List[str],
    pgn_text: str,
    opening_api_url: str,
    depth: int,
    sleep_seconds: float,
) -> List[Dict[str, str]]:
    if chess is None:
        raise RuntimeError("python-chess is not available")

    rows: List[Dict[str, str]] = []
    start_fen = extract_start_fen(pgn_text)
    local_book_rows = classify_book_moves(san_moves, start_fen)
    board = chess.Board(start_fen)
    limit = chess.engine.Limit(depth=depth)

    with chess.engine.SimpleEngine.popen_uci(LOCAL_STOCKFISH_PATH) as engine:
        engine.configure({"Threads": LOCAL_STOCKFISH_THREADS, "Hash": LOCAL_STOCKFISH_HASH_MB})

        pre_info: Optional[Dict[str, Any]] = None
        try:
            pre_info = engine.analyse(board, limit)
        except Exception:
            pre_info = None

        for ply, san in enumerate(san_moves, start=1):
            pre_fen = board.fen()
            row: Dict[str, str] = {
                "move_number": str((ply + 1) // 2),
                "side": "white" if ply % 2 == 1 else "black",
                "move": san,
                "eval_score": "",
                "bestmove": "",
                "bestmove_eval": "",
                "eval_gap": "",
                "accuracy": "",
                "fen_before_move": pre_fen,
                "is_book_move": "unknown",
                "opening_eco": "",
                "opening_name": "",
            }

            if ply - 1 < len(local_book_rows):
                row["is_book_move"] = local_book_rows[ply - 1].is_book_move
                row["opening_eco"] = local_book_rows[ply - 1].opening_eco
                row["opening_name"] = local_book_rows[ply - 1].opening_name

            if pre_info:
                pv = pre_info.get("pv")
                if isinstance(pv, list) and len(pv) > 0:
                    try:
                        row["bestmove"] = pv[0].uci()
                    except Exception:
                        row["bestmove"] = ""
                row["bestmove_eval"] = score_to_eval_string(pre_info.get("score"))

            if ply == 1 and pre_info:
                pv = pre_info.get("pv")
                if isinstance(pv, list) and len(pv) > 0:
                    try:
                        row["bestmove"] = pv[0].uci()
                    except Exception:
                        pass
                first_eval = score_to_eval_string(pre_info.get("score"))
                if first_eval:
                    row["bestmove_eval"] = first_eval

            try:
                board.push_san(san)
            except Exception:
                pre_info = None
                rows.append(row)
                continue

            try:
                post_info = engine.analyse(board, limit)
                row["eval_score"] = score_to_eval_string(post_info.get("score"))
                pre_info = post_info
            except Exception:
                row["eval_score"] = ""
                pre_info = None

            row["eval_gap"] = compute_eval_gap(row["eval_score"], row["bestmove_eval"])
            row["accuracy"] = compute_accuracy(row["side"], row["eval_score"], row["bestmove_eval"])

            rows.append(row)
            if sleep_seconds > 0:
                time.sleep(sleep_seconds)

    return rows


def write_csv(output_path: Path, rows: List[Dict[str, str]]) -> None:
    fieldnames = [
        "move_number",
        "side",
        "move",
        "eval_score",
        "bestmove",
        "bestmove_eval",
        "eval_gap",
        "accuracy",
        "fen_before_move",
        "is_book_move",
        "opening_eco",
        "opening_name",
    ]
    with output_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    pgn_text = read_text(DEFAULT_INPUT)
    moves_text = extract_moves_text(pgn_text)
    san_moves = parse_san_moves(moves_text)
    rows = evaluate_all_moves(
        san_moves=san_moves,
        pgn_text=pgn_text,
        api_url=DEFAULT_API_URL,
        opening_api_url=DEFAULT_OPENING_API_URL,
        depth=DEFAULT_DEPTH,
        sleep_seconds=DEFAULT_SLEEP_SECONDS,
    )
    write_csv(DEFAULT_OUTPUT, rows)
    print(f"Wrote {len(rows)} rows to {DEFAULT_OUTPUT}")


if __name__ == "__main__":
    main()
