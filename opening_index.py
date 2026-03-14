from __future__ import annotations

import csv
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Set

try:
    import chess  # type: ignore
except Exception:
    chess = None  # type: ignore


STARTPOS_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
RESULT_TOKENS = {"1-0", "0-1", "1/2-1/2", "*"}
ECO_DIR = Path(__file__).resolve().parent / "data" / "eco"


@dataclass(frozen=True)
class OpeningInfo:
    eco: str
    name: str
    pgn: str
    ply: int


@dataclass(frozen=True)
class MoveBookInfo:
    is_book_move: str
    opening_eco: str
    opening_name: str


_INDEX_LOCK = threading.Lock()
_OPENING_BY_EPD: Optional[Dict[str, OpeningInfo]] = None
_BOOK_MOVES_BY_EPD: Optional[Dict[str, Set[str]]] = None


def normalize_san_token(value: str) -> str:
    token = (value or "").strip()
    token = re.sub(r"[!?]+$", "", token)
    token = token.rstrip("+#")
    return token


def parse_san_moves_text(moves_text: str) -> List[str]:
    text = re.sub(r"\{[^}]*\}", " ", moves_text)
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"\$\d+", " ", text)
    tokens = re.split(r"\s+", text.strip())

    moves: List[str] = []
    for token in tokens:
        token = token.strip()
        if not token or token in RESULT_TOKENS:
            continue
        if re.fullmatch(r"\d+\.(\.\.)?", token):
            continue
        token = re.sub(r"^\d+\.(\.\.)?", "", token).strip()
        if not token or token in RESULT_TOKENS:
            continue
        moves.append(token)
    return moves


def _load_opening_index() -> tuple[Dict[str, OpeningInfo], Dict[str, Set[str]]]:
    opening_by_epd: Dict[str, OpeningInfo] = {}
    book_moves_by_epd: Dict[str, Set[str]] = {}
    if chess is None:
        return opening_by_epd, book_moves_by_epd

    for path in sorted(ECO_DIR.glob("*.tsv")):
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            for row in reader:
                eco = str(row.get("eco") or "").strip()
                name = str(row.get("name") or "").strip()
                pgn = str(row.get("pgn") or "").strip()
                if not eco or not name or not pgn:
                    continue

                board = chess.Board(STARTPOS_FEN)
                san_moves = parse_san_moves_text(pgn)
                valid = True
                for san in san_moves:
                    pre_epd = board.epd()
                    normalized = normalize_san_token(san)
                    if normalized:
                        book_moves_by_epd.setdefault(pre_epd, set()).add(normalized)
                    try:
                        board.push_san(san)
                    except Exception:
                        valid = False
                        break

                if not valid:
                    continue

                post_epd = board.epd()
                info = OpeningInfo(eco=eco, name=name, pgn=pgn, ply=len(san_moves))
                previous = opening_by_epd.get(post_epd)
                if previous is None or info.ply >= previous.ply:
                    opening_by_epd[post_epd] = info

    return opening_by_epd, book_moves_by_epd


def ensure_opening_index_loaded() -> tuple[Dict[str, OpeningInfo], Dict[str, Set[str]]]:
    global _OPENING_BY_EPD, _BOOK_MOVES_BY_EPD
    if _OPENING_BY_EPD is not None and _BOOK_MOVES_BY_EPD is not None:
        return _OPENING_BY_EPD, _BOOK_MOVES_BY_EPD
    with _INDEX_LOCK:
        if _OPENING_BY_EPD is None or _BOOK_MOVES_BY_EPD is None:
            _OPENING_BY_EPD, _BOOK_MOVES_BY_EPD = _load_opening_index()
    return _OPENING_BY_EPD or {}, _BOOK_MOVES_BY_EPD or {}


def classify_book_moves(san_moves: List[str], start_fen: str = STARTPOS_FEN) -> List[MoveBookInfo]:
    if chess is None:
        return [MoveBookInfo(is_book_move="unknown", opening_eco="", opening_name="") for _ in san_moves]

    opening_by_epd, book_moves_by_epd = ensure_opening_index_loaded()
    if not opening_by_epd and not book_moves_by_epd:
        return [MoveBookInfo(is_book_move="unknown", opening_eco="", opening_name="") for _ in san_moves]

    try:
        board = chess.Board(start_fen)
    except Exception:
        board = chess.Board(STARTPOS_FEN)

    rows: List[MoveBookInfo] = []
    current_opening: Optional[OpeningInfo] = opening_by_epd.get(board.epd())
    for san in san_moves:
        pre_epd = board.epd()
        allowed = book_moves_by_epd.get(pre_epd)
        normalized = normalize_san_token(san)
        is_book_move = "yes" if allowed and normalized in allowed else ""

        try:
            board.push_san(san)
        except Exception:
            rows.append(
                MoveBookInfo(
                    is_book_move=is_book_move,
                    opening_eco=current_opening.eco if is_book_move == "yes" and current_opening else "",
                    opening_name=current_opening.name if is_book_move == "yes" and current_opening else "",
                )
            )
            current_opening = None
            continue

        matched = opening_by_epd.get(board.epd())
        if matched is not None:
            current_opening = matched
        rows.append(
            MoveBookInfo(
                is_book_move=is_book_move,
                opening_eco=current_opening.eco if is_book_move == "yes" and current_opening else "",
                opening_name=current_opening.name if is_book_move == "yes" and current_opening else "",
            )
        )

    return rows
