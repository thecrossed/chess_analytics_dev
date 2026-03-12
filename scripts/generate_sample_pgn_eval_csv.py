#!/usr/bin/env python3
"""Generate per-move Stockfish evaluations from sample-pgn.md into CSV.

This script uses the Stockfish-backed API at https://chess-api.com/v1.
It evaluates the position after each ply by sending progressively longer
move-text prefixes.
"""

from __future__ import annotations

import csv
import json
import re
import time
from pathlib import Path
from typing import Dict, List
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_INPUT = Path("sample-pgn.md")
DEFAULT_OUTPUT = Path("sample-pgn-eval.csv")
DEFAULT_API_URL = "https://chess-api.com/v1"
DEFAULT_DEPTH = 18
DEFAULT_SLEEP_SECONDS = 0.2
USER_AGENT = "ChessAnalytics/1.0 (contact: chessalwaysfun@gmail.com)"

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


def evaluate_all_moves(
    san_moves: List[str],
    api_url: str,
    depth: int,
    sleep_seconds: float,
) -> List[Dict[str, str]]:
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
                input_text="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                depth=depth,
            )
        except Exception:
            initial_position_data = None
    previous_played_data = None

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
        }

        pre_move_data = previous_played_data if previous_played_data is not None else initial_position_data
        if isinstance(pre_move_data, dict):
            best_move = pre_move_data.get("move")
            if not isinstance(best_move, str):
                line = pre_move_data.get("line")
                if isinstance(line, str):
                    best_move = line.split(" ")[0].strip() if line.strip() else ""
            best_eval_value = pre_move_data.get("continuationArrEval")
            pre_eval_value = pre_move_data.get("eval")
            pre_centipawns = pre_move_data.get("centipawns")
            pre_mate = pre_move_data.get("mate")

            if isinstance(best_move, str):
                row["bestmove"] = best_move
            if isinstance(best_eval_value, (int, float)):
                row["bestmove_eval"] = str(best_eval_value)
            elif isinstance(pre_eval_value, (int, float)):
                row["bestmove_eval"] = str(pre_eval_value)
            elif isinstance(pre_centipawns, int):
                row["bestmove_eval"] = f"{pre_centipawns / 100:.2f}"
            elif isinstance(pre_mate, int):
                row["bestmove_eval"] = f"mate {pre_mate}"

        progressive.append(san)
        pgn_prefix = build_pgn_prefix(progressive)
        try:
            data = call_stockfish_api(api_url, pgn_prefix, depth)
            eval_value = data.get("eval")
            centipawns = data.get("centipawns")
            mate = data.get("mate")
            if isinstance(eval_value, (int, float)):
                row["eval_score"] = str(eval_value)
            elif isinstance(centipawns, int):
                row["eval_score"] = f"{centipawns / 100:.2f}"
            elif isinstance(mate, int):
                row["eval_score"] = f"mate {mate}"
            previous_played_data = data
        except (HTTPError, URLError, Exception):
            row["eval_score"] = ""
            previous_played_data = None

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
        api_url=DEFAULT_API_URL,
        depth=DEFAULT_DEPTH,
        sleep_seconds=DEFAULT_SLEEP_SECONDS,
    )
    write_csv(DEFAULT_OUTPUT, rows)
    print(f"Wrote {len(rows)} rows to {DEFAULT_OUTPUT}")


if __name__ == "__main__":
    main()
